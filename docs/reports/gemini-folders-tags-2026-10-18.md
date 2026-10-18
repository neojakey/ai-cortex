# AI-Cortex Phase 1: Folders, Moving Notes, and Tags Analysis Report
**Date:** 2026-10-18  
**Author:** Gemini (Antigravity)  
**Branch:** `gemini/folders-tags`  
**Reviewers:** Claude & Paul Jacobs  

---

## 1. Executive Summary

This report documents the implementation, validation, and review fixes for AI-Cortex Phase 1:
1. **Part A — Folder Tree Navigation**: Implemented `GET /api/notes/tree` returning active non-daily notes grouped into project folders, with unfiled notes placed in a trailing `{ project: null, notes: [...] }` section. The sidebar replaces the old "Projects" accordion with a collapsible "Folders" tree using `.tree-folder-btn` and `.tree-note-item` (avoiding selector collisions with `.note-item`). The open note's folder auto-expands and folder expansions persist across reloads in `localStorage`. The flat list was relabeled from "All Notes" to "Recent".
2. **Part B — Moving Notes in the Editor**: Added a folder picker to `.properties-bar` (hidden on daily notes). Supports selecting existing folders, clearing to "No folder", and creating new folders with live suggestions (matching with `normalizeProjectName` ignoring case, spaces, and punctuation). If a name matches an existing project (case-insensitively), it reassigns without confirmation or duplication. Creating a truly new folder requires explicit `window.confirm` confirmation. Unsaved text is flushed via `saveBeforeServerEdit()` with `expectedRevision` before moving.
3. **App.jsx Tree Refetch Optimization**: `handleUpdateNote` avoids refetching the folder tree during autosave pauses when only content or tags changed; it refetches only when title, project, or status differs from what the tree currently holds for that note.
4. **Part C — Tags Analysis**: Created `scripts/tags-report.js` (read-only, zero mutations verified by test spy). Analyzed 203 distinct tags across 1,036 notes in the live database, identifying 6 system tags, 6 short accidental tags, and 9 probable typos using a bounded Levenshtein ratio ($D \le 2, L \ge 5, D/L \le 0.25$). Proposed three persistent cleanup strategies.

---

## 2. Test Verification & Exact Runs

### 2.1 Test Suite Run
Ran `npm test`:
- **Result**: 306 tests passing across all test files with 0 failures and 0 skipped.
- `tests/integration/folders-tree.test.js`: Exactly 5 tests:
  1. `GET /api/notes/tree: is not shadowed by /api/notes/:id`
  2. `GET /api/notes/tree: excludes daily, trashed, and archived notes; groups by project; sorts folders and notes`
  3. `GET /api/notes: behavior remains unchanged`
  4. `PUT /api/notes/:id: changing note project, clearing project, creating new project, and 409 conflict`
  5. `scripts/tags-report: generates plain-text report and writes nothing to the database`

### 2.2 Browser Checks
Ran `npm run test:browser`:
- **Result**: All 9 suites passed cleanly:
  1. `attachments.check.js`: 10 assertions passed.
  2. `folders.check.js`: 29 assertions passed (including new folder cancellation, acceptance, case-insensitive reuse, and suggestion chips).
  3. `google-photos-dialog.check.js`: 8 assertions passed.
  4. `journal-title.check.js`: 18 assertions passed.
  5. `note-layout.check.js`: 14 assertions passed.
  6. `project-labels.check.js`: 7 assertions passed.
  7. `raw-html.check.js`: 11 assertions passed.
  8. `section-add.check.js`: 6 assertions passed.
  9. `sidebar.check.js`: 9 assertions passed.

### 2.3 Production Build Check
Executed:
```bash
npx vite build client --outDir /tmp/gemini-dist-check --emptyOutDir
```
**Result**: 1,614 modules transformed, built in 952ms without error.

---

## 3. Review Fixes & Implementation Details

### 3.1 Case-Insensitive Sort Test (`folders-tree.test.js`)
- **Fix**: Replaced `"A-note in Zulu"` and `"b-note in Zulu"` with `"b-note in Zulu"` and `"C-note in Zulu"`.
- **Reason**: In ASCII, `'A' < 'b'` and `'a' < 'b'` have identical relative order, so a case-sensitive ASCII sort would not fail. With `"b-note"` and `"C-note"`, ASCII puts `'C'` (67) before `'b'` (98), whereas case-insensitive `localeCompare(..., { sensitivity: 'base' })` puts `'b'` before `'C'`.

### 3.2 Tree Refetch Optimization (`App.jsx`)
- **Fix**: In `handleUpdateNote`, inspected `folderTreeRef.current` before calling `fetchTree()`.
- **Logic**:
  - Found note in tree: if `status` changed from `'active'`, `title` changed, or `project_id` changed -> call `fetchTree()`.
  - Note not in tree: if note is newly `'active'` and not a daily note -> call `fetchTree()`.
  - Normal autosaves while typing content: `title`, `project`, and `status` match what the tree already holds -> `fetchTree()` is skipped.

### 3.3 Folder Suggestions Matching (`NoteEditor.jsx`)
- **Fix**: Imported `normalizeProjectName` from `client/src/lib/projectLabels.js`.
- **Logic**: Filters suggestions where `normalizeProjectName(p.name).includes(normalizedTyped)` (or vice-versa for queries $\ge 3$ characters). Typing `"Bolsa Hotelera"`, `"bolsa hotel"`, or `"bolsa-hotelera"` successfully matches `"BolsaHotelera"`.

### 3.4 New Folder Flow in Browser Checks (`folders.check.js`)
- **Fix**: Added comprehensive coverage in `folders.check.js`:
  - Cancelling `window.confirm`: no project created, note unfiled.
  - Accepting `window.confirm`: project created, note moved, tree shows note in new folder.
  - Typing existing project in different case (`pGamma.toLowerCase()`): no confirmation dialog shown, note moved, no duplicate project row created.
  - Suggestion chips: typing normalized query `"project   zeta"` shows chip for `pZeta`, clicking it moves note.

---

## 4. Break-on-Purpose Experiments

All 5 experiments were executed and their exact witnessed error outputs were captured:

| Experiment | Code Mutated | Test Run | Result | Witnessed Error Output |
|---|---|---|---|---|
| **1. Sort Test Sensitivity** | Replaced `localeCompare` with `(a, b) => a.title < b.title ? -1 : 1` in `noteService.js` | `node --test tests/integration/folders-tree.test.js` | FAIL | `AssertionError [ERR_ASSERTION]: Notes in Zulu should be sorted case-insensitively ignoring case (b before C)`<br>`actual: ['C-note in Zulu...', 'b-note in Zulu...']`<br>`expected: ['b-note in Zulu...', 'C-note in Zulu...']` |
| **2. Remove Confirmation** | Removed `window.confirm` in `NoteEditor.jsx` (always calling `moveFolder`) | `node tests/browser/run.js folders` | FAIL | `FAIL Confirmation dialog was shown on new folder creation`<br>`TypeError: Cannot read properties of undefined (reading 'includes')` at line 140 because `dialogs` was empty. |
| **3. Ignore Confirmation Cancel** | Called `moveFolder` regardless of `window.confirm` return value | `node tests/browser/run.js folders` | FAIL | `FAIL Cancelled folder was not added to the tree`<br>`FAIL Note B was not moved after cancelling confirmation` |
| **4. Case-Sensitive Match** | Replaced `.toLowerCase() === .toLowerCase()` with `p.name === trimmed` in `NoteEditor.jsx` | `node tests/browser/run.js folders` | FAIL | `FAIL No confirmation dialog shown for existing folder in different case` |
| **5. Suggestion Chip Click** | Replaced chip `onClick={() => moveFolder(p.name)}` with `onClick={() => {}}` | `node tests/browser/run.js folders` | FAIL | `page.waitForSelector: Timeout 10000ms exceeded waiting for locator('.tree-folder:has-text("Project Zeta...") .tree-note-item:has-text("Note B Unfiled")')` |

All mutations were reverted; all tests returned to passing.

---

## 5. Part C: Tags Cleanup Analysis

### 5.1 Analysis Output (`scripts/tags-report.js`)
Executed read-only analysis on the live database (1,036 notes):
- **Total Unique Tags**: 203
- **System Tags Identified**: 6
  - `#journal` (860 notes — 6 body hashtags, 860 explicit tags)
  - `#daily` (858 notes — 14 body hashtags, 858 explicit tags)
  - `#dayone` (829 notes — 0 body hashtags, 829 explicit tags from Day One import)
  - `#2026-10` (17 notes)
  - `#2026-09` (6 notes)
  - `#2026-08` (3 notes)
- **Probable Accidents** (length $\le 2$): 6 tags
  - `#id` (1 note), `#n` (1 note), `#qa` (3 notes), `#ai` (2 notes), `#ui` (1 note), `#uk` (1 note)
- **Probable Typos** (min length 5, edit distance $\le 2$, ratio $\le 0.25$): 9 tags
  - `#bolsehotelera` (17 notes) vs project `BolsaHotelera` (distance 1)
  - `#bolsahotelera` (12 notes) vs `#bolsehotelera` (distance 1)
  - `#claude-memory` (38 notes) vs project `Claude Memory` (distance 1)
  - `#about-paul` (1 note) vs project `About Paul` (distance 1)
  - `#projects` (1 note) vs `#project` (13 notes, distance 1)
  - `#ideas` (2 notes) vs `#idea` (3 notes, distance 1)
  - `#preference` (2 notes) vs `#reference` (4 notes, distance 1)
  - `#preferences` (2 notes) vs `#reference` (4 notes, distance 2)
  - `#work-log` (1 note) vs `#workflow` (8 notes, distance 2)

### 5.2 Proposed Cleanup Strategies
1. **Strategy 1: Virtual Aliases Table (Recommended)**:
   Add a `tag_aliases` table (`alias_name` -> `canonical_name`). Search and backlinks resolve aliases dynamically without rewriting note bodies or inflating revisions.
2. **Strategy 2: Interactive Migration Script**:
   A CLI tool `scripts/migrate-tags.js --mapping=map.json --commit` running within an explicit MySQL transaction. Rewrites hashtags and `note_tags` entries permanently.
3. **Strategy 3: Proactive Input Normalization**:
   Autocomplete in `NoteEditor` suggests existing canonical tags and warns when typing a tag within edit distance 2 of an existing tag.

---

## 6. Deviations from the Brief

1. **`GET /api/projects` filters empty projects**: `projectService.listProjects()` uses `HAVING note_count > 0`. Therefore, if a project has 0 active notes (for example, if its only note was archived or moved), it will not appear in `projects` returned to the client until an active note is placed in it. In `folders.check.js`, an extra active note was kept in `pGamma` so the project remained populated in the client suggestions.
2. **Folder creation confirmation uses native `window.confirm`**: Rather than introducing a custom HTML modal component with backdrop, the implementation uses the browser's native `window.confirm(...)`. This avoids DOM clutter, guarantees modality, and integrates cleanly with Playwright's `page.on('dialog')` event handler.

---

## 7. What I Am Least Sure About

1. **Submitting trimmed names that match projects with differing punctuation**:
   If a project is named `AI-Cortex`, typing `ai cortex` in `+ New folder...` matches via suggestion chips, but pressing Enter directly on `ai cortex` (without clicking the chip) checks `p.name.toLowerCase() === trimmed.toLowerCase()`. Since `'ai cortex'` does not strictly equal `'ai-cortex'` case-insensitively, it prompts to create `"ai cortex"`. If Paul wants Enter to also resolve normalized matches without prompt, `projects.find((p) => normalizeProjectName(p.name) === normalizeProjectName(trimmed))` could be used.
2. **Folder tree collapse state on project rename / note move**:
   When a note is moved, `Sidebar.jsx` auto-expands the destination folder. However, if a user deliberately collapsed an empty folder, `localStorage` holds the collapsed state until an active note within it becomes open.

---

## 8. How Paul Can Try It by Hand

1. **Start the local dev environment on branch `gemini/folders-tags`**:
   ```bash
   cd /home/pauljacobs/dev/ai-cortex-gemini
   npm run dev
   ```
2. **Browse the Folders tree in the Sidebar**:
   - Open the web app at `http://localhost:5173`.
   - In the sidebar, notice the new **Folders** section.
   - Click any folder chevron to expand/collapse. Refresh the page: the expansion state remains.
   - Notice the flat list below is now labeled **Recent** and shows recent notes.
3. **Move a Note to an Existing Folder**:
   - Open an active note.
   - Look at the properties bar above the note content: notice the folder dropdown.
   - Select another folder: the note is moved immediately, and in the sidebar, the destination folder expands showing the note.
4. **Move a Note with Suggestions and Typing**:
   - In the folder dropdown, choose `+ New folder...`.
   - Type `bolsa hotelera` (with spaces or lowercase): notice the suggestion chip `BolsaHotelera` appears. Click the chip: the note is assigned to `BolsaHotelera`.
5. **Test New Folder Confirmation**:
   - Choose `+ New folder...` and type a brand new name (e.g. `Test Folder`).
   - Click Confirm or press Enter: a confirmation dialog appears asking to confirm creation.
   - Click Cancel: no folder is created.
   - Click Confirm again and click OK: the new folder is created, appears in the sidebar tree, and contains the note.
6. **Verify Daily Notes**:
   - Open a daily journal entry (e.g. `Alt+D`): verify the folder picker is hidden from the properties bar.
