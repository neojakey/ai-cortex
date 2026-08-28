import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../core/db/pool.js';
import { noteService } from '../../core/services/noteService.js';
import { searchService } from '../../core/services/searchService.js';

test('Integration: Note creation, backlinks traversal, tags & properties', async (t) => {
  // Create Target Note
  const targetNote = await noteService.createNote({
    title: 'Test Target Note',
    content: 'This is the target note content with #testing-tag',
    properties: {
      status: 'In Review',
      priority: 2
    }
  });

  assert.ok(targetNote.id);
  assert.equal(targetNote.slug, 'test-target-note');
  assert.ok(targetNote.tags.includes('testing-tag'));
  assert.equal(targetNote.properties.status, 'In Review');
  assert.equal(targetNote.properties.priority, 2);

  // Create Source Note that links to target note
  const sourceNote = await noteService.createNote({
    title: 'Test Source Note',
    content: 'This note mentions [[Test Target Note]] in its body.',
    status: 'active'
  });

  assert.ok(sourceNote.id);
  assert.equal(sourceNote.outgoingLinks.length, 1);
  assert.equal(sourceNote.outgoingLinks[0].targetSlug, 'test-target-note');

  // Verify that Target Note now lists Source Note in its backlinks!
  const targetRefreshed = await noteService.getNoteById(targetNote.id);
  assert.ok(targetRefreshed);
  assert.ok(targetRefreshed.backlinks.length >= 1);
  const foundBacklink = targetRefreshed.backlinks.find((b) => b.id === sourceNote.id);
  assert.ok(foundBacklink, 'Source note must appear in target note backlinks');
  assert.equal(foundBacklink.title, 'Test Source Note');

  // Test full-text search
  const searchResults = await searchService.search('target note');
  assert.ok(searchResults.length > 0);
  assert.ok(searchResults.some((r) => r.id === targetNote.id));

  // Test soft delete and restore
  await noteService.deleteNote(sourceNote.id, { permanent: false });
  const trashed = await noteService.getNoteById(sourceNote.id);
  assert.equal(trashed.status, 'trash');

  await noteService.restoreNote(sourceNote.id);
  const restored = await noteService.getNoteById(sourceNote.id);
  assert.equal(restored.status, 'active');

  // Clean up
  await noteService.deleteNote(sourceNote.id, { permanent: true });
  await noteService.deleteNote(targetNote.id, { permanent: true });
});

test.after(async () => {
  await pool.end();
});
