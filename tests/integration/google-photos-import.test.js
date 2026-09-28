import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import app from '../../core/api/server.js';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';

// Only the paths that are refused before any request leaves the server: these tests
// must never reach Google. The import itself is covered with a fake fetch in
// tests/unit/googlePhotosImport.test.js.

const SHARE_LINK = 'https://photos.app.goo.gl/RwiUGGaB1PkDFVHD8';

let server;
let baseUrl;
let note;
let realFetch;
const outboundCalls = [];

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  note = await noteService.createNote({ title: `gphotos-${crypto.randomUUID()}`, content: 'base' });

  // Record (and refuse) any request the server makes to somewhere other than itself.
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(baseUrl)) return realFetch(url, options);
    outboundCalls.push(String(url));
    throw new Error(`Test tried to reach ${url}`);
  };
});

test.after(async () => {
  globalThis.fetch = realFetch;
  await noteService.deleteNote(note.id, { permanent: true });
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function post(body) {
  const res = await fetch(`${baseUrl}/api/attachments/from-google-photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

async function attachmentCount(noteId) {
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM attachments WHERE note_id = ?', [noteId]);
  return Number(rows[0].n);
}

test('Google Photos import: missing noteId is a 400', async () => {
  const res = await post({ url: SHARE_LINK });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /noteId/);
});

test('Google Photos import: missing url is a 400', async () => {
  const res = await post({ noteId: note.id });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /url/);
});

test('Google Photos import: a private library link is a 400 that says to use a share link', async () => {
  const res = await post({ noteId: note.id, url: 'https://photos.google.com/u/0/photo/AF1QipM8Vg5M' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Share → Create link/);
});

test('Google Photos import: a non-Google URL is a 400', async () => {
  for (const url of ['https://example.com/photo.jpg', 'http://photos.app.goo.gl/RwiUGGaB1PkDFVHD8', 'file:///etc/passwd']) {
    const res = await post({ noteId: note.id, url });
    assert.equal(res.status, 400, url);
  }
});

test('Google Photos import: a note that does not exist is a 404', async () => {
  const res = await post({ noteId: crypto.randomUUID(), url: SHARE_LINK });
  assert.equal(res.status, 404);
});

test('Google Photos import: a cross-origin request is blocked', async () => {
  const res = await fetch(`${baseUrl}/api/attachments/from-google-photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ noteId: note.id, url: SHARE_LINK })
  });
  assert.equal(res.status, 403);
});

test('Google Photos import: refused requests never reach the network or save anything', async () => {
  assert.deepEqual(outboundCalls, []);
  assert.equal(await attachmentCount(note.id), 0);
});
