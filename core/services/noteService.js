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
   * Update an existing note
   */
  async updateNote(id, {
    title,
    content,
    status,
    dueDate,
    properties,
    customTags,
    project
  }) {
    const existing = await this.getNoteById(id);
    if (!existing) {
      throw new Error(`Note not found: ${id}`);
    }

    if (title !== undefined && typeof title !== 'string') {
      throw new Error('Note title must be a string');
    }

    const projectRecord = project !== undefined
      ? (project ? await projectService.getOrCreateByName(project) : null)
      : undefined;

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const newTitle = title !== undefined ? title.trim() : existing.title;
      let newSlug = existing.slug;

      // If title changed, update slug if unique
      if (title !== undefined && title.trim() !== existing.title) {
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

      const newContent = content !== undefined ? content : existing.content;
      const newStatus = status !== undefined ? status : existing.status;
      const newDueDate = dueDate !== undefined ? (dueDate || null) : existing.dueDate;
      const newProjectId = projectRecord !== undefined
        ? (projectRecord ? projectRecord.id : null)
        : (existing.project ? existing.project.id : null);
      const contentText = markdownToPlaintext(newContent);

      // 1. Update note
      await conn.query(
        `UPDATE notes
         SET title = ?, slug = ?, content = ?, content_text = ?, status = ?, due_date = ?, project_id = ?, updated_at = NOW(3)
         WHERE id = ?`,
        [newTitle, newSlug, newContent, contentText, newStatus, newDueDate, newProjectId, id]
      );

      // 2. Snapshot if content or title changed
      const contentChanged = content !== undefined && content !== existing.content;
      const titleChanged = title !== undefined && newTitle !== existing.title;
      if (contentChanged || titleChanged) {
        await conn.query(
          `INSERT INTO note_versions (note_id, title, content) VALUES (?, ?, ?)`,
          [id, newTitle, newContent]
        );
      }

      // 3. Update tags if content or customTags provided
      if (content !== undefined || customTags !== undefined) {
        const extractedTags = extractHashtags(newContent);
        const tagsToSync = Array.from(new Set([
          ...extractedTags,
          ...normalizeCustomTags(customTags)
        ]));

        await conn.query(`DELETE FROM note_tags WHERE note_id = ?`, [id]);

        for (const tagName of tagsToSync) {
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

        // Drop tags that no longer belong to any note
        await conn.query(PRUNE_ORPHAN_TAGS_SQL);
      }

      // 4. Update Wikilinks if content changed
      if (content !== undefined) {
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
      if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
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

      await conn.commit();
      return this.getNoteById(id);
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
  async getNoteById(id) {
    const [notes] = await pool.query(`SELECT * FROM notes WHERE id = ?`, [id]);
    if (!notes.length) return null;
    return this._formatNoteRecord(notes[0]);
  }

  /**
   * Fetch a single note by Slug
   */
  async getNoteBySlug(slug) {
    const [notes] = await pool.query(`SELECT * FROM notes WHERE slug = ?`, [slug]);
    if (!notes.length) return null;
    return this._formatNoteRecord(notes[0]);
  }

  /**
   * Internal helper to populate note details
   */
  async _formatNoteRecord(row) {
    const noteId = row.id;

    // 0. Project
    let project = null;
    if (row.project_id) {
      const [projectRows] = await pool.query(
        `SELECT id, name, slug FROM projects WHERE id = ?`,
        [row.project_id]
      );
      if (projectRows.length) {
        project = { id: projectRows[0].id, name: projectRows[0].name, slug: projectRows[0].slug };
      }
    }

    // 1. Tags
    const [tagRows] = await pool.query(
      `SELECT t.name FROM tags t
       JOIN note_tags nt ON t.id = nt.tag_id
       WHERE nt.note_id = ?
       ORDER BY t.name ASC`,
      [noteId]
    );
    const tags = tagRows.map((t) => t.name);

    // 2. Notion-style Properties
    const [propRows] = await pool.query(
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
    const [outgoingRows] = await pool.query(
      `SELECT nl.target_slug, nl.target_note_id, n.title as target_title
       FROM note_links nl
       LEFT JOIN notes n ON nl.target_note_id = n.id
       WHERE nl.source_note_id = ?`,
      [noteId]
    );

    // 4. Backlinks (Incoming mentions from other notes)
    const [backlinkRows] = await pool.query(
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
    const [attachmentRows] = await pool.query(
      `SELECT id, filename, mime_type, file_size, sha256, storage_path, created_at
       FROM attachments
       WHERE note_id = ?
       ORDER BY created_at DESC`,
      [noteId]
    );

    return {
      id: row.id,
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
      const [res] = await pool.query(`UPDATE notes SET status = 'trash' WHERE id = ?`, [id]);
      return res.affectedRows > 0;
    }
  }

  /**
   * Restore a note from trash
   */
  async restoreNote(id) {
    const [res] = await pool.query(`UPDATE notes SET status = 'active' WHERE id = ?`, [id]);
    return res.affectedRows > 0;
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
    const note = await this.getNoteById(noteId);
    if (!note) {
      const err = new Error(`Note not found: ${noteId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const matches = extractTasks(note.content).filter((t) => t.text === text);
    const target = matches.find((t) => t.line === line) || (matches.length === 1 ? matches[0] : null);
    if (!target) {
      const err = new Error('Task could not be located; the note has changed. Refresh and try again.');
      err.code = 'TASK_CONFLICT';
      throw err;
    }

    if (target.completed === completed) return note;

    const lines = note.content.split('\n');
    lines[target.line - 1] = lines[target.line - 1].replace(/\[[ xX]\]/, completed ? '[x]' : '[ ]');
    return this.updateNote(noteId, { content: lines.join('\n') });
  }

  /**
   * Restore a note's title and content from a saved version. Applied as a normal
   * edit, so the restore itself is snapshotted and can be undone.
   * @returns {Promise<Object|null>} the updated note, or null if the version isn't this note's
   */
  async restoreVersion(noteId, versionId) {
    const [rows] = await pool.query(
      `SELECT title, content FROM note_versions WHERE id = ? AND note_id = ?`,
      [versionId, noteId]
    );
    if (!rows.length) return null;
    return this.updateNote(noteId, { title: rows[0].title, content: rows[0].content });
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
