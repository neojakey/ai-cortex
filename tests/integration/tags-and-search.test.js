import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { searchService } from '../../core/services/searchService.js';
import { projectService } from '../../core/services/projectService.js';

const suffix = crypto.randomUUID().slice(0, 8);
const uniq = (label) => `TS ${label} ${suffix}`;
// tags is a single global table shared by every test file running in parallel against
// the same test database, so tag names need the same per-run uniqueness as titles and
// project names get elsewhere in this suite — a literal like 'alpha' colliding with
// another file's concurrent INSERT IGNORE INTO tags(name) can deadlock both writers.
const tag = (label) => `ts-${suffix}-${label}`;

const createdNotes = [];
const createdProjects = [];

async function makeNote(label, fields = {}) {
  const note = await noteService.createNote({ title: uniq(label), content: 'base', ...fields });
  createdNotes.push(note.id);
  return note;
}

async function tagRow(noteId, tagName) {
  const [rows] = await pool.query(
    `SELECT nt.from_hashtag, nt.from_explicit FROM note_tags nt
     JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? AND t.name = ?`,
    [noteId, tagName]
  );
  return rows[0] || null;
}

async function tagExistsAtAll(tagName) {
  const [rows] = await pool.query(`SELECT id FROM tags WHERE name = ?`, [tagName]);
  return rows.length > 0;
}

test.after(async () => {
  for (const id of createdNotes) await noteService.deleteNote(id, { permanent: true });
  for (const name of createdProjects) await pool.query(`DELETE FROM projects WHERE name = ?`, [name]);
  await pool.end();
});

// --- Explicit-tag preservation (audit finding #2) ---------------------------------

test('Tags: a content-only edit preserves an explicit tag that is not typed as a hashtag', async () => {
  const dayone = tag('dayone');
  const note = await makeNote('preserve', { customTags: [dayone] });
  assert.ok(note.tags.includes(dayone));

  const updated = await noteService.updateNote(note.id, { content: 'a fresh sentence, no hashtags here' });
  assert.ok(updated.tags.includes(dayone), 'explicit tag must survive a content-only edit with customTags omitted');
});

test('Tags: customTags: [] clears explicit tags but a literal hashtag in content still shows the tag', async () => {
  const kept = tag('kept');
  const explicitOnly = tag('explicit-only');
  const note = await makeNote('clear-explicit', { content: `body with #${kept}`, customTags: [kept, explicitOnly] });
  assert.deepEqual([...note.tags].sort(), [explicitOnly, kept].sort());

  const updated = await noteService.updateNote(note.id, { customTags: [] });
  assert.ok(updated.tags.includes(kept), 'a tag still typed in content must remain visible');
  assert.ok(!updated.tags.includes(explicitOnly), 'a tag with no other origin must be cleared');
});

test('Tags: removing a hashtag from content leaves an explicit tag in place', async () => {
  const both = tag('both');
  const note = await makeNote('drop-hashtag', { content: `body with #${both}`, customTags: [both] });
  assert.ok((await tagRow(note.id, both)).from_hashtag);
  assert.ok((await tagRow(note.id, both)).from_explicit);

  const updated = await noteService.updateNote(note.id, { content: 'body with the hashtag removed' });
  assert.ok(updated.tags.includes(both), 'the tag must remain because it is still explicit');
  const row = await tagRow(note.id, both);
  assert.equal(row.from_hashtag, 0);
  assert.equal(row.from_explicit, 1);
});

test('Tags: an invisible explicit-clear (hashtag still covers the tag) is still persisted and does not bump revision', async () => {
  const covered = tag('covered');
  const note = await makeNote('invisible-clear', { content: `body with #${covered}`, customTags: [covered] });
  const cleared = await noteService.updateNote(note.id, { customTags: [] });

  // Nothing visible changed (the tag is still shown, via the hashtag), so no revision bump.
  assert.equal(cleared.revision, note.revision, 'a change invisible in the tag list must not bump the revision');
  assert.ok(cleared.tags.includes(covered));

  // But the explicit flag really was cleared, provable once the hashtag is also removed.
  const afterHashtagRemoved = await noteService.updateNote(note.id, { content: 'the hashtag is gone now' });
  assert.ok(!afterHashtagRemoved.tags.includes(covered), 'the earlier explicit-clear must have actually persisted');
});

test('Tags: a tag with no remaining origin anywhere is pruned from the global tags table', async () => {
  const soloOrphan = tag('solo-orphan');
  const note = await makeNote('prune', { customTags: [soloOrphan] });
  assert.ok(await tagExistsAtAll(soloOrphan));

  await noteService.updateNote(note.id, { customTags: [] });
  assert.ok(!(await tagExistsAtAll(soloOrphan)), 'a tag attached to nothing must be pruned');
});

test('Tags: reordering the same explicit tag list changes nothing and does not bump the revision', async () => {
  const a = tag('reorder-a');
  const b = tag('reorder-b');
  const note = await makeNote('reorder', { customTags: [a, b] });
  const same = await noteService.updateNote(note.id, { customTags: [b, a] });
  assert.equal(same.revision, note.revision);
});

// --- Project resolution by id, slug, or display name (audit finding #5) -----------

test('Projects: getBySlugOrId resolves by id, slug, and case-insensitive display name; unknown is null', async () => {
  const name = uniq('Resolve Me');
  createdProjects.push(name);
  const created = await projectService.getOrCreateByName(name);

  assert.equal((await projectService.getBySlugOrId(created.id)).id, created.id);
  assert.equal((await projectService.getBySlugOrId(created.slug)).id, created.id);
  assert.equal((await projectService.getBySlugOrId(name.toUpperCase())).id, created.id);
  assert.equal(await projectService.getBySlugOrId(uniq('does-not-exist')), null);
});

test('Notes: listNotes filters by a project display name, not just its slug or id', async () => {
  const name = uniq('List By Name');
  createdProjects.push(name);
  const note = await makeNote('in-project', { project: name });

  const byName = await noteService.listNotes({ project: name });
  assert.ok(byName.some((n) => n.id === note.id), 'listNotes must match the project by display name');

  const byUnknown = await noteService.listNotes({ project: uniq('no-such-project') });
  assert.deepEqual(byUnknown, [], 'an unresolvable project must return no notes, not every note');
});

// --- Search: project name filtering and exact-tag matching (audit finding #5) -----

test('Search: filtering by a project display name returns the same notes as filtering by its slug', async () => {
  const name = uniq('Search Project');
  createdProjects.push(name);
  const needle = uniq('needle');
  const note = await makeNote('search-scoped', { project: name, content: `${needle} content` });
  const project = await projectService.getBySlugOrId(name);

  const byName = await searchService.search(needle, { project: name });
  const bySlug = await searchService.search(needle, { project: project.slug });
  assert.ok(byName.some((r) => r.id === note.id));
  assert.deepEqual(byName.map((r) => r.id).sort(), bySlug.map((r) => r.id).sort());

  const byUnknownProject = await searchService.search(needle, { project: uniq('ghost-project') });
  assert.deepEqual(byUnknownProject, [], 'an unresolvable project must return no results, not every match');
});

test('Search: an explicit tag not present anywhere in the text is still found by name', async () => {
  const rareword = tag('rareword');
  const note = await makeNote('tag-only', {
    content: 'this body never mentions the word we will search for',
    customTags: [rareword]
  });

  const results = await searchService.search(rareword);
  assert.ok(results.some((r) => r.id === note.id), 'a note must be findable by an explicit tag alone');
});

test('Search: a note matched by tag ranks at or above a note only matched by a weak text hit', async () => {
  const term = tag('rankterm');
  const byTag = await makeNote('rank-tag', { content: 'unrelated body text', customTags: [term] });
  const byText = await makeNote('rank-text', { content: `mentions ${term} once in passing` });

  const results = await searchService.search(term);
  const tagResult = results.find((r) => r.id === byTag.id);
  const textResult = results.find((r) => r.id === byText.id);
  assert.ok(tagResult && textResult, 'both notes must appear in the results');
  assert.ok(tagResult.score >= textResult.score, 'the exact tag match should not rank below the weaker text hit');
});
