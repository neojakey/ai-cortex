#!/usr/bin/env node
// One-time tag cleanup. Three rules, applied to regular notes (never journal entries):
//   1. a tag that just repeats the note's own folder name is removed (the folder says it),
//   2. known misspellings are merged into the right tag (TAG_ALIASES in tagRules.js),
//   3. a tag used by only one note is removed (it groups nothing).
// System tags (journal, daily, dayone, YYYY-MM) are never touched. Note text is never
// changed; only the links between notes and tags are.
//
//   node scripts/tags-cleanup.js                       preview: writes nothing
//   node scripts/tags-cleanup.js --apply               writes (needs a backup from the last 30 minutes)
//   node scripts/tags-cleanup.js --undo <file>         puts everything back from an undo file
//
// Every --apply writes an undo file next to the backups: for each link it touched, what it
// was before and after, so --undo restores it exactly. Running it twice does nothing the
// second time. (A removed tag that is also typed as #word in a note's text comes back the
// next time that note's text is saved, unless rule 1 or 2 covers it: see tagRules.js.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool as defaultPool } from '../core/db/pool.js';
import { retryOnDeadlock } from '../core/db/retry.js';
import { TAG_ALIASES } from '../core/services/tagRules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.cwd(), process.env.BACKUP_DIR)
  : path.join(root, 'storage', 'backups');
const DAILY_TITLE = /^Daily: \d{4}-\d{2}-\d{2}$/;
const SYSTEM_TAGS = new Set(['journal', 'daily', 'dayone']);
// Tags that might be a deliberate marker rather than a label: kept even if only one note has them.
const KEEP_TAGS = new Set(['private']);
const isSystemTag = (name) => SYSTEM_TAGS.has(name) || /^\d{4}-\d{2}$/.test(name);
const normalise = (name) => String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const key = (noteId, tag) => `${noteId}\u0000${tag}`;
const sameFlags = (a, b) => (!a && !b) || (a && b && a.fh === b.fh && a.fe === b.fe);

/**
 * Decide what to change. Pure: takes the note-tag rows, returns the plan.
 * @param {Array<{noteId, title, status, folder, tag, fh, fe}>} rows every link of every non-trashed note
 * @param {{aliases?: Object, scope?: Set<string>|null}} [options] scope limits which notes may be changed (counts still use all notes)
 */
export function computePlan(rows, { aliases = TAG_ALIASES, scope = null, keep = KEEP_TAGS } = {}) {
  const notes = new Map();
  for (const r of rows) {
    if (!notes.has(r.noteId)) {
      notes.set(r.noteId, { id: r.noteId, title: r.title, folder: r.folder, daily: DAILY_TITLE.test(r.title), tags: new Map() });
    }
    notes.get(r.noteId).tags.set(r.tag, { fh: !!r.fh, fe: !!r.fe });
  }

  // changes: key -> { noteId, tag, before: flags|null, after: flags|null, reason }
  const changes = new Map();
  const touch = (note, tag, after, reason) => {
    const k = key(note.id, tag);
    if (!changes.has(k)) changes.set(k, { noteId: note.id, tag, before: note.tags.has(tag) ? { ...note.tags.get(tag) } : null, after: null, reason });
    const change = changes.get(k);
    change.after = after;
    if (reason) change.reason = reason;
    if (after) note.tags.set(tag, after); else note.tags.delete(tag);
  };
  const inScope = (note) => !scope || scope.has(note.id);

  // 1. merge misspellings into the right tag, for every note in scope
  for (const note of notes.values()) {
    if (!inScope(note)) continue;
    for (const [alias, canonical] of Object.entries(aliases)) {
      if (!note.tags.has(alias)) continue;
      const old = note.tags.get(alias);
      const target = note.tags.get(canonical);
      touch(note, canonical, { fh: old.fh || !!target?.fh, fe: old.fe || !!target?.fe }, 'merge');
      touch(note, alias, null, 'merge');
    }
  }

  // 2. a tag that is just the note's own folder name
  for (const note of notes.values()) {
    if (!inScope(note) || note.daily || !note.folder) continue;
    for (const tag of [...note.tags.keys()]) {
      if (!isSystemTag(tag) && normalise(tag) === normalise(note.folder)) touch(note, tag, null, 'folder');
    }
  }

  // 3. a tag used by only one note, when that note is a regular one in scope
  const users = new Map();
  for (const note of notes.values()) for (const tag of note.tags.keys()) users.set(tag, [...(users.get(tag) || []), note]);
  for (const [tag, list] of users) {
    if (list.length !== 1 || isSystemTag(tag) || keep.has(tag)) continue;
    const [note] = list;
    if (inScope(note) && !note.daily) touch(note, tag, null, 'one-off');
  }

  const list = [...changes.values()].filter((c) => !sameFlags(c.before, c.after));
  const removed = list.filter((c) => c.before && !c.after);
  const tagsNowAfter = new Set();
  for (const note of notes.values()) for (const tag of note.tags.keys()) tagsNowAfter.add(tag);
  const tagsBefore = new Set(rows.map((r) => r.tag));
  const emptied = [...new Set(list.map((c) => c.noteId))]
    .map((id) => notes.get(id))
    .filter((n) => n && n.tags.size === 0)
    .map((n) => ({ id: n.id, title: n.title }));

  return {
    changes: list,
    summary: {
      linksRemoved: removed.length,
      byReason: ['merge', 'folder', 'one-off'].reduce((acc, reason) => ({ ...acc, [reason]: list.filter((c) => c.reason === reason).length }), {}),
      tagsBefore: tagsBefore.size,
      tagsAfter: tagsNowAfter.size,
      notesWithNoTagsLeft: emptied
    }
  };
}

/** Every link of every non-trashed note, as computePlan expects. */
export async function loadRows(db = defaultPool) {
  const [rows] = await db.query(`
    SELECT n.id AS noteId, n.title, n.status, p.name AS folder, t.name AS tag,
           nt.from_hashtag AS fh, nt.from_explicit AS fe
    FROM note_tags nt
    JOIN tags t ON t.id = nt.tag_id
    JOIN notes n ON n.id = nt.note_id
    LEFT JOIN projects p ON p.id = n.project_id
    WHERE n.status != 'trash'`);
  return rows.map((r) => ({ ...r, fh: !!r.fh, fe: !!r.fe }));
}

/** Refuse to write unless a backup is fresh. */
export function assertRecentBackup({ backupDir = DEFAULT_BACKUP_DIR, maxAgeMs = 30 * 60 * 1000, now = Date.now() } = {}) {
  const files = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((f) => f.endsWith('.sql.gz')) : [];
  const newest = Math.max(0, ...files.map((f) => fs.statSync(path.join(backupDir, f)).mtimeMs));
  if (!newest || now - newest > maxAgeMs) {
    throw new Error(`No database backup from the last ${Math.round(maxAgeMs / 60000)} minutes in ${backupDir}. Take one first (Settings, or POST /api/admin/backup).`);
  }
}

async function setState(conn, changes, direction) {
  for (const c of changes) {
    const state = direction === 'forward' ? c.after : c.before;
    if (!state) {
      await conn.query(`DELETE nt FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? AND t.name = ?`, [c.noteId, c.tag]);
    } else {
      await conn.query(`INSERT IGNORE INTO tags (name) VALUES (?)`, [c.tag]);
      const [[tag]] = await conn.query(`SELECT id FROM tags WHERE name = ?`, [c.tag]);
      await conn.query(
        `INSERT INTO note_tags (note_id, tag_id, from_hashtag, from_explicit) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE from_hashtag = VALUES(from_hashtag), from_explicit = VALUES(from_explicit)`,
        [c.noteId, tag.id, state.fh ? 1 : 0, state.fe ? 1 : 0]
      );
    }
  }
  // Tags this touched that no note uses any more
  const names = [...new Set(changes.filter((c) => !c.after || !c.before).map((c) => c.tag))];
  if (direction === 'forward' && names.length) {
    await conn.query(`DELETE t FROM tags t WHERE t.name IN (?) AND NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.tag_id = t.id)`, [names]);
  }
}

async function runInTransaction(db, fn) {
  return retryOnDeadlock(async () => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await fn(conn);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }, { label: 'tags cleanup' });
}

/**
 * Plan and, with apply: true, write the cleanup and an undo file.
 * @returns {Promise<{plan, undoFile: string|null}>}
 */
export async function cleanupTags({ apply = false, db = defaultPool, scope = null, requireBackup = true, backupDir = DEFAULT_BACKUP_DIR, undoDir = backupDir, now = new Date() } = {}) {
  if (apply && requireBackup) assertRecentBackup({ backupDir, now: now.getTime() });
  const plan = computePlan(await loadRows(db), { scope });
  if (!apply || plan.changes.length === 0) return { plan, undoFile: null };

  fs.mkdirSync(undoDir, { recursive: true });
  const undoFile = path.join(undoDir, `tag-cleanup-undo-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(undoFile, JSON.stringify({ createdAt: now.toISOString(), changes: plan.changes }, null, 1));
  await runInTransaction(db, (conn) => setState(conn, plan.changes, 'forward'));
  return { plan, undoFile };
}

/** Put every link back the way the undo file recorded it. */
export async function undoCleanup(file, { db = defaultPool } = {}) {
  const { changes } = JSON.parse(fs.readFileSync(file, 'utf8'));
  await runInTransaction(db, (conn) => setState(conn, changes, 'backward'));
  return changes.length;
}

function describe(plan) {
  const { summary, changes } = plan;
  const lines = [];
  lines.push(`Links to change: ${changes.length} (merged: ${summary.byReason.merge}, folder-name repeats: ${summary.byReason.folder}, one-note tags: ${summary.byReason['one-off']})`);
  lines.push(`Distinct tags in use: ${summary.tagsBefore} -> ${summary.tagsAfter}`);
  const merges = changes.filter((c) => c.reason === 'merge' && c.after);
  if (merges.length) lines.push(`\nMerged into the right spelling: ${merges.map((c) => c.tag).filter((v, i, a) => a.indexOf(v) === i).join(', ')} (${merges.length} notes)`);
  const folder = new Map();
  for (const c of changes.filter((x) => x.reason === 'folder')) folder.set(c.tag, (folder.get(c.tag) || 0) + 1);
  if (folder.size) lines.push(`\nRepeating their folder: ${[...folder].map(([t, n]) => `${t} (${n})`).join(', ')}`);
  const oneOff = changes.filter((c) => c.reason === 'one-off').map((c) => c.tag).sort();
  if (oneOff.length) lines.push(`\nUsed by one note only (${oneOff.length}): ${oneOff.join(', ')}`);
  if (summary.notesWithNoTagsLeft.length) {
    lines.push(`\nNotes left with no tags (${summary.notesWithNoTagsLeft.length}): ${summary.notesWithNoTagsLeft.map((n) => n.title).slice(0, 12).join(' | ')}${summary.notesWithNoTagsLeft.length > 12 ? ' | ...' : ''}`);
  }
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    const undoAt = args.indexOf('--undo');
    if (undoAt >= 0) {
      const count = await undoCleanup(args[undoAt + 1]);
      console.log(`Restored ${count} links from ${args[undoAt + 1]}.`);
    } else {
      const apply = args.includes('--apply');
      const { plan, undoFile } = await cleanupTags({ apply });
      console.log(describe(plan));
      console.log(apply
        ? (undoFile ? `\nDone. Undo file: ${undoFile}\nTo undo: node scripts/tags-cleanup.js --undo ${undoFile}` : '\nNothing to change.')
        : '\nPreview only; nothing was written. Run with --apply to write.');
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await defaultPool.end();
  }
}
