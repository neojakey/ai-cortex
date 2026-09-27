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
const uniq = (label) => `RR ${label} ${suffix}`;

let server;
let baseUrl;
const createdNotes = [];

async function makeNote(label, fields = {}) {
  const note = await noteService.createNote({ title: uniq(label), content: 'base', ...fields });
  createdNotes.push(note.id);
  return note;
}

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
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// --- Service layer: requireRevision is opt-in and off by default ------------------

test('requireRevision: off by default, so internal callers are unaffected', async () => {
  const note = await makeNote('default-off');
  const updated = await noteService.updateNote(note.id, { content: 'no revision, no flag' });
  assert.equal(updated.content, 'no revision, no flag');
});

test('requireRevision: true refuses a replace with no expectedRevision, and writes nothing', async () => {
  const note = await makeNote('require-replace');
  await assert.rejects(
    noteService.updateNote(note.id, { content: 'should not land', requireRevision: true }),
    (e) => e.code === 'EXPECTED_REVISION_REQUIRED'
  );
  const after = await noteService.getNoteById(note.id);
  assert.equal(after.content, 'base');
  assert.equal(after.revision, 1);
});

test('requireRevision: true still allows an append with no expectedRevision', async () => {
  const note = await makeNote('require-append');
  const updated = await noteService.updateNote(note.id, { appendContent: 'tail', requireRevision: true });
  assert.equal(updated.content, 'base\n\ntail');
});

test('requireRevision: true with a correct expectedRevision still works, and a stale one still 409s', async () => {
  const note = await makeNote('require-checked');
  const updated = await noteService.updateNote(note.id, {
    content: 'v2', expectedRevision: 1, requireRevision: true
  });
  assert.equal(updated.revision, 2);

  await assert.rejects(
    noteService.updateNote(note.id, { content: 'stale', expectedRevision: 1, requireRevision: true }),
    (e) => e.code === 'REVISION_CONFLICT' && e.currentRevision === 2
  );
});

test('requireRevision: an unknown note is still NOT_FOUND, not EXPECTED_REVISION_REQUIRED', async () => {
  await assert.rejects(
    noteService.updateNote(crypto.randomUUID(), { content: 'x', requireRevision: true }),
    (e) => e.code === 'NOT_FOUND'
  );
});

// --- REST: PUT and version-restore always require it -------------------------------

test('REST: PUT without expectedRevision is refused with 400 and writes nothing', async () => {
  const note = await makeNote('rest-required');
  const res = await fetch(`${baseUrl}/api/notes/${note.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'should not land' })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'EXPECTED_REVISION_REQUIRED');

  const after = await noteService.getNoteById(note.id);
  assert.equal(after.content, 'base');
  assert.equal(after.revision, 1);
});

test('REST: PUT for an unknown note is 404 even without expectedRevision', async () => {
  const res = await fetch(`${baseUrl}/api/notes/${crypto.randomUUID()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'x' })
  });
  assert.equal(res.status, 404);
});

test('REST: version restore without expectedRevision is refused with 400', async () => {
  const note = await makeNote('rest-restore-required');
  await noteService.updateNote(note.id, { content: 'v2', expectedRevision: 1 });
  const versions = await noteService.getVersions(note.id);

  const res = await fetch(`${baseUrl}/api/notes/${note.id}/versions/${versions[0].id}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'EXPECTED_REVISION_REQUIRED');
});

// --- MCP: replace requires it, append never does ------------------------------------

test('MCP: update_note refuses a bare overwrite with no expectedRevision, but append still works without one', async () => {
  const note = await makeNote('mcp-required');
  const client = new Client({ name: 'require-revision-test', version: '1.0.0' });
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

    const bare = await call({ content: 'should not land' });
    assert.equal(bare.isError, true);
    assert.equal(JSON.parse(text(bare)).error, 'EXPECTED_REVISION_REQUIRED');
    assert.equal((await noteService.getNoteById(note.id)).content, 'base');

    const appended = await call({ content: 'tail', append: true });
    assert.notEqual(appended.isError, true);
    assert.match(text(appended), /WARNING: expectedRevision was not provided/);
    assert.equal((await noteService.getNoteById(note.id)).content, 'base\n\ntail');

    const checked = await call({ content: 'v2 replace', expectedRevision: 2 });
    assert.notEqual(checked.isError, true);
    assert.doesNotMatch(text(checked), /WARNING/);
  } finally {
    await client.close();
  }
});
