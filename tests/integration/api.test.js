import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../../core/api/server.js';
import { pool } from '../../core/db/pool.js';
import http from 'node:http';

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    // Listen on random available port
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('API: Health Check returns db latency and telemetry', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.status, 'healthy');
  assert.equal(data.db.connected, true);
  assert.equal(typeof data.db.latencyMs, 'number');
  assert.ok(data.system.platform);
});

test('API: Notes CRUD and search workflow', async () => {
  // 1. Create note via API
  const createRes = await fetch(`${baseUrl}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'API Test Note',
      content: 'Testing REST endpoints with #api-tag and a task:\n- [ ] Review API docs',
      status: 'active'
    })
  });
  assert.equal(createRes.status, 201);
  const createData = await createRes.json();
  const noteId = createData.note.id;

  // 2. Fetch note via API
  const getRes = await fetch(`${baseUrl}/api/notes/${noteId}`);
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.note.title, 'API Test Note');
  assert.ok(getData.note.tags.includes('api-tag'));

  // 3. Search via API
  const searchRes = await fetch(`${baseUrl}/api/search?q=Testing`);
  assert.equal(searchRes.status, 200);
  const searchData = await searchRes.json();
  assert.ok(searchData.results.some((r) => r.id === noteId));

  // 4. Tasks list via API
  const tasksRes = await fetch(`${baseUrl}/api/tasks`);
  assert.equal(tasksRes.status, 200);
  const tasksData = await tasksRes.json();
  assert.ok(tasksData.tasks.some((t) => t.noteId === noteId && t.text === 'Review API docs'));

  // 5. Clean up note
  const delRes = await fetch(`${baseUrl}/api/notes/${noteId}?permanent=true`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
});

test('API: Settings MCP Config returns OS-specific paths', async () => {
  const res = await fetch(`${baseUrl}/api/settings/mcp-config`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(data.mcpScriptPath);
  assert.ok(data.claudeConfig.mcpServers.secondbrain);
  assert.ok(data.configPaths.currentOS);
});
