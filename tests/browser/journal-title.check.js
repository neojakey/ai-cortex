// Journal title field on daily notes, including the save path's risky cases: switching
// notes mid-typing, reloading with a draft, and a conflict with a change made elsewhere.
import { check, finish, createNote, updateNote, getNote, deleteNotes, openBrowser, openNote, shot, testDate, APP } from './helpers.js';

const stamp = Date.now();
const dayA = testDate(1848);
const dayB = testDate(1847);
const A = await createNote({ title: `Daily: ${dayA}`, content: '## Log\n- a' });
const B = await createNote({ title: `Daily: ${dayB}`, content: '## Log\n- b' });
const R = await createNote({ title: `Regular ${stamp}`, content: 'regular text' });

const { browser, page, errors } = await openBrowser({ settings: { ai_cortex_view_mode: 'read' } });
const box = page.locator('.journal-title-input');

// Typed in Read mode, saved and shown everywhere.
await openNote(page, A.id);
check(await box.count() === 1 && await box.inputValue() === '', 'a daily note shows an empty title box');
const row = await page.textContent('.journal-title-row');
check(row.includes('Journal:') && row.includes(`- ${dayA}`), 'the row shows "Journal:" and the date');
await box.click();
await page.keyboard.type('Patio Cleanup');
await page.waitForTimeout(1500);
let a = await getNote(A.id);
check(a.properties.journal_title === 'Patio Cleanup', `title saved (${a.properties.journal_title})`);
check(a.title === `Daily: ${dayA}`, 'the stored title is unchanged');
check((await page.locator(`.note-item-title:has-text("Journal: Patio Cleanup - ${dayA}")`).count()) === 1, 'the note list shows the full title');
await shot(page, 'journal-title');

// Text and title edited together.
await page.click('.view-mode-btn:has-text("Edit")');
await page.click('textarea');
await page.keyboard.press('Control+End');
await page.keyboard.type(' more');
await box.click();
await page.keyboard.press('End');
await page.keyboard.type('!');
await page.waitForTimeout(1500);
a = await getNote(A.id);
check(a.content.endsWith('- a more') && a.properties.journal_title === 'Patio Cleanup!', 'text and title both saved');

// Switch notes within the 600 ms debounce: the title goes to A only.
await box.click();
await page.keyboard.press('End');
await page.keyboard.type(' quick');
await page.goto(`${APP}/#/note/${B.id}`);
await page.waitForSelector('.journal-title-input');
await page.waitForTimeout(1500);
a = await getNote(A.id);
let b = await getNote(B.id);
check(a.properties.journal_title === 'Patio Cleanup! quick', `fast switch: the typing was saved to A (${a.properties.journal_title})`);
check(b.properties.journal_title === undefined && b.revision === B.revision, 'fast switch: B untouched');
check(await box.inputValue() === '', 'B shows its own (empty) title');
await openNote(page, A.id);
check(await box.inputValue() === 'Patio Cleanup! quick', 'reopening A shows its title');
b = await getNote(B.id);
check(b.properties.journal_title === undefined && b.revision === B.revision, 'B still untouched after reopening A');

// Reload within the debounce: the draft brings the title back and saves it.
await box.click();
await page.keyboard.press('End');
await page.keyboard.type(' draft');
await page.reload();
await page.waitForSelector('.journal-title-input');
await page.waitForTimeout(1800);
check(await box.inputValue() === 'Patio Cleanup! quick draft', 'after a reload the draft title is back');
a = await getNote(A.id);
check(a.properties.journal_title === 'Patio Cleanup! quick draft', 'and it was saved');

// Clearing the box removes the title.
await box.fill('');
await page.waitForTimeout(1500);
a = await getNote(A.id);
check(a.properties.journal_title === undefined, 'clearing the box removes the title');
check((await page.locator(`.note-item-title:has-text("Journal: ${dayA}")`).count()) === 1, 'the note list shows just the date');

// A change made elsewhere is a conflict, not overwritten.
await updateNote(A.id, { properties: { journal_title: 'Set elsewhere' }, expectedRevision: a.revision });
await box.click();
await page.keyboard.type('Mine');
await page.waitForTimeout(1500);
a = await getNote(A.id);
check(a.properties.journal_title === 'Set elsewhere', `conflict: the other change is kept (${a.properties.journal_title})`);
check(await page.locator('.btn-conflict').count() > 0, 'the conflict banner is shown');

// A regular note's heading is still its editable title.
await openNote(page, R.id);
check(await box.count() === 0, 'a regular note has no journal title box');
await page.locator('.note-title-input').click();
await page.keyboard.press('End');
await page.keyboard.type(' renamed');
await page.waitForTimeout(1500);
const r = await getNote(R.id);
check(r.title === `Regular ${stamp} renamed` && r.properties.journal_title === undefined, 'a regular note renames as before');

check(errors.length === 0, `no page errors ${errors.join(' ')}`);
await browser.close();
await deleteNotes([A, B, R]);
finish();
