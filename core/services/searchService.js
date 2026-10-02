import { pool } from '../db/pool.js';
import { toBooleanFulltextQuery } from './parser.js';
import { projectService } from './projectService.js';
import { journalTitleSql, JOURNAL_TITLE_PROPERTY } from './journalTitle.js';

export class SearchService {
  /**
   * Search notes using MySQL FULLTEXT with fallback fuzzy LIKE, plus an exact tag match.
   * @param {string} query
   * @param {Object} options
   */
  async search(query, { status = 'active', project = null, limit = 30 } = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const trimmed = query.trim();
    const booleanQuery = toBooleanFulltextQuery(trimmed);

    if (!booleanQuery) return [];

    let projectId = null;
    if (project) {
      const resolved = await projectService.getBySlugOrId(project);
      if (!resolved) return []; // an unresolvable project has no notes, not "match everything"
      projectId = resolved.id;
    }

    const likePattern = `%${trimmed}%`;
    // A query that is exactly a tag name (e.g. "journal") should surface notes carrying
    // that tag even when the tag text never appears in the title or body — an explicit
    // tag added via customTags need not be typed anywhere in the content.
    const exactTag = trimmed.toLowerCase();
    const projectClause = projectId ? `AND n.project_id = ?` : '';
    const tagExistsSql = `EXISTS (
      SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
      WHERE nt.note_id = n.id AND t.name = ?
    )`;

    // High performance query: combines FULLTEXT relevance score with fallback LIKE match
    // and a tag-match boost.
    const sql = `
      SELECT n.id, n.title, n.slug, n.status, n.due_date, n.updated_at,
             LEFT(n.content_text, 180) as snippet,
             ${journalTitleSql('n')},
             MATCH(n.title, n.content_text) AGAINST(? IN BOOLEAN MODE)
               + IF(${tagExistsSql}, 5, 0) as score
      FROM notes n
      WHERE n.status = ?
        AND (
          MATCH(n.title, n.content_text) AGAINST(? IN BOOLEAN MODE)
          OR n.title LIKE ?
          OR n.content LIKE ?
          OR EXISTS (SELECT 1 FROM note_properties jp WHERE jp.note_id = n.id
                     AND jp.property_name = '${JOURNAL_TITLE_PROPERTY}' AND jp.property_value LIKE ?)
          OR ${tagExistsSql}
        )
        ${projectClause}
      ORDER BY score DESC, n.updated_at DESC
      LIMIT ?
    `;

    const params = [booleanQuery, exactTag, status, booleanQuery, likePattern, likePattern, likePattern, exactTag];
    if (projectId) params.push(projectId);
    params.push(Number(limit));

    const [rows] = await pool.query(sql, params);

    // Batch load tags
    const noteIds = rows.map((r) => r.id);
    let tagsMap = {};
    if (noteIds.length) {
      const [tagRows] = await pool.query(
        `SELECT nt.note_id, t.name
         FROM note_tags nt
         JOIN tags t ON nt.tag_id = t.id
         WHERE nt.note_id IN (?)
         ORDER BY t.name ASC`,
        [noteIds]
      );
      for (const t of tagRows) {
        if (!tagsMap[t.note_id]) tagsMap[t.note_id] = [];
        tagsMap[t.note_id].push(t.name);
      }
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      status: r.status,
      dueDate: r.due_date,
      snippet: r.snippet || '',
      score: Number(r.score || 0),
      updatedAt: r.updated_at,
      tags: tagsMap[r.id] || [],
      journalTitle: r.journal_title || null
    }));
  }
}

export const searchService = new SearchService();
export default searchService;
