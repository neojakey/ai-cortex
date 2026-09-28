# AI-Cortex product and implementation audit

Date: September 27, 2026  
Scope: Shared memory across AI models, implementation reliability, retrieval, security boundaries, and product development opportunities.

## Overall assessment

AI-Cortex is a credible foundation for shared AI memory. Local ownership, a common MCP interface, transactional updates, revision checking, atomic appends, and recoverable note history address real problems when humans and multiple models share information.

The largest product opportunity is to make memories trustworthy, current, and easy to retrieve. The implementation currently functions primarily as a shared notebook: each model must decide what to save, locate the right notes, and interpret whether their contents are still valid. A stronger memory layer would also track provenance, superseded decisions, scope, and retrieval evidence.

The recommended sequence is to fix data-loss and attachment-security issues, strengthen replacement-write guarantees, and then introduce a project-resume tool backed by memory provenance.

## Scope and verification

The review covered the REST API, MCP tools, note and project services, database schema, attachment storage, backup and vault import/export code, editor save coordination, and existing tests.

Verification completed:

- All 46 existing automated tests passed against the isolated test database.
- The production build succeeded.
- Targeted checks reproduced explicit-tag loss after content edits, failed project-name search where slug search succeeded, and failure to retrieve a note using an explicit tag.
- A targeted frontmatter-parser check demonstrated malformed handling of quoted titles and omission of due dates and properties.
- Temporary records created by the targeted checks were removed.

No application source was changed during the audit. The findings below distinguish reproduced behavior from code-inspection findings. This was not a full penetration test, a browser interaction audit, a load test, or a disaster-recovery drill. Passing the existing suite does not establish coverage of the identified gaps.

## Priority findings

### 1. High: active attachments are served from the application origin

**Evidence:** Code inspection. [Attachment upload and serving](../core/api/server.js) accepts the uploaded MIME type and serves file bytes inline using that type. The response does not force a download or apply a sandbox to active content. The editor opens attachment URLs in a new tab.

**Impact:** Opening a malicious HTML or SVG attachment could execute script in the application's origin and give it access to the unauthenticated API. The loopback binding and browser-origin checks do not isolate same-origin attachment scripts. Sanitizing rendered note Markdown does not protect the attachment endpoint.

**Recommendation:** Force downloads for active or unknown content types, set `X-Content-Type-Options: nosniff`, and allow inline previews only for deliberately supported types. If active document previews are needed, isolate them from the application origin with appropriate sandboxing.

**Acceptance checks:** Upload HTML and SVG fixtures and verify that opening them cannot execute script with application-origin API access. Confirm that supported image and document workflows still function. No exploit was executed during this audit.

### 2. High: content edits remove explicitly assigned tags

**Evidence:** Reproduced against the test database. A note created with an explicit tag lost that tag after a content-only update. In [noteService.js](../core/services/noteService.js), tags are rebuilt when content changes using extracted hashtags plus `normalizeCustomTags(customTags)`. When the update omits `customTags`, the explicit contribution becomes empty.

**Impact:** Normal human or agent edits silently remove classification information and can make memories disappear from tag-filtered lists. The existing test for unchanged content preserving tags does not cover changed content.

**Recommendation:** Store explicit tags separately from content-derived tags, or retain their origin in the relationship model. Treat omission of `customTags` as preservation; define an explicit empty array as clearing the explicit tags.

**Acceptance checks:** Verify that content replacement, append, and task toggling preserve explicit tags; that removing a hashtag updates derived tags; and that explicit tag removal remains possible.

### 3. High: replacement writes can bypass revision checks

**Evidence:** Code inspection and existing test coverage confirm this intentional compatibility behavior. [MCP update handling](../core/mcp/index.js) accepts an omitted `expectedRevision` and warns only after writing. The service also permits unchecked updates.

**Impact:** Two models can still overwrite each other's work if either omits the revision. The database lock makes each write atomic but does not establish that a replacement was based on the latest content.

**Recommendation:** Require `expectedRevision` for replacement writes through both REST and MCP. Preserve atomic append as a separate operation. If compatibility requires an escape hatch, make force replacement explicit and auditable rather than an implicit consequence of a missing field.

**Acceptance checks:** Missing or stale revisions must reject replacement without mutation. Concurrent valid replacement attempts must yield one success and one conflict. Atomic appends must retain all appended content.

### 4. Medium: vault export/import loses structure and attachment references

**Evidence:** Code inspection of [exportService.js](../core/services/exportService.js), plus a targeted parser check. Export writes due dates and properties, but import does not restore those fields. Project metadata is not exported. Attachments are imported with new identifiers and without their original note associations. Note content is not remapped from application attachment URLs to portable vault paths and back. The regular-expression frontmatter parser also mishandles quoted titles.

**Impact:** A vault migrated into a fresh installation can lose metadata and retain broken `/api/attachments/...` references. Idempotent import is useful but does not establish a faithful round trip. The vault format should not be presented as equivalent to a complete database backup.

**Recommendation:** Use a proper YAML parser/serializer, define the supported portability contract, and add a versioned manifest for project metadata and attachment mappings. Rewrite attachment links on export/import and preserve note associations. Keep database backups and portable vault exports clearly distinguished in the UI.

**Acceptance checks:** Export a fixture containing projects, dates, properties, quoted titles, duplicate filenames, links, and attachments. Import into a fresh test database and compare supported fields and link targets. Then repeat the import to verify idempotence.

### 5. Medium: retrieval differs from MCP descriptions

**Evidence:** Reproduced against the test database. A project-scoped search using the project's display name returned zero results, while the slug returned the expected note. Searching for an explicit tag also failed to return the tagged note. [searchService.js](../core/services/searchService.js) filters projects by slug or ID and searches title/content; it loads tags only after selecting matches. MCP descriptions advertise project names and tag matching more broadly.

**Impact:** A model can incorrectly conclude that a saved memory does not exist. It may then recreate information, use stale context, or fail to resume work.

**Recommendation:** Normalize project identifiers through a shared resolver and make the tool contract explicit. Include explicit tags in retrieval with deliberate ranking, and return project identity in search results. Reject ambiguous identifiers rather than silently choosing a match.

**Acceptance checks:** Test display names, slugs, IDs, unknown projects, and explicit tags through the actual MCP transport as well as the service layer.

### 6. Medium: rapid navigation can discard unsaved editor changes

**Evidence:** Code inspection, not browser reproduction. [NoteEditor.jsx](../client/src/components/NoteEditor.jsx) schedules autosave after 600 ms and clears the timer during effect cleanup. Switching notes resets editor fields and the save coordinator. No per-note draft persistence or navigation guard was found for this path.

**Impact:** Switching away before autosave starts can discard the latest edits. Closing the page during the debounce window poses a similar risk.

**Recommendation:** Preserve drafts per note and flush or guard navigation. Recover drafts after reload. Do not rely exclusively on an unload-time network request for persistence.

**Acceptance checks:** In a browser test, type and immediately switch notes, close/reload the page, and navigate during an in-flight save. Confirm that text is either persisted or recoverable and never assigned to a different note.

## Project scope and access boundaries

Projects currently organize memories; they do not restrict access. Search and list filters are optional, note reads resolve globally, and the MCP task-list tool has no project filter. Backlinks may also disclose notes outside a requested project. This is consistent with a trusted single-user notebook, but it is not a sufficient boundary for agents with different access requirements.

Introduce a clear distinction between organizational filters and enforced client permissions. A restricted connection should have its scope applied in the service layer across reads, writes, search, backlinks, tasks, and related metadata. Models should not be relied upon to enforce that boundary through instructions alone.

## Product enhancements

### 1. A project-resume tool

Add an operation that accepts a project and current task, then returns a compact brief containing current decisions, relevant preferences, unresolved questions, recent changes, and next actions. Include source note IDs and revisions, plus a response-size budget.

This would make switching models immediately useful without requiring several manual searches. Start with a deterministic bundle of stored information; if summaries are generated, label them as derived and retain their sources.

### 2. Memory provenance and lifecycle

Record the originating client/session, supporting source, last verification date, and whether a statement is user-confirmed or model-inferred. Distinguish asserted author information from authenticated client identity when authentication becomes available.

Support explicit supersession: a new deployment decision should replace an old decision in the current view while retaining its history. Consider memory types such as preference, decision, fact, procedure, and temporary task context. Avoid treating a model's self-reported confidence as proof of correctness.

### 3. Retrieval with evidence

First make project and tag filtering reliable. Return snippets from the matching passage rather than only the beginning of the note. Include project, age, lifecycle status, and a useful explanation of the match.

Then evaluate semantic retrieval alongside keyword search. Build a benchmark of real user questions and expected memories before selecting an embedding or ranking approach. Measure whether relevant memories are found, whether the wrong project's information appears, and how much context is returned.

### 4. Memory activity and correction UI

Show what each connected AI remembered or changed, a readable diff, and an undo action. Expose the existing version-history foundation in the UI. Add reviewable duplicate and contradiction suggestions instead of silently merging memories.

This gives the user a practical way to inspect and correct the shared knowledge that future models will consume.

### 5. Scoped client connections

Allow read-only connections and connections restricted to selected projects. Add a visible connection inventory and enforce restrictions centrally. Keep the current trusted local-use mode simple, while making broader sharing an explicit product capability with real access controls.

## Suggested implementation sequence

| Stage | Work | Completion criteria |
| --- | --- | --- |
| 1. Protect existing information | Attachment isolation, explicit-tag preservation, safe editor navigation, required revisions for replacement | Regression checks cover the identified failure paths; existing tests and build pass |
| 2. Make portability and retrieval dependable | Vault round-trip contract, metadata and attachment mapping, consistent project resolution, explicit-tag search | Fresh-database round-trip test and MCP retrieval contract tests pass |
| 3. Improve continuity across models | Project-resume tool, provenance, superseded-memory handling | A second model can resume a representative task using a compact brief with traceable sources |
| 4. Add oversight and controlled sharing | Activity/diff UI, reviewable corrections, scoped client access | Users can inspect and undo changes; restricted clients cannot retrieve or mutate out-of-scope data |

The central product outcome to optimize is: another model can pick up where the user left off, using accurate and traceable context. New features should be evaluated against that outcome rather than against the number of notebook features available.
