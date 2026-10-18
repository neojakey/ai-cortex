import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlan } from '../../scripts/tags-cleanup.js';
import { pool } from '../../core/db/pool.js';

test.after(async () => { await pool.end(); });

const row = (noteId, tag, extra = {}) => ({ noteId, title: extra.title ?? `Note ${noteId}`, status: 'active', folder: extra.folder ?? null, tag, fh: !!extra.fh, fe: extra.fe ?? true });
const daily = (noteId, tag) => row(noteId, tag, { title: 'Daily: 2026-10-01' });
const ALIASES = { typo: 'right' };
const plan = (rows, options = {}) => computePlan(rows, { aliases: ALIASES, ...options });
const removed = (p) => p.changes.filter((c) => !c.after).map((c) => `${c.noteId}:${c.tag}:${c.reason}`).sort();

test('cleanup plan: a tag equal to the note\'s own folder is removed, other tags stay', () => {
  const p = plan([row('a', 'health', { folder: 'Health' }), row('a', 'sleep', { folder: 'Health' }), row('b', 'sleep', { folder: 'Health' })]);
  assert.deepEqual(removed(p), ['a:health:folder']);
});

test('cleanup plan: the folder match ignores case, spaces and punctuation', () => {
  const p = plan([row('a', 'claude-memory', { folder: 'Claude Memory' }), row('b', 'claude-memory', { folder: 'Claude Memory' })]);
  assert.deepEqual(removed(p), ['a:claude-memory:folder', 'b:claude-memory:folder']);
});

test('cleanup plan: a tag used by one note is removed, a tag used by two is kept', () => {
  const p = plan([row('a', 'solo'), row('a', 'pair'), row('b', 'pair')]);
  assert.deepEqual(removed(p), ['a:solo:one-off']);
});

test('cleanup plan: journal entries are never changed, and count as users of a tag', () => {
  const p = plan([daily('j', 'solo-on-journal'), row('a', 'shared'), daily('j2', 'shared'), row('b', 'only-here')]);
  assert.deepEqual(removed(p), ['b:only-here:one-off']);
});

test('cleanup plan: system tags are never removed, even when only one note has them', () => {
  const p = plan([row('a', 'journal'), row('b', 'daily'), row('c', 'dayone'), row('d', '2099-01')]);
  assert.deepEqual(removed(p), []);
});

test('cleanup plan: protected tags (private) are kept even when only one note has them', () => {
  assert.deepEqual(removed(plan([row('a', 'private'), row('b', 'other')])), ['b:other:one-off']);
});

test('cleanup plan: a misspelling is merged into the right tag, flags combined', () => {
  const p = plan([row('a', 'typo', { fh: true, fe: false }), row('a', 'right', { fh: false, fe: true }), row('b', 'typo', { fh: false, fe: true }), row('c', 'right')]);
  const byKey = Object.fromEntries(p.changes.map((c) => [`${c.noteId}:${c.tag}`, c]));
  assert.deepEqual(byKey['a:typo'].after, null);
  assert.deepEqual(byKey['a:right'].after, { fh: true, fe: true });
  assert.deepEqual(byKey['b:right'].before, null);
  assert.deepEqual(byKey['b:right'].after, { fh: false, fe: true });
  assert.deepEqual(byKey['b:typo'].after, null);
});

test('cleanup plan: merging happens before the folder rule, so an alias of the folder name goes too', () => {
  const p = plan([row('a', 'typo', { folder: 'Right' }), row('b', 'right', { folder: 'Right' }), row('c', 'right')]);
  const ends = new Map(p.changes.map((c) => [`${c.noteId}:${c.tag}`, c.after]));
  assert.equal(ends.get('a:typo'), null);
  assert.equal(ends.has('a:right'), false, 'merged in and removed again: no net change');
  assert.equal(ends.get('b:right'), null);
});

test('cleanup plan: the plan is idempotent: planning again on the result changes nothing', () => {
  const rows = [row('a', 'health', { folder: 'Health' }), row('a', 'solo'), row('b', 'typo'), row('b', 'pair'), row('c', 'pair')];
  const first = plan(rows);
  const after = new Map(rows.map((r) => [`${r.noteId}:${r.tag}`, r]));
  for (const c of first.changes) {
    const k = `${c.noteId}:${c.tag}`;
    if (c.after) after.set(k, row(c.noteId, c.tag, { fh: c.after.fh, fe: c.after.fe })); else after.delete(k);
  }
  assert.equal(plan([...after.values()]).changes.length, 0);
});

test('cleanup plan: scope limits what changes, but out-of-scope notes still count as users', () => {
  const rows = [row('in', 'shared'), row('out', 'shared'), row('in', 'solo'), row('out', 'health', { folder: 'Health' })];
  const p = plan(rows, { scope: new Set(['in']) });
  assert.deepEqual(removed(p), ['in:solo:one-off']);
});

test('cleanup plan: notes left with no tags are reported', () => {
  const p = plan([row('a', 'solo', { title: 'Lonely note' }), row('b', 'x'), row('b', 'x2'), row('c', 'x'), row('c', 'x2')]);
  assert.deepEqual(p.summary.notesWithNoTagsLeft.map((n) => n.title), ['Lonely note']);
});

test('cleanup plan: the summary counts agree with the changes', () => {
  const p = plan([row('a', 'health', { folder: 'Health' }), row('a', 'solo'), row('b', 'typo'), row('b', 'pair'), row('c', 'pair')]);
  assert.equal(p.summary.linksRemoved, p.changes.filter((c) => c.before && !c.after).length);
  assert.equal(p.summary.byReason.folder + p.summary.byReason['one-off'] + p.summary.byReason.merge, p.changes.length);
  assert.ok(p.summary.tagsAfter < p.summary.tagsBefore);
});

test('cleanup plan: a clean set of tags has nothing to do', () => {
  const p = plan([row('a', 'pair'), row('b', 'pair'), row('a', 'journal'), row('a', 'other'), row('b', 'other')]);
  assert.equal(p.changes.length, 0);
});
