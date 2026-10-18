import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import app from '../../core/api/server.js';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { projectService } from '../../core/services/projectService.js';

let server;
let baseUrl;
const createdNoteIds = [];
const createdProjectIds = [];

const suffix = crypto.randomUUID().slice(0, 8);
const uniq = (label) => `FT ${label} ${suffix}`;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  for (const id of createdNoteIds) {
    await noteService.deleteNote(id, { permanent: true }).catch(() => {});
  }
  for (const id of createdProjectIds) {
    await projectService.deleteProject(id).catch(() => {});
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('GET /api/notes/tree: is not shadowed by /api/notes/:id', async () => {
  const res = await fetch(`${baseUrl}/api/notes/tree`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.folders), 'Expected folders array');
});

test('GET /api/notes/tree: excludes daily, trashed, and archived notes; groups by project; sorts folders and notes', async () => {
  const pA = await projectService.getOrCreateByName(uniq('Alpha Project'));
  const pZ = await projectService.getOrCreateByName(uniq('Zulu Project'));
  createdProjectIds.push(pA.id, pZ.id);

  // Active notes in projects
  const noteZ1 = await noteService.createNote({ title: uniq('b-note in Zulu'), content: 'test', project: pZ.name });
  const noteZ2 = await noteService.createNote({ title: uniq('A-note in Zulu'), content: 'test', project: pZ.name });
  const noteA1 = await noteService.createNote({ title: uniq('Note in Alpha'), content: 'test', project: pA.name });

  // Unfiled active note
  const noteUnfiled = await noteService.createNote({ title: uniq('Loose Note'), content: 'test' });

  // Excluded notes: Daily note, Archived note, Trash note
  const noteDaily = await noteService.createNote({ title: 'Daily: 1999-01-01', content: 'journal' });
  const noteArchived = await noteService.createNote({ title: uniq('Archived Note'), content: 'test', status: 'archived', project: pA.name });
  const noteTrash = await noteService.createNote({ title: uniq('Trash Note'), content: 'test', status: 'trash', project: pZ.name });

  createdNoteIds.push(
    noteZ1.id, noteZ2.id, noteA1.id, noteUnfiled.id,
    noteDaily.id, noteArchived.id, noteTrash.id
  );

  const res = await fetch(`${baseUrl}/api/notes/tree`);
  assert.equal(res.status, 200);
  const { folders } = await res.json();

  // 1. Daily, archived, and trashed notes must NOT appear in any folder
  const allNoteIds = folders.flatMap((f) => f.notes.map((n) => n.id));
  assert.ok(allNoteIds.includes(noteZ1.id), 'Active note Z1 should be in tree');
  assert.ok(allNoteIds.includes(noteZ2.id), 'Active note Z2 should be in tree');
  assert.ok(allNoteIds.includes(noteA1.id), 'Active note A1 should be in tree');
  assert.ok(allNoteIds.includes(noteUnfiled.id), 'Active unfiled note should be in tree');

  assert.ok(!allNoteIds.includes(noteDaily.id), 'Daily note must be excluded');
  assert.ok(!allNoteIds.includes(noteArchived.id), 'Archived note must be excluded');
  assert.ok(!allNoteIds.includes(noteTrash.id), 'Trash note must be excluded');

  // 2. The null folder (Unfiled) must be last
  const lastFolder = folders[folders.length - 1];
  assert.equal(lastFolder.project, null, 'The last folder must have project: null');
  assert.ok(lastFolder.notes.some((n) => n.id === noteUnfiled.id), 'Unfiled note must be in the null folder');

  // 3. Folders with projects must be sorted alphabetically by project name
  const namedFolders = folders.filter((f) => f.project !== null);
  for (let i = 1; i < namedFolders.length; i++) {
    const prev = namedFolders[i - 1].project.name.toLowerCase();
    const curr = namedFolders[i].project.name.toLowerCase();
    assert.ok(prev.localeCompare(curr) <= 0, `Folders out of order: ${prev} vs ${curr}`);
  }

  // 4. Notes within Zulu folder must be sorted case-insensitively
  const zuluFolder = folders.find((f) => f.project?.id === pZ.id);
  assert.ok(zuluFolder, 'Zulu folder should exist');
  const zuluNoteTitles = zuluFolder.notes.map((n) => n.title);
  assert.deepEqual(zuluNoteTitles, [noteZ2.title, noteZ1.title], 'Notes in Zulu should be sorted case-insensitively ignoring case (A before b)');

  // 5. Notes in tree must be lightweight (no content, no tags, no backlinks, no previews)
  const sampleNote = zuluFolder.notes[0];
  assert.deepEqual(Object.keys(sampleNote).sort(), ['id', 'title', 'updatedAt'].sort());
  assert.equal(sampleNote.content, undefined);
  assert.equal(sampleNote.tags, undefined);
  assert.equal(sampleNote.backlinks, undefined);

  // 6. Project object in folder must have {id, name, slug, color}
  assert.deepEqual(Object.keys(zuluFolder.project).sort(), ['color', 'id', 'name', 'slug'].sort());
});

test('GET /api/notes: behavior remains unchanged', async () => {
  const res = await fetch(`${baseUrl}/api/notes`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.notes));
  assert.equal(typeof data.total, 'number');
});

test('PUT /api/notes/:id: changing note project, clearing project, creating new project, and 409 conflict', async () => {
  const p1 = await projectService.getOrCreateByName(uniq('Project One'));
  createdProjectIds.push(p1.id);

  const note = await noteService.createNote({ title: uniq('Move Target'), content: 'move me' });
  createdNoteIds.push(note.id);
  assert.equal(note.project, null);

  // 1. Move to Project One with valid expectedRevision
  const moveRes = await fetch(`${baseUrl}/api/notes/${note.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: p1.name, expectedRevision: note.revision })
  });
  assert.equal(moveRes.status, 200);
  const moveData = await moveRes.json();
  assert.equal(moveData.note.project.id, p1.id);
  assert.equal(moveData.note.revision, note.revision + 1);

  // 2. Stale expectedRevision gives 409 REVISION_CONFLICT
  const staleRes = await fetch(`${baseUrl}/api/notes/${note.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: null, expectedRevision: note.revision })
  });
  assert.equal(staleRes.status, 409);
  const staleData = await staleRes.json();
  assert.equal(staleData.code, 'REVISION_CONFLICT');

  // 3. Clear project with valid revision (empty or null)
  const clearRes = await fetch(`${baseUrl}/api/notes/${note.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: null, expectedRevision: moveData.note.revision })
  });
  assert.equal(clearRes.status, 200);
  const clearData = await clearRes.json();
  assert.equal(clearData.note.project, null);

  // 4. Create new project on the fly
  const newProjName = uniq('Brand New Project');
  const createProjRes = await fetch(`${baseUrl}/api/notes/${note.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: newProjName, expectedRevision: clearData.note.revision })
  });
  assert.equal(createProjRes.status, 200);
  const createProjData = await createProjRes.json();
  assert.equal(createProjData.note.project.name, newProjName);
  createdProjectIds.push(createProjData.note.project.id);
});
