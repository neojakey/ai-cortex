// Runs every browser check (tests/browser/*.check.js) against a throwaway copy of the app:
// the API on the test database with scratch attachment storage, plus a Vite dev server
// pointed at it. Nothing touches the real app or its data. Both are stopped at the end,
// whatever happened.
//
//   npm run test:browser                      all checks
//   npm run test:browser -- journal-title     only checks whose file name contains this
//
// Ports: BROWSER_TEST_API_PORT (default 3011), BROWSER_TEST_APP_PORT (default 5174).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiPort = process.env.BROWSER_TEST_API_PORT || '3011';
const appPort = process.env.BROWSER_TEST_APP_PORT || '5174';
const API = `http://127.0.0.1:${apiPort}`;
const APP = `http://127.0.0.1:${appPort}`;
const filter = process.argv[2] || '';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cortex-browser-'));
const children = [];

function start(name, cmd, args, env) {
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', fs.openSync(path.join(scratch, `${name}.log`), 'a'), fs.openSync(path.join(scratch, `${name}.log`), 'a')],
    detached: true // its own process group, so stopping it also stops anything it started
  });
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopAll(); process.exit(130); });

async function waitFor(url, what) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${what} did not start (logs in ${scratch})`);
}

const prepared = spawnSync(process.execPath, ['scripts/prepare-test-db.js'], { cwd: root, stdio: 'inherit' });
if (prepared.status !== 0) process.exit(prepared.status || 1);

start('api', process.execPath, ['core/api/server.js'], {
  DB_NAME: 'ai_cortex_test',
  STORAGE_DIR: path.join(scratch, 'attachments'),
  PORT: apiPort
});
start('vite', process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'client', '--port', appPort, '--strictPort'], {
  AI_CORTEX_API_URL: API
});
await waitFor(`${API}/api/health`, 'Test API');
await waitFor(`${APP}/api/health`, 'Vite dev server');

const health = await (await fetch(`${API}/api/health`)).json();
if (health?.db?.database !== 'ai_cortex_test') {
  console.error(`Refusing to run: the test API is on database "${health?.db?.database}", not ai_cortex_test.`);
  process.exit(1);
}

const dir = path.join(root, 'tests/browser');
const checks = fs.readdirSync(dir).filter((f) => f.endsWith('.check.js') && f.includes(filter)).sort();
const results = [];
for (const file of checks) {
  console.log(`\n=== ${file}`);
  const run = spawnSync(process.execPath, [path.join(dir, file)], {
    cwd: root,
    stdio: 'inherit',
    timeout: 180000,
    env: { ...process.env, BROWSER_TEST_API: API, BROWSER_TEST_APP: APP, BROWSER_TEST_SHOTS: path.join(scratch, 'shots') }
  });
  results.push({ file, ok: run.status === 0 });
}

console.log('\n=== Summary');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.file}`);
console.log(`Screenshots and server logs: ${scratch}`);
stopAll();
process.exit(results.every((r) => r.ok) && results.length > 0 ? 0 : 1);
