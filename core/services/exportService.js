import archiver from 'archiver';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';
import { noteService } from './noteService.js';
import { attachmentService } from './attachmentService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ExportService {
  /**
   * Export all notes and attachments as an Obsidian-ready ZIP stream
   * @param {import('stream').Writable} outputStream
   */
  async exportVaultToZip(outputStream) {
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(outputStream);

    // Fetch all active notes with tags and properties
    const [notes] = await pool.query(
      `SELECT * FROM notes WHERE status != 'trash' ORDER BY title ASC`
    );

    for (const note of notes) {
      const fullNote = await noteService.getNoteById(note.id);
      if (!fullNote) continue;

      // Build YAML frontmatter
      const frontmatterLines = ['---'];
      frontmatterLines.push(`title: "${fullNote.title.replace(/"/g, '\\"')}"`);
      frontmatterLines.push(`id: "${fullNote.id}"`);
      frontmatterLines.push(`status: "${fullNote.status}"`);
      if (fullNote.dueDate) frontmatterLines.push(`due_date: "${fullNote.dueDate}"`);
      if (fullNote.tags && fullNote.tags.length) {
        frontmatterLines.push(`tags:\n  - ${fullNote.tags.join('\n  - ')}`);
      }
      if (fullNote.properties && Object.keys(fullNote.properties).length) {
        frontmatterLines.push('properties:');
        for (const [k, v] of Object.entries(fullNote.properties)) {
          frontmatterLines.push(`  ${k}: ${JSON.stringify(v)}`);
        }
      }
      frontmatterLines.push('---', '');

      const fileContent = frontmatterLines.join('\n') + fullNote.content;
      const safeFilename = `${fullNote.title.replace(/[\/\\?%*:|"<>]/g, '_')}.md`;
      archive.append(fileContent, { name: safeFilename });
    }

    // Attachments
    const [attachments] = await pool.query(`SELECT * FROM attachments`);
    for (const att of attachments) {
      const diskPath = attachmentService.resolveDiskPath(att.storage_path);
      if (fs.existsSync(diskPath)) {
        archive.file(diskPath, { name: `attachments/${att.filename}` });
      }
    }

    await archive.finalize();
  }

  /**
   * Import notes from an Obsidian / Markdown ZIP archive buffer
   * @param {Buffer} zipBuffer
   */
  async importVaultFromZip(zipBuffer) {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    let importedNotes = 0;
    let importedAttachments = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const entryName = entry.entryName;

      // Handle Markdown files
      if (entryName.endsWith('.md')) {
        const text = entry.getData().toString('utf8');
        const filename = path.basename(entryName, '.md');

        // Simple frontmatter extractor
        let title = filename;
        let content = text;
        let tags = [];

        const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        if (fmMatch) {
          content = fmMatch[2];
          const fmText = fmMatch[1];
          const titleMatch = fmText.match(/title:\s*"?([^"\n\r]+)"?/);
          if (titleMatch) title = titleMatch[1];
        }

        await noteService.createNote({
          title,
          content,
          status: 'active',
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
