import test from 'node:test';
import assert from 'node:assert/strict';
import { noteService } from '../../core/services/noteService.js';
import { searchService } from '../../core/services/searchService.js';
import { pool } from '../../core/db/pool.js';

test('MCP Tool Handlers: search, read_note, get_backlinks, create_note, list_tasks', async () => {
  // 1. Test create note
  const created = await noteService.createNote({
    title: 'MCP Protocol Reference',
    content: 'Comprehensive reference for Model Context Protocol.\nMentions [[Architecture Overview]].\n- [ ] Review MCP tool schema',
    customTags: ['mcp', 'claude', 'gemini']
  });
  assert.ok(created.id);
  assert.equal(created.slug, 'mcp-protocol-reference');

  // 2. Test read note
  const read = await noteService.getNoteBySlug('mcp-protocol-reference');
  assert.ok(read);
  assert.equal(read.title, 'MCP Protocol Reference');
  assert.ok(read.tags.includes('mcp'));

  // 3. Test backlinks
  const targetNote = await noteService.getNoteBySlug('architecture-overview');
  if (targetNote) {
    assert.ok(targetNote.backlinks.some((b) => b.id === created.id));
  }

  // 4. Test search
  const searchResults = await searchService.search('Protocol Reference');
  assert.ok(searchResults.some((r) => r.id === created.id));

  // 5. Test tasks
  const tasks = await noteService.getTasks();
  assert.ok(tasks.some((t) => t.noteId === created.id && t.text.includes('Review MCP tool schema')));

  // Clean up
  await noteService.deleteNote(created.id, { permanent: true });
});

test.after(async () => {
  await pool.end();
});
