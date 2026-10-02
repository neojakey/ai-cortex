// Sidebar highlight: "Today's Journal" while today's daily note is open, "Notes Editor"
// for any other note, "Journal" for the calendar.
import { check, finish, createNote, deleteNotes, openBrowser, testDate, APP } from './helpers.js';

const other = await createNote({ title: `Sidebar check ${Date.now()}`, content: 'x' });
const oldDaily = await createNote({ title: `Daily: ${testDate(1850)}`, content: 'x' });
const { browser, page, errors } = await openBrowser();
const active = () => page.$$eval('.nav-views .nav-item.active', (els) => els.map((e) => e.querySelector('span').textContent));

await page.goto(`${APP}/#/note/${other.id}`);
await page.waitForSelector('.nav-views');
await page.waitForTimeout(600);
check(JSON.stringify(await active()) === '["Notes Editor"]', `ordinary note: Notes Editor (${await active()})`);

await page.click('.nav-item:has-text("Today\'s Journal")');
await page.waitForSelector('.journal-title-input');
await page.waitForTimeout(600);
check(JSON.stringify(await active()) === '["Today\'s Journal"]', `today's note: Today's Journal (${await active()})`);

await page.goto(`${APP}/#/note/${oldDaily.id}`);
await page.waitForTimeout(800);
check(JSON.stringify(await active()) === '["Notes Editor"]', `an older daily note: Notes Editor (${await active()})`);

await page.keyboard.press('Alt+d');
await page.waitForTimeout(1000);
check(JSON.stringify(await active()) === '["Today\'s Journal"]', `Alt+D: Today's Journal (${await active()})`);

await page.click('.nav-item:has-text("Journal") >> nth=1');
await page.waitForTimeout(800);
check(JSON.stringify(await active()) === '["Journal"]', `calendar: Journal only (${await active()})`);

check(errors.length === 0, `no page errors ${errors.join(' ')}`);
await browser.close();
await deleteNotes([other, oldDaily]);
finish();
