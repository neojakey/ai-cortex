import '../helpers/test-env.js';
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
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
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
  const delRes = await fetch(`${baseUrl}/api/notes/${noteId}?permanent=true`, {
    method: 'DELETE',
    headers: { Origin: baseUrl }
  });
  assert.equal(delRes.status, 200);
});

test('API: Projects list and project-scoped note filtering', async () => {
  // 1. Create notes in two different projects
  const noteAres = await fetch(`${baseUrl}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({
      title: 'API Test CarbonVerified Note',
      content: 'Belongs to CarbonVerified.',
      project: 'CarbonVerified'
    })
  });
  assert.equal(noteAres.status, 201);
  const noteA = (await noteAres.json()).note;
  assert.equal(noteA.project.name, 'CarbonVerified');

  const noteBres = await fetch(`${baseUrl}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({
      title: 'API Test AI-Cortex Note',
      content: 'Belongs to AI-Cortex.',
      project: 'AI-Cortex'
    })
  });
  assert.equal(noteBres.status, 201);
  const noteB = (await noteBres.json()).note;

  // 2. Projects list includes the new project with a note count
  const projectsRes = await fetch(`${baseUrl}/api/projects`);
  assert.equal(projectsRes.status, 200);
  const projectsData = await projectsRes.json();
  const carbonProject = projectsData.projects.find((p) => p.slug === noteA.project.slug);
  assert.ok(carbonProject);
  assert.ok(carbonProject.noteCount >= 1);

  // 3. Notes list scoped by project only returns the matching note
  const scopedRes = await fetch(`${baseUrl}/api/notes?project=${encodeURIComponent(noteA.project.slug)}`);
  assert.equal(scopedRes.status, 200);
  const scopedData = await scopedRes.json();
  assert.ok(scopedData.notes.some((n) => n.id === noteA.id));
  assert.ok(!scopedData.notes.some((n) => n.id === noteB.id));

  // Clean up
  await fetch(`${baseUrl}/api/notes/${noteA.id}?permanent=true`, { method: 'DELETE', headers: { Origin: baseUrl } });
  await fetch(`${baseUrl}/api/notes/${noteB.id}?permanent=true`, { method: 'DELETE', headers: { Origin: baseUrl } });
});

test('API: Settings MCP Config returns OS-specific paths', async () => {
  const res = await fetch(`${baseUrl}/api/settings/mcp-config`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(data.mcpScriptPath);
  assert.ok(data.claudeConfig.mcpServers['ai-cortex']);
  assert.ok(data.configPaths.currentOS);
});
