// One-time copy of each daily note's first heading ("## Patio Cleanup") into its journal
// title field (the `journal_title` property), so past entries show as
// "Journal: Patio Cleanup - 2026-10-01".
//
//   node scripts/backfill-journal-titles.js           preview only: lists what would change
//   node scripts/backfill-journal-titles.js --apply   writes it
//
// Only daily notes that have no journal title yet are touched, so it's safe to re-run.
// Each note is saved through updateNote with its current revision: the revision goes up,
// so an editor tab that loaded the note earlier gets a conflict instead of saving a blank
// title over the copied one. The heading line stays in the text.
import { fileURLToPath } from 'node:url';
import { pool as defaultPool } from '../core/db/pool.js';
import { noteService } from '../core/services/noteService.js';
import { titleFromFirstHeading, JOURNAL_TITLE_PROPERTY } from '../core/services/journalTitle.js';

/**
 * @param {string[]} [options.noteIds] only these notes (tests use it to stay off other tests' notes)
 * @returns {Promise<{checked: number, titled: Array<{id, title, journalTitle}>, failed: Array<{id, title, error}>}>}
 */
export async function backfillJournalTitles({ apply = false, noteIds = null, notes = noteService, pool = defaultPool } = {}) {
  const [rows] = await pool.query(
    `SELECT n.id, n.title, n.content, n.revision
     FROM notes n
     WHERE n.status != 'trash'
       AND n.title REGEXP '^Daily: [0-9]{4}-[0-9]{2}-[0-9]{2}$'
       AND NOT EXISTS (SELECT 1 FROM note_properties p WHERE p.note_id = n.id AND p.property_name = ?)
       ${noteIds ? 'AND n.id IN (?)' : ''}
     ORDER BY n.title`,
    noteIds ? [JOURNAL_TITLE_PROPERTY, noteIds] : [JOURNAL_TITLE_PROPERTY]
  );

  const titled = [];
  const failed = [];
  for (const row of rows) {
    const journalTitle = titleFromFirstHeading(row.content);
    if (!journalTitle) continue;
    if (apply) {
      try {
        await notes.updateNote(row.id, {
          properties: { [JOURNAL_TITLE_PROPERTY]: journalTitle },
          expectedRevision: row.revision
        });
      } catch (err) {
        failed.push({ id: row.id, title: row.title, error: err.code || err.message });
        continue;
      }
    }
    titled.push({ id: row.id, title: row.title, journalTitle });
  }
  return { checked: rows.length, titled, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const result = await backfillJournalTitles({ apply });
  for (const t of result.titled) console.log(`${t.title}  →  ${t.journalTitle}`);
  for (const f of result.failed) console.log(`FAILED ${f.title}: ${f.error}`);
  console.log(`\n${result.checked} daily notes without a journal title; ${result.titled.length} ${apply ? 'titled' : 'would be titled'}; ${result.failed.length} failed.`);
  if (!apply) console.log('Preview only. Run with --apply to write.');
  await defaultPool.end();
}
