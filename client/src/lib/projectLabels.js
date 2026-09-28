// Project labels in daily notes: a bullet that starts with a project name and a colon
// ("bolsahotelera: fixed AUD-02") shows the name as a tag. Kept free of the DOM so the
// matching rule can be unit tested; renderMarkdown.js applies it to the rendered bullets.

/** "AI-Cortex", "ai cortex" and "AICortex" all compare equal: case, spaces and punctuation are ignored. */
export function normalizeProjectName(name) {
  return String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** The set of normalized names to match against, from the Projects list. */
export function projectKeys(names) {
  return new Set((names || []).map(normalizeProjectName).filter(Boolean));
}

// A label is everything before the first colon, on one line, of a reasonable length.
const LEADING_LABEL = /^(\s*)([^:\n]{1,60}):/;

/**
 * Split a bullet's opening text into the parts around a project label, or return null
 * when it doesn't start with one.
 * @param {string} text the bullet's first run of plain text
 * @param {Set<string>} keys from projectKeys()
 * @returns {{before: string, label: string, after: string} | null}
 *   before + label + after === text; `after` starts with the colon (or spaces before it)
 */
export function splitProjectLabel(text, keys) {
  if (!keys || keys.size === 0) return null;
  const match = LEADING_LABEL.exec(String(text || ''));
  if (!match) return null;
  const raw = match[2];
  const label = raw.trimEnd();
  if (!label || !keys.has(normalizeProjectName(label))) return null;
  const before = match[1];
  return { before, label, after: text.slice(before.length + label.length) };
}
