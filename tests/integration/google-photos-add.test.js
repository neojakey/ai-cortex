import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import app from '../../core/api/server.js';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { attachmentService } from '../../core/services/attachmentService.js';

// The whole "Add from Google Photos" path through the server, with Google faked: the
// server's own fetch is replaced for the duration, so no request ever leaves the machine.
// (Rejections before any fetch are in google-photos-import.test.js; the importer's own
// rules are unit tested in tests/unit/googlePhotosImport.test.js.)

const SHORT = 'https://photos.app.goo.gl/TestPhotoLink1';
const SHARE = 'https://photos.google.com/share/AF1QipTestShare?key=testkey';
const PHOTO = 'https://lh3.googleusercontent.com/pw/AP1GczTestPhoto';
const OTHER_PHOTO = 'https://lh3.googleusercontent.com/pw/AP1GczSecondPhoto';
const PHOTO_BYTES = Buffer.from(`fake-jpeg-${crypto.randomUUID()}`);

let server;
let baseUrl;
let realFetch;
let albumMode = false;
const outbound = [];
const createdNotes = [];

function sharePage(photos) {
  const imgs = photos.map((u) => `<img src="${u}=w100">`).join('');
  return `<html><head><meta property="og:image" content="${photos[0]}=w600-h315-p-k"></head><body>${imgs}</body></html>`;
}

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith(baseUrl)) return realFetch(url, options);
    outbound.push(target);
    if (target === SHORT) return new Response(null, { status: 302, headers: { location: SHARE } });
    if (target === SHARE) {
      return new Response(sharePage(albumMode ? [PHOTO, OTHER_PHOTO] : [PHOTO]), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (target === `${PHOTO}=w2048-h2048`) {
      return new Response(PHOTO_BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    throw new Error(`Test refused to reach ${target}`);
  };
});

test.after(async () => {
  globalThis.fetch = realFetch;
  for (const id of createdNotes) {
    const [rows] = await pool.query('SELECT id FROM attachments WHERE note_id = ?', [id]);
    for (const row of rows) await attachmentService.deleteAttachment(row.id);
    await noteService.deleteNote(id, { permanent: true });
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function makeNote(title, content) {
  const note = await noteService.createNote({ title, content });
  createdNotes.push(note.id);
  return note;
}

async function add(noteId, url) {
  const res = await fetch(`${baseUrl}/api/attachments/from-google-photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noteId, url })
  });
  return { status: res.status, body: await res.json() };
}

test('add: on a regular note the photo is attached and the text is left exactly as it was', async () => {
  const note = await makeNote(`gphotos-add-${crypto.randomUUID()}`, 'My text\n\nstays put');
  const res = await add(note.id, SHORT);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.attachment.noteId, note.id);
  assert.equal(res.body.attachment.mimeType, 'image/jpeg');
  assert.equal(res.body.attachment.filename, 'google-photo.jpg');

  const stored = await noteService.getNoteById(note.id);
  assert.equal(stored.content, 'My text\n\nstays put');
  assert.equal(stored.revision, note.revision, 'adding a photo is not a text edit');
  assert.deepEqual(stored.attachments.map((a) => a.id), [res.body.attachment.id]);

  const file = await fetch(`${baseUrl}${res.body.attachment.url}`);
  assert.equal(file.status, 200);
  assert.ok(Buffer.from(await file.arrayBuffer()).equals(PHOTO_BYTES), 'the downloaded photo is what is served');
});

test('add: on a daily note the photo is attached (shown in the side panel) and the text untouched', async () => {
  const day = String(1 + crypto.randomInt(28)).padStart(2, '0');
  const note = await makeNote(`Daily: 18${String(crypto.randomInt(100)).padStart(2, '0')}-07-${day}`, '# Day\n\nText');
  const res = await add(note.id, `  ${SHORT}\n`);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const stored = await noteService.getNoteById(note.id);
  assert.equal(stored.content, '# Day\n\nText');
  assert.equal(stored.revision, note.revision);
  assert.equal(stored.attachments.length, 1);
});

test('add: only Google hosts are contacted, in order', async () => {
  outbound.length = 0;
  const note = await makeNote(`gphotos-add-${crypto.randomUUID()}`, 'x');
  assert.equal((await add(note.id, SHORT)).status, 201);
  assert.deepEqual(outbound, [SHORT, SHARE, `${PHOTO}=w2048-h2048`]);
});

test('add: an album link is refused with the photo count, and nothing is saved', async () => {
  const note = await makeNote(`gphotos-add-${crypto.randomUUID()}`, 'x');
  albumMode = true;
  try {
    const res = await add(note.id, SHORT);
    assert.equal(res.status, 422);
    assert.match(res.body.error, /2 photos/);
  } finally {
    albumMode = false;
  }
  const stored = await noteService.getNoteById(note.id);
  assert.equal(stored.attachments.length, 0);
  assert.equal(stored.content, 'x');
});
