import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { slugify } from './parser.js';

export class ProjectService {
  /**
   * List all projects with their active note count
   */
  async listProjects() {
    const [rows] = await pool.query(`
      SELECT p.id, p.name, p.slug, p.color, p.created_at,
             COUNT(n.id) as note_count
      FROM projects p
      LEFT JOIN notes n ON n.project_id = p.id AND n.status = 'active'
      GROUP BY p.id, p.name, p.slug, p.color, p.created_at
      HAVING note_count > 0
      ORDER BY p.name ASC
    `);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      color: r.color,
      createdAt: r.created_at,
      noteCount: Number(r.note_count)
    }));
  }

  /**
   * Look up a project by its slug or ID
   */
  async getBySlugOrId(idOrSlug) {
    if (!idOrSlug) return null;
    const [rows] = await pool.query(
      `SELECT id, name, slug, color, created_at FROM projects WHERE id = ? OR slug = ?`,
      [idOrSlug, idOrSlug]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, name: r.name, slug: r.slug, color: r.color, createdAt: r.created_at };
  }

  /**
   * Get a project by name, creating it if it doesn't already exist.
   * Used by both the REST API and MCP tools so callers can pass a plain
   * project name without a separate "create project" step.
   */
  async getOrCreateByName(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return null;

    const [existing] = await pool.query(`SELECT id, name, slug, color FROM projects WHERE name = ?`, [trimmed]);
    if (existing.length) {
      const r = existing[0];
      return { id: r.id, name: r.name, slug: r.slug, color: r.color };
    }

    const id = crypto.randomUUID();
    let baseSlug = slugify(trimmed) || 'project';
    let slug = baseSlug;
    let counter = 1;
    while (true) {
      const [slugMatches] = await pool.query(`SELECT id FROM projects WHERE slug = ?`, [slug]);
      if (!slugMatches.length) break;
      slug = `${baseSlug}-${counter++}`;
    }

    await pool.query(
      `INSERT IGNORE INTO projects (id, name, slug) VALUES (?, ?, ?)`,
      [id, trimmed, slug]
    );

    // Another concurrent request may have won the race on the unique `name` constraint.
    const [rows] = await pool.query(`SELECT id, name, slug, color FROM projects WHERE name = ?`, [trimmed]);
    const r = rows[0];
    return { id: r.id, name: r.name, slug: r.slug, color: r.color };
  }

  /**
   * Delete a project. Notes are unlinked (project_id set NULL via FK), not deleted.
   */
  async deleteProject(idOrSlug) {
    const project = await this.getBySlugOrId(idOrSlug);
    if (!project) return false;
    const [res] = await pool.query(`DELETE FROM projects WHERE id = ?`, [project.id]);
    return res.affectedRows > 0;
  }
}

export const projectService = new ProjectService();
export default projectService;
