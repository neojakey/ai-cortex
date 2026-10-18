// The sidebar's Hashtags list: tags used by 2+ notes are shown, system tags (journal, daily,
// dayone, YYYY-MM) and one-note tags are behind "Show N more", and the selected tag is
// always visible.
import { check, finish, createNote, deleteNotes, openBrowser, openNote } from './helpers.js';

const s = Date.now();
const pair = `xt-pair-${s}`;
const single = `xt-single-${s}`;
const notes = [
  await createNote({ title: `Tags list A ${s}`, content: 'a', customTags: [pair, 'journal'] }),
  await createNote({ title: `Tags list B ${s}`, content: 'b', customTags: [pair, 'journal'] }),
  await createNote({ title: `Tags list C ${s}`, content: 'c', customTags: [single] })
];

const { browser, page, errors } = await openBrowser();
await openNote(page, notes[0].id);
await page.reload();
await page.waitForSelector('.note-title-input');
await page.waitForTimeout(800);

// The accordion header also names the selected tag, so exclude it.
const chip = (name) => page.locator('button', { hasText: `#${name}` }).filter({ hasNotText: 'Hashtags' });
await page.locator('button', { hasText: 'Hashtags' }).click();
await page.waitForTimeout(300);

check(await chip(pair).count() === 1, 'a tag used by two notes is listed');
check(await chip(single).count() === 0, 'a tag used by one note is hidden');
check(await chip('journal').count() === 0, 'the journal system tag is hidden');
const more = page.locator('.filter-more-btn');
check(/^Show \d+ more/.test(await more.innerText()), 'a "Show N more…" link is offered');

await more.click();
await page.waitForTimeout(200);
check(await chip(single).count() === 1 && await chip('journal').count() === 1, 'Show more reveals the hidden tags');
check((await more.innerText()) === 'Show fewer', 'the link now says "Show fewer"');

// Select a hidden tag, then collapse the list: the selected tag stays.
await chip(single).click();
await page.waitForTimeout(500);
await page.locator('.filter-more-btn').click();
await page.waitForTimeout(200);
check(await chip(single).count() === 1, 'the selected tag stays visible after Show fewer');
check(await chip(pair).count() === 1, 'the other listed tags are still there');
check(await chip('journal').count() === 0, 'the other hidden tags go back into hiding');

check(errors.length === 0, `no page errors ${errors.join(' ')}`);
await browser.close();
await deleteNotes(notes);
finish();
