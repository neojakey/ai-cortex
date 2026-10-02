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

const { savedJournalTitle, journalTitleSave } = await import('../../client/src/lib/noteTitle.js');

test('display title: a daily note with a journal title shows it before the date', () => {
  assert.equal(displayTitle('Daily: 2026-10-01', 'Patio Cleanup'), 'Journal: Patio Cleanup - 2026-10-01');
  assert.equal(displayTitle('Daily: 2026-10-01', '  Patio Cleanup  '), 'Journal: Patio Cleanup - 2026-10-01');
});

test('display title: a blank journal title shows just the date', () => {
  for (const blank of ['', '   ', null, undefined]) {
    assert.equal(displayTitle('Daily: 2026-10-01', blank), 'Journal: 2026-10-01', JSON.stringify(blank));
  }
});

test('display title: a journal title on a regular note is ignored', () => {
  assert.equal(displayTitle('Job application: Arc', 'Patio Cleanup'), 'Job application: Arc');
});

test('saved journal title: read from the note property, empty when missing', () => {
  assert.equal(savedJournalTitle({ properties: { journal_title: 'Patio Cleanup' } }), 'Patio Cleanup');
  assert.equal(savedJournalTitle({ properties: {} }), '');
  assert.equal(savedJournalTitle({}), '');
  assert.equal(savedJournalTitle(null), '');
});

test('journal title save: a daily note sends the trimmed title, or null to clear it', () => {
  assert.deepEqual(journalTitleSave('Daily: 2026-10-01', ' Patio Cleanup '), { properties: { journal_title: 'Patio Cleanup' } });
  assert.deepEqual(journalTitleSave('Daily: 2026-10-01', '   '), { properties: { journal_title: null } });
  assert.deepEqual(journalTitleSave('Daily: 2026-10-01', ''), { properties: { journal_title: null } });
});

test('journal title save: a regular note sends nothing extra', () => {
  assert.deepEqual(journalTitleSave('Job application: Arc', 'Patio Cleanup'), {});
});
