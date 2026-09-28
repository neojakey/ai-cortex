import test from 'node:test';
import assert from 'node:assert/strict';

// draftStorage.js touches the `localStorage` global at call time only, so importing it
// in Node is safe; purgeLegacyDrafts gets its own fake storage passed in.
const { shouldPersistEdits, purgeLegacyDrafts } = await import('../../client/src/lib/draftStorage.js');

function fakeStorage(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    store,
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
}

test('shouldPersistEdits: nothing is saved while the fields still belong to the previous note', () => {
  assert.equal(shouldPersistEdits({ noteId: 'B', loadedNoteId: 'A', isDirty: true, conflict: null }), false);
});

test('shouldPersistEdits: nothing is saved before any note has loaded (first open after a page load)', () => {
  assert.equal(shouldPersistEdits({ noteId: 'A', loadedNoteId: null, isDirty: true, conflict: null }), false);
});

test('shouldPersistEdits: an edit to the loaded note is saved', () => {
  assert.equal(shouldPersistEdits({ noteId: 'A', loadedNoteId: 'A', isDirty: true, conflict: null }), true);
});

test('shouldPersistEdits: an unchanged note is not saved', () => {
  assert.equal(shouldPersistEdits({ noteId: 'A', loadedNoteId: 'A', isDirty: false, conflict: null }), false);
});

test('shouldPersistEdits: nothing is saved while a conflict is unresolved', () => {
  assert.equal(shouldPersistEdits({ noteId: 'A', loadedNoteId: 'A', isDirty: true, conflict: { currentRevision: 4 } }), false);
});

test('shouldPersistEdits: no note open means nothing to save', () => {
  assert.equal(shouldPersistEdits({ noteId: undefined, loadedNoteId: undefined, isDirty: true, conflict: null }), false);
});

test('purgeLegacyDrafts: deletes every existing draft and nothing else', () => {
  const storage = fakeStorage({
    ai_cortex_draft_a: '{"baseRevision":1,"title":"","content":""}',
    ai_cortex_draft_b: '{"baseRevision":2,"title":"other note","content":"x"}',
    ai_cortex_view_mode: 'edit',
    ai_cortex_sidebar_width: '300'
  });
  assert.equal(purgeLegacyDrafts(storage), 2);
  assert.deepEqual([...storage.store.keys()].sort(), ['ai_cortex_drafts_purged_v2', 'ai_cortex_sidebar_width', 'ai_cortex_view_mode']);
});

test('purgeLegacyDrafts: runs only once, so drafts written after the fix survive later loads', () => {
  const storage = fakeStorage({ ai_cortex_draft_a: '{}' });
  purgeLegacyDrafts(storage);
  storage.setItem('ai_cortex_draft_new', '{"baseRevision":5}');
  assert.equal(purgeLegacyDrafts(storage), 0);
  assert.equal(storage.getItem('ai_cortex_draft_new'), '{"baseRevision":5}');
});

test('purgeLegacyDrafts: an empty storage just sets the flag', () => {
  const storage = fakeStorage();
  assert.equal(purgeLegacyDrafts(storage), 0);
  assert.equal(storage.getItem('ai_cortex_drafts_purged_v2'), '1');
});

test('purgeLegacyDrafts: never throws when storage is unavailable', () => {
  const broken = { getItem() { throw new Error('SecurityError'); } };
  assert.equal(purgeLegacyDrafts(broken), 0);
});
