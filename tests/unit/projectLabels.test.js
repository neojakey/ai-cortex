import test from 'node:test';
import assert from 'node:assert/strict';

const { normalizeProjectName, projectKeys, splitProjectLabel } = await import('../../client/src/lib/projectLabels.js');

const KEYS = projectKeys(['AI-Cortex', 'BolsaHotelera', 'CarbonVerified', 'Health', 'Ali Abdaal / LBA', 'Guerrero Alerta']);

const joined = (parts) => parts.before + parts.label + parts.after;

test('labels: a project name followed by a colon is a label, in any case', () => {
  const parts = splitProjectLabel('bolsahotelera: fixed AUD-02', KEYS);
  assert.deepEqual(parts, { before: '', label: 'bolsahotelera', after: ': fixed AUD-02' });
  assert.equal(splitProjectLabel('BOLSAHOTELERA: x', KEYS).label, 'BOLSAHOTELERA');
});

test('labels: spaces, hyphens and punctuation are ignored when matching', () => {
  for (const text of ['AI-Cortex: x', 'ai cortex: x', 'AICortex: x', 'ai_cortex: x']) {
    assert.ok(splitProjectLabel(text, KEYS), text);
  }
  assert.equal(splitProjectLabel('Ali Abdaal / LBA: notes', KEYS).label, 'Ali Abdaal / LBA');
  assert.equal(splitProjectLabel('guerrero-alerta: x', KEYS).label, 'guerrero-alerta');
});

test('labels: the parts always rebuild the original text exactly', () => {
  for (const text of ['bolsahotelera: a: b', '  AI-Cortex : spaced', 'Health:no space after']) {
    const parts = splitProjectLabel(text, KEYS);
    assert.ok(parts, text);
    assert.equal(joined(parts), text);
    assert.match(parts.after, /^\s*:/, text);
  }
});

test('labels: spaces before the colon are left out of the tag', () => {
  assert.deepEqual(splitProjectLabel('AI-Cortex : x', KEYS), { before: '', label: 'AI-Cortex', after: ' : x' });
});

test('labels: leading spaces are kept outside the tag', () => {
  assert.deepEqual(splitProjectLabel('  Health: slept badly', KEYS), { before: '  ', label: 'Health', after: ': slept badly' });
});

test('labels: a name that is not at the very start is not a label', () => {
  assert.equal(splitProjectLabel('Still open (bolsahotelera): AUD-04', KEYS), null);
  assert.equal(splitProjectLabel('Talked about health: sleep', KEYS), null);
  assert.equal(splitProjectLabel('Searched the CarbonVerified git history', KEYS), null);
});

test('labels: text with no colon, or an unknown name, is not a label', () => {
  assert.equal(splitProjectLabel('bolsahotelera fixed AUD-02', KEYS), null);
  assert.equal(splitProjectLabel('Arc: applied for the role', KEYS), null);
  assert.equal(splitProjectLabel(': empty label', KEYS), null);
  assert.equal(splitProjectLabel('', KEYS), null);
  assert.equal(splitProjectLabel(null, KEYS), null);
});

test('labels: the colon must be on the first line', () => {
  assert.equal(splitProjectLabel('bolsahotelera\nnext line: x', KEYS), null);
  assert.equal(splitProjectLabel('Health\n: x', KEYS), null);
});

test('labels: a project name far into a long first line is not a label', () => {
  const long = `${'Spent the morning going through notes about various things '.repeat(2)}Health: x`;
  assert.equal(splitProjectLabel(long, KEYS), null);
});

test('labels: a name that only starts like a project does not match', () => {
  assert.equal(splitProjectLabel('Healthcare: x', KEYS), null);
  assert.equal(splitProjectLabel('AI-Cortex2: x', KEYS), null);
});

test('labels: no projects means no labels', () => {
  assert.equal(splitProjectLabel('bolsahotelera: x', projectKeys([])), null);
  assert.equal(splitProjectLabel('bolsahotelera: x', undefined), null);
});

test('normalize: case, spaces and punctuation are dropped; letters and digits kept', () => {
  assert.equal(normalizeProjectName('AI-Cortex'), 'aicortex');
  assert.equal(normalizeProjectName('Ali Abdaal / LBA'), 'aliabdaallba');
  assert.equal(normalizeProjectName('Café 2'), 'café2');
  assert.equal(normalizeProjectName('---'), '');
});

test('keys: names that normalize to nothing are ignored', () => {
  assert.deepEqual([...projectKeys(['---', '', 'Health'])], ['health']);
});
