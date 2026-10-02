import test from 'node:test';
import assert from 'node:assert/strict';
import { retryOnDeadlock, isDeadlock, DEFAULT_ATTEMPTS } from '../../core/db/retry.js';

const deadlock = () => Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });
const lockTimeout = () => Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 });

function harness() {
  const logs = [];
  const sleeps = [];
  return {
    logs,
    sleeps,
    options: { log: (m) => logs.push(m), sleep: async (ms) => { sleeps.push(ms); } }
  };
}

test('retry: a deadlock is retried and the second attempt wins', async () => {
  const h = harness();
  const calls = [];
  const result = await retryOnDeadlock(async (attempt) => {
    calls.push(attempt);
    if (attempt === 1) throw deadlock();
    return 'saved';
  }, { ...h.options, label: 'updateNote' });
  assert.equal(result, 'saved');
  assert.deepEqual(calls, [1, 2]);
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0], /deadlock in updateNote; retrying \(attempt 2 of 3\)/);
});

test('retry: gives up after 3 attempts and throws the deadlock', async () => {
  const h = harness();
  let calls = 0;
  await assert.rejects(
    retryOnDeadlock(async () => { calls += 1; throw deadlock(); }, h.options),
    (err) => err.code === 'ER_LOCK_DEADLOCK'
  );
  assert.equal(calls, DEFAULT_ATTEMPTS);
  assert.equal(DEFAULT_ATTEMPTS, 3);
  assert.equal(h.logs.length, 2, 'one log line per retry, none for the final failure');
});

test('retry: a lock wait timeout is not retried', async () => {
  const h = harness();
  let calls = 0;
  await assert.rejects(retryOnDeadlock(async () => { calls += 1; throw lockTimeout(); }, h.options), (err) => err.code === 'ER_LOCK_WAIT_TIMEOUT');
  assert.equal(calls, 1);
  assert.equal(h.logs.length, 0);
});

test('retry: any other error passes straight through, unretried', async () => {
  const h = harness();
  for (const err of [
    Object.assign(new Error('Note changed since you read it.'), { code: 'REVISION_CONFLICT', currentRevision: 4 }),
    Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 }),
    new TypeError('boom')
  ]) {
    let calls = 0;
    await assert.rejects(retryOnDeadlock(async () => { calls += 1; throw err; }, h.options), (e) => e === err);
    assert.equal(calls, 1, err.message);
  }
  assert.equal(h.logs.length, 0);
});

test('retry: success on the first try runs once, without a pause or a log line', async () => {
  const h = harness();
  let calls = 0;
  assert.equal(await retryOnDeadlock(async () => { calls += 1; return 7; }, h.options), 7);
  assert.equal(calls, 1);
  assert.deepEqual(h.sleeps, []);
  assert.deepEqual(h.logs, []);
});

test('retry: the pause grows with each attempt and is randomised', async () => {
  const h = harness();
  await assert.rejects(retryOnDeadlock(async () => { throw deadlock(); }, { ...h.options, attempts: 4, baseDelayMs: 20 }));
  assert.equal(h.sleeps.length, 3);
  h.sleeps.forEach((ms, i) => {
    const n = i + 1;
    assert.ok(ms >= 20 * n && ms <= 40 * n, `pause ${n} was ${ms}ms`);
  });
});

test('isDeadlock: matched by code or by MySQL error number', () => {
  assert.equal(isDeadlock(deadlock()), true);
  assert.equal(isDeadlock({ errno: 1213 }), true);
  assert.equal(isDeadlock({ code: 'ER_LOCK_DEADLOCK' }), true);
  assert.equal(isDeadlock(lockTimeout()), false);
  assert.equal(isDeadlock(new Error('x')), false);
  assert.equal(isDeadlock(null), false);
});
