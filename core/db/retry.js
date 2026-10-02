// Retry a database write that MySQL cancelled to break a deadlock.
//
// When two transactions each wait on a lock the other holds, InnoDB rolls one of them
// back completely and reports ER_LOCK_DEADLOCK. Because the whole transaction is undone,
// running it again from the start is safe and almost always succeeds. `fn` must be that
// whole unit: it opens its own transaction (or runs one autocommit statement) and re-reads
// what it needs, so a retry re-checks revisions like any first attempt.
//
// Only deadlocks are retried. A lock wait timeout (ER_LOCK_WAIT_TIMEOUT) rolls back just
// the last statement, leaving the rest of the transaction in place, so repeating the work
// could apply part of it twice.

export const DEADLOCK_ERRNO = 1213;
export const DEFAULT_ATTEMPTS = 3;

export function isDeadlock(err) {
  return !!err && (err.code === 'ER_LOCK_DEADLOCK' || err.errno === DEADLOCK_ERRNO);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {(attempt: number) => Promise<T>} fn the whole unit of work, run once per attempt
 * @param {Object} [options]
 * @param {string} [options.label] what is being written, for the log line
 * @param {number} [options.attempts] total tries, including the first
 * @param {number} [options.baseDelayMs] pause before retry n is n×base plus up to as much again, at random
 * @param {(message: string) => void} [options.log]
 * @param {(ms: number) => Promise<void>} [options.sleep] tests pass a fake
 * @returns {Promise<T>}
 * @template T
 */
export async function retryOnDeadlock(fn, {
  label = 'database write',
  attempts = DEFAULT_ATTEMPTS,
  baseDelayMs = 20,
  log = (message) => console.warn(message),
  sleep = pause
} = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (!isDeadlock(err) || attempt >= attempts) throw err;
      log(`[db] deadlock in ${label}; retrying (attempt ${attempt + 1} of ${attempts})`);
      await sleep(baseDelayMs * attempt * (1 + Math.random()));
    }
  }
}
