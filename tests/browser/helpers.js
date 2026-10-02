// Shared pieces for the browser checks. Each *.check.js file is a plain script run by
// run.js against a throwaway copy of the app (test database, scratch storage), so the
// checks can create and delete notes freely. Run them with `npm run test:browser`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

export const API = process.env.BROWSER_TEST_API || 'http://127.0.0.1:3011';
export const APP = process.env.BROWSER_TEST_APP || 'http://127.0.0.1:5174';
export const SHOTS = process.env.BROWSER_TEST_SHOTS || path.join(os.tmpdir(), 'ai-cortex-browser-shots');

let failures = 0;
export function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures += 1;
}

/** Print the summary and exit non-zero if anything failed. Call once, at the end. */
export function finish() {
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}

export async function api(p, options = {}) {
  const res = await fetch(`${API}${p}`, options);
  return res.json();
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const createNote = (body) => api('/api/notes', json('POST', body)).then((d) => d.note);
export const updateNote = (id, body) => api(`/api/notes/${id}`, json('PUT', body));
export const getNote = (id) => api(`/api/notes/${id}`).then((d) => d.note);
export const deleteNotes = (notes) => Promise.all(notes.map((n) => fetch(`${API}/api/notes/${n.id}?permanent=true`, { method: 'DELETE' })));

export async function upload(noteId, buffer, name, type = 'image/jpeg') {
  const form = new FormData();
  form.append('noteId', noteId);
  form.append('file', new Blob([buffer], { type }), name);
  return (await api('/api/attachments', { method: 'POST', body: form })).attachment;
}

/** A date no real note has, unique enough per run: `${year}-MM-DD` in the given year. */
export function testDate(year) {
  const n = Date.now();
  return `${year}-${String(1 + (n % 12)).padStart(2, '0')}-${String(1 + (Math.floor(n / 12) % 28)).padStart(2, '0')}`;
}

// playwright-core doesn't download browsers. Use the Chromium already installed by
// Playwright (~/.cache/ms-playwright) unless CHROMIUM_PATH points somewhere else.
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const dir of dirs) {
    const exe = path.join(root, dir, 'chrome-linux64', 'chrome');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined; // let playwright-core try its own default
}

/**
 * A browser page with the given saved settings, collecting page errors in `errors`.
 * Dialogs (window.confirm / alert) are accepted unless `dialog: 'dismiss'`.
 */
export async function openBrowser({ viewport = { width: 1400, height: 900 }, settings = {} } = {}) {
  const browser = await chromium.launch({ executablePath: findChromium() });
  const context = await browser.newContext({ viewport });
  await context.addInitScript((s) => {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, settings);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const dialogs = [];
  page.dialogAnswer = 'accept';
  page.on('dialog', async (d) => {
    dialogs.push(d.message());
    if (page.dialogAnswer === 'accept') await d.accept(); else await d.dismiss();
  });
  return { browser, context, page, errors, dialogs };
}

export async function openNote(page, id, selector = '.note-title-input') {
  await page.goto(`${APP}/#/note/${id}`);
  await page.waitForSelector(selector);
  await page.waitForTimeout(500);
}

export function shot(page, name, clip) {
  fs.mkdirSync(SHOTS, { recursive: true });
  return page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...(clip ? { clip } : {}) });
}
