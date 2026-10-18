// Daily notes are stored as "Daily: YYYY-MM-DD": the app finds them by that title (and its
// slug, daily-YYYY-MM-DD), so it never changes. They're shown as "Journal: YYYY-MM-DD", or
// "Journal: <title> - YYYY-MM-DD" once they have a journal title (the `journal_title`
// note property, see core/services/journalTitle.js).

const DAILY_TITLE = /^Daily: (\d{4}-\d{2}-\d{2})$/;
export const JOURNAL_TITLE_PROPERTY = 'journal_title';

/** True for a daily note's stored title. */
export function isDailyTitle(title) {
  return DAILY_TITLE.test(title || '');
}

/** The title as shown to the user. Anything that isn't a daily note is unchanged. */
export function displayTitle(title, journalTitle) {
  const match = DAILY_TITLE.exec(title || '');
  if (!match) return title;
  const name = String(journalTitle || '').trim();
  return name ? `Journal: ${name} - ${match[1]}` : `Journal: ${match[1]}`;
}

/**
 * A note's title as shown inside its folder in the sidebar tree: a leading "<Folder>: "
 * is dropped, since the folder already says it ("BolsaHotelera: deploy commands" under
 * BolsaHotelera shows as "deploy commands"). Names match ignoring case, spaces and
 * punctuation. Anything else, or a title that is only the prefix, is shown unchanged.
 */
export function treeTitle(title, folderName) {
  const text = String(title || '');
  const colon = text.indexOf(':');
  if (colon <= 0 || !folderName) return text;
  const normalise = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const rest = text.slice(colon + 1).trim();
  if (!rest || normalise(text.slice(0, colon)) !== normalise(folderName) || !normalise(folderName)) return text;
  return rest;
}

/** A note's saved journal title, '' when it has none. */
export function savedJournalTitle(note) {
  const value = note?.properties?.[JOURNAL_TITLE_PROPERTY];
  return value == null ? '' : String(value);
}

/**
 * What to add to a save for the journal title: nothing for a regular note; for a daily
 * note the property, trimmed, or null (which removes it) when it's blank.
 */
export function journalTitleSave(storedTitle, journalTitle) {
  if (!isDailyTitle(storedTitle)) return {};
  const name = String(journalTitle || '').trim();
  return { properties: { [JOURNAL_TITLE_PROPERTY]: name || null } };
}
