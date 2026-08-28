import { pool } from '../db/pool.js';
import { toBooleanFulltextQuery } from './parser.js';

export class SearchService {
  /**
   * Search notes using MySQL FULLTEXT with fallback fuzzy LIKE
   * @param {string} query
   * @param {Object} options
   */
  async search(query, { status = 'active', limit = 30 } = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const trimmed = query.trim();
    const booleanQuery = toBooleanFulltextQuery(trimmed);

    if (!booleanQuery) return [];

    const likePattern = `%${trimmed}%`;

    // High performance query: combines FULLTEXT relevance score with fallback LIKE match
    const sql = `
      SELECT n.id, n.title, n.slug, n.status, n.due_date, n.updated_at,
             LEFT(n.content_text, 180) as snippet,
             MATCH(n.title, n.content_text) AGAINST(? IN BOOLEAN MODE) as score
      FROM notes n
      WHERE n.status = ?
        AND (
          MATCH(n.title, n.content_text) AGAINST(? IN BOOLEAN MODE)
          OR n.title LIKE ?
          OR n.content LIKE ?
        )
      ORDER BY score DESC, n.updated_at DESC
      LIMIT ?
    `;

    const [rows] = await pool.query(sql, [
      booleanQuery,
      status,
      booleanQuery,
      likePattern,
      likePattern,
      Number(limit)
    ]);

    // Batch load tags
    const noteIds = rows.map((r) => r.id);
    let tagsMap = {};
    if (noteIds.length) {
      const [tagRows] = await pool.query(
        `SELECT nt.note_id, t.name
         FROM note_tags nt
         JOIN tags t ON nt.tag_id = t.id
         WHERE nt.note_id IN (?)`,
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
      tags: tagsMap[r.id] || []
    }));
  }
}

export const searchService = new SearchService();
export default searchService;
