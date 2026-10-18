import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTagRules, canonicalTag, TAG_ALIASES } from '../../core/services/tagRules.js';

test('tag rules: a tag equal to the folder name is dropped, ignoring case, spaces and punctuation', () => {
  assert.deepEqual(applyTagRules(['health', 'sleep'], 'Health'), ['sleep']);
  assert.deepEqual(applyTagRules(['claude-memory', 'x'], 'Claude Memory'), ['x']);
  assert.deepEqual(applyTagRules(['aicortex', 'ai-cortex', 'ai_cortex', 'y'], 'AI-Cortex'), ['y']);
});

test('tag rules: other tags, and notes without a folder, keep every tag', () => {
  assert.deepEqual(applyTagRules(['health', 'sleep'], 'MonakTech'), ['health', 'sleep']);
  assert.deepEqual(applyTagRules(['health', 'sleep'], null), ['health', 'sleep']);
  assert.deepEqual(applyTagRules(['health'], undefined), ['health']);
});

test('tag rules: a tag that only contains the folder name is kept', () => {
  assert.deepEqual(applyTagRules(['health-log', 'healthcare'], 'Health'), ['health-log', 'healthcare']);
});

test('tag rules: a known misspelling becomes the right tag, once', () => {
  assert.deepEqual(applyTagRules(['bolsehotelera'], null), ['bolsahotelera']);
  assert.deepEqual(applyTagRules(['bolsehotelera', 'bolsahotelera', 'qa'], null), ['bolsahotelera', 'qa']);
});

test('tag rules: the alias is resolved before the folder check', () => {
  assert.deepEqual(applyTagRules(['bolsehotelera', 'qa'], 'BolsaHotelera'), ['qa']);
});

test('tag rules: order is kept, and empty input is safe', () => {
  assert.deepEqual(applyTagRules(['b', 'a', 'c'], null), ['b', 'a', 'c']);
  assert.deepEqual(applyTagRules([], 'Health'), []);
  assert.deepEqual(applyTagRules(['', 'x'], 'Health'), ['x']);
});

test('tag rules: canonicalTag leaves normal names alone, including ones named like object properties', () => {
  assert.equal(canonicalTag('health'), 'health');
  assert.equal(canonicalTag('constructor'), 'constructor');
  assert.equal(canonicalTag('toString'), 'toString');
  assert.equal(canonicalTag('bolsehotelera'), TAG_ALIASES.bolsehotelera);
});
