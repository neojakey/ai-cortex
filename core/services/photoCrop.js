// Crop an image attachment to a square, as a new attachment.
//
// The crop is saved under a new attachment id rather than written over the old file:
// attachment files are served with a one-year immutable cache, so reusing the address
// would keep showing the uncropped photo. The note's text is repointed at the new
// address (with the usual revision check), and the original is detached from the note
// but kept, so older versions of the note in its history still show their photo.
//
// ImageMagick does the work. The browser picks the square on the photo as it displays
// it, which is already turned upright from the camera's EXIF tag, so every size and
// coordinate here is measured after -auto-orient.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MIN_CROP_SIZE = 64;
export const MAX_OUTPUT_SIZE = 2048;

// Formats we re-encode in place. GIF is left out: cropping would drop its animation.
export const CROPPABLE_TYPES = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp'
};

export class PhotoCropError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PhotoCropError';
    this.status = status;
  }
}

/**
 * Check a requested square against the photo's upright size.
 * @param {{x: number, y: number, size: number}} rect in the photo's own pixels
 * @param {{width: number, height: number}} image
 * @returns {{x: number, y: number, size: number}}
 */
export function validateCropRect(rect, { width, height }) {
  const { x, y, size } = rect || {};
  if (![x, y, size].every(Number.isInteger)) {
    throw new PhotoCropError(400, 'x, y and size must be whole numbers of pixels');
  }
  if (size < MIN_CROP_SIZE) {
    throw new PhotoCropError(400, `The square must be at least ${MIN_CROP_SIZE} px`);
  }
  if (x < 0 || y < 0 || x + size > width || y + size > height) {
    throw new PhotoCropError(400, 'The square must fit inside the photo');
  }
  return { x, y, size };
}

/** The finished square's side: the chosen size, shrunk to 2048 px at most, never enlarged. */
export function outputSize(size) {
  return Math.min(size, MAX_OUTPUT_SIZE);
}

/** The photo's width and height once turned upright. */
export async function readUprightSize(sourcePath, magickBin) {
  const { stdout } = await execFileAsync(
    magickBin,
    [`${sourcePath}[0]`, '-auto-orient', '-format', '%w %h', 'info:'],
    { timeout: 30000 }
  );
  const [width, height] = String(stdout).trim().split(/\s+/).map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new PhotoCropError(422, "Couldn't read the photo's size");
  }
  return { width, height };
}

/** Render the square as a new image of the same format. Returns its bytes. */
export async function renderSquare(sourcePath, rect, mimeType, magickBin) {
  const format = CROPPABLE_TYPES[mimeType];
  const side = outputSize(rect.size);
  const { stdout } = await execFileAsync(
    magickBin,
    [
      `${sourcePath}[0]`, '-auto-orient',
      '-crop', `${rect.size}x${rect.size}+${rect.x}+${rect.y}`, '+repage',
      '-resize', `${side}x${side}`,
      '-quality', '88',
      `${format}:-`
    ],
    { timeout: 60000, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  );
  return stdout;
}

/**
 * Crop an attachment to a square and swap it into its note.
 *
 * Order matters, so a failure part-way never leaves the note's text pointing at nothing:
 *   1. save the square as a new attachment on the same note (same created_at, so it keeps
 *      the original's place, e.g. as the Journal calendar's cover photo)
 *   2. detach the original, only if it is still on this note. If not, someone else cropped
 *      it first: the new attachment is removed and this is a conflict
 *   3. repoint the note's text, if it links the original, checked against expectedRevision.
 *      If that fails, steps 1 and 2 are undone.
 *
 * @returns {Promise<{attachment: Object, note: Object}>}
 */
export async function cropAttachment({ attachmentId, rect, expectedRevision, magickBin, attachments, notes, pool }) {
  if (!magickBin) throw new PhotoCropError(503, 'Cropping needs ImageMagick, which is not installed');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new PhotoCropError(400, 'expectedRevision is required');
  }

  const original = await attachments.getAttachmentById(attachmentId);
  if (!original || !original.noteId) throw new PhotoCropError(404, 'Attachment not found');
  if (!CROPPABLE_TYPES[original.mimeType]) {
    throw new PhotoCropError(415, `Can't crop this type of file (${original.mimeType})`);
  }
  const note = await notes.getNoteById(original.noteId);
  if (!note) throw new PhotoCropError(404, 'Note not found');

  const source = attachments.resolveDiskPath(original.storagePath);
  let upright;
  try {
    upright = await readUprightSize(source, magickBin);
  } catch (err) {
    if (err instanceof PhotoCropError) throw err;
    throw new PhotoCropError(422, "Couldn't read the photo");
  }
  const square = validateCropRect(rect, upright);

  let buffer;
  try {
    buffer = await renderSquare(source, square, original.mimeType, magickBin);
  } catch {
    throw new PhotoCropError(422, "Couldn't crop the photo");
  }

  const cropped = await attachments.saveAttachment({
    noteId: original.noteId,
    filename: original.filename,
    mimeType: original.mimeType,
    buffer
  });
  await pool.query('UPDATE attachments SET created_at = ? WHERE id = ?', [original.createdAt, cropped.id]);

  const [detached] = await pool.query(
    'UPDATE attachments SET note_id = NULL WHERE id = ? AND note_id = ?',
    [original.id, original.noteId]
  );
  if (detached.affectedRows !== 1) {
    await attachments.deleteAttachment(cropped.id);
    throw new PhotoCropError(409, 'This photo was just changed somewhere else. Reload and try again.');
  }

  const oldUrl = `/api/attachments/${original.id}/file`;
  let updated = note;
  if ((note.content || '').includes(oldUrl)) {
    try {
      updated = await notes.updateNote(original.noteId, {
        content: note.content.split(oldUrl).join(cropped.url),
        expectedRevision
      });
    } catch (err) {
      await pool.query('UPDATE attachments SET note_id = ? WHERE id = ?', [original.noteId, original.id]);
      await attachments.deleteAttachment(cropped.id);
      throw err;
    }
  }

  return { attachment: { ...cropped, createdAt: original.createdAt }, note: updated };
}
