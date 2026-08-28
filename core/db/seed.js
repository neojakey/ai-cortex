import { pool } from './pool.js';
import { runMigrations } from './migrate.js';
import { noteService } from '../services/noteService.js';
import { attachmentService } from '../services/attachmentService.js';

export async function seed() {
  console.log('[Seed] Ensuring schema exists...');
  await runMigrations();

  console.log('[Seed] Clearing existing demo data...');
  await pool.query('DELETE FROM notes');
  await pool.query('DELETE FROM tags');
  await pool.query('DELETE FROM attachments');

  console.log('[Seed] Populating rich demo notes with backlinks and tags...');

  // Note 1: Architecture Overview
  const archNote = await noteService.createNote({
    title: 'Architecture Overview',
    content: `# AI-Cortex Architecture Overview

Welcome to your self-hosted **AI-Cortex**! This system is designed for sub-millisecond query speed, privacy, and full ownership.

## Core Pillars
1. **Relational MySQL 8.4 Backing**: All notes, relations, and Notion properties are indexed in MySQL.
2. **Hybrid Storage**: Attachments are stored on disk with SHA-256 deduplication, while metadata lives in the database.
3. **AI Connectors**: Native MCP tools connect directly to **Claude Desktop** and **Gemini** using your monthly subscription.

Check out our current roadmap in [[Project Apollo]] and meeting minutes in [[Weekly Sync Notes]].

## System Components
- Core Server & REST API
- Model Context Protocol (MCP) Daemon
- Vite + React Fast Client

#architecture #engineering #roadmap
`,
    status: 'active',
    dueDate: '2026-09-15',
    properties: {
      category: 'Documentation',
      priority: 1,
      reviewed: true
    },
    customTags: ['architecture', 'engineering']
  });

  // Note 2: Project Apollo
  const apolloNote = await noteService.createNote({
    title: 'Project Apollo',
    content: `# Project Apollo: Next-Gen Knowledge Hub

Target release for the new personal knowledge operating system.

## Action Items
- [x] Configure MySQL 8.4 database and schema migrations
- [ ] Connect Claude Desktop via MCP standard input/output
- [ ] Test attachment streaming with HTTP 206 range requests
- [ ] Validate bidirectional backlinks linking back to [[Architecture Overview]]

## Notes
Refer to [[Weekly Sync Notes]] for team decisions and timeline updates.

#apollo #planning #active-project
`,
    status: 'active',
    dueDate: '2026-09-01',
    properties: {
      status: 'In Progress',
      lead: 'Paul Jacobs',
      sprint: 4
    }
  });

  // Note 3: Weekly Sync Notes
  const meetingNote = await noteService.createNote({
    title: 'Weekly Sync Notes',
    content: `# Weekly Sync Notes (August 2026)

Discussing the new AI-Cortex deployment and migration from Obsidian/Notion.

## Highlights
- **Decided**: Keep filesystem for attachments + MySQL for metadata for best performance.
- **AI Strategy**: Skip API keys; use Claude Pro subscription via local MCP.
- **Next steps**: Review [[Project Apollo]] deliverables and [[Architecture Overview]].

## Key Tasks
- [ ] Install MCP config in Claude Desktop
- [ ] Import initial Obsidian notes export

#meeting #notes #team
`,
    status: 'active',
    dueDate: '2026-08-30',
    properties: {
      type: 'Meeting',
      attendees: 3
    }
  });

  // Note 4: Daily Note
  const dailyNote = await noteService.getOrCreateDailyNote(new Date().toISOString().slice(0, 10));

  // Add a sample attachment
  const sampleSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <circle cx="50" cy="50" r="45" fill="#3b82f6" />
  <path d="M30 50 L45 65 L70 35" stroke="#ffffff" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
</svg>
  `.trim());

  await attachmentService.saveAttachment({
    noteId: apolloNote.id,
    filename: 'apollo-badge.svg',
    mimeType: 'image/svg+xml',
    buffer: sampleSvg
  });

  console.log('[Seed] Successfully seeded demo notes and attachments!');
}

if (process.argv[1] === import.meta.filename) {
  seed()
    .then(() => {
      console.log('Seeding completed.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
