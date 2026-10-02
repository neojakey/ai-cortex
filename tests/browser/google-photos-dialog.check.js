// Add from Google Photos dialog, offline parts only: these checks never contact Google
// (the full import is covered with Google faked in tests/integration/google-photos-add.test.js).
import { check, finish, createNote, getNote, deleteNotes, openBrowser, openNote } from './helpers.js';

const note = await createNote({ title: `Google Photos dialog check ${Date.now()}`, content: 'Original text' });
const { browser, context, page, errors } = await openBrowser({ settings: { ai_cortex_view_mode: 'edit' } });
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
await openNote(page, note.id, 'textarea');

await page.click('button[aria-label="Add from Google Photos"]');
await page.waitForSelector('.google-photos-card');
check(await page.evaluate(() => document.activeElement?.closest('.google-photos-field') !== null), 'the link box has focus');
check(await page.locator('.google-photos-card button[type=submit]').isDisabled(), 'Add is greyed out while the box is empty');
await page.fill('.google-photos-field input', 'https://photos.google.com/u/0/photo/AF1QipM8Vg5M');
await page.keyboard.press('Enter');
await page.waitForSelector('.google-photos-card [role=alert]', { timeout: 10000 });
check(/private link/.test(await page.textContent('.google-photos-card [role=alert]')), 'a private link is explained in the window');
check(await page.inputValue('.google-photos-field input') === 'https://photos.google.com/u/0/photo/AF1QipM8Vg5M', 'the link stays in the box');
await page.keyboard.press('Escape');
await page.waitForSelector('.google-photos-card', { state: 'detached', timeout: 5000 });
check((await getNote(note.id)).attachments.length === 0, 'nothing was saved');

// A Google Photos link pasted into the text is just text.
await page.click('textarea');
await page.keyboard.press('Control+End');
await page.evaluate((t) => navigator.clipboard.writeText(t), '\nhttps://photos.app.goo.gl/RwiUGGaB1PkDFVHD8');
await page.keyboard.press('Control+V');
await page.waitForTimeout(2000);
const n = await getNote(note.id);
check(n.content === 'Original text\nhttps://photos.app.goo.gl/RwiUGGaB1PkDFVHD8', `a pasted link stays as text (${JSON.stringify(n.content)})`);
check(n.attachments.length === 0, 'pasting imported nothing');

check(errors.length === 0, `no page errors ${errors.join(' ')}`);
await browser.close();
await deleteNotes([note]);
finish();
