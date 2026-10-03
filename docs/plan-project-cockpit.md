# Plan: project cockpit

Status: proposal, 3 October 2026. Nothing here is built yet.

## Why

Paul's work runs across four repos: CarbonVerified, bolsahotelera, pauljacobs.dev and ai-cortex itself. Each keeps its own task list and docs in a different shape, and each deploys a different way. Three questions come up every day and none has a one-screen answer:

1. What's open, across everything?
2. What's committed but not live yet?
3. Where did we write down X?

ai-cortex already has projects, task aggregation, full-text search and an MCP server. It just doesn't know the repos exist. This plan teaches it, in three phases, smallest first.

What exists today, for reference:

- CarbonVerified: 47 open `- [ ]` items in `TODO.md`, plus `docs/` (architecture, deployment, audits, compliance checks). Deploys by git bundle because the host can't reach GitHub. Step 1 of `.claude/commands/deploy.md` already asks for the server's HEAD; nothing records it afterwards.
- bolsahotelera: tasks in `docs/engineering/build-backlog.md` (6 open checkboxes), deferred work as `##` sections in `docs/memories/*-backlog.md`, audit reports in `docs/reports/`. Deploys with `deploy/deploy.sh`, which runs on the server, pulls `master` from GitHub and posts to Slack.
- pauljacobs.dev: Laravel on Fasthosts shared hosting, deployed through `deploy-to-htdocs/`.
- The Obsidian vault mirror of `docs/` has drifted. bolsahotelera's CLAUDE.md still points at `sync-docs.sh` and `_meta/`; CarbonVerified's says both were retired on 20 August 2026 and the mirror is refreshed by hand.

## Ground rules

- The repo stays the source of truth for anything ingested from it. ai-cortex is the read side.
- Ingested notes are read-only in ai-cortex for v1. Editing them in two places would just recreate the drift problem.
- ai-cortex keeps binding to localhost (`ALLOWED_HOSTS` in `core/api/server.js`). Nothing in this plan needs it on the internet. Servers never call ai-cortex; ai-cortex reads local clones and, where needed, asks the server.
- Same patterns as the rest of the codebase: idempotent migrations in `core/db/migrate.js`, services in `core/services/`, `node --test` integration tests against the test database.

## Phase 1: deploy ledger

The smallest piece and the one that removes the most SSH sessions.

### Data

```sql
CREATE TABLE IF NOT EXISTS deploys (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  environment VARCHAR(32) NOT NULL DEFAULT 'production',
  commit_sha CHAR(40) NOT NULL,
  deployed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  source ENUM('manual', 'script', 'probe') NOT NULL,
  note VARCHAR(255) NULL,
  INDEX idx_deploys_project_env (project_id, environment, deployed_at),
  CONSTRAINT fk_deploys_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repo_sources (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL UNIQUE,
  local_path VARCHAR(1024) NOT NULL,
  default_branch VARCHAR(255) NOT NULL DEFAULT 'main',
  include_globs JSON NOT NULL,          -- used from phase 2
  last_ingested_sha CHAR(40) NULL,      -- used from phase 2
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_repo_sources_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

The ledger is append-only. "What's live" is the latest row per project and environment. Keeping history means "when did this commit go out?" also has an answer.

Repos are registered in a local config file, `repos.json` next to `.env` and gitignored, so absolute paths never land in git:

```json
[
  { "project": "CarbonVerified", "path": "~/code/CarbonVerified", "branch": "main",
    "include": ["TODO.md", "docs/**/*.md"] },
  { "project": "bolsahotelera", "path": "~/code/bolsahotelera", "branch": "master",
    "include": ["docs/**/*.md"] }
]
```

### Recording a deploy

Each repo gets a different hook because each deploys differently.

| Repo | How the SHA reaches the ledger |
|---|---|
| CarbonVerified | New last step in `.claude/commands/deploy.md`: after the tree-hash check passes, run `npm --prefix <ai-cortex> run deploy:record -- --project CarbonVerified --sha $(git rev-parse main)`. The deploy already runs on Paul's machine, so this is a local call. |
| pauljacobs.dev | Same local command at the end of the `deploy-to-htdocs` routine. |
| bolsahotelera | `deploy.sh` runs on the server, so it can't reach a localhost ai-cortex. Instead ai-cortex probes: `deploy.sh` writes the deployed SHA to a file, and `/health.php` returns it only when the request carries a matching `DEPLOY_PROBE_TOKEN` header. ai-cortex fetches it on demand and records a `probe` row when the SHA changed. |

`deploy:record` is a thin script (`scripts/record-deploy.js`) that calls a new `deployService.record()`. It refuses a SHA the local clone doesn't have, which catches typos and deploys from an unpushed branch.

### Reading it

`deployService.status(project)` returns:

- live SHA, when, and how it was recorded
- `git rev-list --count <live>..<branch>` and the subjects of those commits (via `execFile('git', ...)` with `cwd` set to the registered path, never a shell string)
- a warning when the live SHA isn't an ancestor of the branch, which means a server hotfix or a force-push

Surfaces:

- REST: `GET /api/deploys/status`, `GET /api/deploys/status/:project`, `POST /api/deploys` (manual record)
- MCP: `ai_cortex_deploy_status` (optional `project`) and `ai_cortex_record_deploy`
- UI: a small "Deploys" panel per project in the sidebar: "CarbonVerified · 12 commits not live · last deploy 4 days ago"

### Tests

- Recording a SHA the repo doesn't know is refused.
- Status against a throwaway git repo built in a temp dir: 0 ahead, N ahead, and diverged.
- The probe ignores a response without the right token and records nothing when the SHA is unchanged.

## Phase 2: repo ingest

Replaces the vault mirror and `sync-docs.sh`.

### How it works

`repoIngestService.sync(project)`:

1. Read `HEAD` of the registered branch. If it equals `last_ingested_sha`, stop.
2. List files with `git ls-tree -r --name-only <sha>` filtered by `include_globs`, and read each with `git show <sha>:<path>`. Reading from the commit, not the working tree, means half-saved local edits never get ingested.
3. Upsert one note per file into the project. Title is the first `# heading`, or the file name. The note gets three `note_properties` rows: `source_repo`, `source_path` and `source_blob` (the git blob SHA).
4. Skip files whose blob SHA hasn't changed. Changed files go through the normal `updateNote` path, so they get a revision bump and a `note_versions` snapshot like any other edit.
5. Files that disappeared from the repo get their note moved to `archived`, not deleted.
6. Save the new `last_ingested_sha`.

Using `note_properties` instead of a new table keeps ingested notes visible to the existing Database Grid view with no extra work.

### Read-only notes

`noteService.updateNote` and `toggleTask` refuse a note with a `source_repo` property unless the caller is the ingest service, with a coded error `SOURCE_READ_ONLY`. The editor shows a banner: "From CarbonVerified/TODO.md at a1b2c3d. Edit it in the repo." The MCP `ai_cortex_update_note` returns the same error text so an agent knows to edit the file instead.

### When it runs

- On server start, for every registered repo.
- From a "Sync" button per project and `POST /api/repos/:project/sync`.
- From MCP `ai_cortex_sync_repo`, so a Claude session can sync right after it commits.
- Optionally, a `post-commit` hook in each repo that calls the sync endpoint. This lives in `.git/hooks`, so it's per-machine and never committed.

No file watcher in v1. Commits are the unit that matters, and step 1 makes a redundant sync nearly free.

### Tests

- A fixture repo with three files: first sync creates three notes; a second sync with no new commit touches nothing; a commit that edits one file updates one note and adds one version; a commit that deletes one archives it.
- Editing an ingested note through the API and through MCP both fail with `SOURCE_READ_ONLY`.
- A file outside `include_globs` is never read.

## Phase 3: task board

Most of this already exists in `noteService.getTasks()` and `TasksView.jsx`. The changes are small.

- `getTasks` gains a `project` filter, and each task carries `sourcePath` and `sourceLine` when its note is ingested.
- `TasksView` groups by project, and tasks from repo notes show "CarbonVerified/TODO.md:142" with a copy button instead of a tick box. Ticking happens in the repo, then the next sync picks it up.
- `ai_cortex_list_tasks` gains the same `project` filter.
- `getTasks` currently caps at the 200 most recently updated notes. Ingest will add a lot of notes, so the cap moves to tasks rather than notes, and the `LIKE '%[ ]%'` prefilter stays.

The board only collects `- [ ]` checkboxes. bolsahotelera's `docs/memories/*-backlog.md` files hold deferred work as `##` sections on purpose ("don't build or re-propose proactively"), so they stay searchable notes and stay off the board. That's the right behaviour, not a gap.

## Order of work

1. Migration for `deploys` and `repo_sources`, `repos.json` loader, `deployService`, `deploy:record` script, tests.
2. Status REST endpoints and MCP tools. Wire the CarbonVerified deploy command. Use it for two weeks.
3. Deploys panel in the UI.
4. bolsahotelera probe (needs a small change in that repo's `deploy.sh` and `health.php`).
5. Repo ingest service, read-only guard, tests.
6. Retire the vault mirror: remove the `sync-docs.sh` and vault-mirror paragraphs from the bolsahotelera and CarbonVerified CLAUDE.md files.
7. Task board changes.

Steps 1 and 2 are a weekend. Everything after can wait until the ledger has proven itself.

## Open questions

- Where do the clones live on the current machine? `repos.json` needs real paths, and the two CLAUDE.md files disagree about the home directory (`/home/donpolanco` vs `/home/pauljacobs`).
- Should ai-cortex ingest its own `docs/`? Probably yes, for consistency.
- Is a token-gated SHA on `/health.php` acceptable for bolsahotelera, or should the probe use SSH (`ssh deploy@host git -C /var/www/bolsahotelera rev-parse HEAD`) instead? SSH avoids touching the app but needs a key on Paul's machine.
- Do staging environments matter yet? The schema supports them through `environment`; the UI can ignore them until they exist.
