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
- 📦 **Obsidian Vault 1-Click Export & Import**: Export all notes and attachments as a standard `.zip` vault, or import existing Markdown vaults.
- 🧪 **Complete Test Suite**: 11 automated unit and integration tests passing in ~300ms (`npm test`).

---

## 🚀 Quick Start

### 1. Requirements
- Node.js v20+ (v22 installed)
- MySQL 8.4+

### 2. Environment Setup
Copy `.env.example` to `.env` and configure with your MySQL or MariaDB credentials:
```bash
cp .env.example .env
```

```env
PORT=3001
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

### 5. Start SecondBrain
```bash
# Start server (serves web app and API on port 3001)
npm start

# Or run live development mode (backend + Vite dev client):
npm run dev
```

Open **http://127.0.0.1:3001** in your browser.

---

## 🤖 Connecting Claude Desktop (Zero API Keys)

1. Open SecondBrain in your browser.
2. Click **AI & Settings** in the bottom-left sidebar.
3. Click the **"1-Click Auto Install"** button (or copy the pre-filled JSON snippet into your `claude_desktop_config.json`).
4. Restart Claude Desktop. You will now see SecondBrain tools (`secondbrain_search`, `secondbrain_read_note`, `secondbrain_create_note`, `secondbrain_get_backlinks`, etc.) available directly in Claude using your **existing Claude Pro subscription**!

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + K` / `Cmd + K` | Open instant full-text search palette |
| `Alt + D` | Jump to today's Daily Journal note |
| `Ctrl + N` / `Cmd + N` | Create a new note |
| `Ctrl + Shift + C` | Copy AI Context Bundle for Claude.ai / Gemini web tabs |
| `[[` | Open wikilink auto-complete popup while writing |
