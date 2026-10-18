import test from 'node:test';
import assert from 'node:assert/strict';

const { treeTitle } = await import('../../client/src/lib/noteTitle.js');

test('tree title: the folder name before the colon is dropped', () => {
  assert.equal(treeTitle('BolsaHotelera: deploy commands', 'BolsaHotelera'), 'deploy commands');
  assert.equal(treeTitle('MonakTech: Decision Log', 'MonakTech'), 'Decision Log');
});

test('tree title: matched ignoring case, spaces and punctuation', () => {
  assert.equal(treeTitle('ai-cortex: roadmap', 'AI-Cortex'), 'roadmap');
  assert.equal(treeTitle('AI Cortex: roadmap', 'AI-Cortex'), 'roadmap');
  assert.equal(treeTitle('Claude Memory: tips', 'Claude memory'), 'tips');
});

test('tree title: other prefixes are shown in full', () => {
  assert.equal(treeTitle('Prescription: Mony, 2025-10-01', 'Health'), 'Prescription: Mony, 2025-10-01');
  assert.equal(treeTitle('BolseHotelera: typo in the title', 'BolsaHotelera'), 'BolseHotelera: typo in the title');
  assert.equal(treeTitle('Job application: Arc', 'MonakTech'), 'Job application: Arc');
});

test('tree title: only the first colon counts, and the rest keeps its own colons', () => {
  assert.equal(treeTitle('BolsaHotelera: step 1: login', 'BolsaHotelera'), 'step 1: login');
  assert.equal(treeTitle('Notes: BolsaHotelera: x', 'BolsaHotelera'), 'Notes: BolsaHotelera: x');
});

test('tree title: a title that is only the folder prefix is not emptied', () => {
  assert.equal(treeTitle('BolsaHotelera:', 'BolsaHotelera'), 'BolsaHotelera:');
  assert.equal(treeTitle('BolsaHotelera:   ', 'BolsaHotelera'), 'BolsaHotelera:   ');
});

test('tree title: unfiled notes, missing titles and odd folder names are safe', () => {
  assert.equal(treeTitle('Lemon Curd', undefined), 'Lemon Curd');
  assert.equal(treeTitle('Unfiled: something', undefined), 'Unfiled: something');
  assert.equal(treeTitle('', 'BolsaHotelera'), '');
  assert.equal(treeTitle(null, 'BolsaHotelera'), '');
  assert.equal(treeTitle('---: x', '---'), '---: x', 'a folder name with no letters never matches');
  assert.equal(treeTitle(': x', 'BolsaHotelera'), ': x');
});
