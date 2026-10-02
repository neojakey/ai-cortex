// Raw HTML in a note is shown as text: nothing vanishes, nothing after a <title> is
// hidden, and no script, image or javascript: link from the note ever becomes live.
import { check, finish, createNote, getNote, deleteNotes, openBrowser, openNote, shot } from './helpers.js';

const CONTENT = [
  'Before. The page needs a <title> tag in the head.',
  '',
  'Placeholders: <person> and <db> and <ip>.',
  '',
  '<script>window.__ran = "script"</script>',
  '<img src="https://tracker.invalid/p.gif" onerror="window.__ran = (window.__ran || \'\') + \' img\'">',
  '<a href="javascript:window.__ran=1">js link</a>',
  '',
  'An autolink: <https://example.com> and `<input type="email">` in code.',
  '',
  'After: this last line must be visible.'
].join('\n');
const note = await createNote({ title: `Raw HTML check ${Date.now()}`, content: CONTENT });

const { browser, page, errors } = await openBrowser({ settings: { ai_cortex_view_mode: 'read' } });
const blocked = [];
page.on('request', (r) => { if (r.url().includes('tracker.invalid')) blocked.push(r.url()); });
await openNote(page, note.id, '.note-rendered');
const shown = (await page.innerText('.note-rendered')).replace(/\s+/g, ' ');

check(shown.includes('needs a <title> tag in the head.'), 'a <title> mid-sentence is shown as typed');
check(shown.includes('After: this last line must be visible.'), 'nothing after it is hidden');
check(shown.includes('Placeholders: <person> and <db> and <ip>.'), 'placeholder words are kept');
check(shown.includes('<script>window.__ran = "script"</script>'), 'the script is shown as text');
const live = await page.evaluate(() => ({
  ran: window.__ran || null,
  scripts: document.querySelectorAll('.note-rendered script').length,
  imgs: document.querySelectorAll('.note-rendered img').length,
  jsLinks: [...document.querySelectorAll('.note-rendered a')].filter((a) => /^javascript:/i.test(a.getAttribute('href') || '')).length
}));
check(live.ran === null, 'no code from the note ran');
check(live.scripts === 0 && live.imgs === 0 && live.jsLinks === 0, `no live script, image or javascript: link (${JSON.stringify(live)})`);
check(blocked.length === 0, 'the image address was never requested');
check(await page.locator('.note-rendered a[href="https://example.com"]').count() === 1, 'a link in angle brackets is still a link');
check(await page.locator('.note-rendered code').first().innerText() === '<input type="email">', 'code keeps its angle brackets');
await shot(page, 'raw-html');

const stored = await getNote(note.id);
check(stored.content === CONTENT, 'the stored text is unchanged');
check(errors.length === 0, `no page errors ${errors.join(' ')}`);
await browser.close();
await deleteNotes([note]);
finish();
