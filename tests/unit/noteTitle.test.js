import test from 'node:test';
import assert from 'node:assert/strict';

const { displayTitle, isDailyTitle } = await import('../../client/src/lib/noteTitle.js');

test('display title: a daily note is shown as Journal', () => {
  assert.equal(displayTitle('Daily: 2026-09-29'), 'Journal: 2026-09-29');
});

test('display title: every other title is shown as it is', () => {
  for (const title of [
    'Job application: Arc',
    'Daily standup notes',
    'Daily: 2026-09-29 extra',
    'daily: 2026-09-29',
    'Daily: 2026-9-29',
    ' Daily: 2026-09-29',
    'Journal: 2026-09-29',
    ''
  ]) {
    assert.equal(displayTitle(title), title, JSON.stringify(title));
  }
});

test('display title: a missing title stays missing (callers fall back to "Untitled")', () => {
  assert.equal(displayTitle(null), null);
  assert.equal(displayTitle(undefined), undefined);
});

test('daily title: only the exact stored form counts', () => {
  assert.equal(isDailyTitle('Daily: 2026-09-29'), true);
  assert.equal(isDailyTitle('Journal: 2026-09-29'), false);
  assert.equal(isDailyTitle('Daily: 2026-09-29 extra'), false);
  assert.equal(isDailyTitle(null), false);
});
