import archiver from 'archiver';
import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import mime from 'mime-types';
import { pool } from '../db/pool.js';
import { noteService } from './noteService.js';
import { attachmentService } from './attachmentService.js';
import { projectService } from './projectService.js';
import { markdownToPlaintext } from './parser.js';

// Guards against decompression bombs on import
const MAX_ZIP_ENTRIES = 5000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024; // 512 MB
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Matches this app's own attachment links, e.g. /api/attachments/<uuid>/file, so export can
// rewrite them to a portable relative path and import can rewrite them back.
const ATTACHMENT_URL_RE = /\/api\/attachments\/([0-9a-f-]{36})\/file/gi;
const MANIFEST_VERSION = 1;

function coercePropertyValue(type, value) {
  if (type === 'number') return Number(value);
  if (type === 'checkbox') return value === 'true' || value === '1';
  return value;
}

export class ExportService {
  /**
   * Export all notes and attachments as a portable ZIP: Obsidian-readable Markdown with YAML
   * frontmatter, plus a manifest.json of project metadata. Internal attachment links
   * (/api/attachments/<id>/file) are rewritten to a relative attachments/<filename> path, and
   * each note's frontmatter lists exactly the attachments that belong to it, so importing into
   * a fresh database can recreate both the links and the note/attachment associations.
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
      const [allAttachments] = await pool.query(`SELECT * FROM attachments`);
      const [allProjects] = await pool.query(`SELECT id, name, slug, color FROM projects`);
      const projectById = new Map(allProjects.map((p) => [p.id, p]));

      // Each attachment's exported name, computed once so the frontmatter list, the
      // rewritten content links, and the actual zip entry all agree with each other.
      const usedAttachmentNames = new Set();
      const attachmentExportName = new Map(); // attachment.id (lowercased) -> exported filename
      const attachmentNamesByNote = new Map(); // note.id -> [exported filename, ...]
      for (const att of allAttachments) {
        const diskPath = attachmentService.resolveDiskPath(att.storage_path);
        if (!fs.existsSync(diskPath)) continue; // unchanged: silently skip files missing on disk

        let name = att.filename;
        if (usedAttachmentNames.has(name.toLowerCase())) {
          name = `${att.sha256}-${att.filename}`;
        }
        usedAttachmentNames.add(name.toLowerCase());
        attachmentExportName.set(att.id.toLowerCase(), name);

        if (att.note_id) {
          if (!attachmentNamesByNote.has(att.note_id)) attachmentNamesByNote.set(att.note_id, []);
          attachmentNamesByNote.get(att.note_id).push(name);
        }
      }

      const usedNoteNames = new Set();

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

        const project = note.project_id ? projectById.get(note.project_id) : null;
        const noteAttachmentNames = attachmentNamesByNote.get(note.id) || [];
        const dueDate = note.due_date
          ? (note.due_date instanceof Date ? note.due_date.toISOString().slice(0, 10) : String(note.due_date).slice(0, 10))
          : null;

        const content = (note.content || '').replace(ATTACHMENT_URL_RE, (full, attId) => {
          const exportedName = attachmentExportName.get(attId.toLowerCase());
          return exportedName ? `attachments/${exportedName}` : full;
        });

        const frontmatter = {
          title: note.title,
          id: note.id,
          status: note.status,
          ...(dueDate ? { due_date: dueDate } : {}),
          ...(project ? { project: project.slug } : {}),
          ...(tags.length ? { tags } : {}),
          ...(Object.keys(properties).length ? { properties } : {}),
          ...(noteAttachmentNames.length ? { attachments: noteAttachmentNames } : {})
        };

        const fileContent = `---\n${YAML.stringify(frontmatter)}---\n\n${content}`;

        // Disambiguate notes that sanitize to the same filename
        const base = String(note.title).replace(/[\/\\?%*:|"<>]/g, '_');
        let safeFilename = `${base}.md`;
        if (usedNoteNames.has(safeFilename.toLowerCase())) {
          safeFilename = `${base}-${note.slug}.md`;
        }
        usedNoteNames.add(safeFilename.toLowerCase());

        archive.append(fileContent, { name: safeFilename });
      }

      // Attachment files themselves, under the same names just computed above.
      for (const att of allAttachments) {
        const name = attachmentExportName.get(att.id.toLowerCase());
        if (!name) continue; // missing on disk, already skipped above
        const diskPath = attachmentService.resolveDiskPath(att.storage_path);
        archive.file(diskPath, { name: `attachments/${name}` });
      }

      // Manifest: format version + project metadata, so import can recreate projects
      // (including color) even before any note is processed.
      archive.append(
        JSON.stringify({
          version: MANIFEST_VERSION,
          exportedAt: new Date().toISOString(),
          projects: allProjects.map((p) => ({ name: p.name, slug: p.slug, color: p.color }))
        }, null, 2),
        { name: 'manifest.json' }
      );

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
   * Parse the frontmatter (title, id, status, tags, due date, project, properties,
   * attachments) out of an exported/Obsidian note, via a real YAML parser.
   * @param {string} text raw markdown file contents
   * @param {string} filename fallback title (file name without extension)
   */
  _parseVaultNote(text, filename) {
    const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!fmMatch) {
      return { id: null, title: filename, content: text, tags: [], status: 'active', dueDate: null, project: null, properties: {}, attachments: [] };
    }

    const content = fmMatch[2];
    let fm;
    try {
      fm = YAML.parse(fmMatch[1]) || {};
    } catch {
      // Malformed YAML: treat the whole block as absent rather than failing the import.
      return { id: null, title: filename, content: text, tags: [], status: 'active', dueDate: null, project: null, properties: {}, attachments: [] };
    }
    if (typeof fm !== 'object' || Array.isArray(fm)) fm = {};

    const title = typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : filename;

    // Only trust a well-formed UUID; anything else is ignored rather than stored.
    let id = null;
    if (typeof fm.id === 'string' && UUID_RE.test(fm.id.trim())) id = fm.id.trim().toLowerCase();

    const status = ['active', 'archived', 'trash'].includes(fm.status) ? fm.status : 'active';

    const dueDate = typeof fm.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fm.due_date)
      ? fm.due_date
      : null;

    const project = typeof fm.project === 'string' && fm.project.trim() ? fm.project.trim() : null;

    const tags = Array.isArray(fm.tags) ? fm.tags.filter((t) => typeof t === 'string' && t.trim()) : [];

    const properties = (fm.properties && typeof fm.properties === 'object' && !Array.isArray(fm.properties))
      ? fm.properties
      : {};

    const attachments = Array.isArray(fm.attachments)
      ? fm.attachments.filter((a) => typeof a === 'string' && a.trim())
      : [];

    return { id, title, content, tags, status, dueDate, project, properties, attachments };
  }

  /**
   * Import notes from a Markdown ZIP archive produced by exportVaultToZip (or a plain
   * Obsidian-style vault, which simply won't have manifest.json / the extra frontmatter
   * fields, and imports as it always has).
   *
   * All-or-nothing for notes: they are written in one transaction, so a failure leaves no
   * partial import. Attachment records created in the same run are removed on failure too.
   * Re-importing is safe: a note is skipped (never overwritten) if its frontmatter id
   * already exists or a note with the same title and content does; an attachment is
   * skipped (never re-created, and its existing ownership never reassigned) if the same
   * filename and hash are already stored — but a note that lists it is still linked to it
   * via the rewritten content, so a re-import still produces working links.
   * @param {Buffer} zipBuffer
   * @returns {Promise<{importedNotes: number, skippedNotes: number, importedAttachments: number, skippedAttachments: number}>}
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

    // Manifest projects, created/colored up front. Idempotent and safe outside the notes
    // transaction, same as how project creation already works as a side effect elsewhere
    // in this app (e.g. noteService.updateNote's project field).
    const manifestEntry = entries.find((e) => !e.isDirectory && e.entryName === 'manifest.json');
    if (manifestEntry) {
      let manifest;
      try { manifest = JSON.parse(manifestEntry.getData().toString('utf8')); } catch { manifest = null; }
      for (const p of manifest?.projects || []) {
        if (!p || typeof p.name !== 'string' || !p.name.trim()) continue;
        await projectService.getOrCreateByName(p.name);
        if (p.color) {
          await pool.query(`UPDATE projects SET color = ? WHERE name = ? AND color IS NULL`, [p.color, p.name]);
        }
      }
    }

    // Categorize entries up front: markdown notes, and every attachments/* file by its
    // basename. Notes are processed first and "claim" the attachment files their own
    // frontmatter lists; whatever's left over afterward imports unassociated, exactly as
    // a vault with no attachments: field always has.
    const mdEntries = entries.filter((e) => !e.isDirectory && e.entryName.endsWith('.md'));
    const attachmentEntries = new Map(); // basename -> zip entry
    for (const e of entries) {
      if (e.isDirectory) continue;
      if (e.entryName.startsWith('attachments/')) {
        attachmentEntries.set(path.basename(e.entryName), e);
      }
    }

    const result = { importedNotes: 0, skippedNotes: 0, importedAttachments: 0, skippedAttachments: 0 };
    const savedAttachmentIds = [];
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      for (const entry of mdEntries) {
        const text = entry.getData().toString('utf8');
        const parsed = this._parseVaultNote(text, path.basename(entry.entryName, '.md'));

        const [sameId] = parsed.id
          ? await conn.query(`SELECT id FROM notes WHERE id = ?`, [parsed.id])
          : [[]];
        const [sameContent] = sameId.length
          ? [[]]
          : await conn.query(
              `SELECT id FROM notes WHERE title = ? AND content = ? LIMIT 1`,
              [parsed.title.trim(), parsed.content]
            );
        if (sameId.length || sameContent.length) {
          result.skippedNotes++;
          continue;
        }

        // Resolve the project slug to its current name in this database; if the manifest
        // didn't cover it (a hand-edited or foreign vault), fall back to the slug itself
        // as a best-effort project name.
        let projectName;
        if (parsed.project) {
          const resolved = await projectService.getBySlugOrId(parsed.project);
          projectName = resolved ? resolved.name : parsed.project;
        }

        // Generated here (not left to createNote) so it's guaranteed to match the id the
        // attachments below are saved against — they need the note to already exist
        // (note_id is a foreign key), so the note is created first, with its content
        // still holding the portable attachments/<filename> paths, and patched below
        // once each referenced attachment has a real id to rewrite them to.
        const noteId = parsed.id || crypto.randomUUID();

        await noteService.createNote({
          id: noteId,
          title: parsed.title,
          content: parsed.content,
          status: parsed.status,
          dueDate: parsed.dueDate,
          properties: parsed.properties,
          customTags: parsed.tags,
          project: projectName,
          conn
        });
        result.importedNotes++;

        let content = parsed.content;
        let contentChanged = false;
        for (const filename of parsed.attachments) {
          const attEntry = attachmentEntries.get(filename);
          if (!attEntry) continue; // listed but not actually in the zip; nothing to link
          attachmentEntries.delete(filename); // claimed, whether new or a dedup match

          const buffer = attEntry.getData();
          const sha256 = attachmentService.computeHash(buffer);
          const [existing] = await conn.query(
            `SELECT id FROM attachments WHERE sha256 = ? AND filename = ? LIMIT 1`,
            [sha256, filename]
          );

          let attachmentId;
          if (existing.length) {
            attachmentId = existing[0].id; // reuse; ownership is never reassigned
            result.skippedAttachments++;
          } else {
            const saved = await attachmentService.saveAttachment({
              noteId,
              filename,
              mimeType: mime.lookup(filename) || 'application/octet-stream',
              buffer,
              conn
            });
            savedAttachmentIds.push(saved.id);
            attachmentId = saved.id;
            result.importedAttachments++;
          }

          if (content.includes(`attachments/${filename}`)) {
            content = content.split(`attachments/${filename}`).join(`/api/attachments/${attachmentId}/file`);
            contentChanged = true;
          }
        }

        // A direct patch, not noteService.updateNote: this is finishing the note's
        // initial creation (still inside the same transaction, before anyone could have
        // read it), not an edit, so it shouldn't bump the revision or snapshot a version.
        // Wikilinks/hashtags were already correctly extracted from createNote's own copy
        // of this content, since attachment-path substitution can't affect [[...]] or #tags.
        if (contentChanged) {
          await conn.query(
            `UPDATE notes SET content = ?, content_text = ? WHERE id = ?`,
            [content, markdownToPlaintext(content), noteId]
          );
        }
      }

      // Whatever's left in attachmentEntries wasn't claimed by any note's frontmatter
      // (a plain vault, or a stray file): import unassociated, exactly as before.
      for (const [filename, entry] of attachmentEntries) {
        const buffer = entry.getData();
        const [existing] = await conn.query(
          `SELECT id FROM attachments WHERE sha256 = ? AND filename = ? LIMIT 1`,
          [attachmentService.computeHash(buffer), filename]
        );
        if (existing.length) {
          result.skippedAttachments++;
          continue;
        }

        const saved = await attachmentService.saveAttachment({
          filename,
          mimeType: mime.lookup(filename) || 'application/octet-stream',
          buffer,
          conn
        });
        savedAttachmentIds.push(saved.id);
        result.importedAttachments++;
      }

      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      for (const attachmentId of savedAttachmentIds) {
        await attachmentService.deleteAttachment(attachmentId).catch(() => {});
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}

export const exportService = new ExportService();
export default exportService;
