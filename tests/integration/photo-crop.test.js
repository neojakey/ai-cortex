import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import app from '../../core/api/server.js';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { attachmentService } from '../../core/services/attachmentService.js';
import { magickBin, makeImage, describeImage, isBlue, isRed } from '../helpers/testImages.js';

let server;
let baseUrl;
const createdNotes = [];

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  for (const id of createdNotes) {
    // Crops keep the original's filename, so this also finds the detached originals.
    const [rows] = await pool.query('SELECT id FROM attachments WHERE filename LIKE ?', [`crop-${id}.%`]);
    for (const row of rows) await attachmentService.deleteAttachment(row.id);
    await noteService.deleteNote(id, { permanent: true });
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function makeNote(title = `crop-${crypto.randomUUID()}`) {
  const note = await noteService.createNote({ title, content: 'base' });
  createdNotes.push(note.id);
  return note;
}

// A 400×200 photo on the note: blue left half, red right half.
async function addPhoto(note, { format = 'jpeg', mimeType = 'image/jpeg', width = 400, height = 200 } = {}) {
  return attachmentService.saveAttachment({
    noteId: note.id,
    filename: `crop-${note.id}.${format}`,
    mimeType,
    buffer: makeImage({ width, height, format })
  });
}

async function embed(note, photo) {
  return noteService.updateNote(note.id, {
    content: `Before\n\n![Photo](${photo.url})\n\nAfter ![again](${photo.url})`,
    expectedRevision: note.revision
  });
}

async function crop(attachmentId, body) {
  const res = await fetch(`${baseUrl}/api/attachments/${attachmentId}/crop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

async function noteAttachmentIds(noteId) {
  const [rows] = await pool.query('SELECT id FROM attachments WHERE note_id = ? ORDER BY id', [noteId]);
  return rows.map((r) => r.id);
}

async function fileOf(url) {
  const res = await fetch(`${baseUrl}${url}`);
  assert.equal(res.status, 200, url);
  return Buffer.from(await res.arrayBuffer());
}

const needsMagick = { skip: !magickBin };

test('crop: a photo in the note text becomes a square and the text points at it', needsMagick, async () => {
  const note = await makeNote();
  const photo = await addPhoto(note);
  const withPhoto = await embed(note, photo);

  const res = await crop(photo.id, { x: 200, y: 0, size: 200, expectedRevision: withPhoto.revision });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { attachment, note: updated } = res.body;

  assert.notEqual(attachment.id, photo.id);
  assert.equal(attachment.noteId, note.id);
  assert.equal(attachment.mimeType, 'image/jpeg');
  const square = describeImage(await fileOf(attachment.url), { x: 100, y: 100 });
  assert.deepEqual([square.width, square.height], [200, 200]);
  assert.ok(isRed(square.pixel), `the right half was chosen, got ${square.pixel}`);

  assert.equal(updated.revision, withPhoto.revision + 1);
  assert.equal(updated.content, `Before\n\n![Photo](${attachment.url})\n\nAfter ![again](${attachment.url})`);
  const stored = await noteService.getNoteById(note.id);
  assert.equal(stored.content, updated.content);
});

test('crop: the original is detached from the note but still served (for note history)', needsMagick, async () => {
  const note = await makeNote();
  const photo = await addPhoto(note);
  const withPhoto = await embed(note, photo);

  const res = await crop(photo.id, { x: 0, y: 0, size: 200, expectedRevision: withPhoto.revision });
  assert.equal(res.status, 201);
  assert.deepEqual(await noteAttachmentIds(note.id), [res.body.attachment.id]);
  assert.deepEqual((await noteService.getNoteById(note.id)).attachments.map((a) => a.id), [res.body.attachment.id]);

  const original = describeImage(await fileOf(photo.url));
  assert.deepEqual([original.width, original.height], [400, 200]);
});

test('crop: a photo not in the text (daily "Add a photo") is swapped and the text left alone', needsMagick, async () => {
  const note = await makeNote();
  const photo = await addPhoto(note);

  const res = await crop(photo.id, { x: 0, y: 0, size: 200, expectedRevision: note.revision });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const stored = await noteService.getNoteById(note.id);
  assert.equal(stored.content, 'base');
  assert.equal(stored.revision, note.revision, 'nothing in the text changed, so no new revision');
  assert.deepEqual(await noteAttachmentIds(note.id), [res.body.attachment.id]);
  assert.ok(isBlue(describeImage(await fileOf(res.body.attachment.url), { x: 100, y: 100 }).pixel));
});

test('crop: keeps its place, e.g. as the Journal calendar cover photo', needsMagick, async () => {
  const day = String(1 + crypto.randomInt(28)).padStart(2, '0');
  const note = await makeNote(`Daily: 18${String(crypto.randomInt(100)).padStart(2, '0')}-02-${day}`);
  const first = await addPhoto(note);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await addPhoto(note, { width: 300 });
  const coverBefore = (await noteService.getJournalDays()).find((d) => d.noteId === note.id);
  assert.equal(coverBefore.photoId, first.id);

  const res = await crop(first.id, { x: 0, y: 0, size: 200, expectedRevision: note.revision });
  assert.equal(res.status, 201);
  const coverAfter = (await noteService.getJournalDays()).find((d) => d.noteId === note.id);
  assert.equal(coverAfter.photoId, res.body.attachment.id);
  assert.equal(coverAfter.imageCount, 2);
  assert.notEqual(coverAfter.photoId, second.id);
});

test('crop: a note changed since it was read is a conflict, and nothing changes', needsMagick, async () => {
  const note = await makeNote();
  const photo = await addPhoto(note);
  const withPhoto = await embed(note, photo);
  const edited = await noteService.updateNote(note.id, {
    content: `${withPhoto.content}\n\nedited elsewhere`,
    expectedRevision: withPhoto.revision
  });

  const res = await crop(photo.id, { x: 0, y: 0, size: 200, expectedRevision: withPhoto.revision });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'REVISION_CONFLICT');

  const stored = await noteService.getNoteById(note.id);
  assert.equal(stored.revision, edited.revision);
  assert.equal(stored.content, edited.content);
  assert.deepEqual(await noteAttachmentIds(note.id), [photo.id]);
  const [orphans] = await pool.query('SELECT COUNT(*) AS n FROM attachments WHERE filename = ?', [photo.filename]);
  assert.equal(Number(orphans[0].n), 1, 'the new square was removed again');
});

test('crop: a square outside the photo or too small is refused, and nothing changes', needsMagick, async () => {
  const note = await makeNote();
  const photo = await addPhoto(note);
  for (const rect of [
    { x: 201, y: 0, size: 200 },
    { x: 0, y: 0, size: 201 },
    { x: 0, y: 0, size: 63 },
    { x: 0, y: 0, size: 'big' },
    {}
  ]) {
    const res = await crop(photo.id, { ...rect, expectedRevision: note.revision });
    assert.equal(res.status, 400, JSON.stringify(rect));
  }
  assert.deepEqual(await noteAttachmentIds(note.id), [photo.id]);
});

test('crop: missing expectedRevision is refused', needsMagick, async () => {
  const note = await makeNote();
  const photo = await addPhoto(note);
  const res = await crop(photo.id, { x: 0, y: 0, size: 200 });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /expectedRevision/);
  assert.deepEqual(await noteAttachmentIds(note.id), [photo.id]);
});

test('crop: GIF and non-image attachments are refused as unsupported', needsMagick, async () => {
  const note = await makeNote();
  const gif = await addPhoto(note, { format: 'gif', mimeType: 'image/gif' });
  const pdf = await attachmentService.saveAttachment({
    noteId: note.id, filename: `crop-${note.id}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4')
  });
  for (const att of [gif, pdf]) {
    const res = await crop(att.id, { x: 0, y: 0, size: 100, expectedRevision: note.revision });
    assert.equal(res.status, 415, att.mimeType);
  }
});

test('crop: an unknown or already-cropped attachment is a 404', needsMagick, async () => {
  const note = await makeNote();
  const photo = await addPhoto(note);
  assert.equal((await crop(crypto.randomUUID(), { x: 0, y: 0, size: 100, expectedRevision: 1 })).status, 404);

  const first = await crop(photo.id, { x: 0, y: 0, size: 200, expectedRevision: note.revision });
  assert.equal(first.status, 201);
  const again = await crop(photo.id, { x: 0, y: 0, size: 200, expectedRevision: note.revision });
  assert.equal(again.status, 404);
  assert.deepEqual(await noteAttachmentIds(note.id), [first.body.attachment.id]);
});

test('crop: two crops of the same photo at once leave exactly one square', needsMagick, async () => {
  const note = await makeNote();
  const photo = await addPhoto(note);
  const results = await Promise.all([
    crop(photo.id, { x: 0, y: 0, size: 200, expectedRevision: note.revision }),
    crop(photo.id, { x: 200, y: 0, size: 200, expectedRevision: note.revision })
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.equal(statuses.filter((s) => s === 201).length, 1, `got ${statuses}`);
  assert.ok([404, 409].includes(statuses.find((s) => s !== 201)), `got ${statuses}`);
  const winner = results.find((r) => r.status === 201).body.attachment.id;
  assert.deepEqual(await noteAttachmentIds(note.id), [winner]);
});

test('crop: a cross-origin request is blocked', async () => {
  const res = await fetch(`${baseUrl}/api/attachments/${crypto.randomUUID()}/crop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ x: 0, y: 0, size: 100, expectedRevision: 1 })
  });
  assert.equal(res.status, 403);
});
