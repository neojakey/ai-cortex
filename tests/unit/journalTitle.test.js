import test from 'node:test';
import assert from 'node:assert/strict';
import { titleFromFirstHeading } from '../../core/services/journalTitle.js';

test('first heading: an entry that starts with a heading has that title', () => {
  assert.equal(titleFromFirstHeading('## Patio Cleanup\n- I woke up early'), 'Patio Cleanup');
  assert.equal(titleFromFirstHeading('# A Light Day\n\n- Had breakfast'), 'A Light Day');
  assert.equal(titleFromFirstHeading('### Boxing Day'), 'Boxing Day');
});

test('first heading: trailing spaces and closing hashes are dropped', () => {
  assert.equal(titleFromFirstHeading('# A Whole lot of Nothing \nx'), 'A Whole lot of Nothing');
  assert.equal(titleFromFirstHeading('## Patio Cleanup ##\nx'), 'Patio Cleanup');
});

test('first heading: punctuation the user typed is kept', () => {
  assert.equal(titleFromFirstHeading('# A Day with Dad..!\nx'), 'A Day with Dad..!');
});

test('first heading: formatting is reduced to plain text', () => {
  assert.equal(titleFromFirstHeading('## A **big** _day_ with `code`'), 'A big day with code');
  assert.equal(titleFromFirstHeading('## Trip to [Taxco](https://example.com)'), 'Trip to Taxco');
  assert.equal(titleFromFirstHeading('## Lunch with [[Mum and Dad|the folks]]'), 'Lunch with the folks');
  assert.equal(titleFromFirstHeading('## Notes on [[BolsaHotelera]]'), 'Notes on BolsaHotelera');
});

test('first heading: template sections are never a title', () => {
  for (const line of ['## Log', '## Tasks', '## Notes & Reflections', '## Worked on with Claude', '## LOG']) {
    assert.equal(titleFromFirstHeading(`${line}\n- x`), null, line);
  }
});

test('first heading: the old "# Daily: <date>" template heading is not a title', () => {
  assert.equal(titleFromFirstHeading('# Daily: 2026-09-29\n\n## Log'), null);
  assert.equal(titleFromFirstHeading('# Journal: 2026-09-29'), null);
});

test('first heading: only the very first line counts', () => {
  assert.equal(titleFromFirstHeading('- a bullet first\n## Later heading'), null);
  assert.equal(titleFromFirstHeading('\n## Heading after a blank line'), null);
  assert.equal(titleFromFirstHeading('Plain text first'), null);
});

test('first heading: deeper headings, empty headings and hashtags are not titles', () => {
  assert.equal(titleFromFirstHeading('#### Too deep'), null);
  assert.equal(titleFromFirstHeading('## '), null);
  assert.equal(titleFromFirstHeading('##'), null);
  assert.equal(titleFromFirstHeading('#journal #2026-10'), null);
  assert.equal(titleFromFirstHeading('## **  **'), null);
});

test('first heading: empty or missing content has no title', () => {
  assert.equal(titleFromFirstHeading(''), null);
  assert.equal(titleFromFirstHeading(null), null);
});

test('first heading: very long headings are cut to 200 characters', () => {
  assert.equal(titleFromFirstHeading(`## ${'x'.repeat(300)}`).length, 200);
});
