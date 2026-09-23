import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import app from '../../core/api/server.js';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const suffix = crypto.randomUUID().slice(0, 8);
const uniq = (label) => `R ${label} ${suffix}`;

let server;
let baseUrl;
const createdNotes = [];
const createdProjects = [];

async function makeNote(label, fields = {}) {
  const note = await noteService.createNote({ title: uniq(label), content: 'base', ...fields });
  createdNotes.push(note.id);
  return note;
}

const isConflict = (currentRevision) => (err) =>
  err.code === 'REVISION_CONFLICT' && err.currentRevision === currentRevision;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  for (const id of createdNotes) await noteService.deleteNote(id, { permanent: true });
  for (const name of createdProjects) await pool.query(`DELETE FROM projects WHERE name = ?`, [name]);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// 1. A matching revision succeeds and bumps by one
test('Revisions: a new note starts at 1 and a matching expectedRevision bumps it by one', async () => {
  const note = await makeNote('match');
  assert.equal(note.revision, 1);

  const updated = await noteService.updateNote(note.id, { content: 'v2', expectedRevision: 1 });
  assert.equal(updated.revision, 2);
  assert.equal(updated.content, 'v2');
});

// 2. A stale revision is refused and leaves everything untouched
test('Revisions: a stale expectedRevision is refused and changes nothing', async () => {
  const note = await makeNote('stale');
  await noteService.updateNote(note.id, { content: 'newer', expectedRevision: 1 });
  const versionsBefore = (await noteService.getVersions(note.id)).length;
  const phantomProject = uniq('phantom-project');
  createdProjects.push(phantomProject);

  await assert.rejects(
    noteService.updateNote(note.id, { content: 'stale write', project: phantomProject, expectedRevision: 1 }),
    isConflict(2)
  );

  const after = await noteService.getNoteById(note.id);
  assert.equal(after.content, 'newer');
  assert.equal(after.revision, 2);
  assert.equal((await noteService.getVersions(note.id)).length, versionsBefore);
  const [projects] = await pool.query(`SELECT id FROM projects WHERE name = ?`, [phantomProject]);
  assert.equal(projects.length, 0, 'a refused write must not create a project as a side effect');
});

// 3. An omitted revision is allowed and still bumps
test('Revisions: an omitted expectedRevision is allowed and bumps the revision', async () => {
  const note = await makeNote('omitted');
  const updated = await noteService.updateNote(note.id, { content: 'unchecked' });
  assert.equal(updated.revision, 2);
});

// 4. Concurrent writers with the same revision: exactly one wins
test('Revisions: of two concurrent writers holding the same revision, exactly one wins', async () => {
  const note = await makeNote('race');
  const results = await Promise.allSettled([
    noteService.updateNote(note.id, { content: 'writer A', expectedRevision: 1 }),
    noteService.updateNote(note.id, { content: 'writer B', expectedRevision: 1 })
  ]);

  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason.code, 'REVISION_CONFLICT');

  const final = await noteService.getNoteById(note.id);
  assert.equal(final.revision, 2);
  assert.equal(final.content, won[0].value.content);
});

// 5. Concurrent appends all persist
test('Revisions: concurrent appends all persist', async () => {
  const note = await makeNote('appends');
  const parts = ['one', 'two', 'three', 'four', 'five'];
  await Promise.all(parts.map((p) => noteService.updateNote(note.id, { appendContent: p })));

  const final = await noteService.getNoteById(note.id);
  for (const p of parts) assert.ok(final.content.includes(p), `missing appended "${p}"`);
  assert.ok(final.content.startsWith('base'));
  assert.equal(final.revision, 1 + parts.length);
});

// 6. A write that changes nothing does not bump
test('Revisions: writes that change nothing do not bump the revision or snapshot', async () => {
  const project = uniq('noop-project');
  createdProjects.push(project);
  const note = await makeNote('noop', {
    customTags: ['beta', 'alpha'],
    dueDate: '2026-10-01',
    project
  });
  const versionsBefore = (await noteService.getVersions(note.id)).length;

  const same = await noteService.updateNote(note.id, {
    title: note.title,
    content: 'base',
    status: 'active',
    dueDate: '2026-10-01',
    project,
    customTags: ['alpha', 'beta'] // same tags, different order
  });

  assert.equal(same.revision, 1);
  assert.equal((await noteService.getVersions(note.id)).length, versionsBefore);
});

test('Revisions: unchanged content does not wipe an existing note\'s explicit tags', async () => {
  const note = await makeNote('keep-tags', { customTags: ['keepme'] });
  const updated = await noteService.updateNote(note.id, { content: 'base', status: 'archived' });
  assert.ok(updated.tags.includes('keepme'));
  assert.equal(updated.revision, 2);
});

// 7. Trash and restore bump; repeating them does not
test('Revisions: trash and restore each bump the revision, repeating them does not', async () => {
  const note = await makeNote('status');

  await noteService.deleteNote(note.id);
  assert.equal((await noteService.getNoteById(note.id)).revision, 2);
  await noteService.deleteNote(note.id); // already trashed
  assert.equal((await noteService.getNoteById(note.id)).revision, 2);

  await noteService.restoreNote(note.id);
  const restored = await noteService.getNoteById(note.id);
  assert.equal(restored.status, 'active');
  assert.equal(restored.revision, 3);
  assert.equal((await noteService.getVersions(note.id)).length, 1, 'status changes must not snapshot');
});

// The response must be exactly the write that just committed
test('Revisions: each concurrent unchecked write is returned as its own revision and content', async () => {
  const note = await makeNote('response');
  const [a, b] = await Promise.all([
    noteService.updateNote(note.id, { content: 'first writer' }),
    noteService.updateNote(note.id, { content: 'second writer' })
  ]);

  assert.notEqual(a.revision, b.revision);
  assert.deepEqual([a.revision, b.revision].sort(), [2, 3]);
  assert.equal(a.content, 'first writer');
  assert.equal(b.content, 'second writer');
});

test('Revisions: the response is read inside the write\'s own transaction, not after it', async () => {
  const note = await makeNote('readback');
  const original = noteService.getNoteById.bind(noteService);
  let injected = false;

  // A read made outside any transaction (default connection) is where a competing
  // write could slip in after our commit. Inject one there, once.
  noteService.getNoteById = async (id, db) => {
    if (!injected && (db === undefined || db === pool)) {
      injected = true;
      await noteService.updateNote(id, { content: 'intruder' });
    }
    return original(id, db);
  };

  try {
    const mine = await noteService.updateNote(note.id, { content: 'mine' });
    assert.equal(mine.content, 'mine', 'the response must be this write, not a later one');
    assert.equal(mine.revision, 2);
  } finally {
    delete noteService.getNoteById;
  }
});

test('Revisions: task toggles that race each other both land (retry on conflict)', async () => {
  const note = await makeNote('toggle-race', { content: '- [ ] alpha\n- [ ] beta' });
  await Promise.all([
    noteService.toggleTask(note.id, { line: 1, text: 'alpha', completed: true }),
    noteService.toggleTask(note.id, { line: 2, text: 'beta', completed: true })
  ]);
  assert.equal((await noteService.getNoteById(note.id)).content, '- [x] alpha\n- [x] beta');
});

test('Validation: bad status, bad expectedRevision and content+appendContent are rejected without writing', async () => {
  const note = await makeNote('validation');

  await assert.rejects(noteService.updateNote(note.id, { status: 'draft' }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(noteService.updateNote(note.id, { content: 'x', expectedRevision: '1' }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(noteService.updateNote(note.id, { content: 'x', expectedRevision: 0 }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(noteService.updateNote(note.id, { content: 'x', appendContent: 'y' }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(noteService.createNote({ title: uniq('bad-status'), status: 'draft' }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(noteService.updateNote(crypto.randomUUID(), { content: 'x' }), (e) => e.code === 'NOT_FOUND');

  const after = await noteService.getNoteById(note.id);
  assert.equal(after.content, 'base');
  assert.equal(after.revision, 1);
});

// 8a. REST contract
test('REST: a stale PUT returns 409 with code and currentRevision; bad input is 400; unknown note is 404', async () => {
  const note = await makeNote('rest');
  const put = (id, body) => fetch(`${baseUrl}/api/notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const ok = await put(note.id, { content: 'rest v2', expectedRevision: 1 });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).note.revision, 2);

  const stale = await put(note.id, { content: 'rest stale', expectedRevision: 1 });
  assert.equal(stale.status, 409);
  const body = await stale.json();
  assert.equal(body.code, 'REVISION_CONFLICT');
  assert.equal(body.currentRevision, 2);
  assert.equal(typeof body.error, 'string');
  assert.notEqual(body.error, 'REVISION_CONFLICT', 'error stays a readable message for existing clients');

  assert.equal((await put(note.id, { content: 'x', expectedRevision: '2' })).status, 400);
  assert.equal((await put(crypto.randomUUID(), { content: 'x' })).status, 404);
  assert.equal((await noteService.getNoteById(note.id)).content, 'rest v2');
});

// 8b. MCP contract, through the real stdio server
test('MCP: update_note refuses a stale revision with isError, warns when it is omitted, and append is atomic', async () => {
  const note = await makeNote('mcp');
  const client = new Client({ name: 'revision-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'core/mcp/index.js')],
    cwd: repoRoot,
    env: { ...process.env }
  });
  await client.connect(transport);

  try {
    const call = (args) => client.callTool({ name: 'ai_cortex_update_note', arguments: { idOrTitle: note.id, ...args } });
    const text = (res) => res.content[0].text;

    const read = await client.callTool({ name: 'ai_cortex_read_note', arguments: { idOrTitle: note.id } });
    assert.equal(JSON.parse(text(read)).revision, 1);

    const ok = await call({ content: 'mcp v2', expectedRevision: 1 });
    assert.notEqual(ok.isError, true);
    assert.match(text(ok), /now at revision 2/);
    assert.doesNotMatch(text(ok), /WARNING/);

    const stale = await call({ content: 'mcp stale', expectedRevision: 1 });
    assert.equal(stale.isError, true);
    const conflict = JSON.parse(text(stale));
    assert.equal(conflict.error, 'REVISION_CONFLICT');
    assert.equal(conflict.currentRevision, 2);
    assert.match(conflict.message, /Re-read/);

    const unchecked = await call({ content: 'tail', append: true });
    assert.notEqual(unchecked.isError, true);
    assert.match(text(unchecked), /WARNING: expectedRevision was not provided/);
    assert.equal((await noteService.getNoteById(note.id)).content, 'mcp v2\n\ntail');
  } finally {
    await client.close();
  }
});
