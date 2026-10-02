import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { attachmentService } from '../../core/services/attachmentService.js';
import { exportService } from '../../core/services/exportService.js';

// Each save gets a simulated deadlock: the matching statement throws ER_LOCK_DEADLOCK
// instead of running, exactly once (or `times` times), the way MySQL reports a
// transaction it cancelled. The save must then succeed on its retry, with one copy saved.

const realGetConnection = pool.getConnection.bind(pool);
const realQuery = pool.query.bind(pool);
const created = [];
const warnings = [];
const realWarn = console.warn;

function fakeDeadlock() {
  return Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });
}

/**
 * Make the next `times` statements matching `match` fail as a deadlock, on pooled
 * connections and on pool.query alike. `before` runs (awaited) just before each throw.
 */
function injectDeadlocks(match, { times = 1, error = fakeDeadlock, before } = {}) {
  let left = times;
  const trip = async (sql) => {
    if (left > 0 && match.test(String(sql))) {
      left -= 1;
      if (before) await before();
      throw error();
    }
  };
  pool.query = async (sql, ...rest) => { await trip(sql); return realQuery(sql, ...rest); };
  pool.getConnection = async () => {
    const conn = await realGetConnection();
    const original = conn.query.bind(conn);
    conn.query = async (sql, ...rest) => { await trip(sql); return original(sql, ...rest); };
    const release = conn.release.bind(conn);
    conn.release = () => { conn.query = original; return release(); };
    return conn;
  };
  return { remaining: () => left };
}

test.beforeEach(() => { warnings.length = 0; console.warn = (m) => warnings.push(String(m)); });
test.afterEach(() => {
  pool.query = realQuery;
  pool.getConnection = realGetConnection;
  console.warn = realWarn;
});
test.after(async () => {
  for (const id of created) await noteService.deleteNote(id, { permanent: true }).catch(() => {});
  await pool.end();
});

const unique = (label) => `deadlock ${label} ${crypto.randomUUID()}`;
async function countByTitle(title) {
  const [rows] = await realQuery('SELECT COUNT(*) AS n FROM notes WHERE title = ?', [title]);
  return Number(rows[0].n);
}

test('createNote: a deadlock is retried and the note is saved exactly once', async () => {
  const title = unique('create');
  const probe = injectDeadlocks(/INSERT INTO note_versions/);
  const note = await noteService.createNote({ title, content: 'body #tagged [[Somewhere]]', customTags: ['retry'] });
  created.push(note.id);
  assert.equal(probe.remaining(), 0, 'the deadlock was hit');
  assert.equal(await countByTitle(title), 1);
  assert.deepEqual(note.tags.sort(), ['retry', 'tagged']);
  assert.equal(note.revision, 1);
  // At least the simulated deadlock; a real one from another test file can add a line.
  assert.ok(warnings.some((w) => /deadlock in createNote/.test(w)), warnings.join(' | '));
});

test('updateNote: a deadlock is retried and applied once (revision goes up by one)', async () => {
  const note = await noteService.createNote({ title: unique('update'), content: 'v1' });
  created.push(note.id);
  injectDeadlocks(/UPDATE notes\s+SET title/);
  const updated = await noteService.updateNote(note.id, { content: 'v2', expectedRevision: note.revision });
  assert.equal(updated.content, 'v2');
  assert.equal(updated.revision, note.revision + 1);
  const [versions] = await realQuery('SELECT COUNT(*) AS n FROM note_versions WHERE note_id = ?', [note.id]);
  assert.equal(Number(versions[0].n), 2, 'one snapshot for the create, one for the update');
  assert.ok(warnings.some((w) => /deadlock in updateNote/.test(w)), warnings.join(' | '));
});

test('updateNote: if the note changed before the retry, the retry is a normal conflict', async () => {
  const note = await noteService.createNote({ title: unique('conflict'), content: 'v1' });
  created.push(note.id);
  injectDeadlocks(/FOR UPDATE/, {
    // Someone else saves between the cancelled attempt and the retry.
    before: () => realQuery('UPDATE notes SET content = ?, revision = revision + 1 WHERE id = ?', ['theirs', note.id])
  });
  await assert.rejects(
    noteService.updateNote(note.id, { content: 'mine', expectedRevision: note.revision }),
    (err) => err.code === 'REVISION_CONFLICT' && err.currentRevision === note.revision + 1
  );
  const stored = await noteService.getNoteById(note.id);
  assert.equal(stored.content, 'theirs', 'the other save is kept');
});

test('updateNote: three deadlocks in a row fail as before, with nothing written', async () => {
  const note = await noteService.createNote({ title: unique('give up'), content: 'v1' });
  created.push(note.id);
  injectDeadlocks(/UPDATE notes\s+SET title/, { times: 3 });
  await assert.rejects(
    noteService.updateNote(note.id, { content: 'v2', expectedRevision: note.revision }),
    (err) => err.code === 'ER_LOCK_DEADLOCK'
  );
  const stored = await noteService.getNoteById(note.id);
  assert.equal(stored.content, 'v1');
  assert.equal(stored.revision, note.revision);
  assert.equal(warnings.length, 2);
});

test('updateNote: a lock wait timeout is not retried', async () => {
  const note = await noteService.createNote({ title: unique('timeout'), content: 'v1' });
  created.push(note.id);
  const probe = injectDeadlocks(/UPDATE notes\s+SET title/, {
    times: 2,
    error: () => Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 })
  });
  await assert.rejects(
    noteService.updateNote(note.id, { content: 'v2', expectedRevision: note.revision }),
    (err) => err.code === 'ER_LOCK_WAIT_TIMEOUT'
  );
  assert.equal(probe.remaining(), 1, 'tried once only');
  assert.equal(warnings.length, 0);
});

test('setStatus: a deadlock is retried and the status changes once', async () => {
  const note = await noteService.createNote({ title: unique('status'), content: 'x' });
  created.push(note.id);
  injectDeadlocks(/UPDATE notes SET status/);
  const result = await noteService.setStatus(note.id, 'archived', { expectedRevision: note.revision });
  assert.deepEqual(result, { id: note.id, status: 'archived', revision: note.revision + 1 });
});

test('deleteNote: a deadlock on the delete is retried and reports success', async () => {
  const note = await noteService.createNote({ title: unique('delete'), content: 'x' });
  injectDeadlocks(/DELETE FROM notes/);
  assert.equal(await noteService.deleteNote(note.id, { permanent: true }), true);
  assert.equal(await noteService.getNoteById(note.id), null);
});

test('deleteNote: a deadlock on the tag cleanup is retried, so no orphan tag is left', async () => {
  const tag = `orphan${crypto.randomUUID().slice(0, 8)}`;
  const note = await noteService.createNote({ title: unique('delete tags'), content: `#${tag}` });
  injectDeadlocks(/DELETE t FROM tags/);
  assert.equal(await noteService.deleteNote(note.id, { permanent: true }), true);
  const [rows] = await realQuery('SELECT COUNT(*) AS n FROM tags WHERE name = ?', [tag]);
  assert.equal(Number(rows[0].n), 0);
});

test('saveAttachment: a deadlock on its insert is retried and one record saved', async () => {
  const note = await noteService.createNote({ title: unique('attachment'), content: 'x' });
  created.push(note.id);
  injectDeadlocks(/INSERT INTO attachments/);
  const saved = await attachmentService.saveAttachment({ noteId: note.id, filename: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from(crypto.randomUUID()) });
  const [rows] = await realQuery('SELECT COUNT(*) AS n FROM attachments WHERE note_id = ?', [note.id]);
  assert.equal(Number(rows[0].n), 1);
  assert.ok(await attachmentService.getAttachmentById(saved.id));
  await attachmentService.deleteAttachment(saved.id);
});

test('importVaultFromZip: a deadlock mid-import is retried, with each note once and the counts right', async () => {
  const zip = new AdmZip();
  const titles = [unique('import one'), unique('import two')];
  for (const t of titles) zip.addFile(`notes/${t}.md`, Buffer.from(`body of ${t}`));
  // Let the first note's snapshot through, then deadlock on the second's: the whole import
  // transaction (first note included) must be undone and run again.
  let seen = 0;
  const secondSnapshot = { test: (sql) => /INSERT INTO note_versions/.test(sql) && (seen += 1) === 2 };
  const probe = injectDeadlocks(secondSnapshot);
  const result = await exportService.importVaultFromZip(zip.toBuffer());
  assert.equal(probe.remaining(), 0, 'the deadlock was hit');
  // If the first note's rows had survived the cancelled attempt, the retry would count it
  // as skipped (importedNotes 1, skippedNotes 1) instead of importing both again.
  assert.deepEqual(result, { importedNotes: 2, skippedNotes: 0, importedAttachments: 0, skippedAttachments: 0 });
  for (const t of titles) {
    assert.equal(await countByTitle(t), 1, t);
    const [rows] = await realQuery('SELECT id FROM notes WHERE title = ?', [t]);
    created.push(rows[0].id);
  }
  assert.match(warnings.join('\n'), /deadlock in importVaultFromZip/);
});

test('createNote inside a caller\'s transaction is not retried on its own', async () => {
  const conn = await realGetConnection();
  const title = unique('in transaction');
  let calls = 0;
  const original = conn.query.bind(conn);
  conn.query = async (sql, ...rest) => {
    if (/INSERT INTO note_versions/.test(String(sql))) { calls += 1; throw fakeDeadlock(); }
    return original(sql, ...rest);
  };
  try {
    await conn.beginTransaction();
    await assert.rejects(noteService.createNote({ title, content: 'x', conn }), (err) => err.code === 'ER_LOCK_DEADLOCK');
    assert.equal(calls, 1, 'the deadlock goes straight back to the transaction owner');
  } finally {
    conn.query = original;
    await conn.rollback();
    conn.release();
  }
  assert.equal(await countByTitle(title), 0);
});
