import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// The reader runs in the browser (DOMPurify and the DOM post-processing need a window),
// so it's tested in jsdom. DOMPurify binds to `window` when first imported, so the
// globals are set up before importing the renderer.
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
const { renderNoteMarkdown } = await import('../../client/src/lib/renderMarkdown.js');

function render(md, options) {
  const el = document.createElement('div');
  el.innerHTML = renderNoteMarkdown(md, options);
  return el;
}
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

test('reader: a tag name mid-sentence is shown as typed, and nothing after it disappears', () => {
  const el = render('Before. The page needs a <title> tag in the head.\n\nAfter: still here.');
  assert.equal(text(el), 'Before. The page needs a <title> tag in the head. After: still here.');
  assert.equal(el.querySelector('title'), null);
});

test('reader: placeholder words in angle brackets are kept', () => {
  assert.equal(text(render('Placeholders: <person> and <db> and <ip>.')), 'Placeholders: <person> and <db> and <ip>.');
});

test('reader: tags that would swallow the rest of a note (<textarea>, <style>) are text', () => {
  for (const tag of ['textarea', 'style', 'noscript', 'xmp']) {
    const el = render(`A <${tag}> here.\n\nThe end.`);
    assert.equal(text(el), `A <${tag}> here. The end.`, tag);
    assert.equal(el.querySelector(tag), null, tag);
  }
});

test('reader: a script is shown as text and never becomes an element', () => {
  const el = render('<script>window.ran = 1</script>\n\nok');
  assert.equal(el.querySelector('script'), null);
  assert.match(text(el), /<script>window\.ran = 1<\/script>/);
});

test('reader: raw <img> and event handlers are text, so nothing loads or runs', () => {
  const el = render('<img src="https://tracker.example/p.gif" onerror="alert(1)">\n\nInline <img src=x onerror=alert(1)> too.');
  assert.equal(el.querySelectorAll('img').length, 0);
  assert.equal(el.querySelectorAll('[onerror]').length, 0);
  assert.match(text(el), /<img src="https:\/\/tracker\.example\/p\.gif" onerror="alert\(1\)">/);
});

test('reader: raw links, <details>, <br> and comments are shown as text', () => {
  const el = render('<a href="javascript:alert(1)">x</a>\n\n<details><summary>s</summary>d</details>\n\nline<br>break\n\n<!-- note to self -->');
  assert.equal(el.querySelectorAll('a').length, 0);
  assert.equal(el.querySelectorAll('details, br').length, 0);
  assert.match(text(el), /<!-- note to self -->/);
  assert.match(text(el), /line<br>break/);
});

test('reader: a raw HTML block keeps its line breaks', () => {
  const el = render('<div>\none\ntwo\n</div>');
  const p = el.querySelector('p');
  assert.ok(p, 'shown as a paragraph');
  assert.equal(p.querySelectorAll('br').length, 3);
  assert.equal(p.textContent, '<div>one\ntwo</div>'.replace('\n', ''));
});

test('reader: a link in angle brackets is still a link', () => {
  const a = render('See <https://example.com> today.').querySelector('a');
  assert.ok(a);
  assert.equal(a.getAttribute('href'), 'https://example.com');
  assert.equal(a.getAttribute('target'), '_blank');
});

test('reader: angle brackets inside code stay as written', () => {
  const el = render('Use `<input type="email">` here.\n\n```\n<form action="/x">\n```');
  assert.equal(el.querySelector('p code').textContent, '<input type="email">');
  assert.equal(el.querySelector('pre code').textContent, '<form action="/x">\n');
  assert.equal(el.querySelectorAll('input, form').length, 0);
});

test('reader: "less than" in prose is untouched', () => {
  assert.equal(text(render('Done in <10 minutes, x < y and a<b.')), 'Done in <10 minutes, x < y and a<b.');
});

test('reader: markdown still renders (bold, lists, tables, links, images, tasks, wikilinks)', () => {
  const el = render([
    '**bold** and *em*',
    '',
    '- one',
    '- [x] done task',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '[site](https://example.com) and [[Other note|alias]]',
    '',
    '![Photo](/api/attachments/abc/file)'
  ].join('\n'));
  assert.equal(el.querySelector('strong').textContent, 'bold');
  assert.equal(el.querySelector('em').textContent, 'em');
  assert.equal(el.querySelectorAll('li').length, 2);
  assert.ok(el.querySelector('li.task-list-item input[type=checkbox][disabled]'));
  assert.equal(el.querySelectorAll('table td').length, 2);
  assert.equal(el.querySelector('a[href="https://example.com"]').textContent, 'site');
  assert.equal(el.querySelector('a[href^="wikilink:"]').textContent, 'alias');
  assert.equal(el.querySelector('img').getAttribute('src'), '/api/attachments/abc/file');
});

test('reader: project tags still work next to raw HTML text', () => {
  const el = render('- bolsahotelera: check the <title> tag', { projectNames: ['BolsaHotelera'] });
  assert.equal(el.querySelector('.project-label').textContent, 'bolsahotelera');
  assert.equal(text(el), 'bolsahotelera: check the <title> tag');
});

test('reader: a heading that is exactly a project name shows it as the tag', () => {
  const el = render('## Worked on with Claude\n\n### BolsaHotelera\n\n- fixed AUD-02\n\n### ai cortex\n\n- shipped', { projectNames: ['BolsaHotelera', 'AI-Cortex'] });
  const tags = [...el.querySelectorAll('h3.project-heading .project-label')].map((t) => t.textContent);
  assert.deepEqual(tags, ['BolsaHotelera', 'ai cortex']);
  assert.equal(el.querySelector('h2').classList.contains('project-heading'), false, 'other headings are left alone');
});

test('reader: a heading that only mentions a project, or has formatting, is left alone', () => {
  const el = render('### BolsaHotelera launch plan\n\n### **BolsaHotelera**', { projectNames: ['BolsaHotelera'] });
  assert.equal(el.querySelectorAll('.project-heading, .project-label').length, 0);
});

test('reader: without project names (regular notes) headings get no tag', () => {
  assert.equal(render('### BolsaHotelera').querySelectorAll('.project-label').length, 0);
});
