// Daily notes are stored as "Daily: YYYY-MM-DD": the app finds them by that title (and its
// slug, daily-YYYY-MM-DD), so it never changes. They're only shown as "Journal: YYYY-MM-DD".

const DAILY_TITLE = /^Daily: (\d{4}-\d{2}-\d{2})$/;

/** True for a daily note's stored title. */
export function isDailyTitle(title) {
  return DAILY_TITLE.test(title || '');
}

/** The title as shown to the user: "Journal: …" for a daily note, anything else unchanged. */
export function displayTitle(title) {
  const match = DAILY_TITLE.exec(title || '');
  return match ? `Journal: ${match[1]}` : title;
}
