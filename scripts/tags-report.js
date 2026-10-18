#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { pool } from '../core/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

export async function generateTagsReport(db = pool) {
  const [tagRows] = await db.query(`
    SELECT 
      t.id, 
      t.name, 
      COUNT(nt.note_id) AS note_count,
      SUM(CASE WHEN nt.from_hashtag = 1 THEN 1 ELSE 0 END) AS hashtag_count,
      SUM(CASE WHEN nt.from_explicit = 1 THEN 1 ELSE 0 END) AS explicit_count
    FROM tags t
    LEFT JOIN note_tags nt ON t.id = nt.tag_id
    GROUP BY t.id, t.name
    ORDER BY note_count DESC, t.name ASC
  `);

  const [projectRows] = await db.query(`
    SELECT id, name, slug FROM projects
  `);

  const SYSTEM_TAGS = new Set(['daily', 'journal', 'dayone']);
  const isYearMonth = /^\d{4}-\d{2}$/;
  const MIN_TYPO_LEN = 5;

  const analyzed = [];
  let systemCount = 0;
  let typoCount = 0;
  let accidentCount = 0;

  for (const t of tagRows) {
    const name = t.name;
    const noteCount = Number(t.note_count);
    const hashtagCount = Number(t.hashtag_count || 0);
    const explicitCount = Number(t.explicit_count || 0);
    const flags = [];

    // 1. System tag check (never to be touched)
    const isSystem = SYSTEM_TAGS.has(name.toLowerCase()) || isYearMonth.test(name);
    if (isSystem) {
      flags.push('SYSTEM');
      systemCount++;
    } else {
      // 2. Probable accident check
      if (name.length <= 2) {
        flags.push('ACCIDENT: short (<=2 chars)');
        accidentCount++;
      } else if (/^\d+$/.test(name)) {
        flags.push('ACCIDENT: numeric-only');
        accidentCount++;
      } else if (/^[0-9a-fA-F]{6,}$/.test(name)) {
        flags.push('ACCIDENT: hex-like');
        accidentCount++;
      }

      // 3. Probable typo check
      // Requirements: minimum length 5, and edit distance relative to length <= 0.25 (capped at max 2 edits)
      if (name.length >= MIN_TYPO_LEN) {
        const lower = name.toLowerCase();

        // Check against projects
        for (const p of projectRows) {
          const pLower = p.name.toLowerCase();
          if (lower === pLower) continue;
          const dist = levenshtein(lower, pLower);
          if (dist > 0 && dist <= 2 && (dist / name.length) <= 0.25) {
            flags.push(`TYPO: close to project '${p.name}' (distance ${dist})`);
            typoCount++;
            break;
          }
        }

        // Check against more frequently used tags
        for (const other of tagRows) {
          const otherCount = Number(other.note_count);
          if (otherCount <= noteCount) continue;
          const otherLower = other.name.toLowerCase();
          if (lower === otherLower) continue;
          const dist = levenshtein(lower, otherLower);
          if (dist > 0 && dist <= 2 && (dist / name.length) <= 0.25) {
            flags.push(`TYPO: close to tag '#${other.name}' (${otherCount} notes, distance ${dist})`);
            typoCount++;
            break;
          }
        }
      }
    }

    analyzed.push({
      name,
      noteCount,
      hashtagCount,
      explicitCount,
      flags
    });
  }

  const lines = [];
  lines.push('================================================================');
  lines.push('                      AI-CORTEX TAGS REPORT                     ');
  lines.push('================================================================');
  lines.push(`Total Tags Analyzed:    ${analyzed.length}`);
  lines.push(`System Tags:            ${systemCount}`);
  lines.push(`Probable Typos:         ${typoCount}`);
  lines.push(`Probable Accidents:     ${accidentCount}`);
  lines.push('----------------------------------------------------------------');
  lines.push('TAG BREAKDOWN:');
  lines.push('Format: #tag (count | text #hashtag: X, explicit: Y) [FLAGS]');
  lines.push('----------------------------------------------------------------');

  for (const item of analyzed) {
    const flagStr = item.flags.length ? ` [${item.flags.join(' | ')}]` : '';
    lines.push(
      `#${item.name.padEnd(28)} (${String(item.noteCount).padStart(3)} notes | hashtag: ${String(item.hashtagCount).padStart(3)}, explicit: ${String(item.explicitCount).padStart(3)})${flagStr}`
    );
  }

  lines.push('================================================================');
  return lines.join('\n');
}

// When run directly from CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const reportText = await generateTagsReport();
    console.log(reportText);
  } catch (err) {
    console.error('Error generating tags report:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}
