import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import app from '../../core/api/server.js';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';

let server;
let baseUrl;
const created = [];

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  for (const id of created) await noteService.deleteNote(id, { permanent: true });
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// A date no other test uses (year 16xx).
const someDate = () => `16${String(crypto.randomInt(100)).padStart(2, '0')}-0${1 + crypto.randomInt(9)}-${String(10 + crypto.randomInt(18))}`;
const openDaily = (date) => fetch(`${baseUrl}/api/daily?date=${date}`).then((r) => r.json()).then((d) => d.note);

test('daily note: a new entry starts with no text', async () => {
  const date = someDate();
  const note = await openDaily(date);
  created.push(note.id);
  assert.equal(note.title, `Daily: ${date}`);
  assert.equal(note.content, '');
});

test('daily note: it is still tagged daily, journal and its month', async () => {
  const date = someDate();
  const note = await openDaily(date);
  created.push(note.id);
  assert.deepEqual([...note.tags].sort(), [date.slice(0, 7), 'daily', 'journal'].sort());
});

test('daily note: the month tag survives writing in the entry', async () => {
  const date = someDate();
  const note = await openDaily(date);
  created.push(note.id);
  const res = await fetch(`${baseUrl}/api/notes/${note.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '- Woke up early and did the patio', expectedRevision: note.revision })
  });
  const { note: updated } = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual([...updated.tags].sort(), [date.slice(0, 7), 'daily', 'journal'].sort());
});

test('daily note: opening it again returns the same note, untouched', async () => {
  const date = someDate();
  const first = await openDaily(date);
  created.push(first.id);
  const again = await openDaily(date);
  assert.equal(again.id, first.id);
  assert.equal(again.revision, first.revision);
});

test('daily note: an empty entry adds no blank task to Global Tasks', async () => {
  const date = someDate();
  const note = await openDaily(date);
  created.push(note.id);
  const tasks = await fetch(`${baseUrl}/api/tasks`).then((r) => r.json());
  assert.equal((tasks.tasks || tasks).filter((t) => t.noteId === note.id).length, 0);
});
