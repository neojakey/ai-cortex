// Rendered note layout: checkbox bullets flow like normal text (they once broke into
// narrow columns), and inline code is visibly tinted against the page.
import { check, finish, createNote, deleteNotes, openBrowser, openNote, shot } from './helpers.js';

const LONG = '- [ ] 0.2 🌐 **Registrar access.** Log in to wherever `bolsahotelera.com` is registered. Step 1.3 changes its nameservers. **[GAP]** If Pepe bought the domain on his account, get access now. *Done when:* you can see the settings.';
const note = await createNote({ title: `Layout check ${Date.now()}`, content: `${LONG}\n- Plain bullet with \`code\` for comparison.` });

for (const theme of ['dark', 'light']) {
  const { browser, page, errors } = await openBrowser({ settings: { ai_cortex_view_mode: 'read', ai_cortex_theme_mode: theme } });
  await openNote(page, note.id, '.note-rendered li.task-list-item');
  const task = await page.$eval('.note-rendered li.task-list-item', (li) => {
    const cs = getComputedStyle(li);
    const cb = li.querySelector(':scope > input').getBoundingClientRect();
    const r = li.getBoundingClientRect();
    return { display: cs.display, lines: Math.round(r.height / parseFloat(cs.lineHeight)), cbTop: cb.top - r.top };
  });
  check(task.display !== 'flex', `${theme}: the checkbox bullet isn't a flex row (${task.display})`);
  check(task.lines <= 3, `${theme}: the long step wraps to at most 3 lines at this width (${task.lines})`);
  check(task.cbTop >= 0 && task.cbTop < 16, `${theme}: the checkbox sits on the first line (${Math.round(task.cbTop)}px)`);

  const tint = await page.evaluate(() => {
    const code = document.querySelector('.note-rendered li:not(.task-list-item) code');
    const page = document.querySelector('.note-rendered');
    let el = page;
    while (el && getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)') el = el.parentElement;
    return { code: getComputedStyle(code).backgroundColor, page: el ? getComputedStyle(el).backgroundColor : 'none' };
  });
  check(tint.code !== tint.page, `${theme}: inline code has its own background (${tint.code} on ${tint.page})`);
  await shot(page, `note-layout-${theme}`);
  check(errors.length === 0, `${theme}: no page errors ${errors.join(' ')}`);
  await browser.close();
}

await deleteNotes([note]);
finish();
