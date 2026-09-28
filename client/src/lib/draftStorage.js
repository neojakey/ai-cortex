// Per-note unsaved drafts, so a tab closed or reloaded mid-debounce isn't gone for good.
// Kept free of React so it can be unit tested, like saveCoordinator.js.
//
// Written synchronously on every edit (not debounced) so even a close moments after a
// keystroke still has it. baseRevision lets a later load tell a draft that's still safe
// to resume from one whose note has since moved on without it.

const keyFor = (noteId) => `ai_cortex_draft_${noteId}`;

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
