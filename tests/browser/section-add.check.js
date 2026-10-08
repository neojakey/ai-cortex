// An AI adding a line by section while the note is open and being typed in: the open
// editor must show the conflict banner, never save over the added line.
import { check, finish, createNote, getNote, deleteNotes, openBrowser, openNote, testDate, API } from './helpers.js';

const CLAUDE = '## Worked on with Claude';
const note = await createNote({ title: `Daily: ${testDate(1846)}`, content: `- my own line\n\n${CLAUDE}\n### BolsaHotelera\n- logged earlier\n` });

const { browser, page, errors } = await openBrowser({ settings: { ai_cortex_view_mode: 'edit' } });
await openNote(page, note.id, 'textarea');

// A session adds a line through the section endpoint...
const added = await (await fetch(`${API}/api/notes/${note.id}/section`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ section: [CLAUDE, '### BolsaHotelera'], content: '- added by a session' })
})).json();
check(added.revision === note.revision + 1, `the add was saved (revision ${added.revision})`);

// ...while the open tab, which loaded the note before that, types and autosaves.
await page.click('textarea');
await page.keyboard.press('Control+Home');
await page.keyboard.type('Typed in the open tab. ');
await page.waitForTimeout(1800);

const stored = await getNote(note.id);
check(stored.content.includes('- added by a session'), 'the added line is still there');
check(!stored.content.includes('Typed in the open tab.'), 'the tab did not save over it');
check(await page.locator('.btn-conflict').count() > 0, 'the open tab shows the conflict banner');
check(await page.inputValue('textarea').then((v) => v.startsWith('Typed in the open tab.')), 'the typing is still in the editor, not lost');

check(errors.length === 0, `no page errors ${errors.join(' ')}`);
await browser.close();
await deleteNotes([note]);
finish();
