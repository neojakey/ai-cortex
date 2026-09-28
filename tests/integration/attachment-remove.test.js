import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import app from '../../core/api/server.js';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { attachmentService } from '../../core/services/attachmentService.js';

let server;
let baseUrl;
const createdNotes = [];
const thumbsDir = path.resolve(attachmentService.storageDir, '..', 'thumbs');

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
    const [rows] = await pool.query('SELECT id FROM attachments WHERE filename LIKE ?', [`remove-${id}%`]);
    for (const row of rows) await attachmentService.deleteAttachment(row.id);
    await noteService.deleteNote(id, { permanent: true });
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function makeNote(content = 'base') {
  const note = await noteService.createNote({ title: `remove-${crypto.randomUUID()}`, content });
  createdNotes.push(note.id);
  return note;
}

// Unique bytes each time, so no two attachments share a file unless a test means them to.
function addFile(note, { name = 'photo.jpg', mimeType = 'image/jpeg', bytes } = {}) {
  return attachmentService.saveAttachment({
    noteId: note.id,
    filename: `remove-${note.id}-${name}`,
    mimeType,
    buffer: bytes || Buffer.from(`bytes-${crypto.randomUUID()}`)
  });
}

async function remove(attachmentId, body) {
  const res = await fetch(`${baseUrl}/api/attachments/${attachmentId}/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

async function rowExists(id) {
  const [rows] = await pool.query('SELECT 1 FROM attachments WHERE id = ?', [id]);
  return rows.length === 1;
}

test('remove: a photo in the note text is removed, with its line', async () => {
  const note = await makeNote();
  const photo = await addFile(note);
  const withPhoto = await noteService.updateNote(note.id, {
    content: `Intro\n\n![Photo](${photo.url})\n\nAfter`,
    expectedRevision: note.revision
  });

  const res = await remove(photo.id, { expectedRevision: withPhoto.revision });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.note.content, 'Intro\n\nAfter');
  assert.equal(res.body.note.revision, withPhoto.revision + 1);
  assert.deepEqual(res.body.note.attachments, []);

  assert.equal(await rowExists(photo.id), false);
  assert.equal(fs.existsSync(attachmentService.resolveDiskPath(photo.storagePath)), false, 'file deleted');
  assert.equal((await fetch(`${baseUrl}${photo.url}`)).status, 404);
});

test('remove: a photo not in the text (daily panel) is removed and the text left alone', async () => {
  const note = await makeNote('Some text');
  const photo = await addFile(note);
  const res = await remove(photo.id, { expectedRevision: note.revision });
  assert.equal(res.status, 200);
  assert.equal(res.body.note.content, 'Some text');
  assert.equal(res.body.note.revision, note.revision, 'nothing in the text changed, so no new revision');
  assert.equal(await rowExists(photo.id), false);
});

test('remove: any attachment type can be removed (a PDF linked with 📎)', async () => {
  const note = await makeNote();
  const pdf = await addFile(note, { name: 'report.pdf', mimeType: 'application/pdf' });
  const withLink = await noteService.updateNote(note.id, {
    content: `Report:\n\n[📎 report.pdf](${pdf.url})\n`,
    expectedRevision: note.revision
  });
  const res = await remove(pdf.id, { expectedRevision: withLink.revision });
  assert.equal(res.status, 200);
  assert.equal(res.body.note.content, 'Report:\n');
  assert.equal(await rowExists(pdf.id), false);
});

test('remove: only the chosen attachment goes; the others stay', async () => {
  const note = await makeNote();
  const keep = await addFile(note, { name: 'keep.jpg' });
  const drop = await addFile(note, { name: 'drop.jpg' });
  const withBoth = await noteService.updateNote(note.id, {
    content: `![k](${keep.url})\n\n![d](${drop.url})\n`,
    expectedRevision: note.revision
  });
  const res = await remove(drop.id, { expectedRevision: withBoth.revision });
  assert.equal(res.status, 200);
  assert.equal(res.body.note.content, `![k](${keep.url})\n`);
  assert.deepEqual(res.body.note.attachments.map((a) => a.id), [keep.id]);
});

test('remove: a note changed since it was read is a conflict, and nothing is removed', async () => {
  const note = await makeNote();
  const photo = await addFile(note);
  const withPhoto = await noteService.updateNote(note.id, {
    content: `![Photo](${photo.url})`,
    expectedRevision: note.revision
  });
  const edited = await noteService.updateNote(note.id, {
    content: `${withPhoto.content}\n\nedited elsewhere`,
    expectedRevision: withPhoto.revision
  });

  const res = await remove(photo.id, { expectedRevision: withPhoto.revision });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'REVISION_CONFLICT');
  assert.equal(await rowExists(photo.id), true);
  assert.ok(fs.existsSync(attachmentService.resolveDiskPath(photo.storagePath)), 'file still there');
  const stored = await noteService.getNoteById(note.id);
  assert.equal(stored.content, edited.content);
  assert.equal(stored.revision, edited.revision);
});

test('remove: a file shared with another note stays for that note', async () => {
  const a = await makeNote();
  const b = await makeNote();
  const bytes = Buffer.from(`shared-${crypto.randomUUID()}`);
  const onA = await addFile(a, { bytes });
  const onB = await addFile(b, { bytes });
  assert.equal(onA.storagePath, onB.storagePath, 'same bytes, same file on disk');

  const res = await remove(onA.id, { expectedRevision: a.revision });
  assert.equal(res.status, 200);
  assert.equal(await rowExists(onB.id), true);
  assert.equal((await fetch(`${baseUrl}${onB.url}`)).status, 200);
});

test('remove: its cached preview is deleted too, unless another note still has the file', async () => {
  const note = await makeNote();
  const other = await makeNote();
  const alone = await addFile(note, { name: 'alone.jpg' });
  const sharedBytes = Buffer.from(`shared-${crypto.randomUUID()}`);
  const shared = await addFile(note, { name: 'shared.jpg', bytes: sharedBytes });
  await addFile(other, { name: 'shared.jpg', bytes: sharedBytes });

  fs.mkdirSync(thumbsDir, { recursive: true });
  const aloneThumb = path.join(thumbsDir, `${alone.sha256}.480.jpg`);
  const sharedThumb = path.join(thumbsDir, `${shared.sha256}.480.jpg`);
  fs.writeFileSync(aloneThumb, 'thumb');
  fs.writeFileSync(sharedThumb, 'thumb');

  assert.equal((await remove(alone.id, { expectedRevision: note.revision })).status, 200);
  assert.equal((await remove(shared.id, { expectedRevision: note.revision })).status, 200);
  assert.equal(fs.existsSync(aloneThumb), false, 'preview of a file nobody has any more is gone');
  assert.equal(fs.existsSync(sharedThumb), true, 'preview still used by the other note is kept');
  fs.rmSync(sharedThumb, { force: true });
});

test('remove: missing expectedRevision is refused and nothing is removed', async () => {
  const note = await makeNote();
  const photo = await addFile(note);
  const res = await remove(photo.id, {});
  assert.equal(res.status, 400);
  assert.match(res.body.error, /expectedRevision/);
  assert.equal(await rowExists(photo.id), true);
});

test('remove: an unknown or already-removed attachment is a 404', async () => {
  const note = await makeNote();
  const photo = await addFile(note);
  assert.equal((await remove(crypto.randomUUID(), { expectedRevision: 1 })).status, 404);
  assert.equal((await remove(photo.id, { expectedRevision: note.revision })).status, 200);
  assert.equal((await remove(photo.id, { expectedRevision: note.revision })).status, 404);
});

test('remove: a cross-origin request is blocked', async () => {
  const note = await makeNote();
  const photo = await addFile(note);
  const res = await fetch(`${baseUrl}/api/attachments/${photo.id}/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ expectedRevision: note.revision })
  });
  assert.equal(res.status, 403);
  assert.equal(await rowExists(photo.id), true);
});
