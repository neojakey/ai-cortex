# 🧠 AI-Cortex

A self-hosted, persistent long-term memory cortex for **Claude**, **Gemini**, and other LLMs. Combines the best of **Notion** (structured properties, database views) and **Obsidian** (speed, privacy, local ownership, markdown, bidirectional backlinks), backed by **MySQL 8.4** and local hybrid file storage.

Designed to connect natively to **Claude Desktop (Claude Pro)** and **Gemini** via the **Model Context Protocol (MCP)** with **zero API keys**.

---

## ✨ Features

- ⚡ **Sub-Millisecond MySQL 8.4 Relational Engine**: Pre-indexed slugs, B-Tree foreign keys with cascading updates, and `FULLTEXT` search index.
- 📎 **Hybrid Attachment Storage**: Deduplicated binary storage on disk ([storage/attachments/](storage/attachments)) using SHA-256 hashes, with metadata and relations in MySQL.
- 🤖 **Native MCP Server for Claude & Gemini**:
  - Connects to Claude Desktop using your **monthly Claude Pro subscription** without paying for API tokens.
  - Connects to Gemini / Antigravity with zero setup friction.
  - In-app **1-Click Auto-Installer** for `claude_desktop_config.json`.
- 🔗 **Bidirectional Backlinks & Wikilinks**:
  - Type `[[` in any note to trigger instant autocompletion of existing notes.
  - "Linked Mentions" panel at the bottom of every note displaying all notes that reference it.
- 📋 **Notion-Style Database Views**:
  - **Database Grid**: Sortable, filterable table view with editable statuses.
  - **Global Action Items**: Automatically extracts and aggregates `- [ ]` tasks from every note into a consolidated checklist. Ticking one edits its source note safely: the task is matched by its text, not just its line number, so an edit above it can't tick the wrong one.
- ✍️ **Read / Edit Editor**: Notes open in a rendered **Read** view (sanitized Markdown, clickable `[[wikilinks]]`, read-only task checkboxes) and switch to raw Markdown in **Edit** mode. Autosave shows a clear status (saved / unsaved / saving / failed), **Save** (`Ctrl/Cmd + S`) writes immediately, and **Refresh** pulls in changes an AI made over MCP. An optional full-width layout is one click away.
- 🗂️ **Projects**: Scope notes by project (for example one per product) so search and lists don't blend together. Filter from the sidebar; every MCP tool that creates, updates, searches or lists notes accepts an optional `project`.
- 🛡️ **Safe Concurrent Writes**: People and AI agents write to the same notes, so every note carries a `revision`. An update that says which revision it read is refused if the note has changed since, instead of silently overwriting it. See **Safe Writes for Agents** below.
- 🕘 **Version History**: Every title or content change is snapshotted (`GET /api/notes/:id/versions`). `POST /api/notes/:id/versions/:versionId/restore` re-applies a version as a normal edit, so the restore itself can be undone. (API only for now; there is no version UI yet.)
- 📅 **Daily Journaling**: Jump to or create today's daily note with one keystroke (`Alt + D`).
- 🎨 **Adaptive Theming**: 3-way **Dark / Light / System** ambiance (follows the OS and reacts live to changes), 15 curated accent palettes plus a custom-colour picker. Preferences persist in `localStorage`; the theme is applied before first paint to avoid any flash. Toggle modes with `Alt + T` or from **Settings → Appearance**.
- 📦 **Obsidian Vault 1-Click Export & Import**: Export all notes and attachments as a standard `.zip` vault, or import existing Markdown vaults. Imports are all-or-nothing for notes, keep the `id` in each note's frontmatter, and are safe to repeat: notes and attachments that already exist are skipped, never overwritten or duplicated.
- 🧪 **Complete Test Suite**: 37 automated unit and integration tests (about 3 seconds, `npm test`). Integration tests run against a separate database and a temp attachment folder, so they can never touch your real notes.

---

## 🚀 Quick Start

### 1. Requirements
- Node.js v20+ (v22 recommended)
- MySQL 8.4+ (MariaDB 10.6+ also works)

### 2. Environment Setup
Copy `.env.example` to `.env` and configure with your MySQL or MariaDB credentials:
```bash
cp .env.example .env
```

```env
PORT=3001
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=ai_cortex
DB_USER=your_db_user
DB_PASS=your_db_password
```

### 3. Run Migrations & Seed Demo Data
```bash
npm run migrate
npm run seed
```

### 4. Run Automated Tests
```bash
npm test
```
Tests use their own `ai_cortex_test` database on the same MySQL server, plus a temp folder for attachments. A `pretest` step creates and migrates it automatically (your DB user needs permission to create databases). The test helper refuses to run against any database whose name doesn't end in `_test`, whatever your `.env` says, so your real notes are never touched. Set `TEST_DB_NAME` to use a different test database.

### 5. Start AI-Cortex

**Development** (backend + Vite dev client with hot reload):
```bash
npm run dev
```
Open **http://127.0.0.1:5173** — the client proxies `/api` to the backend on port 3001.

**Production** (single server serving the built UI + API):
```bash
npm run build   # bundles the client into ./dist
npm start
```
Open **http://127.0.0.1:3001**. The API binds to `HOST` (default `127.0.0.1`).

> **AI-Cortex has no authentication and is built for local use. Don't expose it to a network.** `HOST` / `ALLOWED_HOSTS` only relax the Host-header check; writes from browsers on non-loopback origins are still rejected.

---

## 🤖 Connecting Claude Desktop (Zero API Keys)

1. Open AI-Cortex in your browser.
2. Click **Settings** in the bottom-left sidebar, then open the **AI Integrations** tab.
3. Click the **"1-Click Auto Install"** button (or copy the pre-filled JSON snippet into your `claude_desktop_config.json`). A **"1-Click Enable for Gemini"** button does the same for `.agents/mcp_config.json` in this workspace.
4. Restart Claude Desktop. You will now see the memory tools (`ai_cortex_search`, `ai_cortex_read_note`, `ai_cortex_create_note`, `ai_cortex_update_note`, `ai_cortex_get_backlinks`, `ai_cortex_list_recent`, `ai_cortex_list_projects`, `ai_cortex_list_tasks`) available directly in Claude using your **existing Claude Pro subscription**!

## 🛡️ Safe Writes for Agents

Notes are edited by you and by AI agents at the same time, so every note has a `revision` number that goes up on every change. To avoid overwriting someone else's edit:

1. **Read** the note (`ai_cortex_read_note`, or `GET /api/notes/:id`). The result includes `revision`.
2. **Pass it back** as `expectedRevision` when you update (`ai_cortex_update_note`, or `PUT /api/notes/:id`).
3. If the note has changed since you read it, **nothing is written** and you get a conflict. Re-read the note, merge your change into the latest content, and retry with the new revision.

An MCP conflict comes back as an error result:

```json
{
  "error": "REVISION_CONFLICT",
  "message": "This note changed since you read it (it is now at revision 12). Re-read the note, merge your change into the latest content, and retry with the new revision as expectedRevision.",
  "currentRevision": 12
}
```

Over REST the same conflict is HTTP `409` with `{ "error": "<readable message>", "code": "REVISION_CONFLICT", "currentRevision": 12 }`.

Good to know:

- Leaving `expectedRevision` out still works, so existing clients keep working, but MCP replies include a warning and the server logs it. Always pass it.
- `append: true` on `ai_cortex_update_note` is applied atomically on the server, so several agents appending at once never lose each other's text.
- A save that changes nothing doesn't bump the revision. Trashing and restoring a note do.

## 🖥️ Connecting Claude Code

Run:

```bash
npm run setup:claude-code
```

This does two things, and is safe to re-run on the same machine (both steps are idempotent):

1. Registers AI-Cortex as a **user-scoped** MCP server (`claude mcp add --scope user`), so its tools are available in *every* Claude Code project on this machine, not just this repo. Start a new Claude Code session afterward to pick it up.
2. Appends a short note-taking policy to your global `~/.claude/CLAUDE.md` (sourced from [`docs/claude-code-note-policy.md`](docs/claude-code-note-policy.md)), telling Claude Code to use AI-Cortex's MCP tools as the canonical place to save notes/memory instead of writing standalone files to disk.

If the `claude` CLI isn't installed yet, the script prints the exact `claude mcp add` command to run manually once it is.

## 🖱️ Desktop Launcher (Linux)

Run:

```bash
npm run setup:desktop
```

This installs a `systemd --user` service that runs the AI-Cortex server in the background, starting automatically at login (same as your database), plus a desktop icon (`~/Desktop/ai-cortex.desktop`, also added to your app launcher) that just opens the app in your browser — no terminal needed day-to-day. If the server isn't running yet for any reason, the icon starts it first.

Requires `systemd` and a `.env` already set up (see [Environment Setup](#2-environment-setup)). On GNOME, the script also marks the desktop icon as trusted so it's launchable immediately, no right-click prompt.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + K` / `Cmd + K` | Open instant full-text search palette |
| `Alt + D` | Jump to today's Daily Journal note |
| `Ctrl + N` / `Cmd + N` | Create a new note |
| `Ctrl + S` / `Cmd + S` | Save the current note now |
| `Ctrl + Shift + C` | Copy AI Context Bundle for Claude.ai / Gemini web tabs |
| `Alt + T` | Cycle theme: Dark → Light → System |
| `[[` | Open wikilink auto-complete popup while writing |
