import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: false });

// Mirrors core/services/parser.js's extractWikilinks regex, but rewrites
// [[Target]] / [[Target|Alias]] into a plain markdown link so `marked`
// renders it as a normal <a>, distinguished by a `wikilink:` URL scheme.
function wikilinksToMarkdownLinks(content) {
  return content.replace(/(^|[^\\])\[\[([^\]\n]+)\]\]/g, (match, prefix, rawTarget) => {
    const trimmed = rawTarget.trim();
    if (!trimmed) return match;

    let target = trimmed;
    let alias = trimmed;
    if (trimmed.includes('|')) {
      const parts = trimmed.split('|');
      target = parts[0].trim();
      alias = parts.slice(1).join('|').trim() || target;
    }

    return `${prefix}[${alias}](wikilink:${encodeURIComponent(target)})`;
  });
}

/**
 * Renders note markdown to sanitized HTML for read-mode display.
 * External links open in a new tab; wikilinks are left for the caller
 * to intercept (href starts with "wikilink:"); checkboxes are disabled
 * (read-only display, not an editable task list).
 */
export function renderNoteMarkdown(content) {
  if (!content || !content.trim()) return '';

  const withLinks = wikilinksToMarkdownLinks(content);
  const rawHtml = marked.parse(withLinks);
  // DOMPurify strips href values with schemes it doesn't recognize; extend its
  // default allow-list with our synthetic `wikilink:` scheme so the anchors survive.
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|wikilink):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
  });

  const container = document.createElement('div');
  container.innerHTML = cleanHtml;

  container.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('wikilink:')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  // marked doesn't mark up task-list <li>s with a class, so it's done here —
  // used by CSS to drop the bullet in favor of the checkbox.
  container.querySelectorAll('li').forEach((li) => {
    const checkbox = li.querySelector(':scope > input[type="checkbox"]');
    if (!checkbox) return;
    li.classList.add('task-list-item');
    checkbox.disabled = true;
  });

  return container.innerHTML;
}

export const WIKILINK_PREFIX = 'wikilink:';
