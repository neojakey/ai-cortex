import test from 'node:test';
import assert from 'node:assert/strict';
import { insertIntoSection, readSection, outlineOf, parsePathItem, SectionPathError } from '../../core/services/markdownSections.js';

const CLAUDE = '## Worked on with Claude';
const BH = '### BolsaHotelera';

// The shape of a real journal entry: the user's own text, Claude's grouped log, the
// closing #daily, and another AI's section with a same-named project heading.
const JOURNAL = [
  '- my own text',
  '',
  CLAUDE,
  '',
  BH,
  '- one',
  '- Still open: x',
  '',
  '#daily',
  '',
  '## Worked on with Gemini',
  '',
  BH,
  '- gemini line',
  ''
].join('\n');

const add = (md, path, content) => insertIntoSection(md, path, content).markdown;
const lines = (md) => md.split('\n');

test('sections: text goes at the end of an existing group', () => {
  const out = add(JOURNAL, [CLAUDE, BH], '- two');
  const l = lines(out);
  assert.deepEqual(l.slice(4, 9), [BH, '- one', '- Still open: x', '- two', '']);
  assert.equal(l[9], '#daily', '#daily stays right after the group');
});

test('sections: the path picks the right one of two same-named headings', () => {
  const out = add(JOURNAL, [CLAUDE, BH], '- two');
  assert.ok(out.includes('### BolsaHotelera\n- gemini line'), 'the Gemini group is untouched');
  assert.equal(out.split('- two').length, 2, 'added once');
  const gem = add(JOURNAL, ['## Worked on with Gemini', BH], '- gemini two');
  assert.ok(gem.endsWith('- gemini line\n- gemini two\n'));
  assert.ok(gem.includes('- Still open: x\n\n#daily'), 'the Claude group is untouched');
});

test('sections: a missing project heading is created at the end of the parent, above #daily', () => {
  const r = insertIntoSection(JOURNAL, [CLAUDE, '### AI-Cortex'], '- new');
  assert.deepEqual(r.created, ['### AI-Cortex']);
  assert.ok(r.markdown.includes('- Still open: x\n\n### AI-Cortex\n- new\n\n#daily\n\n## Worked on with Gemini'), r.markdown);
  assert.equal(lines(r.markdown)[r.line - 1], '- new', 'reported line is the new text');
});

test('sections: when the whole path is missing, both headings go at the end of the note', () => {
  const r = insertIntoSection('- my own text\n', [CLAUDE, BH], '- first');
  assert.equal(r.markdown, `- my own text\n\n${CLAUDE}\n${BH}\n- first\n`);
  assert.deepEqual(r.created, [CLAUDE, BH]);
});

test('sections: an empty note gets the headings and the text, nothing else', () => {
  assert.equal(add('', [CLAUDE, BH], '- first'), `${CLAUDE}\n${BH}\n- first\n`);
});

test('sections: missing headings go above a closing tag-only line at the end of the note', () => {
  const out = add('- my text\n\n#daily\n', [CLAUDE, BH], '- first');
  assert.equal(out, `- my text\n\n${CLAUDE}\n${BH}\n- first\n\n#daily\n`);
});

test('sections: general text goes under the parent heading, before the first project', () => {
  const out = add(JOURNAL, [CLAUDE], '- general');
  assert.ok(out.includes(`${CLAUDE}\n- general\n\n${BH}`), out);
});

test('sections: a group ending in tag-only lines gets the text above them', () => {
  const md = `${CLAUDE}\n${BH}\n- one\n#bh-ops #2026-10\n\n#daily\n`;
  assert.equal(add(md, [CLAUDE, BH], '- two'), `${CLAUDE}\n${BH}\n- one\n- two\n#bh-ops #2026-10\n\n#daily\n`);
});

test('sections: headings match ignoring case and extra spaces', () => {
  const md = '##   worked ON with   claude\n### bolsahotelera\n- one\n';
  assert.equal(add(md, [CLAUDE, BH], '- two'), '##   worked ON with   claude\n### bolsahotelera\n- one\n- two\n');
});

test('sections: with two matching headings in the same place, the first gets the text', () => {
  const md = `${CLAUDE}\n${BH}\n- a\n${BH}\n- b\n`;
  assert.equal(add(md, [CLAUDE, BH], '- new'), `${CLAUDE}\n${BH}\n- a\n- new\n${BH}\n- b\n`);
});

test('sections: heading-like lines inside a code block are ignored', () => {
  const md = '```\n## Worked on with Claude\n```\n\nreal text\n';
  const out = add(md, [CLAUDE], '- logged');
  assert.equal(out, '```\n## Worked on with Claude\n```\n\nreal text\n\n## Worked on with Claude\n- logged\n');
});

test('sections: a heading of a different level does not match', () => {
  const md = '# Worked on with Claude\n- top level\n';
  const out = add(md, [CLAUDE], '- logged');
  assert.ok(out.endsWith('# Worked on with Claude\n- top level\n\n## Worked on with Claude\n- logged\n'), out);
});

test('sections: an empty group gets the text right under its heading, spacing otherwise unchanged', () => {
  const md = `${CLAUDE}\n${BH}\n### AI-Cortex\n- x\n`;
  assert.equal(add(md, [CLAUDE, BH], '- new'), `${CLAUDE}\n${BH}\n- new\n### AI-Cortex\n- x\n`);
});

test('sections: several lines are added together, in order', () => {
  const out = add(JOURNAL, [CLAUDE, BH], '- two\n- three\n\n');
  assert.ok(out.includes('- Still open: x\n- two\n- three\n\n#daily'));
});

test('sections: everything outside the inserted lines is byte-for-byte unchanged', () => {
  const out = add(JOURNAL, [CLAUDE, BH], '- two');
  assert.equal(out.replace('- two\n', ''), JOURNAL);
});

test('sections: a note without a final line break does not get one', () => {
  assert.equal(add('- mine\n\n## Worked on with Claude\n- one', [CLAUDE], '- two'), '- mine\n\n## Worked on with Claude\n- one\n- two');
  assert.equal(add('- mine\n\n#daily', [CLAUDE, BH], '- x'), `- mine\n\n${CLAUDE}\n${BH}\n- x\n\n#daily`);
});

test('sections: bad paths and empty content are refused', () => {
  const refused = (fn, pattern) => assert.throws(fn, (err) => err instanceof SectionPathError && err.code === 'INVALID_ARGUMENT' && pattern.test(err.message));
  refused(() => insertIntoSection(JOURNAL, [], '- x'), /non-empty/);
  refused(() => insertIntoSection(JOURNAL, 'Worked on with Claude', '- x'), /non-empty/);
  refused(() => insertIntoSection(JOURNAL, ['Worked on with Claude'], '- x'), /markdown heading/);
  refused(() => insertIntoSection(JOURNAL, ['### BolsaHotelera', '## Worked on with Claude'], '- x'), /deeper/);
  refused(() => insertIntoSection(JOURNAL, [CLAUDE, '### '], '- x'), /markdown heading/);
  refused(() => insertIntoSection(JOURNAL, [CLAUDE], '   \n'), /empty/);
  refused(() => insertIntoSection(JOURNAL, [CLAUDE], undefined), /empty/);
});

test('path items: level and text are read from the heading', () => {
  assert.deepEqual(parsePathItem('### BolsaHotelera'), { level: 3, text: 'BolsaHotelera' });
  assert.deepEqual(parsePathItem('  ## Worked on with Claude ##  '), { level: 2, text: 'Worked on with Claude' });
});

test('read section: returns the heading, its text and subsections, without the closing #daily', () => {
  assert.equal(readSection(JOURNAL, [CLAUDE, BH]), `${BH}\n- one\n- Still open: x`);
  assert.equal(readSection(JOURNAL, [CLAUDE]), `${CLAUDE}\n\n${BH}\n- one\n- Still open: x`);
  assert.equal(readSection(JOURNAL, ['## Worked on with Gemini', BH]), `${BH}\n- gemini line`);
});

test('read section: a missing section is null', () => {
  assert.equal(readSection(JOURNAL, [CLAUDE, '### AI-Cortex']), null);
  assert.equal(readSection('', [CLAUDE]), null);
});

test('outline: every heading in order, ignoring code blocks and tag lines', () => {
  assert.deepEqual(outlineOf(JOURNAL), [CLAUDE, BH, '## Worked on with Gemini', BH]);
  assert.deepEqual(outlineOf('```\n# not a heading\n```\n#daily\n# Real'), ['# Real']);
});
