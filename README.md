# 🧠 AI-Cortex

A self-hosted, persistent long-term memory cortex for **Claude**, **Gemini**, and other LLMs. Combines the best of **Notion** (structured properties, databases, Kanban boards) and **Obsidian** (speed, privacy, local ownership, markdown, bidirectional backlinks), backed by **MySQL 8.4** and local hybrid file storage.

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
  - **Kanban Board**: Drag or transition notes across workflow statuses.
  - **Database Grid**: Sortable, filterable table view with editable statuses.
  - **Global Action Items**: Automatically extracts and aggregates `- [ ]` tasks from every note into a consolidated checklist.
- 📅 **Daily Journaling**: Jump to or create today's daily note with one keystroke (`Alt + D`).
- 🎨 **Adaptive Theming**: 3-way **Dark / Light / System** ambiance (follows the OS and reacts live to changes), 15 curated accent palettes plus a custom-colour picker. Preferences persist in `localStorage`; the theme is applied before first paint to avoid any flash. Toggle modes with `Alt + T` or from **Settings → Appearance**.
- 📦 **Obsidian Vault 1-Click Export & Import**: Export all notes and attachments as a standard `.zip` vault, or import existing Markdown vaults.
- 🧪 **Complete Test Suite**: 11 automated unit and integration tests passing in ~300ms (`npm test`).

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
Open **http://127.0.0.1:3001**. The API binds to `HOST` (default `127.0.0.1`); set `HOST` / `ALLOWED_HOSTS` to expose it on a LAN.

---

## 🤖 Connecting Claude Desktop (Zero API Keys)

1. Open AI-Cortex in your browser.
2. Click **Settings** in the bottom-left sidebar, then open the **AI Integrations** tab.
3. Click the **"1-Click Auto Install"** button (or copy the pre-filled JSON snippet into your `claude_desktop_config.json`). A **"1-Click Enable for Gemini"** button does the same for `.agents/mcp_config.json` in this workspace.
4. Restart Claude Desktop. You will now see the memory tools (`ai_cortex_search`, `ai_cortex_read_note`, `ai_cortex_create_note`, `ai_cortex_update_note`, `ai_cortex_get_backlinks`, `ai_cortex_list_recent`, `ai_cortex_list_projects`, `ai_cortex_list_tasks`) available directly in Claude using your **existing Claude Pro subscription**!

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
| `Ctrl + Shift + C` | Copy AI Context Bundle for Claude.ai / Gemini web tabs |
| `Alt + T` | Cycle theme: Dark → Light → System |
| `[[` | Open wikilink auto-complete popup while writing |
