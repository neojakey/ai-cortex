// Per-note unsaved drafts, so a tab closed or reloaded mid-debounce isn't gone for good.
// Kept free of React so it can be unit tested, like saveCoordinator.js.
//
// Written synchronously on every edit (not debounced) so even a close moments after a
// keystroke still has it. baseRevision lets a later load tell a draft that's still safe
// to resume from one whose note has since moved on without it.

const DRAFT_PREFIX = 'ai_cortex_draft_';
const keyFor = (noteId) => `${DRAFT_PREFIX}${noteId}`;
// Set once every draft written before the note-switch fix has been deleted (see purgeLegacyDrafts).
const PURGED_FLAG = 'ai_cortex_drafts_purged_v2';

export const draftStorage = {
  save(noteId, draft) {
    try { localStorage.setItem(keyFor(noteId), JSON.stringify(draft)); } catch { /* ignore */ }
  },
  load(noteId) {
    try {
      const raw = localStorage.getItem(keyFor(noteId));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  clear(noteId) {
    try { localStorage.removeItem(keyFor(noteId)); } catch { /* ignore */ }
  }
};

/**
 * Whether a draft found for a note is still safe to resume, i.e. based on the same
 * revision the note is currently at. A draft based on an older revision means the note
 * moved on without it (elsewhere, or by another writer) and is not resumed automatically.
 */
export function shouldResumeDraft(draft, note) {
  return !!draft && !!note && draft.baseRevision === note.revision;
}

/**
 * Whether the editor may write a draft or autosave. Only once the fields on screen
 * belong to the note that's open: for one render after a note switch the editor
 * already has the new note but still holds the previous note's title and content,
 * and saving then would write that text into the wrong note.
 */
export function shouldPersistEdits({ noteId, loadedNoteId, isDirty, conflict }) {
  return !!noteId && loadedNoteId === noteId && !!isDirty && !conflict;
}

/**
 * Delete every draft saved before shouldPersistEdits existed, once. Those could hold
 * another note's text stamped with this note's revision, which shouldResumeDraft
 * cannot tell apart from a genuine draft.
 */
export function purgeLegacyDrafts(storage = globalThis.localStorage) {
  try {
    if (storage.getItem(PURGED_FLAG)) return 0;
    const stale = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(DRAFT_PREFIX)) stale.push(key);
    }
    stale.forEach((key) => storage.removeItem(key));
    storage.setItem(PURGED_FLAG, '1');
    return stale.length;
  } catch {
    return 0;
  }
}
