import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { slugify, extractWikilinks, extractHashtags, extractTasks, markdownToPlaintext, toBooleanFulltextQuery } from './parser.js';
import { projectService } from './projectService.js';

const PRUNE_ORPHAN_TAGS_SQL =
  `DELETE t FROM tags t LEFT JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.tag_id IS NULL`;

function normalizeCustomTags(customTags) {
  return (Array.isArray(customTags) ? customTags : [])
    .filter((t) => typeof t === 'string')
    .map((t) => t.toLowerCase().trim())
    .filter(Boolean);
}

export const NOTE_STATUSES = ['active', 'archived', 'trash'];

/** Error carrying a machine-readable `code` (and any extra fields) for the API/MCP layers. */
function codedError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code }, extra);
}

function assertValidStatus(status) {
  if (status !== undefined && !NOTE_STATUSES.includes(status)) {
    throw codedError('INVALID_ARGUMENT', `Invalid status "${status}". Expected one of: ${NOTE_STATUSES.join(', ')}`);
  }
}

/** undefined/null = "no check requested"; otherwise must be a positive integer. */
function parseExpectedRevision(value) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < 1) {
    throw codedError('INVALID_ARGUMENT', 'expectedRevision must be a positive integer');
  }
  return value;
}

/** Normalize a DATE column value (Date at local midnight) or a date string to YYYY-MM-DD. */
function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

function sameSet(a, b) {
  const setA = new Set(a);
  return setA.size === new Set(b).size && b.every((x) => setA.has(x));
}

export class NoteService {
  /**
   * Create a new note
   */
  async createNote({
    title,
    content = '',
    status = 'active',
    dueDate = null,
    properties = {},
    customTags = [],
    project = null,
    id: providedId = null,
    conn: externalConn = null
  }) {
    if (!title || typeof title !== 'string') {
      throw new Error('Note title is required');
    }
    assertValidStatus(status);

    // With an external connection the caller owns the transaction (e.g. vault import),
    // so nothing is committed, rolled back, or released here.
    const ownsConn = !externalConn;
    const conn = externalConn || await pool.getConnection();
    const id = providedId || crypto.randomUUID();
    let baseSlug = slugify(title) || 'untitled';
    let slug = baseSlug;

    try {
      // Check slug collision (on the same connection so uncommitted rows are seen)
      let counter = 1;
      while (true) {
        const [existing] = await conn.query(`SELECT id FROM notes WHERE slug = ?`, [slug]);
        if (!existing.length) break;
        slug = `${baseSlug}-${counter++}`;
      }

      const projectRecord = project ? await projectService.getOrCreateByName(project) : null;
      const contentText = markdownToPlaintext(content);

      if (ownsConn) await conn.beginTransaction();

      // 1. Insert note
      await conn.query(
        `INSERT INTO notes (id, title, slug, content, content_text, status, due_date, project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title.trim(), slug, content, contentText, status, dueDate || null, projectRecord ? projectRecord.id : null]
      );

      // 2. Process Tags (both extracted #tags and explicitly passed tags)
      const extractedTags = extractHashtags(content);
      const allTags = Array.from(new Set([...extractedTags, ...normalizeCustomTags(customTags)]));

      for (const tagName of allTags) {
        if (!tagName) continue;
        await conn.query(`INSERT IGNORE INTO tags (name) VALUES (?)`, [tagName]);
        const [tagRows] = await conn.query(`SELECT id FROM tags WHERE name = ?`, [tagName]);
        if (tagRows.length) {
          await conn.query(
            `INSERT IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)`,
            [id, tagRows[0].id]
          );
        }
      }

      // 3. Process Wikilinks
      const links = extractWikilinks(content);
      for (const link of links) {
        // Check if target note currently exists
        const [targets] = await conn.query(`SELECT id FROM notes WHERE slug = ?`, [link.targetSlug]);
        const targetNoteId = targets.length ? targets[0].id : null;

        await conn.query(
          `INSERT INTO note_links (source_note_id, target_slug, target_note_id)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE target_note_id = VALUES(target_note_id)`,
          [id, link.targetSlug, targetNoteId]
        );
      }

      // 4. Update any existing orphan links that were waiting for this slug!
      await conn.query(
        `UPDATE note_links SET target_note_id = ? WHERE target_slug = ?`,
        [id, slug]
      );

      // 5. Process Notion-style Properties
      if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
        for (const [propName, propVal] of Object.entries(properties)) {
          if (!propName || propVal === undefined) continue;
          const propType = typeof propVal === 'number' ? 'number' : typeof propVal === 'boolean' ? 'checkbox' : 'text';
          await conn.query(
            `INSERT INTO note_properties (note_id, property_name, property_type, property_value)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE property_value = VALUES(property_value), property_type = VALUES(property_type)`,
            [id, propName, propType, String(propVal)]
          );
        }
      }

      // 6. Record Initial Snapshot in note_versions
      await conn.query(
        `INSERT INTO note_versions (note_id, title, content) VALUES (?, ?, ?)`,
        [id, title.trim(), content]
      );

      if (!ownsConn) return { id, slug };

      await conn.commit();
      return this.getNoteById(id);
    } catch (err) {
      if (ownsConn) await conn.rollback();
      throw err;
    } finally {
      if (ownsConn) conn.release();
    }
  }

  /**
   * Update an existing note.
   *
   * Runs in one transaction that locks the note row (SELECT ... FOR UPDATE) and makes
   * every decision from that locked row, never from an earlier read.
   *
   * - expectedRevision: if given and not the note's current revision, nothing is
   *   written and a REVISION_CONFLICT error (carrying `currentRevision`) is thrown.
   * - appendContent: appended to the locked content, so concurrent appends all
   *   persist. Mutually exclusive with `content`.
   * - A write that changes nothing (after normalizing dates, project and tags)
   *   neither bumps the revision nor snapshots.
   * The returned note is read inside the transaction, so it is exactly this write
   * and its `revision` is safe to use as the caller's next expectedRevision.
   *
   * @throws {Error} code NOT_FOUND | REVISION_CONFLICT | INVALID_ARGUMENT
   */
  async updateNote(id, {
    title,
    content,
    appendContent,
    status,
    dueDate,
    properties,
    customTags,
    project,
    expectedRevision
  }) {
    if (title !== undefined && typeof title !== 'string') {
      throw codedError('INVALID_ARGUMENT', 'Note title must be a string');
    }
    if (content !== undefined && appendContent !== undefined) {
      throw codedError('INVALID_ARGUMENT', 'Pass either content or appendContent, not both');
    }
    if (appendContent !== undefined && typeof appendContent !== 'string') {
      throw codedError('INVALID_ARGUMENT', 'appendContent must be a string');
    }
    assertValidStatus(status);
    const expected = parseExpectedRevision(expectedRevision);

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [lockedRows] = await conn.query(`SELECT * FROM notes WHERE id = ? FOR UPDATE`, [id]);
      if (!lockedRows.length) {
        throw codedError('NOT_FOUND', `Note not found: ${id}`);
      }
      const existing = lockedRows[0];
      const existingContent = existing.content || '';

      if (expected !== undefined && expected !== existing.revision) {
        throw codedError('REVISION_CONFLICT', 'Note changed since you read it.', {
          currentRevision: existing.revision
        });
      }

      // Only now (revision accepted) may we create a project as a side effect.
      const projectRecord = project !== undefined
        ? (project ? await projectService.getOrCreateByName(project) : null)
        : undefined;

      const newTitle = title !== undefined ? title.trim() : existing.title;
      const newContent = appendContent !== undefined
        ? `${existingContent}\n\n${appendContent}`
        : (content !== undefined ? content : existingContent);
      const newStatus = status !== undefined ? status : existing.status;
      const newDueDate = dueDate !== undefined ? (dueDate || null) : existing.due_date;
      const newProjectId = projectRecord !== undefined
        ? (projectRecord ? projectRecord.id : null)
        : existing.project_id;

      const titleDidChange = newTitle !== existing.title;
      const contentDidChange = newContent !== existingContent;

      // Tags are derived from content plus explicit tags; only re-sync when either could differ.
      const syncTags = contentDidChange || customTags !== undefined;
      const tagsToSync = syncTags
        ? Array.from(new Set([...extractHashtags(newContent), ...normalizeCustomTags(customTags)])).filter(Boolean)
        : null;

      // Semantic no-op check: compare normalized values, not raw input.
      let tagsDidChange = false;
      if (tagsToSync) {
        const [tagNameRows] = await conn.query(
          `SELECT t.name FROM tags t JOIN note_tags nt ON t.id = nt.tag_id WHERE nt.note_id = ?`,
          [id]
        );
        tagsDidChange = !sameSet(tagsToSync, tagNameRows.map((r) => r.name));
      }

      let propertiesDidChange = false;
      const hasProperties = properties && typeof properties === 'object' && !Array.isArray(properties);
      if (hasProperties) {
        const [propRows] = await conn.query(
          `SELECT property_name, property_value FROM note_properties WHERE note_id = ?`,
          [id]
        );
        const current = Object.fromEntries(propRows.map((r) => [r.property_name, r.property_value]));
        propertiesDidChange = Object.entries(properties).some(([name, val]) =>
          name && current[name] !== (val === null ? undefined : String(val))
        );
      }

      const isNoop =
        !titleDidChange &&
        !contentDidChange &&
        newStatus === existing.status &&
        toDateOnly(newDueDate) === toDateOnly(existing.due_date) &&
        newProjectId === existing.project_id &&
        !tagsDidChange &&
        !propertiesDidChange;

      if (isNoop) {
        const unchanged = await this.getNoteById(id, conn);
        await conn.commit();
        return unchanged;
      }

      let newSlug = existing.slug;

      // If title changed, update slug if unique
      if (titleDidChange) {
        const baseSlug = slugify(newTitle) || 'untitled';
        let candidateSlug = baseSlug;
        let counter = 1;
        while (true) {
          const [slugMatches] = await conn.query(
            `SELECT id FROM notes WHERE slug = ? AND id != ?`,
            [candidateSlug, id]
          );
          if (!slugMatches.length) break;
          candidateSlug = `${baseSlug}-${counter++}`;
        }
        newSlug = candidateSlug;
      }

      const contentText = markdownToPlaintext(newContent);

      // 1. Update note (and bump its revision)
      await conn.query(
        `UPDATE notes
         SET title = ?, slug = ?, content = ?, content_text = ?, status = ?, due_date = ?, project_id = ?,
             revision = revision + 1, updated_at = NOW(3)
         WHERE id = ?`,
        [newTitle, newSlug, newContent, contentText, newStatus, newDueDate, newProjectId, id]
      );

      // 2. Snapshot if content or title changed
      if (contentDidChange || titleDidChange) {
        await conn.query(
          `INSERT INTO note_versions (note_id, title, content) VALUES (?, ?, ?)`,
          [id, newTitle, newContent]
        );
      }

      // 3. Update tags if content changed or explicit tags were provided
      if (tagsToSync) {
        await conn.query(`DELETE FROM note_tags WHERE note_id = ?`, [id]);

        for (const tagName of tagsToSync) {
          await conn.query(`INSERT IGNORE INTO tags (name) VALUES (?)`, [tagName]);
          const [tagRows] = await conn.query(`SELECT id FROM tags WHERE name = ?`, [tagName]);
          if (tagRows.length) {
            await conn.query(
              `INSERT IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)`,
              [id, tagRows[0].id]
            );
          }
        }

        // Drop tags that no longer belong to any note
        await conn.query(PRUNE_ORPHAN_TAGS_SQL);
      }

      // 4. Update Wikilinks if content changed
      if (contentDidChange) {
        await conn.query(`DELETE FROM note_links WHERE source_note_id = ?`, [id]);

        const links = extractWikilinks(newContent);
        for (const link of links) {
          const [targets] = await conn.query(`SELECT id FROM notes WHERE slug = ?`, [link.targetSlug]);
          const targetNoteId = targets.length ? targets[0].id : null;

          await conn.query(
            `INSERT INTO note_links (source_note_id, target_slug, target_note_id)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE target_note_id = VALUES(target_note_id)`,
            [id, link.targetSlug, targetNoteId]
          );
        }
      }

      // Reconcile backlinks if slug changed
      if (newSlug !== existing.slug) {
        await conn.query(
          `UPDATE note_links SET target_note_id = ? WHERE target_slug = ?`,
          [id, newSlug]
        );
      }

      // 5. Update Properties if passed
      if (hasProperties) {
        for (const [propName, propVal] of Object.entries(properties)) {
          if (!propName) continue;
          if (propVal === null) {
            await conn.query(
              `DELETE FROM note_properties WHERE note_id = ? AND property_name = ?`,
              [id, propName]
            );
          } else {
            const propType = typeof propVal === 'number' ? 'number' : typeof propVal === 'boolean' ? 'checkbox' : 'text';
            await conn.query(
              `INSERT INTO note_properties (note_id, property_name, property_type, property_value)
               VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE property_value = VALUES(property_value), property_type = VALUES(property_type)`,
              [id, propName, propType, String(propVal)]
            );
          }
        }
      }

      const updated = await this.getNoteById(id, conn);
      await conn.commit();
      return updated;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Change only a note's status (trash / restore / archive) under the same lock and
   * revision rules as updateNote, without re-processing tags or links or snapshotting.
   * @returns {Promise<{id: string, status: string, revision: number}|null>} null if no such note
   * @throws {Error} code REVISION_CONFLICT | INVALID_ARGUMENT
   */
  async setStatus(id, status, { expectedRevision } = {}) {
    if (status === undefined) throw codedError('INVALID_ARGUMENT', 'status is required');
    assertValidStatus(status);
    const expected = parseExpectedRevision(expectedRevision);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query(`SELECT status, revision FROM notes WHERE id = ? FOR UPDATE`, [id]);
      if (!rows.length) {
        await conn.rollback();
        return null;
      }
      const { status: current, revision } = rows[0];

      if (expected !== undefined && expected !== revision) {
        throw codedError('REVISION_CONFLICT', 'Note changed since you read it.', { currentRevision: revision });
      }

      if (current === status) {
        await conn.commit();
        return { id, status, revision };
      }

      await conn.query(
        `UPDATE notes SET status = ?, revision = revision + 1 WHERE id = ?`,
        [status, id]
      );
      await conn.commit();
      return { id, status, revision: revision + 1 };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Fetch a single note by ID with backlinks, tags, properties, and attachments
   */
  async getNoteById(id, db = pool) {
    const [notes] = await db.query(`SELECT * FROM notes WHERE id = ?`, [id]);
    if (!notes.length) return null;
    return this._formatNoteRecord(notes[0], db);
  }

  /**
   * Fetch a single note by Slug
   */
  async getNoteBySlug(slug, db = pool) {
    const [notes] = await db.query(`SELECT * FROM notes WHERE slug = ?`, [slug]);
    if (!notes.length) return null;
    return this._formatNoteRecord(notes[0], db);
  }

  /**
   * Internal helper to populate note details
   */
  async _formatNoteRecord(row, db = pool) {
    const noteId = row.id;

    // 0. Project
    let project = null;
    if (row.project_id) {
      const [projectRows] = await db.query(
        `SELECT id, name, slug FROM projects WHERE id = ?`,
        [row.project_id]
      );
      if (projectRows.length) {
        project = { id: projectRows[0].id, name: projectRows[0].name, slug: projectRows[0].slug };
      }
    }

    // 1. Tags
    const [tagRows] = await db.query(
      `SELECT t.name FROM tags t
       JOIN note_tags nt ON t.id = nt.tag_id
       WHERE nt.note_id = ?
       ORDER BY t.name ASC`,
      [noteId]
    );
    const tags = tagRows.map((t) => t.name);

    // 2. Notion-style Properties
    const [propRows] = await db.query(
      `SELECT property_name, property_type, property_value
       FROM note_properties
       WHERE note_id = ?`,
      [noteId]
    );
    const properties = {};
    for (const p of propRows) {
      if (p.property_type === 'number') {
        properties[p.property_name] = Number(p.property_value);
      } else if (p.property_type === 'checkbox') {
        properties[p.property_name] = p.property_value === 'true' || p.property_value === '1';
      } else {
        properties[p.property_name] = p.property_value;
      }
    }

    // 3. Outgoing Links
    const [outgoingRows] = await db.query(
      `SELECT nl.target_slug, nl.target_note_id, n.title as target_title
       FROM note_links nl
       LEFT JOIN notes n ON nl.target_note_id = n.id
       WHERE nl.source_note_id = ?`,
      [noteId]
    );

    // 4. Backlinks (Incoming mentions from other notes)
    const [backlinkRows] = await db.query(
      `SELECT n.id, n.title, n.slug, n.status, n.updated_at
       FROM note_links nl
       JOIN notes n ON nl.source_note_id = n.id
       WHERE (nl.target_note_id = ? OR nl.target_slug = ?)
         AND n.id != ?
         AND n.status != 'trash'
       GROUP BY n.id, n.title, n.slug, n.status, n.updated_at
       ORDER BY n.updated_at DESC`,
      [noteId, row.slug, noteId]
    );

    // 5. Attachments
    const [attachmentRows] = await db.query(
      `SELECT id, filename, mime_type, file_size, sha256, storage_path, created_at
       FROM attachments
       WHERE note_id = ?
       ORDER BY created_at DESC`,
      [noteId]
    );

    return {
      id: row.id,
      revision: row.revision,
      title: row.title,
      slug: row.slug,
      content: row.content || '',
      status: row.status,
      dueDate: row.due_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      project,
      tags,
      properties,
      outgoingLinks: outgoingRows.map((r) => ({
        targetSlug: r.target_slug,
        targetNoteId: r.target_note_id,
        targetTitle: r.target_title || r.target_slug
      })),
      backlinks: backlinkRows.map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        status: r.status,
        updatedAt: r.updated_at
      })),
      attachments: attachmentRows.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mime_type,
        fileSize: Number(a.file_size),
        sha256: a.sha256,
        url: `/api/attachments/${a.id}/file`
      }))
    };
  }

  /**
   * List notes with filtering, pagination, and sorting
   */
  async listNotes({
    status = 'active',
    tag = null,
    project = null,
    search = null,
    limit = 100,
    offset = 0,
    sortBy = 'updated_at',
    sortOrder = 'DESC'
  } = {}) {
    let whereClauses = [];
    let params = [];

    if (status) {
      whereClauses.push(`n.status = ?`);
      params.push(status);
    }

    if (project) {
      whereClauses.push(`n.project_id = (SELECT id FROM projects WHERE slug = ? OR id = ?)`);
      params.push(project, project);
    }

    if (tag) {
      whereClauses.push(`EXISTS (
        SELECT 1 FROM note_tags nt
        JOIN tags t ON nt.tag_id = t.id
        WHERE nt.note_id = n.id AND t.name = ?
      )`);
      params.push(tag.toLowerCase().trim());
    }

    if (search && search.trim()) {
      const booleanQuery = toBooleanFulltextQuery(search);
      if (booleanQuery) {
        whereClauses.push(`MATCH(n.title, n.content_text) AGAINST(? IN BOOLEAN MODE)`);
        params.push(booleanQuery);
      }
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const safeSortBy = ['title', 'created_at', 'updated_at', 'due_date'].includes(sortBy) ? sortBy : 'updated_at';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const [rows] = await pool.query(
      `SELECT n.id, n.title, n.slug, n.status, n.due_date, n.created_at, n.updated_at,
              LEFT(n.content_text, 160) as preview,
              (SELECT COUNT(*) FROM note_links nl WHERE nl.target_note_id = n.id) as backlink_count
       FROM notes n
       ${whereSql}
       ORDER BY n.${safeSortBy} ${safeSortOrder}
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );

    // Fetch tags for listed notes in a single batch
    const noteIds = rows.map((r) => r.id);
    let noteTagsMap = {};

    if (noteIds.length) {
      const [tagRows] = await pool.query(
        `SELECT nt.note_id, t.name
         FROM note_tags nt
         JOIN tags t ON nt.tag_id = t.id
         WHERE nt.note_id IN (?)`,
        [noteIds]
      );
      for (const t of tagRows) {
        if (!noteTagsMap[t.note_id]) noteTagsMap[t.note_id] = [];
        noteTagsMap[t.note_id].push(t.name);
      }
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      status: r.status,
      dueDate: r.due_date,
      preview: r.preview || '',
      backlinkCount: Number(r.backlink_count || 0),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      tags: noteTagsMap[r.id] || []
    }));
  }

  /**
   * Get or create a Daily Note for a given YYYY-MM-DD date
   */
  async getOrCreateDailyNote(dateStr) {
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : new Date().toISOString().slice(0, 10);
    const title = `Daily: ${validDate}`;
    const slug = slugify(title);

    const existing = await this.getNoteBySlug(slug);
    if (existing) return existing;

    const defaultContent = `# ${title}

## Log
- 

## Tasks
- [ ] 

## Notes & Reflections
#journal #${validDate.slice(0, 7)}
`;

    return this.createNote({
      title,
      content: defaultContent,
      status: 'active',
      customTags: ['daily', 'journal']
    });
  }

  /**
   * Aggregate all tasks across notes
   */
  async getTasks({ completed = null, limit = 200 } = {}) {
    const [rows] = await pool.query(
      `SELECT id, title, slug, content, updated_at
       FROM notes
       WHERE status = 'active'
         AND (content LIKE '%[ ]%' OR content LIKE '%[x]%' OR content LIKE '%[X]%')
       ORDER BY updated_at DESC
       LIMIT ?`,
      [Number(limit)]
    );

    const allTasks = [];
    for (const note of rows) {
      const tasks = extractTasks(note.content);
      for (const task of tasks) {
        if (completed === null || task.completed === completed) {
          allTasks.push({
            noteId: note.id,
            noteTitle: note.title,
            noteSlug: note.slug,
            text: task.text,
            completed: task.completed,
            line: task.line,
            updatedAt: note.updated_at
          });
        }
      }
    }

    return allTasks;
  }

  /**
   * Soft-delete note to trash, or permanently delete
   */
  async deleteNote(id, { permanent = false } = {}) {
    if (permanent) {
      const [res] = await pool.query(`DELETE FROM notes WHERE id = ?`, [id]);
      if (res.affectedRows > 0) {
        await pool.query(PRUNE_ORPHAN_TAGS_SQL);
      }
      return res.affectedRows > 0;
    } else {
      return (await this.setStatus(id, 'trash')) !== null;
    }
  }

  /**
   * Restore a note from trash
   */
  async restoreNote(id) {
    return (await this.setStatus(id, 'active')) !== null;
  }

  /**
   * List all unique tags with usage count
   */
  async listTags() {
    const [rows] = await pool.query(`
      SELECT t.name, COUNT(nt.note_id) as count
      FROM tags t
      LEFT JOIN note_tags nt ON t.id = nt.tag_id
      LEFT JOIN notes n ON nt.note_id = n.id AND n.status = 'active'
      GROUP BY t.id, t.name
      HAVING count > 0
      ORDER BY count DESC, t.name ASC
    `);
    return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
  }

  /**
   * Toggle a markdown task by matching its text, not just its line number, so an
   * edit above the task (by a person or an agent) can't make us tick the wrong one.
   * Prefers the task at `line`; falls back to the only task with that text.
   * @throws {Error} code NOT_FOUND (no such note) or TASK_CONFLICT (task moved/ambiguous/gone)
   */
  async toggleTask(noteId, { line, text, completed }) {
    // The write is guarded by the revision we read, so a concurrent edit between our
    // read and write can't be lost; on conflict we re-read and try again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const note = await this.getNoteById(noteId);
      if (!note) throw codedError('NOT_FOUND', `Note not found: ${noteId}`);

      const matches = extractTasks(note.content).filter((t) => t.text === text);
      const target = matches.find((t) => t.line === line) || (matches.length === 1 ? matches[0] : null);
      if (!target) {
        throw codedError('TASK_CONFLICT', 'Task could not be located; the note has changed. Refresh and try again.');
      }

      if (target.completed === completed) return note;

      const lines = note.content.split('\n');
      lines[target.line - 1] = lines[target.line - 1].replace(/\[[ xX]\]/, completed ? '[x]' : '[ ]');
      try {
        return await this.updateNote(noteId, {
          content: lines.join('\n'),
          expectedRevision: note.revision
        });
      } catch (err) {
        if (err.code !== 'REVISION_CONFLICT') throw err;
      }
    }
    throw codedError('TASK_CONFLICT', 'The note kept changing; try again.');
  }

  /**
   * Restore a note's title and content from a saved version. Applied as a normal
   * edit, so the restore itself is snapshotted and can be undone.
   * @returns {Promise<Object|null>} the updated note, or null if the version isn't this note's
   */
  async restoreVersion(noteId, versionId, { expectedRevision } = {}) {
    const [rows] = await pool.query(
      `SELECT title, content FROM note_versions WHERE id = ? AND note_id = ?`,
      [versionId, noteId]
    );
    if (!rows.length) return null;
    return this.updateNote(noteId, { title: rows[0].title, content: rows[0].content, expectedRevision });
  }

  /**
   * Version history for a note
   */
  async getVersions(noteId) {
    const [rows] = await pool.query(
      `SELECT id, note_id, title, content, created_at
       FROM note_versions
       WHERE note_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [noteId]
    );
    return rows;
  }
}

export const noteService = new NoteService();
export default noteService;
