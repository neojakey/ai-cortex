// Two rules applied wherever a tag is attached to a note, so the tag list doesn't refill
// with noise after a cleanup:
//   1. A note never gets a tag that is just the name of its own folder ("health" on a note
//      in the Health folder): the folder already says it. Names match ignoring case, spaces
//      and punctuation.
//   2. Known misspellings map to the right tag (TAG_ALIASES). To add one, add a line.
//
// Both only decide which tags get attached; the note's text is never touched, and a tag
// that is not the note's own folder name is attached as before.

export const TAG_ALIASES = {
  bolsehotelera: 'bolsahotelera'
};

const normalise = (name) => String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The right spelling of a tag name (the name itself unless it is a known misspelling). */
export function canonicalTag(name) {
  return Object.prototype.hasOwnProperty.call(TAG_ALIASES, name) ? TAG_ALIASES[name] : name;
}

/**
 * @param {string[]} names tag names, already lower-cased
 * @param {string|null|undefined} folderName the note's folder (project) name, if any
 * @returns {string[]} aliases resolved, duplicates removed, the folder's own name dropped
 */
export function applyTagRules(names, folderName) {
  const folder = normalise(folderName);
  const out = [];
  for (const name of names) {
    const tag = canonicalTag(name);
    if (!tag || (folder && normalise(tag) === folder) || out.includes(tag)) continue;
    out.push(tag);
  }
  return out;
}
