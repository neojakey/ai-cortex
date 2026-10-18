import test from 'node:test';
import assert from 'node:assert/strict';

const { splitTagList, isSystemTag } = await import('../../client/src/lib/tagLists.js');

const TAGS = [
  { name: 'journal', count: 860 },
  { name: 'daily', count: 858 },
  { name: 'dayone', count: 829 },
  { name: 'health', count: 51 },
  { name: '2026-10', count: 17 },
  { name: 'pair', count: 2 },
  { name: 'single', count: 1 },
  { name: 'other-single', count: 1 }
];

test('tag list: system tags and one-note tags are hidden by default', () => {
  const { visible, hiddenCount } = splitTagList(TAGS);
  assert.deepEqual(visible.map((t) => t.name), ['health', 'pair']);
  assert.equal(hiddenCount, 6);
});

test('tag list: showing all returns every tag in the server order, with nothing hidden', () => {
  const { visible, hiddenCount } = splitTagList(TAGS, { showAll: true });
  assert.deepEqual(visible, TAGS);
  assert.equal(hiddenCount, 0);
});

test('tag list: the selected tag stays visible even if it would be hidden', () => {
  assert.deepEqual(splitTagList(TAGS, { activeKey: 'single' }).visible.map((t) => t.name), ['health', 'pair', 'single']);
  assert.deepEqual(splitTagList(TAGS, { activeKey: 'dayone' }).visible.map((t) => t.name), ['dayone', 'health', 'pair']);
});

test('tag list: a tag used by exactly two notes is shown, one is not', () => {
  const names = splitTagList(TAGS).visible.map((t) => t.name);
  assert.ok(names.includes('pair'));
  assert.ok(!names.includes('single'));
});

test('tag list: the threshold can be changed', () => {
  assert.deepEqual(splitTagList(TAGS, { minCount: 1 }).visible.map((t) => t.name), ['health', 'pair', 'single', 'other-single']);
});

test('tag list: empty or missing lists are safe', () => {
  assert.deepEqual(splitTagList([]), { visible: [], hiddenCount: 0 });
  assert.deepEqual(splitTagList(undefined), { visible: [], hiddenCount: 0 });
});

test('system tags: journal, daily, dayone and month tags only', () => {
  for (const name of ['journal', 'daily', 'dayone', '2026-10', '1999-01']) assert.equal(isSystemTag(name), true, name);
  for (const name of ['health', '2026', '2026-1', '2026-10-05', 'daily-log', 'journal-digest']) assert.equal(isSystemTag(name), false, name);
});
