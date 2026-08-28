/**
 * Wikilink, hashtag, task, and plaintext parsing utilities
 */

/**
 * Generate a clean, URL-safe and search-friendly slug from title
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9\s-_]/g, '')   // remove non-alphanumeric except space/hyphen/underscore
    .replace(/[\s_]+/g, '-')        // collapse whitespace & underscore to single dash
    .replace(/^-+|-+$/g, '');       // trim dashes
}

/**
 * Extract all [[Target Note]] and [[Target Note|Alias]] links
 * @param {string} content
 * @returns {Array<{ raw: string, targetTitle: string, targetSlug: string, alias?: string }>}
 */
export function extractWikilinks(content) {
  if (!content || typeof content !== 'string') return [];

  // Match [[...]] but not escaped \[[...]]
  const regex = /(?:^|[^\\])\[\[([^\]\n]+)\]\]/g;
  const links = [];
  const seen = new Set();

  let match;
  while ((match = regex.exec(content)) !== null) {
    const rawTarget = match[1].trim();
    if (!rawTarget) continue;

    let targetTitle = rawTarget;
    let alias = undefined;

    if (rawTarget.includes('|')) {
      const parts = rawTarget.split('|');
      targetTitle = parts[0].trim();
      alias = parts.slice(1).join('|').trim();
    }

    const targetSlug = slugify(targetTitle);
    if (!targetSlug || seen.has(targetSlug)) continue;

    seen.add(targetSlug);
    links.push({
      raw: match[0].trim(),
      targetTitle,
      targetSlug,
      alias
    });
  }

  return links;
}

/**
 * Extract #tags from content (ignoring markdown headings like # Heading)
 * @param {string} content
 * @returns {string[]}
 */
export function extractHashtags(content) {
  if (!content || typeof content !== 'string') return [];

  // Match #tag where # is preceded by whitespace or start of line, but NOT followed by space (headings)
  const regex = /(?:^|\s)#([a-zA-Z0-9_\-\/]+)/g;
  const tags = new Set();

  let match;
  while ((match = regex.exec(content)) !== null) {
    const tag = match[1].trim().toLowerCase();
    // Exclude if it's just numbers (like #1, #2) or too short
    if (tag && !/^\d+$/.test(tag)) {
      tags.add(tag);
    }
  }

  return Array.from(tags);
}

/**
 * Extract markdown tasks: - [ ] Task description or - [x] Done
 * @param {string} content
 * @returns {Array<{ raw: string, text: string, completed: boolean, line: number }>}
 */
export function extractTasks(content) {
  if (!content || typeof content !== 'string') return [];

  const lines = content.split('\n');
  const tasks = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*[-*]\s+\[([ xX])\]\s+)(.+)$/);
    if (match) {
      const completed = match[2].toLowerCase() === 'x';
      const text = match[3].trim();
      tasks.push({
        raw: line,
        text,
        completed,
        line: i + 1
      });
    }
  }

  return tasks;
}

/**
 * Turn a free-text query into a safe MySQL FULLTEXT BOOLEAN MODE expression.
 * Strips boolean operators so arbitrary user input can't trigger a syntax error.
 * @param {string} query
 * @returns {string} e.g. "+foo* +bar*" (empty string if nothing usable)
 */
export function toBooleanFulltextQuery(query) {
  if (!query || typeof query !== 'string') return '';
  const cleanWords = query
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[+\-><()~*"@]+/g, ''))
    .filter(Boolean);
  return cleanWords.map((w) => `+${w}*`).join(' ');
}

/**
 * Convert Markdown text to clean plaintext for MySQL FULLTEXT indexing
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToPlaintext(markdown) {
  if (!markdown || typeof markdown !== 'string') return '';

  return markdown
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, ' ')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove images: ![alt](url) -> alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1 ')
    // Remove links: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1 ')
    // Wikilinks: [[Note|Alias]] -> Alias or Note
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target)
    // Remove headers: #, ##, etc.
    .replace(/^#{1,6}\s+/gm, '')
    // Remove blockquotes: >
    .replace(/^>\s+/gm, '')
    // Remove bold/italic: **bold**, *italic*, __bold__, _italic_
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Remove horizontal rules
    .replace(/^([-*_]){3,}\s*$/gm, ' ')
    // Remove task markers
    .replace(/^[-*]\s+\[[ xX]\]\s+/gm, '')
    // Replace multiple newlines & spaces with a single space
    .replace(/\s+/g, ' ')
    .trim();
}
