// Remove an attachment from its note for good: the note's links to it, the record, the
// file (unless another record shares it) and its cached preview.
//
// Text first, then the file: if the text can't be saved (the note changed elsewhere),
// nothing is removed; if removing the file fails after the text was cleaned, the
// attachment is still there and removing it again finishes the job. The reverse order
// could leave the text pointing at a missing file.

import fs from 'node:fs';
import path from 'node:path';

export class AttachmentRemovalError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AttachmentRemovalError';
    this.status = status;
  }
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Take every markdown image or link to one attachment out of a note's text.
 * A line holding nothing but such links is removed whole, along with one of the blank
 * lines around it, so no gap is left behind. Nothing else in the text is touched.
 */
export function stripAttachmentLinks(content, attachmentId) {
  const url = escapeRegExp(`/api/attachments/${attachmentId}/file`);
  const link = `!?\\[[^\\]\\n]*\\]\\(${url}\\)`;
  const onlyLinks = new RegExp(`^\\s*(?:${link}\\s*)+$`);
  const inline = new RegExp(link, 'g');

  const lines = String(content || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (onlyLinks.test(lines[i])) {
      const previousBlank = out.length === 0 || out[out.length - 1].trim() === '';
      if (previousBlank && i + 1 < lines.length && lines[i + 1].trim() === '') i += 1;
      continue;
    }
    out.push(lines[i].replace(inline, ''));
  }
  return out.join('\n');
}

/**
 * @returns {Promise<{note: Object}>} the note as it is afterwards
 */
export async function removeAttachment({ attachmentId, expectedRevision, attachments, notes, pool, thumbsDir }) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new AttachmentRemovalError(400, 'expectedRevision is required');
  }
  const attachment = await attachments.getAttachmentById(attachmentId);
  if (!attachment || !attachment.noteId) throw new AttachmentRemovalError(404, 'Attachment not found');
  const note = await notes.getNoteById(attachment.noteId);
  if (!note) throw new AttachmentRemovalError(404, 'Note not found');

  const cleaned = stripAttachmentLinks(note.content, attachment.id);
  if (cleaned !== (note.content || '')) {
    await notes.updateNote(note.id, { content: cleaned, expectedRevision });
  }

  await attachments.deleteAttachment(attachment.id);

  // Previews are cached by content hash; drop them once nothing else has these bytes.
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM attachments WHERE sha256 = ?', [attachment.sha256]);
  if (Number(rows[0].n) === 0 && thumbsDir && fs.existsSync(thumbsDir)) {
    for (const name of fs.readdirSync(thumbsDir)) {
      if (name.startsWith(`${attachment.sha256}.`)) {
        fs.rmSync(path.join(thumbsDir, name), { force: true });
      }
    }
  }

  return { note: await notes.getNoteById(note.id) };
}
