import test from 'node:test';
import assert from 'node:assert/strict';

// draftStorage.js reads the bare `localStorage` global, as it does in a real browser;
// Node has no such global, so a minimal in-memory stand-in is installed before import.
function installFakeLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  return store;
}
const store = installFakeLocalStorage();

const { draftStorage, shouldResumeDraft } = await import('../../client/src/lib/draftStorage.js');

test.beforeEach(() => store.clear());

test('draftStorage: save then load round-trips the same draft', () => {
  draftStorage.save('note-1', { baseRevision: 3, title: 'T', content: 'body', status: 'active', dueDate: null });
  assert.deepEqual(draftStorage.load('note-1'), {
    baseRevision: 3, title: 'T', content: 'body', status: 'active', dueDate: null
  });
});

test('draftStorage: load returns null when nothing was saved for that note', () => {
  assert.equal(draftStorage.load('nothing-here'), null);
});

test('draftStorage: clear removes only that note\'s draft', () => {
  draftStorage.save('note-1', { baseRevision: 1, title: 'a' });
  draftStorage.save('note-2', { baseRevision: 1, title: 'b' });
  draftStorage.clear('note-1');
  assert.equal(draftStorage.load('note-1'), null);
  assert.deepEqual(draftStorage.load('note-2'), { baseRevision: 1, title: 'b' });
});

test('draftStorage: load never throws on corrupt JSON, just returns null', () => {
  store.set('ai_cortex_draft_note-1', '{not valid json');
  assert.equal(draftStorage.load('note-1'), null);
});

test('draftStorage: never throws even when localStorage itself throws (private mode, blocked storage)', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  try {
    assert.doesNotThrow(() => draftStorage.save('note-1', { baseRevision: 1 }));
    assert.equal(draftStorage.load('note-1'), null);
    assert.doesNotThrow(() => draftStorage.clear('note-1'));
  } finally {
    globalThis.localStorage = original;
  }
});

// --- shouldResumeDraft: the decision table from the spec --------------------------

test('shouldResumeDraft: no draft at all -> false', () => {
  assert.equal(shouldResumeDraft(null, { revision: 5 }), false);
});

test('shouldResumeDraft: draft matches the note\'s current revision -> true', () => {
  assert.equal(shouldResumeDraft({ baseRevision: 5, title: 'x' }, { revision: 5 }), true);
});

test('shouldResumeDraft: draft is based on an older revision (note moved on) -> false', () => {
  assert.equal(shouldResumeDraft({ baseRevision: 4, title: 'x' }, { revision: 5 }), false);
});

test('shouldResumeDraft: no note loaded -> false', () => {
  assert.equal(shouldResumeDraft({ baseRevision: 5 }, null), false);
});
