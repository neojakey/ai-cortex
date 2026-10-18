import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { projectService } from '../../core/services/projectService.js';
import { cleanupTags, undoCleanup, assertRecentBackup } from '../../scripts/tags-cleanup.js';

// Everything runs on fixtures with unique names, scoped to those notes, so other test files
// sharing this database are never touched.
const s = crypto.randomUUID().slice(0, 8);
const folderName = `Cleanfolder ${s}`;
const folderTag = `cleanfolder-${s}`;
const solo = `solo-${s}`;
const pair = `pair-${s}`;
const keepOnJournal = `journal-only-${s}`;
const trashedShared = `trashed-shared-${s}`;
const created = [];
const projectIds = [];
let tmp;
let notes = {};

const link = async (noteId, tag, fh = 0, fe = 1) => {
  await pool.query('INSERT IGNORE INTO tags (name) VALUES (?)', [tag]);
  const [[t]] = await pool.query('SELECT id FROM tags WHERE name = ?', [tag]);
  await pool.query('INSERT INTO note_tags (note_id, tag_id, from_hashtag, from_explicit) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE from_hashtag = VALUES(from_hashtag), from_explicit = VALUES(from_explicit)', [noteId, t.id, fh, fe]);
};
async function dump(ids) {
  const [rows] = await pool.query(
    `SELECT nt.note_id, t.name, nt.from_hashtag AS h, nt.from_explicit AS e FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id IN (?) ORDER BY nt.note_id, t.name`, [ids]);
  return rows.map((r) => `${r.note_id}|${r.name}|${r.h}${r.e}`);
}
const tagExists = async (name) => (await pool.query('SELECT 1 FROM tags WHERE name = ?', [name]))[0].length === 1;
const fixtureIds = () => Object.values(notes).map((n) => n.id);
const options = (extra = {}) => ({ scope: new Set(fixtureIds()), requireBackup: false, undoDir: tmp, ...extra });

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-cleanup-'));
  projectIds.push((await projectService.getOrCreateByName(folderName)).id);
  const mk = async (key, opts) => { const n = await noteService.createNote({ title: `Cleanup ${key} ${s}`, content: `text of ${key}`, ...opts }); created.push(n.id); notes[key] = n; };
  await mk('foldered', { project: folderName });
  await mk('plain', {});
  await mk('other', {});
  await mk('journal', {});
  await pool.query('UPDATE notes SET title = ? WHERE id = ?', [`Daily: 1799-0${1 + (parseInt(s.slice(0, 2), 16) % 9)}-1${parseInt(s.slice(2, 3), 16) % 9}`, notes.journal.id]);
  await mk('trashed', {});
  await pool.query("UPDATE notes SET status = 'trash' WHERE id = ?", [notes.trashed.id]);
  // Legacy rows, written directly (the save rules would no longer create the folder-name tag)
  await link(notes.foldered.id, folderTag);
  await link(notes.foldered.id, pair);
  await link(notes.foldered.id, solo, 1, 1);
  await link(notes.plain.id, pair);
  await link(notes.plain.id, trashedShared);
  await link(notes.other.id, folderTag);   // the same tag on two notes that are not in that folder
  await link(notes.plain.id, folderTag);
  await link(notes.journal.id, keepOnJournal);
  await link(notes.trashed.id, trashedShared);
});

test.after(async () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const id of created) await noteService.deleteNote(id, { permanent: true }).catch(() => {});
  for (const id of projectIds) await projectService.deleteProject(id).catch(() => {});
  await pool.query('DELETE FROM tags WHERE name IN (?) AND NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.tag_id = tags.id)', [[folderTag, solo, pair, keepOnJournal, trashedShared]]);
  await pool.end();
});

test('preview writes nothing and makes no undo file', async () => {
  const before = await dump(fixtureIds());
  const { plan, undoFile } = await cleanupTags(options());
  assert.ok(plan.changes.length > 0);
  assert.equal(undoFile, null);
  assert.deepEqual(await dump(fixtureIds()), before);
  assert.deepEqual(fs.readdirSync(tmp), []);
});

test('apply is refused without a fresh backup, and allowed with one', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-backups-'));
  try {
    await assert.rejects(cleanupTags(options({ apply: true, requireBackup: true, backupDir: empty })), /No database backup/);
    fs.writeFileSync(path.join(empty, 'old.sql.gz'), 'x');
    const old = Date.now() - 2 * 3600 * 1000;
    fs.utimesSync(path.join(empty, 'old.sql.gz'), old / 1000, old / 1000);
    assert.throws(() => assertRecentBackup({ backupDir: empty }), /No database backup/, 'a two-hour-old backup is too old');
    fs.writeFileSync(path.join(empty, 'new.sql.gz'), 'x');
    assert.doesNotThrow(() => assertRecentBackup({ backupDir: empty }));
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('apply removes the folder-name tag and the one-note tag, keeps the rest, and leaves note text alone', async () => {
  const before = await dump(fixtureIds());
  const textBefore = await Promise.all(Object.values(notes).map(async (n) => { const x = await noteService.getNoteById(n.id); return `${x.id}|${x.revision}|${x.content}|${x.updatedAt}`; }));
  const { plan, undoFile } = await cleanupTags(options({ apply: true }));
  assert.ok(undoFile && fs.existsSync(undoFile));
  const after = await dump(fixtureIds());

  const has = (rows, noteKey, tag) => rows.some((r) => r.startsWith(`${notes[noteKey].id}|${tag}|`));
  assert.equal(has(before, 'foldered', folderTag), true);
  assert.equal(has(after, 'foldered', folderTag), false, 'folder-name tag removed from the note in that folder');
  assert.equal(has(after, 'other', folderTag), true, 'the same tag on notes outside that folder is kept');
  assert.equal(has(after, 'plain', folderTag), true);
  assert.equal(has(after, 'foldered', solo), false, 'a one-note tag is removed');
  assert.equal(has(after, 'foldered', pair), true, 'a two-note tag is kept');
  assert.equal(has(after, 'plain', pair), true);
  assert.equal(has(after, 'journal', keepOnJournal), true, 'journal entries are never changed');
  assert.equal(has(after, 'trashed', trashedShared), true, 'trashed notes are never changed');
  assert.ok(plan.summary.linksRemoved >= 2);

  const textAfter = await Promise.all(Object.values(notes).map(async (n) => { const x = await noteService.getNoteById(n.id); return `${x.id}|${x.revision}|${x.content}|${x.updatedAt}`; }));
  assert.deepEqual(textAfter, textBefore, 'text, revision and update time are untouched');
});

test('a tag nobody uses any more is deleted, but not one a trashed note still has', async () => {
  assert.equal(await tagExists(solo), false);
  assert.equal(await tagExists(trashedShared), true, 'still linked from the trashed note');
});

test('running it again does nothing', async () => {
  const { plan, undoFile } = await cleanupTags(options({ apply: true }));
  assert.equal(plan.changes.length, 0);
  assert.equal(undoFile, null);
});

test('undo puts every link back exactly, including the deleted tag', async () => {
  const files = fs.readdirSync(tmp).filter((f) => f.startsWith('tag-cleanup-undo-'));
  assert.equal(files.length, 1);
  const count = await undoCleanup(path.join(tmp, files[0]), { db: pool });
  assert.ok(count >= 2);
  assert.equal(await tagExists(solo), true);
  const [rows] = await pool.query(
    `SELECT nt.from_hashtag AS h, nt.from_explicit AS e FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? AND t.name = ?`, [notes.foldered.id, solo]);
  assert.deepEqual({ ...rows[0] }, { h: 1, e: 1 }, 'flags restored too');
  const [folderRows] = await pool.query(`SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? AND t.name = ?`, [notes.foldered.id, folderTag]);
  assert.equal(folderRows.length, 1);
  const plan = (await cleanupTags(options())).plan;
  assert.ok(plan.changes.length > 0, 'after the undo the same cleanup is available again');
});
