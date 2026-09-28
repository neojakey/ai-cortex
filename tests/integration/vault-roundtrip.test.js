import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Writable } from 'node:stream';
import AdmZip from 'adm-zip';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { attachmentService } from '../../core/services/attachmentService.js';
import { projectService } from '../../core/services/projectService.js';
import { exportService } from '../../core/services/exportService.js';

const suffix = crypto.randomUUID().slice(0, 8);
const uniq = (label) => `VR ${label} ${suffix}`;

const createdNotes = [];
const createdProjects = [];
const createdAttachments = [];

test.after(async () => {
  for (const id of createdNotes) await noteService.deleteNote(id, { permanent: true });
  for (const id of createdAttachments) await attachmentService.deleteAttachment(id).catch(() => {});
  for (const name of createdProjects) await pool.query(`DELETE FROM projects WHERE name = ?`, [name]);
  await pool.end();
});

async function exportToBuffer() {
  const chunks = [];
  const sink = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); }
  });
  await exportService.exportVaultToZip(sink);
  return Buffer.concat(chunks);
}

test('_parseVaultNote: a title with an embedded escaped quote round-trips correctly', () => {
  const title = 'He said "hi" to me';
  const text = `---\ntitle: "${title.replace(/"/g, '\\"')}"\nstatus: "active"\n---\nbody`;
  const parsed = exportService._parseVaultNote(text, 'fallback');
  assert.equal(parsed.title, title);
  assert.equal(parsed.content, 'body');
});

test('Export/Import round trip: dueDate, properties, project, tags, and attachment links are restored', async () => {
  const projectName = uniq('Round Trip Project');
  createdProjects.push(projectName);
  await projectService.getOrCreateByName(projectName);
  await pool.query(`UPDATE projects SET color = ? WHERE name = ?`, ['#ff00aa', projectName]);

  const title = uniq('Round Trip Note "quoted"');
  const photoName = `photo-${suffix}.jpg`;
  const coverName = `cover-${suffix}.pdf`;
  const embedded = await attachmentService.saveAttachment({
    filename: photoName, mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  });
  createdAttachments.push(embedded.id);
  const cover = await attachmentService.saveAttachment({
    filename: coverName, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake')
  });
  createdAttachments.push(cover.id);

  const content = `Some text.\n\n![photo](/api/attachments/${embedded.id}/file)\n\nMore text.`;
  const note = await noteService.createNote({
    title,
    content,
    dueDate: '2026-11-05',
    customTags: [`tag-${suffix}`],
    properties: { count: 7, flag: true, label: 'hello' },
    project: projectName
  });
  createdNotes.push(note.id);
  // Attach the cover to the note directly (no link in content), the way the client's
  // embed:false upload path does.
  await pool.query(`UPDATE attachments SET note_id = ? WHERE id = ?`, [note.id, embedded.id]);
  await pool.query(`UPDATE attachments SET note_id = ? WHERE id = ?`, [note.id, cover.id]);

  const zipBuffer = await exportToBuffer();

  // Sanity-check the raw export before importing: frontmatter carries the new fields,
  // and the attachment link was rewritten to a portable path.
  const zip = new AdmZip(zipBuffer);
  const manifest = JSON.parse(zip.getEntry('manifest.json').getData().toString('utf8'));
  assert.ok(manifest.projects.some((p) => p.name === projectName && p.color === '#ff00aa'));
  const mdEntry = zip.getEntries().find((e) => e.entryName.endsWith('.md') && e.getData().toString('utf8').includes(note.id));
  assert.ok(mdEntry, 'the note must be present in the export');
  const mdText = mdEntry.getData().toString('utf8');
  const parsedMd = exportService._parseVaultNote(mdText, 'fallback');
  assert.deepEqual([...parsedMd.attachments].sort(), [coverName, photoName].sort());
  assert.doesNotMatch(mdText, /\/api\/attachments\//, 'no internal app URL should remain in the export');
  assert.match(mdText, new RegExp(`attachments/${photoName.replace('.', '\\.')}`));

  // Delete everything the export just captured, so import is restoring into a clean slate.
  await noteService.deleteNote(note.id, { permanent: true });
  createdNotes.splice(createdNotes.indexOf(note.id), 1);
  await attachmentService.deleteAttachment(embedded.id).catch(() => {});
  await attachmentService.deleteAttachment(cover.id).catch(() => {});
  createdAttachments.length = 0;
  await pool.query(`DELETE FROM projects WHERE name = ?`, [projectName]);

  // exportVaultToZip captured every note in this shared test database, and importing
  // all of it back in one transaction would be a far bigger, longer-held write than any
  // other test in this suite makes — a real source of lock contention under the full
  // suite's parallel load, independent of whether the import logic itself is correct.
  // A minimal zip built from just this note's own entries (the actual bytes the real
  // export produced, so the rewriting logic is still exercised faithfully) tests the
  // same behavior at the same scale as everything else in the suite.
  const minimalZip = new AdmZip();
  minimalZip.addFile(mdEntry.entryName, mdEntry.getData());
  minimalZip.addFile(`attachments/${photoName}`, zip.getEntry(`attachments/${photoName}`).getData());
  minimalZip.addFile(`attachments/${coverName}`, zip.getEntry(`attachments/${coverName}`).getData());
  minimalZip.addFile('manifest.json', Buffer.from(JSON.stringify({
    version: 1,
    projects: manifest.projects.filter((p) => p.name === projectName)
  })));
  const minimalZipBuffer = minimalZip.toBuffer();

  const first = await exportService.importVaultFromZip(minimalZipBuffer);
  assert.equal(first.importedNotes, 1);
  assert.equal(first.importedAttachments, 2);

  const [restoredRows] = await pool.query(`SELECT id FROM notes WHERE id = ?`, [note.id]);
  assert.equal(restoredRows.length, 1, 'the note must be restored under its original id');
  createdNotes.push(note.id);

  const restored = await noteService.getNoteById(note.id);
  assert.equal(restored.title, title);
  const dueDateStr = restored.dueDate instanceof Date
    ? restored.dueDate.toISOString().slice(0, 10)
    : String(restored.dueDate || '').slice(0, 10);
  assert.equal(dueDateStr, '2026-11-05');
  assert.equal(restored.properties.count, 7);
  assert.equal(restored.properties.flag, true);
  assert.equal(restored.properties.label, 'hello');
  assert.ok(restored.tags.includes(`tag-${suffix}`));
  assert.equal(restored.project?.name, projectName);
  assert.equal(restored.attachments.length, 2, 'both attachments must be linked to the restored note');
  for (const a of restored.attachments) createdAttachments.push(a.id);

  // The embedded link must point at the new attachment's real id, not the old one and
  // not the portable placeholder path.
  const newPhoto = restored.attachments.find((a) => a.filename === photoName);
  assert.ok(newPhoto);
  assert.ok(restored.content.includes(`/api/attachments/${newPhoto.id}/file`));
  assert.ok(!restored.content.includes(`attachments/${photoName}`));
  assert.notEqual(newPhoto.id, embedded.id, 'the id is expected to be freshly generated');

  const [colorRows] = await pool.query(`SELECT color FROM projects WHERE name = ?`, [projectName]);
  assert.equal(colorRows[0].color, '#ff00aa', "the project's color must be restored from the manifest");

  // Re-importing the same (minimal) export must be a no-op: nothing duplicated.
  const second = await exportService.importVaultFromZip(minimalZipBuffer);
  assert.equal(second.importedNotes, 0);
  assert.equal(second.skippedNotes, 1);
  assert.equal(second.importedAttachments, 0);
  assert.equal(second.skippedAttachments, 2);

  const [notesAfterReimport] = await pool.query(`SELECT id FROM notes WHERE title = ?`, [title]);
  assert.equal(notesAfterReimport.length, 1, 'no duplicate note from the second import');
  const [attsAfterReimport] = await pool.query(`SELECT id FROM attachments WHERE note_id = ?`, [note.id]);
  assert.equal(attsAfterReimport.length, 2, 'no duplicate attachments from the second import');
});

test('Import: a dedup-matched attachment is linked into the new note\'s content without reassigning its existing owner', async () => {
  // An attachment that already belongs to some other, unrelated note in this database...
  const owner = await noteService.createNote({ title: uniq('existing-owner'), content: 'owner note' });
  createdNotes.push(owner.id);
  const buffer = Buffer.from(`shared bytes ${suffix}`);
  const shared = await attachmentService.saveAttachment({
    noteId: owner.id, filename: `shared-${suffix}.bin`, mimeType: 'application/octet-stream', buffer
  });
  createdAttachments.push(shared.id);

  // ...is referenced (by filename + matching bytes) from a freshly imported note's frontmatter.
  const AdmZipCtor = AdmZip;
  const zip = new AdmZipCtor();
  const title = uniq('imports-shared-attachment');
  zip.addFile(`${title}.md`,
    Buffer.from(`---\ntitle: "${title}"\nattachments:\n  - shared-${suffix}.bin\n---\nsee attachments/shared-${suffix}.bin`));
  zip.addFile(`attachments/shared-${suffix}.bin`, buffer);

  const result = await exportService.importVaultFromZip(zip.toBuffer());
  assert.equal(result.importedNotes, 1);
  assert.equal(result.skippedAttachments, 1, 'the existing attachment must be reused, not duplicated');
  assert.equal(result.importedAttachments, 0);

  const [newNoteRows] = await pool.query(`SELECT id, content FROM notes WHERE title = ?`, [title]);
  createdNotes.push(newNoteRows[0].id);
  assert.match(newNoteRows[0].content, new RegExp(`/api/attachments/${shared.id}/file`));

  // The original owner must still be the one holding it.
  const [ownerCheck] = await pool.query(`SELECT note_id FROM attachments WHERE id = ?`, [shared.id]);
  assert.equal(ownerCheck[0].note_id, owner.id);
});
