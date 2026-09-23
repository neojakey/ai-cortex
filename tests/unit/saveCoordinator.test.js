import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveCoordinator } from '../../client/src/lib/saveCoordinator.js';

// A `send` whose calls stay pending until the test settles them, so overlap can be controlled.
function controllableSend() {
  const calls = [];
  const send = (fields, revision) =>
    new Promise((resolve, reject) => {
      calls.push({ fields, revision, resolve, reject });
    });
  return { send, calls };
}

const conflictError = (currentRevision) =>
  Object.assign(new Error('Note changed since you read it.'), { code: 'REVISION_CONFLICT', currentRevision });

function setup({ revision = 3, fields = { noteId: 'n1', title: 'T', content: 'a' } } = {}) {
  let current = { ...fields };
  const { send, calls } = controllableSend();
  const states = [];
  const saved = [];
  const coordinator = createSaveCoordinator({
    getFields: () => ({ ...current }),
    send,
    onChange: (s) => states.push(s.status),
    onSaved: (n) => saved.push(n)
  });
  coordinator.reset(revision, { ...fields });
  return {
    coordinator,
    calls,
    states,
    saved,
    edit: (patch) => { current = { ...current, ...patch }; },
    // let queued promise continuations run
    tick: () => new Promise((r) => setImmediate(r))
  };
}

test('SaveCoordinator: sends the revision it holds and advances it after each save', async () => {
  const t = setup({ revision: 3 });
  t.edit({ content: 'b' });
  const p1 = t.coordinator.save();
  await t.tick();
  assert.equal(t.calls[0].revision, 3);
  t.calls[0].resolve({ revision: 4 });
  await p1;
  assert.equal(t.coordinator.baseRevision, 4);

  t.edit({ content: 'c' });
  const p2 = t.coordinator.save();
  await t.tick();
  assert.equal(t.calls[1].revision, 4);
  t.calls[1].resolve({ revision: 5 });
  await p2;
  assert.equal(t.coordinator.state.status, 'idle');
});

test('SaveCoordinator: never runs two saves at once, and the follow-up uses the newest revision', async () => {
  const t = setup({ revision: 3 });
  t.edit({ content: 'b' });
  const first = t.coordinator.save();
  await t.tick();

  // The user keeps typing and another save is requested while the first is still in flight.
  t.edit({ content: 'bc' });
  await t.coordinator.save();
  assert.equal(t.calls.length, 1, 'no second request may start while one is in flight');

  t.calls[0].resolve({ revision: 4 });
  await t.tick();
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1].revision, 4, 'the follow-up must be based on the revision the first save produced');
  assert.equal(t.calls[1].fields.content, 'bc');

  t.calls[1].resolve({ revision: 5 });
  await first;
  assert.equal(t.coordinator.state.status, 'idle');
  assert.equal(t.saved.length, 1, 'only the final, up-to-date save is reported as saved');
});

test('SaveCoordinator: sends nothing when the fields equal what was last saved', async () => {
  const t = setup();
  await t.coordinator.save();
  assert.equal(t.calls.length, 0);

  // Another save is requested while one is in flight but nothing new was typed:
  // no duplicate request afterwards, and the state doesn't get stuck on "saving".
  t.edit({ content: 'x' });
  const p = t.coordinator.save();
  await t.tick();
  await t.coordinator.save();
  t.calls[0].resolve({ revision: 4 });
  await p;
  assert.equal(t.calls.length, 1);
  assert.equal(t.coordinator.state.status, 'idle');
});

test('SaveCoordinator: a conflict stops all further saving until it is resolved', async () => {
  const t = setup({ revision: 3 });
  t.edit({ content: 'mine' });
  const p = t.coordinator.save();
  await t.tick();
  t.calls[0].reject(conflictError(7));
  await p;

  assert.equal(t.coordinator.state.status, 'conflict');
  assert.deepEqual(t.coordinator.state.conflict, { currentRevision: 7 });

  t.edit({ content: 'mine, edited more' });
  await t.coordinator.save();
  await t.coordinator.save();
  assert.equal(t.calls.length, 1, 'autosave must not keep retrying against a known conflict');
});

test('SaveCoordinator: overwrite retries with the current revision, never with the check omitted', async () => {
  const t = setup({ revision: 3 });
  t.edit({ content: 'mine' });
  const p = t.coordinator.save();
  await t.tick();
  t.calls[0].reject(conflictError(7));
  await p;

  const o = t.coordinator.overwrite();
  await t.tick();
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1].revision, 7);
  assert.equal(t.calls[1].fields.content, 'mine');
  t.calls[1].resolve({ revision: 8 });
  await o;
  assert.equal(t.coordinator.state.status, 'idle');
  assert.equal(t.coordinator.state.conflict, null);
  assert.equal(t.coordinator.baseRevision, 8);
});

test('SaveCoordinator: if the note changes again during overwrite, the conflict is shown again', async () => {
  const t = setup({ revision: 3 });
  t.edit({ content: 'mine' });
  const p = t.coordinator.save();
  await t.tick();
  t.calls[0].reject(conflictError(7));
  await p;

  const o = t.coordinator.overwrite();
  await t.tick();
  t.calls[1].reject(conflictError(9));
  await o;
  assert.equal(t.coordinator.state.status, 'conflict');
  assert.deepEqual(t.coordinator.state.conflict, { currentRevision: 9 });
});

test('SaveCoordinator: reset (reload or switching notes) clears a conflict and adopts the new revision', async () => {
  const t = setup({ revision: 3 });
  t.edit({ content: 'mine' });
  const p = t.coordinator.save();
  await t.tick();
  t.calls[0].reject(conflictError(7));
  await p;

  t.coordinator.reset(7, { noteId: 'n1', title: 'T', content: 'theirs' });
  assert.equal(t.coordinator.state.status, 'idle');
  assert.equal(t.coordinator.state.conflict, null);
  assert.equal(t.coordinator.baseRevision, 7);
});

test('SaveCoordinator: a save that finishes after the note was switched cannot clobber the new note\'s revision', async () => {
  const t = setup({ revision: 3 });
  t.edit({ content: 'b' });
  const p = t.coordinator.save();
  await t.tick();

  t.coordinator.reset(50, { noteId: 'n2', title: 'Other', content: 'z' }); // user opened another note
  t.calls[0].resolve({ revision: 4 }); // ...then the first note's save lands
  await p;

  assert.equal(t.coordinator.baseRevision, 50);
  assert.equal(t.saved.length, 0);
  assert.equal(t.coordinator.state.status, 'idle');
});

test('SaveCoordinator: a non-conflict failure shows an error and a later save retries', async () => {
  const t = setup({ revision: 3 });
  t.edit({ content: 'b' });
  const p = t.coordinator.save();
  await t.tick();
  t.calls[0].reject(new Error('network down'));
  await p;
  assert.equal(t.coordinator.state.status, 'error');

  const retry = t.coordinator.save();
  await t.tick();
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1].revision, 3, 'a failed save must not advance the revision');
  t.calls[1].resolve({ revision: 4 });
  await retry;
  assert.equal(t.coordinator.state.status, 'idle');
});
