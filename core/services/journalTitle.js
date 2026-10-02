// A daily note's journal title is stored as a note property and shown as
// "Journal: <title> - <date>" (see client/src/lib/noteTitle.js).
export const JOURNAL_TITLE_PROPERTY = 'journal_title';

/** SELECT expression for a note's journal title, given the notes table alias. */
export const journalTitleSql = (alias) =>
  `(SELECT jt.property_value FROM note_properties jt WHERE jt.note_id = ${alias}.id AND jt.property_name = '${JOURNAL_TITLE_PROPERTY}') AS journal_title`;

// Section headings from the daily template: never a title.
const TEMPLATE_SECTIONS = new Set(['log', 'tasks', 'notes & reflections', 'notes and reflections', 'worked on with claude']);

/**
 * The journal title an entry already has in its text: its first line, when that line is
 * a #, ## or ### heading that isn't a template section or the old "Daily: <date>" heading.
 * Markdown formatting is dropped ("A **big** day" → "A big day"). Returns null otherwise.
 */
export function titleFromFirstHeading(content) {
  const firstLine = String(content || '').split('\n', 1)[0];
  const match = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(firstLine);
  if (!match) return null;
  const text = match[1]
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images keep their text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[Target|Alias]]
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // [[Target]]
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (TEMPLATE_SECTIONS.has(text.toLowerCase())) return null;
  if (/^(Daily|Journal): \d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text.slice(0, 200);
}
