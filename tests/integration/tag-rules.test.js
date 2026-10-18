import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { projectService } from '../../core/services/projectService.js';

const created = [];
const projectIds = [];
const s = crypto.randomUUID().slice(0, 8);
const folderA = `Rulefolder ${s}`;          // tag form: "rulefolder-<s>"
const tagA = `rulefolder-${s}`;
const folderB = `Otherfolder ${s}`;

test.after(async () => {
  for (const id of created) await noteService.deleteNote(id, { permanent: true }).catch(() => {});
  for (const id of projectIds) await projectService.deleteProject(id).catch(() => {});
  await pool.end();
});

async function make(opts) {
  const note = await noteService.createNote({ title: `Tag rules ${crypto.randomUUID()}`, content: 'x', ...opts });
  created.push(note.id);
  return note;
}
const tagsOf = async (id) => (await noteService.getNoteById(id)).tags.slice().sort();
async function flags(id, name) {
  const [rows] = await pool.query(
    `SELECT nt.from_hashtag AS h, nt.from_explicit AS e FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? AND t.name = ?`,
    [id, name]
  );
  return rows[0] || null;
}

test.before(async () => {
  for (const name of [folderA, folderB]) projectIds.push((await projectService.getOrCreateByName(name)).id);
});

test('create: a tag equal to the note\'s folder is not attached, from the tag list or from text', async () => {
  const note = await make({ project: folderA, customTags: [tagA, 'keep'], content: `body #${tagA} #also` });
  assert.deepEqual(await tagsOf(note.id), ['also', 'keep']);
});

test('create: the same tag on a note in another folder, or in no folder, is attached normally', async () => {
  const other = await make({ project: folderB, customTags: [tagA] });
  const loose = await make({ customTags: [tagA], content: `#${tagA}` });
  assert.deepEqual(await tagsOf(other.id), [tagA]);
  assert.deepEqual(await tagsOf(loose.id), [tagA]);
});

test('create: a misspelled tag is attached as the right tag, once, with its origin kept', async () => {
  const note = await make({ customTags: ['bolsehotelera', 'bolsahotelera'], content: '#bolsehotelera' });
  assert.deepEqual(await tagsOf(note.id), ['bolsahotelera']);
  assert.deepEqual({ ...(await flags(note.id, 'bolsahotelera')) }, { h: 1, e: 1 });
  const [typo] = await pool.query(`SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? AND t.name = 'bolsehotelera'`, [note.id]);
  assert.equal(typo.length, 0, 'the misspelled tag is not attached');
});

test('create: the alias is attached as its right spelling when the folder has a different name (alias plus folder is in the unit tests)', async () => {
  const note = await noteService.createNote({ title: `Tag rules ${crypto.randomUUID()}`, content: '#bolsehotelera #qa', project: `Bolsa Hotelera ${s}` });
  created.push(note.id);
  projectIds.push((await noteService.getNoteById(note.id)).project.id);
  assert.deepEqual(await tagsOf(note.id), ['bolsahotelera', 'qa']);
});

test('update: text added to a note in a folder never attaches the folder\'s name as a tag', async () => {
  const note = await make({ project: folderA });
  const updated = await noteService.updateNote(note.id, { content: `more text #${tagA} #fresh`, expectedRevision: note.revision });
  assert.deepEqual(updated.tags.slice().sort(), ['fresh']);
});

test('update: explicit tags follow the same rule', async () => {
  const note = await make({ project: folderA });
  const updated = await noteService.updateNote(note.id, { customTags: [tagA, 'mine'], expectedRevision: note.revision });
  assert.deepEqual(updated.tags.slice().sort(), ['mine']);
});

test('update: moving a note and writing in the same save uses the new folder', async () => {
  const note = await make({ project: folderB });
  const updated = await noteService.updateNote(note.id, { project: folderA, content: `#${tagA} #fresh`, expectedRevision: note.revision });
  assert.deepEqual(updated.tags.slice().sort(), ['fresh']);
});

test('update: a note in a folder keeps tags that are not its folder\'s name, and system tags', async () => {
  const note = await make({ project: folderA, customTags: ['journal', 'daily', 'topic'] });
  const updated = await noteService.updateNote(note.id, { content: 'new text #topic', expectedRevision: note.revision });
  assert.deepEqual(updated.tags.slice().sort(), ['daily', 'journal', 'topic']);
});

test('update: editing the text of a note that already carries its folder\'s name as a tag removes it', async () => {
  const note = await make({ project: folderB, content: `old #${tagA}` });
  assert.deepEqual(await tagsOf(note.id), [tagA]);
  const moved = await noteService.updateNote(note.id, { project: folderA, expectedRevision: note.revision });
  assert.deepEqual(moved.tags, [tagA], 'a move alone does not touch tags');
  const edited = await noteService.updateNote(note.id, { content: `edited #${tagA}`, expectedRevision: moved.revision });
  assert.deepEqual(edited.tags, [], 'the next text edit lets the rule take effect');
});
