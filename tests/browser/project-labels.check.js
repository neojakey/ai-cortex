// Project labels on daily notes: a bullet starting with a project name and a colon shows
// the name as a tag; nothing else does, and regular notes never do.
import { check, finish, createNote, getNote, deleteNotes, openBrowser, openNote, shot, testDate } from './helpers.js';

const stamp = Date.now();
// A note in a project creates the project.
const seeds = [];
for (const project of ['BolsaHotelera', 'AI-Cortex', 'Health']) {
  seeds.push(await createNote({ title: `label seed ${project} ${stamp}`, content: 'x', project }));
}
const CONTENT = [
  '- bolsahotelera: fixed AUD-02',
  '- AI-Cortex: made code easier to see',
  '- ai cortex: spaced and lower case',
  '- Still open (bolsahotelera): AUD-04',
  '- Health: slept badly',
  '- Talked about health: sleep',
  '- **bolsahotelera:** bold label',
  '- [ ] BolsaHotelera: a task',
  '- Arc: not a project',
  '',
  'BolsaHotelera: a paragraph, not a bullet',
  '',
  '## BolsaHotelera: a heading'
].join('\n');
const daily = await createNote({ title: `Daily: ${testDate(1851)}`, content: CONTENT });
const regular = await createNote({ title: `Labels regular ${stamp}`, content: CONTENT });

const { browser, page, errors } = await openBrowser({ settings: { ai_cortex_view_mode: 'read', ai_cortex_color_scheme: 'teal', ai_cortex_theme_mode: 'dark' } });
await openNote(page, daily.id, '.note-rendered li');
const tagged = await page.$$eval('.note-rendered .project-label', (els) => els.map((e) => e.textContent));
check(JSON.stringify(tagged) === JSON.stringify(['bolsahotelera', 'AI-Cortex', 'ai cortex', 'Health', 'BolsaHotelera']),
  `tagged exactly the right bullets (${JSON.stringify(tagged)})`);
const inBullets = await page.$$eval('.note-rendered .project-label', (els) => els.every((e) => e.closest('li')));
check(inBullets, 'every tag is inside a bullet (not the paragraph or heading)');
check(await page.$eval('.note-rendered li', (li) => li.textContent) === 'bolsahotelera: fixed AUD-02', 'the bullet text reads the same');
const colours = await page.evaluate(() => {
  const tag = getComputedStyle(document.querySelector('.note-rendered .project-label')).color;
  const probe = document.createElement('span');
  probe.style.color = 'var(--accent-primary)';
  document.body.appendChild(probe);
  const accent = getComputedStyle(probe).color;
  probe.remove();
  return { tag, accent };
});
check(colours.tag !== colours.accent, `tag colour differs from the accent (${colours.tag} vs ${colours.accent})`);
await shot(page, 'project-labels');

// A project heading in "Worked on with Claude" gets the same tag.
const grouped = await createNote({ title: `Daily: ${testDate(1852)}`, content: '## Worked on with Claude\n\n### BolsaHotelera\n\n- fixed AUD-02\n\n### Not a project\n\n- x' });
await openNote(page, grouped.id, '.note-rendered h3');
const headings = await page.$$eval('.note-rendered h3', (hs) => hs.map((h) => ({ text: h.textContent, tagged: !!h.querySelector('.project-label') })));
check(JSON.stringify(headings) === JSON.stringify([{ text: 'BolsaHotelera', tagged: true }, { text: 'Not a project', tagged: false }]), `project heading tagged, other heading not (${JSON.stringify(headings)})`);
await shot(page, 'project-heading');
seeds.push(grouped);

await openNote(page, regular.id, '.note-rendered li');
check(await page.locator('.note-rendered .project-label').count() === 0, 'a regular note gets no tags');
const stored = await getNote(daily.id);
check(stored.content === CONTENT && stored.revision === daily.revision, 'nothing was saved to the note');

check(errors.length === 0, `no page errors ${errors.join(' ')}`);
await browser.close();
await deleteNotes([daily, regular, ...seeds]);
finish();
