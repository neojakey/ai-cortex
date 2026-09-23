// Serializes the editor's saves and tracks the note revision they are based on.
//
// Kept free of React so it can be unit tested. The editor gives it three things:
//   getFields()             -> a snapshot of what should be saved ({ noteId, title, ... })
//   send(fields, revision)  -> performs the save, resolves to the saved note, and
//                              rejects with `code: 'REVISION_CONFLICT'` + `currentRevision`
//                              when the note changed on the server since `revision`
//   onChange(state)         -> { status: 'idle' | 'saving' | 'error' | 'conflict', conflict }
//
// Rules it enforces:
//   - Only one save is in flight at a time. A save requested meanwhile is folded into a
//     follow-up that reads the *latest* fields and the *newest* revision, so the editor
//     can never conflict with itself.
//   - Nothing is sent when the fields equal what was last saved.
//   - After a conflict nothing more is sent until the user resolves it: reset() to adopt
//     the server's version, or overwrite() to knowingly replace it.
//   - Overwrite retries with the server's current revision, never with the check omitted.

export function createSaveCoordinator({ getFields, send, onChange = () => {}, onSaved = () => {} }) {
  let baseRevision = null;
  let lastSavedFields = null;
  let saving = false;
  let saveAgain = false;
  let generation = 0; // bumped by reset() so results from a previous note are ignored
  let state = { status: 'idle', conflict: null };

  const sameFields = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const setState = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  async function save() {
    if (state.conflict) return;
    if (saving) {
      saveAgain = true;
      return;
    }

    const gen = generation;
    saving = true;
    try {
      do {
        saveAgain = false;
        const fields = getFields();
        if (sameFields(fields, lastSavedFields)) {
          // Nothing (left) to save, e.g. the user typed and then reverted during a save.
          if (state.status === 'saving') setState({ status: 'idle' });
          break;
        }

        setState({ status: 'saving' });
        let saved;
        try {
          saved = await send(fields, baseRevision);
          if (!saved || !Number.isInteger(saved.revision)) {
            throw new Error('Save response did not include a revision');
          }
        } catch (err) {
          if (gen !== generation) return;
          if (err && err.code === 'REVISION_CONFLICT') {
            setState({ status: 'conflict', conflict: { currentRevision: err.currentRevision } });
          } else {
            setState({ status: 'error' });
          }
          return;
        }

        if (gen !== generation) return;
        baseRevision = saved.revision;
        lastSavedFields = fields;
        if (sameFields(fields, getFields())) {
          setState({ status: 'idle' });
          onSaved(saved);
        } else {
          saveAgain = true; // the user kept typing while this request was in flight
        }
      } while (saveAgain);
    } finally {
      if (gen === generation) saving = false;
    }
  }

  return {
    save,

    /** Adopt a note as loaded from the server (open, switch, reload, refresh). Clears any conflict. */
    reset(revision, fields) {
      generation += 1;
      baseRevision = revision;
      lastSavedFields = fields;
      saving = false;
      saveAgain = false;
      setState({ status: 'idle', conflict: null });
    },

    /** Resolve a conflict by replacing the server's latest version with ours. */
    overwrite() {
      if (state.conflict) {
        baseRevision = state.conflict.currentRevision;
        setState({ status: 'idle', conflict: null });
      }
      return save();
    },

    get state() {
      return state;
    },

    get baseRevision() {
      return baseRevision;
    }
  };
}
