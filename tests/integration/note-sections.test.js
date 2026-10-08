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

const CLAUDE = '## Worked on with Claude';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let server;
let baseUrl;
let mcp;
const created = [];

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  // The real MCP server, as a Claude session starts it, on the test database.
  mcp = new Client({ name: 'section-test', version: '1.0.0' });
  await mcp.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'core/mcp/index.js')],
    cwd: root,
    env: { ...process.env, DB_NAME: process.env.DB_NAME, STORAGE_DIR: process.env.STORAGE_DIR },
    stderr: 'ignore'
  }));
});

test.after(async () => {
  await mcp?.close();
  for (const id of created) await noteService.deleteNote(id, { permanent: true }).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function makeNote(content) {
  const note = await noteService.createNote({ title: `sections ${crypto.randomUUID()}`, content });
  created.push(note.id);
  return note;
}
const someDay = () => `15${String(crypto.randomInt(100)).padStart(2, '0')}-0${1 + crypto.randomInt(9)}-${10 + crypto.randomInt(18)}`;
const callTool = async (name, args) => {
  const res = await mcp.callTool({ name, arguments: args });
  return { error: !!res.isError, text: res.content[0].text };
};

test('addToSection: adds the line in one save, revision up by one, the rest untouched', async () => {
  const note = await makeNote(`My own text\n\n${CLAUDE}\n\n### BolsaHotelera\n- one\n\n#daily\n`);
  const result = await noteService.addToSection(note.id, [CLAUDE, '### BolsaHotelera'], '- two');
  assert.deepEqual(Object.keys(result).sort(), ['created', 'id', 'line', 'revision', 'title']);
  assert.equal(result.revision, note.revision + 1);
  const stored = await noteService.getNoteById(note.id);
  assert.equal(stored.content, `My own text\n\n${CLAUDE}\n\n### BolsaHotelera\n- one\n- two\n\n#daily\n`);
  const [versions] = await pool.query('SELECT COUNT(*) AS n FROM note_versions WHERE note_id = ?', [note.id]);
  assert.equal(Number(versions[0].n), 2, 'one history copy for the add');
});

test('addToSection: needs no revision, even though the note changed since anyone read it', async () => {
  const note = await makeNote(`${CLAUDE}\n`);
  await noteService.updateNote(note.id, { content: `${CLAUDE}\n- someone else wrote this`, expectedRevision: note.revision });
  await noteService.addToSection(note.id, [CLAUDE], '- mine');
  assert.equal((await noteService.getNoteById(note.id)).content, `${CLAUDE}\n- someone else wrote this\n- mine\n`);
});

test('addToSection: two adds at the same moment are both kept', async () => {
  const note = await makeNote(`${CLAUDE}\n### BolsaHotelera\n- start\n`);
  await Promise.all([
    noteService.addToSection(note.id, [CLAUDE, '### BolsaHotelera'], '- from session A'),
    noteService.addToSection(note.id, [CLAUDE, '### BolsaHotelera'], '- from session B')
  ]);
  const stored = await noteService.getNoteById(note.id);
  assert.ok(stored.content.includes('- from session A') && stored.content.includes('- from session B'), stored.content);
  assert.equal(stored.revision, note.revision + 2);
});

test('addToSection: a hashtag in the added text becomes a tag, and explicit tags stay', async () => {
  const note = await noteService.createNote({ title: `sections ${crypto.randomUUID()}`, content: 'x', customTags: ['kept'] });
  created.push(note.id);
  await noteService.addToSection(note.id, [CLAUDE], '- deployed #release');
  assert.deepEqual((await noteService.getNoteById(note.id)).tags.sort(), ['kept', 'release']);
});

test('addToSection: a daily slug that does not exist yet is created, with its tags', async () => {
  const day = someDay();
  const result = await noteService.addToSection(`daily-${day}`, [CLAUDE, '### AI-Cortex'], '- first entry');
  created.push(result.id);
  const note = await noteService.getNoteById(result.id);
  assert.equal(note.title, `Daily: ${day}`);
  assert.equal(note.content, `${CLAUDE}\n### AI-Cortex\n- first entry\n`);
  assert.deepEqual(note.tags.sort(), [day.slice(0, 7), 'daily', 'journal'].sort());
  assert.deepEqual(result.created, [CLAUDE, '### AI-Cortex']);
});

test('addToSection: an unknown note (not a daily slug) is NOT_FOUND and nothing is created', async () => {
  const name = `no-such-note-${crypto.randomUUID()}`;
  await assert.rejects(noteService.addToSection(name, [CLAUDE], '- x'), (err) => err.code === 'NOT_FOUND');
  assert.equal(await noteService.getNoteBySlug(name), null);
});

test('addToSection: a bad path is refused and the note is unchanged', async () => {
  const note = await makeNote(`${CLAUDE}\n- one\n`);
  await assert.rejects(noteService.addToSection(note.id, ['Worked on with Claude'], '- x'), (err) => err.code === 'INVALID_ARGUMENT');
  const stored = await noteService.getNoteById(note.id);
  assert.equal(stored.revision, note.revision);
  assert.equal(stored.content, note.content);
});

test('readSection: one section plus the outline', async () => {
  const note = await makeNote(`Mine\n\n${CLAUDE}\n### BolsaHotelera\n- one\n### AI-Cortex\n- two\n\n#daily\n`);
  const result = await noteService.readSection(note.id, [CLAUDE, '### AI-Cortex']);
  assert.equal(result.section, '### AI-Cortex\n- two');
  assert.deepEqual(result.outline, [CLAUDE, '### BolsaHotelera', '### AI-Cortex']);
  assert.equal(result.revision, note.revision);
});

test('API: POST /api/notes/:id/section adds, and reports bad input as 400 / 404', async () => {
  const note = await makeNote(`${CLAUDE}\n`);
  const post = (id, body) => fetch(`${baseUrl}/api/notes/${encodeURIComponent(id)}/section`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const ok = await post(note.id, { section: [CLAUDE], content: '- via the API' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).revision, note.revision + 1);
  assert.equal((await post(note.id, { section: ['nope'], content: '- x' })).status, 400);
  assert.equal((await post(note.id, { section: [CLAUDE], content: '' })).status, 400);
  assert.equal((await post(`missing-${crypto.randomUUID()}`, { section: [CLAUDE], content: '- x' })).status, 404);
  const cross = await fetch(`${baseUrl}/api/notes/${note.id}/section`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ section: [CLAUDE], content: '- x' })
  });
  assert.equal(cross.status, 403);
});

test('API: an edit function can never be passed in through a normal update', async () => {
  const note = await makeNote('unchanged');
  const res = await fetch(`${baseUrl}/api/notes/${note.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ editContent: 'x', expectedRevision: note.revision })
  });
  assert.ok(res.status < 500);
  assert.equal((await noteService.getNoteById(note.id)).content, 'unchanged');
});

test('MCP: the tools are listed for sessions', async () => {
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('ai_cortex_add_to_section'));
  assert.ok(names.includes('ai_cortex_read_section'));
});

test('MCP: add_to_section adds the line and replies with a short summary, not the note', async () => {
  const filler = '- an older line that makes the note long\n'.repeat(200);
  const note = await makeNote(`${CLAUDE}\n### BolsaHotelera\n${filler}`);
  const res = await callTool('ai_cortex_add_to_section', { idOrTitle: note.id, section: [CLAUDE, '### BolsaHotelera'], content: '- via MCP' });
  assert.equal(res.error, false, res.text);
  const summary = JSON.parse(res.text);
  assert.equal(summary.revision, note.revision + 1);
  assert.ok(res.text.length < 300, `reply is ${res.text.length} characters for a ${note.content.length}-character note`);
  assert.ok((await noteService.getNoteById(note.id)).content.endsWith('- via MCP\n'));
});

test('MCP: add_to_section on today\'s missing daily slug creates the entry', async () => {
  const day = someDay();
  const res = await callTool('ai_cortex_add_to_section', { idOrTitle: `daily-${day}`, section: [CLAUDE, '### BolsaHotelera'], content: '- logged' });
  assert.equal(res.error, false, res.text);
  created.push(JSON.parse(res.text).id);
  assert.equal(JSON.parse(res.text).title, `Daily: ${day}`);
});

test('MCP: errors come back as clear tool errors', async () => {
  const note = await makeNote('x');
  const bad = await callTool('ai_cortex_add_to_section', { idOrTitle: note.id, section: ['Worked on with Claude'], content: '- x' });
  assert.equal(bad.error, true);
  assert.equal(JSON.parse(bad.text).error, 'INVALID_ARGUMENT');
  const missing = await callTool('ai_cortex_read_section', { idOrTitle: `missing-${crypto.randomUUID()}`, section: [CLAUDE] });
  assert.equal(missing.error, true);
  assert.equal(JSON.parse(missing.text).error, 'NOT_FOUND');
});

test('MCP: read_section returns one section and the outline', async () => {
  const note = await makeNote(`${CLAUDE}\n### BolsaHotelera\n- one\n### AI-Cortex\n- two\n`);
  const res = await callTool('ai_cortex_read_section', { idOrTitle: note.id, section: [CLAUDE, '### BolsaHotelera'] });
  const body = JSON.parse(res.text);
  assert.equal(body.section, '### BolsaHotelera\n- one');
  assert.deepEqual(body.outline, [CLAUDE, '### BolsaHotelera', '### AI-Cortex']);
});

test('MCP: read_note replies with compact JSON', async () => {
  const note = await makeNote('compact please');
  const res = await callTool('ai_cortex_read_note', { idOrTitle: note.id });
  assert.equal(res.text.includes('\n  '), false, 'no indentation');
  assert.equal(JSON.parse(res.text).content, 'compact please');
});
