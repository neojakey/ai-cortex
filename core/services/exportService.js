import archiver from 'archiver';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../db/pool.js';
import { noteService } from './noteService.js';
import { attachmentService } from './attachmentService.js';

// Guards against decompression bombs on import
const MAX_ZIP_ENTRIES = 5000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024; // 512 MB

function coercePropertyValue(type, value) {
  if (type === 'number') return Number(value);
  if (type === 'checkbox') return value === 'true' || value === '1';
  return value;
}

export class ExportService {
  /**
   * Export all notes and attachments as an Obsidian-ready ZIP stream
   * @param {import('stream').Writable} outputStream
   */
  async exportVaultToZip(outputStream) {
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Surface archiver failures as a rejected promise instead of an unhandled 'error' event
    const archiveError = new Promise((_, reject) => archive.on('error', reject));
    archive.on('warning', (err) => console.warn('[export] archive warning:', err.message));

    archive.pipe(outputStream);

    const buildZip = (async () => {
      const [notes] = await pool.query(
        `SELECT * FROM notes WHERE status != 'trash' ORDER BY title ASC`
      );

      const usedNames = new Set();

      for (const note of notes) {
        const [tagRows] = await pool.query(
          `SELECT t.name FROM tags t
           JOIN note_tags nt ON t.id = nt.tag_id
           WHERE nt.note_id = ?
           ORDER BY t.name ASC`,
          [note.id]
        );
        const [propRows] = await pool.query(
          `SELECT property_name, property_type, property_value
           FROM note_properties WHERE note_id = ?`,
          [note.id]
        );

        const tags = tagRows.map((t) => t.name);
        const properties = {};
        for (const p of propRows) {
          properties[p.property_name] = coercePropertyValue(p.property_type, p.property_value);
        }

        // Build YAML frontmatter
        const frontmatterLines = ['---'];
        frontmatterLines.push(`title: "${String(note.title).replace(/"/g, '\\"')}"`);
        frontmatterLines.push(`id: "${note.id}"`);
        frontmatterLines.push(`status: "${note.status}"`);
        if (note.due_date) {
          const due = note.due_date instanceof Date
            ? note.due_date.toISOString().slice(0, 10)
            : String(note.due_date).slice(0, 10);
          frontmatterLines.push(`due_date: "${due}"`);
        }
        if (tags.length) {
          frontmatterLines.push(`tags:\n  - ${tags.join('\n  - ')}`);
        }
        if (Object.keys(properties).length) {
          frontmatterLines.push('properties:');
          for (const [k, v] of Object.entries(properties)) {
            frontmatterLines.push(`  ${k}: ${JSON.stringify(v)}`);
          }
        }
        frontmatterLines.push('---', '');

        const fileContent = frontmatterLines.join('\n') + (note.content || '');

        // Disambiguate notes that sanitize to the same filename
        const base = String(note.title).replace(/[\/\\?%*:|"<>]/g, '_');
        let safeFilename = `${base}.md`;
        if (usedNames.has(safeFilename.toLowerCase())) {
          safeFilename = `${base}-${note.slug}.md`;
        }
        usedNames.add(safeFilename.toLowerCase());

        archive.append(fileContent, { name: safeFilename });
      }

      // Attachments
      const [attachments] = await pool.query(`SELECT * FROM attachments`);
      const seenAttachmentNames = new Set();
      for (const att of attachments) {
        const diskPath = attachmentService.resolveDiskPath(att.storage_path);
        if (!fs.existsSync(diskPath)) continue;

        let name = `attachments/${att.filename}`;
        if (seenAttachmentNames.has(name.toLowerCase())) {
          name = `attachments/${att.sha256}-${att.filename}`;
        }
        seenAttachmentNames.add(name.toLowerCase());
        archive.file(diskPath, { name });
      }

      await archive.finalize();
    })();

    try {
      await Promise.race([buildZip, archiveError]);
    } finally {
      // Swallow a late archiver error (fired after finalize) so it isn't an unhandled rejection
      archiveError.catch(() => {});
    }
  }

  /**
   * Import notes from an Obsidian / Markdown ZIP archive buffer
   * @param {Buffer} zipBuffer
   */
  async importVaultFromZip(zipBuffer) {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    if (entries.length > MAX_ZIP_ENTRIES) {
      throw new Error(`Zip archive has too many entries (${entries.length} > ${MAX_ZIP_ENTRIES})`);
    }

    let totalUncompressed = 0;
    for (const entry of entries) {
      totalUncompressed += entry.header?.size || 0;
    }
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error('Zip archive exceeds the maximum allowed uncompressed size');
    }

    let importedNotes = 0;
    let importedAttachments = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const entryName = entry.entryName;

      // Handle Markdown files
      if (entryName.endsWith('.md')) {
        const text = entry.getData().toString('utf8');
        const filename = path.basename(entryName, '.md');

        let title = filename;
        let content = text;
        let tags = [];
        let status = 'active';

        const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        if (fmMatch) {
          content = fmMatch[2];
          const fmText = fmMatch[1];

          const titleMatch = fmText.match(/^title:\s*"?([^"\n\r]+)"?/m);
          if (titleMatch) title = titleMatch[1].trim();

          const statusMatch = fmText.match(/^status:\s*"?(active|archived|trash)"?/mi);
          if (statusMatch) status = statusMatch[1].toLowerCase();

          // Block-style: "tags:\n  - foo\n  - bar"
          const blockTags = fmText.match(/^tags:\s*\r?\n((?:[ \t]*-[ \t]*.+\r?\n?)+)/m);
          if (blockTags) {
            tags = blockTags[1]
              .split(/\r?\n/)
              .map((l) => l.replace(/^[ \t]*-[ \t]*/, '').trim().replace(/^["']|["']$/g, ''))
              .filter(Boolean);
          } else {
            // Inline-style: "tags: [foo, bar]"
            const inlineTags = fmText.match(/^tags:\s*\[([^\]]*)\]/m);
            if (inlineTags) {
              tags = inlineTags[1]
                .split(',')
                .map((s) => s.trim().replace(/^["']|["']$/g, ''))
                .filter(Boolean);
            }
          }
        }

        await noteService.createNote({
          title,
          content,
          status,
          customTags: tags
        });

        importedNotes++;
      } else if (entryName.startsWith('attachments/') && !entryName.endsWith('/')) {
        const buffer = entry.getData();
        const filename = path.basename(entryName);
        await attachmentService.saveAttachment({
          filename,
          mimeType: 'application/octet-stream',
          buffer
        });
        importedAttachments++;
      }
    }

    return { importedNotes, importedAttachments };
  }
}

export const exportService = new ExportService();
export default exportService;
