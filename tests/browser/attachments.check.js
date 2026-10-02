// Attachment crop and remove: a sideways phone photo is cropped where the user framed it,
// typing just before a crop or remove is kept, and remove takes the photo's line out of the text.
import { makeImage, withRotateTag, describeImage, isRed } from '../helpers/testImages.js';
import { check, finish, createNote, updateNote, getNote, deleteNotes, upload, openBrowser, openNote, API } from './helpers.js';

const stamp = Date.now();
const note = await createNote({ title: `Attachments check ${stamp}`, content: 'x' });
// Stored 1200×800 with blue on the left; shown upright 800×1200 with blue on top.
const phone = await upload(note.id, withRotateTag(makeImage({ width: 1200, height: 800 })), 'phone.jpg');
const wrong = await upload(note.id, makeImage({ width: 300, height: 200 }), 'wrong.jpg');
await updateNote(note.id, { content: `Intro\n\n![Photo](${phone.url})\n\n![wrong](${wrong.url})\n`, expectedRevision: note.revision });

const { browser, page, errors, dialogs } = await openBrowser({ settings: { ai_cortex_view_mode: 'read' } });
const card = (name) => page.locator('.attachment-card', { hasText: name });
await openNote(page, note.id, '.attachment-card');

// Crop the phone photo to its bottom square.
await card('phone.jpg').hover();
await card('phone.jpg').locator('.crop-btn').click();
await page.waitForSelector('[data-testid=crop-square]');
await page.waitForTimeout(300);
const stage = await page.locator('.crop-stage img').boundingBox();
check(Math.abs(stage.height / stage.width - 1.5) < 0.02, 'the photo is shown upright in the crop window');
const sq = await page.locator('[data-testid=crop-square]').boundingBox();
await page.mouse.move(sq.x + sq.width / 2, sq.y + sq.height / 2);
await page.mouse.down();
await page.mouse.move(sq.x + sq.width / 2, sq.y + sq.height / 2 + 2000, { steps: 8 });
await page.mouse.up();
await page.click('.crop-actions .btn-primary');
await page.waitForSelector('.crop-card', { state: 'detached', timeout: 15000 });
let n = await getNote(note.id);
const cropped = n.attachments.find((a) => a.filename === 'phone.jpg');
const info = describeImage(Buffer.from(await (await fetch(`${API}${cropped.url}`)).arrayBuffer()), { x: 400, y: 700 });
check(info.width === 800 && info.height === 800, `square is 800×800 (${info.width}×${info.height})`);
check(isRed(info.pixel), `the bottom square of the upright photo was cropped (${info.pixel})`);
check(n.content.includes(cropped.url) && !n.content.includes(phone.url), 'the note text points at the square');

// Type in Edit mode, then remove the wrong photo straight away.
await page.click('.view-mode-btn:has-text("Edit")');
await page.click('textarea');
await page.keyboard.press('Control+End');
await page.keyboard.type('Typed before removing');
page.dialogAnswer = 'dismiss';
await card('wrong.jpg').hover();
await card('wrong.jpg').locator('.remove-btn').click();
await page.waitForTimeout(500);
check(dialogs.at(-1)?.includes('wrong.jpg'), 'the confirmation names the file');
check((await getNote(note.id)).attachments.length === 2, 'Cancel removes nothing');
page.dialogAnswer = 'accept';
await card('wrong.jpg').hover();
await card('wrong.jpg').locator('.remove-btn').click();
await page.waitForFunction(() => document.querySelectorAll('.attachment-card').length === 1, null, { timeout: 10000 })
  .then(() => check(true, 'the card disappears'), () => check(false, 'the card disappears'));
n = await getNote(note.id);
check(!n.content.includes(wrong.url) && n.content.includes('Typed before removing'), 'the photo line is gone and the typing kept');
check(await page.inputValue('textarea') === n.content, 'the editor shows exactly what was saved');
check((await fetch(`${API}${wrong.url}`)).status === 404, 'the removed file is gone');

check(errors.length === 0, `no page errors ${errors.join(' ')}`);
await browser.close();
await deleteNotes([note]);
finish();
