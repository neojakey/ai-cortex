import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import app from '../../core/api/server.js';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { backfillJournalTitles } from '../../scripts/backfill-journal-titles.js';

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

// A daily note with a date no other test uses (year 17xx).
async function makeDaily(content = '## Log\n- ') {
  const date = `17${String(crypto.randomInt(100)).padStart(2, '0')}-${String(1 + crypto.randomInt(12)).padStart(2, '0')}-${String(1 + crypto.randomInt(28)).padStart(2, '0')}`;
  const note = await noteService.createNote({ title: `Daily: ${date}`, content: `${content}\n<!-- ${crypto.randomUUID()} -->` });
  created.push(note.id);
  return note;
}

async function put(id, body) {
  const res = await fetch(`${baseUrl}/api/notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}
const get = (path) => fetch(`${baseUrl}${path}`).then((r) => r.json());

test('journal title: saved as a property and returned with the note', async () => {
  const note = await makeDaily();
  const res = await put(note.id, { properties: { journal_title: 'Patio Cleanup' }, expectedRevision: note.revision });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.note.properties.journal_title, 'Patio Cleanup');
  assert.equal(res.body.note.revision, note.revision + 1);
  assert.equal(res.body.note.title, note.title, 'stored title unchanged');
});

test('journal title: saving the same title again is not a new revision', async () => {
  const note = await makeDaily();
  const first = await put(note.id, { properties: { journal_title: 'Same' }, expectedRevision: note.revision });
  const again = await put(note.id, { properties: { journal_title: 'Same' }, expectedRevision: first.body.note.revision });
  assert.equal(again.status, 200);
  assert.equal(again.body.note.revision, first.body.note.revision);
});

test('journal title: null clears it', async () => {
  const note = await makeDaily();
  const set = await put(note.id, { properties: { journal_title: 'Temp' }, expectedRevision: note.revision });
  const cleared = await put(note.id, { properties: { journal_title: null }, expectedRevision: set.body.note.revision });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.note.properties.journal_title, undefined);
});

test('journal title: a stale revision is a conflict and changes nothing', async () => {
  const note = await makeDaily();
  const set = await put(note.id, { properties: { journal_title: 'First' }, expectedRevision: note.revision });
  const stale = await put(note.id, { properties: { journal_title: null }, expectedRevision: note.revision });
  assert.equal(stale.status, 409);
  const now = (await get(`/api/notes/${note.id}`)).note;
  assert.equal(now.properties.journal_title, 'First');
  assert.equal(now.revision, set.body.note.revision);
});

test('journal title: comes with the note list, search, tasks and backlinks', async () => {
  const marker = `zq${crypto.randomUUID().slice(0, 8)}`;
  const note = await makeDaily(`## Log\n- [ ] task ${marker}`);
  await put(note.id, { properties: { journal_title: `Title ${marker}` }, expectedRevision: note.revision });
  const linker = await noteService.createNote({ title: `linker ${marker}`, content: `see [[${note.title}]]` });
  created.push(linker.id);

  const list = await get('/api/notes?limit=500');
  const inList = (list.notes || list).find((n) => n.id === note.id);
  assert.equal(inList?.journalTitle, `Title ${marker}`);

  const search = await get(`/api/search?q=${encodeURIComponent(`Title ${marker}`)}`);
  const hit = (search.results || search).find((r) => r.id === note.id);
  assert.ok(hit, 'search finds the note by its journal title');
  assert.equal(hit.journalTitle, `Title ${marker}`);

  const tasks = await get('/api/tasks');
  const task = (tasks.tasks || tasks).find((t) => t.noteId === note.id);
  assert.equal(task?.noteJournalTitle, `Title ${marker}`);

  const linked = (await get(`/api/notes/${linker.id}`)).note;
  const target = await get(`/api/notes/${note.id}`);
  const back = target.note.backlinks.find((b) => b.id === linker.id);
  assert.ok(back, 'backlink present');
  assert.equal(back.journalTitle, null, 'the linking note is not a daily note');
  assert.ok(linked);
});

test('backfill: preview lists first headings and writes nothing', async () => {
  const titled = await makeDaily('## Patio Cleanup\n- woke up early');
  const template = await makeDaily('## Log\n- ');
  const plain = await makeDaily('just text');
  const result = await backfillJournalTitles({ noteIds: [titled.id, template.id, plain.id] });
  assert.equal(result.checked, 3);
  assert.deepEqual(result.titled.map((t) => [t.id, t.journalTitle]), [[titled.id, 'Patio Cleanup']]);
  const after = await noteService.getNoteById(titled.id);
  assert.equal(after.properties.journal_title, undefined);
  assert.equal(after.revision, titled.revision);
});

test('backfill: --apply copies the heading, bumps the revision and keeps the text', async () => {
  const note = await makeDaily('# A Light Day\n\n- Had breakfast');
  const result = await backfillJournalTitles({ apply: true, noteIds: [note.id] });
  assert.equal(result.titled.length, 1);
  assert.equal(result.failed.length, 0);
  const after = await noteService.getNoteById(note.id);
  assert.equal(after.properties.journal_title, 'A Light Day');
  assert.equal(after.revision, note.revision + 1);
  assert.equal(after.content, note.content);
});

test('backfill: a note that already has a journal title is left alone, so re-running is safe', async () => {
  const note = await makeDaily('## Heading In Text');
  const set = await put(note.id, { properties: { journal_title: 'Chosen by hand' }, expectedRevision: note.revision });
  const result = await backfillJournalTitles({ apply: true, noteIds: [note.id] });
  assert.equal(result.checked, 0);
  const after = await noteService.getNoteById(note.id);
  assert.equal(after.properties.journal_title, 'Chosen by hand');
  assert.equal(after.revision, set.body.note.revision);
});

test('backfill: regular and trashed notes are never touched', async () => {
  const regular = await noteService.createNote({ title: `regular ${crypto.randomUUID()}`, content: '## A Heading' });
  created.push(regular.id);
  const trashed = await makeDaily('## Trashed Day');
  await noteService.deleteNote(trashed.id);
  const result = await backfillJournalTitles({ apply: true, noteIds: [regular.id, trashed.id] });
  assert.equal(result.checked, 0);
  assert.equal((await noteService.getNoteById(regular.id)).properties.journal_title, undefined);
});
