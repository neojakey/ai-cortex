import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { AttachmentService, attachmentService } from '../../core/services/attachmentService.js';
import { exportService } from '../../core/services/exportService.js';

const suffix = crypto.randomUUID().slice(0, 8);
const uniq = (label) => `P1 ${label} ${suffix}`;
const byNewest = (a, b) => Number(b.id) - Number(a.id);

test.after(async () => {
  await pool.end();
});

test('Versions: a title-only edit is snapshotted', async () => {
  const note = await noteService.createNote({ title: uniq('title-a'), content: 'body' });
  try {
    const renamed = uniq('title-b');
    await noteService.updateNote(note.id, { title: renamed });

    const versions = (await noteService.getVersions(note.id)).sort(byNewest);
    assert.equal(versions.length, 2);
    assert.equal(versions[0].title, renamed);
    assert.equal(versions[0].content, 'body');
  } finally {
    await noteService.deleteNote(note.id, { permanent: true });
  }
});

test('Versions: restoreVersion reapplies an old version as a new, undoable edit', async () => {
  const note = await noteService.createNote({ title: uniq('restore'), content: 'first draft' });
  const other = await noteService.createNote({ title: uniq('restore-other'), content: 'unrelated' });
  try {
    await noteService.updateNote(note.id, { content: 'second draft' });
    const original = (await noteService.getVersions(note.id)).find((v) => v.content === 'first draft');
    assert.ok(original);

    const restored = await noteService.restoreVersion(note.id, original.id);
    assert.equal(restored.content, 'first draft');
    assert.equal((await noteService.getVersions(note.id)).length, 3, 'the restore is itself snapshotted');

    const foreign = (await noteService.getVersions(other.id))[0];
    assert.equal(await noteService.restoreVersion(note.id, foreign.id), null, "another note's version must not apply");
    assert.equal((await noteService.getNoteById(note.id)).content, 'first draft');
  } finally {
    await noteService.deleteNote(note.id, { permanent: true });
    await noteService.deleteNote(other.id, { permanent: true });
  }
});

test('Tasks: toggle ticks the right task even after lines shift', async () => {
  const note = await noteService.createNote({
    title: uniq('tasks'),
    content: '- [ ] alpha\n- [ ] beta'
  });
  try {
    const first = await noteService.toggleTask(note.id, { line: 1, text: 'alpha', completed: true });
    assert.equal(first.content, '- [x] alpha\n- [ ] beta');

    // A line is inserted above; the caller still holds beta's old line number (2),
    // which now points at alpha.
    await noteService.updateNote(note.id, { content: 'intro\n- [x] alpha\n- [ ] beta' });
    const second = await noteService.toggleTask(note.id, { line: 2, text: 'beta', completed: true });
    assert.equal(second.content, 'intro\n- [x] alpha\n- [x] beta');
  } finally {
    await noteService.deleteNote(note.id, { permanent: true });
  }
});

test('Tasks: toggle refuses ambiguous or missing tasks instead of guessing', async () => {
  const note = await noteService.createNote({
    title: uniq('tasks-conflict'),
    content: 'x\n- [ ] dup\n- [ ] dup'
  });
  try {
    await assert.rejects(
      noteService.toggleTask(note.id, { line: 9, text: 'dup', completed: true }),
      (err) => err.code === 'TASK_CONFLICT'
    );
    await assert.rejects(
      noteService.toggleTask(note.id, { line: 2, text: 'gone', completed: true }),
      (err) => err.code === 'TASK_CONFLICT'
    );
    await assert.rejects(
      noteService.toggleTask(crypto.randomUUID(), { line: 1, text: 'dup', completed: true }),
      (err) => err.code === 'NOT_FOUND'
    );
    assert.equal((await noteService.getNoteById(note.id)).content, 'x\n- [ ] dup\n- [ ] dup');
  } finally {
    await noteService.deleteNote(note.id, { permanent: true });
  }
});

test('Tasks: toggling to the state a task is already in writes nothing', async () => {
  const note = await noteService.createNote({ title: uniq('tasks-noop'), content: '- [x] done' });
  try {
    await noteService.toggleTask(note.id, { line: 1, text: 'done', completed: true });
    assert.equal((await noteService.getVersions(note.id)).length, 1);
  } finally {
    await noteService.deleteNote(note.id, { permanent: true });
  }
});

test('Attachments: deleting one of two same-bytes/different-extension records frees only its own file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cortex-att-'));
  const service = new AttachmentService(dir);
  const buffer = Buffer.from(`same bytes ${suffix}`);
  const png = await service.saveAttachment({ filename: 'a.png', mimeType: 'image/png', buffer });
  const jpg = await service.saveAttachment({ filename: 'b.jpg', mimeType: 'image/jpeg', buffer });
  try {
    const pngPath = service.resolveDiskPath(png.storagePath);
    const jpgPath = service.resolveDiskPath(jpg.storagePath);
    assert.ok(fs.existsSync(pngPath) && fs.existsSync(jpgPath));

    await service.deleteAttachment(png.id);
    assert.equal(fs.existsSync(pngPath), false, 'the deleted record must not leave its file behind');
    assert.equal(fs.existsSync(jpgPath), true, "the other record's file must survive");

    await service.deleteAttachment(jpg.id);
    assert.equal(fs.existsSync(jpgPath), false);
  } finally {
    await pool.query(`DELETE FROM attachments WHERE id IN (?, ?)`, [png.id, jpg.id]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function buildZip(files) {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(files)) zip.addFile(name, Buffer.from(data));
  return zip.toBuffer();
}

async function cleanupImported(titles, attachmentNames = []) {
  for (const title of titles) {
    await pool.query(`DELETE FROM notes WHERE title = ?`, [title]);
  }
  for (const name of attachmentNames) {
    const [rows] = await pool.query(`SELECT id FROM attachments WHERE filename = ?`, [name]);
    for (const row of rows) await attachmentService.deleteAttachment(row.id);
  }
}

test('Import: keeps frontmatter ids and is idempotent on re-import', async () => {
  const id = crypto.randomUUID();
  const withId = uniq('import-with-id');
  const noId = uniq('import-no-id');
  const attName = `p1-${suffix}.bin`;
  const zip = buildZip({
    [`${withId}.md`]: `---\ntitle: "${withId}"\nid: "${id}"\nstatus: "archived"\n---\nhello`,
    [`${noId}.md`]: 'plain note, no frontmatter',
    [`attachments/${attName}`]: `payload ${suffix}`
  });
  try {
    const first = await exportService.importVaultFromZip(zip);
    assert.deepEqual(first, { importedNotes: 2, skippedNotes: 0, importedAttachments: 1, skippedAttachments: 0 });

    const kept = await noteService.getNoteById(id);
    assert.equal(kept.title, withId);
    assert.equal(kept.status, 'archived');

    const second = await exportService.importVaultFromZip(zip);
    assert.deepEqual(second, { importedNotes: 0, skippedNotes: 2, importedAttachments: 0, skippedAttachments: 1 });

    const [counts] = await pool.query(`SELECT COUNT(*) AS c FROM notes WHERE title IN (?, ?)`, [withId, noId]);
    assert.equal(Number(counts[0].c), 2);
  } finally {
    await cleanupImported([withId, noId], [attName]);
  }
});

test('Import: a failure part-way leaves no notes or attachments behind', async () => {
  const good = uniq('import-good');
  const attName = `p1-rollback-${suffix}.bin`;
  const zip = buildZip({
    [`attachments/${attName}`]: `rollback payload ${suffix}`,
    [`${good}.md`]: 'a perfectly valid note',
    // Title longer than the 255-char column, so the insert fails after the first note is written
    [`bad.md`]: `---\ntitle: "${'x'.repeat(300)}"\n---\nboom`
  });
  try {
    await assert.rejects(exportService.importVaultFromZip(zip));

    const [notes] = await pool.query(`SELECT id FROM notes WHERE title = ?`, [good]);
    assert.equal(notes.length, 0, 'the valid note must be rolled back');
    const [atts] = await pool.query(`SELECT id FROM attachments WHERE filename = ?`, [attName]);
    assert.equal(atts.length, 0, 'the attachment record must be removed');
  } finally {
    await cleanupImported([good], [attName]);
  }
});

test('Import: ignores a malformed frontmatter id instead of storing it', async () => {
  const title = uniq('import-bad-id');
  const zip = buildZip({ [`${title}.md`]: `---\ntitle: "${title}"\nid: "not-a-uuid-not-a-uuid-not-a-uuid-xx"\n---\nbody` });
  try {
    const result = await exportService.importVaultFromZip(zip);
    assert.equal(result.importedNotes, 1);
    const [rows] = await pool.query(`SELECT id FROM notes WHERE title = ?`, [title]);
    assert.match(rows[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  } finally {
    await cleanupImported([title]);
  }
});
