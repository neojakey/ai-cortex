import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import app from '../../core/api/server.js';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';

let server;
let baseUrl;
let note;
const marker = `ordr${crypto.randomUUID().slice(0, 8)}`;
// Created in a non-alphabetical order on purpose.
const TAGS = [`zeta${marker}`, `alpha${marker}`, `mid${marker}`];

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  note = await noteService.createNote({ title: `Tag order ${marker}`, content: `${marker} ${TAGS.map((t) => `#${t}`).join(' ')}` });
});

test.after(async () => {
  await noteService.deleteNote(note.id, { permanent: true });
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const sorted = [...TAGS].sort();
const get = (p) => fetch(`${baseUrl}${p}`).then((r) => r.json());

test('tags: the note itself lists its tags alphabetically', async () => {
  assert.deepEqual((await get(`/api/notes/${note.id}`)).note.tags, sorted);
});

test('tags: the note list gives the same alphabetical order', async () => {
  const list = await get('/api/notes?limit=500');
  assert.deepEqual((list.notes || list).find((n) => n.id === note.id).tags, sorted);
});

test('tags: search results give the same alphabetical order', async () => {
  const search = await get(`/api/search?q=${marker}`);
  assert.deepEqual((search.results || search).find((r) => r.id === note.id).tags, sorted);
});
