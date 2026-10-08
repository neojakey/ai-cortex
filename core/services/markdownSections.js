// Read and add to one section of a markdown note, addressed by its heading path, e.g.
// ["## Worked on with Claude", "### BolsaHotelera"]. Notes stay plain markdown; this lets an
// AI add a line under a heading (or read one section) without sending the whole note.
//
// A section runs from its heading to the next heading of the same or a higher level.
// Headings inside fenced code blocks don't count. Headings match on level plus text,
// ignoring case and extra spaces; the first match inside the parent section wins.

export class SectionPathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SectionPathError';
    this.code = 'INVALID_ARGUMENT';
  }
}

const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^\s*(```|~~~)/;
// A line made only of hashtags, like the journal's closing "#daily". Not a heading:
// a heading needs a space after its #s.
const TAG_ONLY = /^\s*(#[^\s#]\S*\s*)+$/;

const normalise = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** "### BolsaHotelera" -> { level: 3, text: 'BolsaHotelera' } */
export function parsePathItem(item) {
  const m = HEADING.exec(String(item ?? '').trim());
  if (!m || !m[2].trim()) {
    throw new SectionPathError(`Each section must be a markdown heading such as "## Worked on with Claude", got ${JSON.stringify(item)}`);
  }
  return { level: m[1].length, text: m[2].trim() };
}

function parsePath(path) {
  if (!Array.isArray(path) || path.length === 0) {
    throw new SectionPathError('section must be a non-empty list of headings, e.g. ["## Worked on with Claude", "### BolsaHotelera"]');
  }
  const items = path.map(parsePathItem);
  items.forEach((item, i) => {
    if (i > 0 && item.level <= items[i - 1].level) {
      throw new SectionPathError(`"${path[i]}" must be a deeper heading than "${path[i - 1]}"`);
    }
  });
  return items;
}

/** Every heading outside code blocks: { line, level, text }. */
function headingsOf(lines) {
  const found = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const m = HEADING.exec(line);
    if (m && m[2].trim()) found.push({ line: i, level: m[1].length, text: m[2].trim() });
  });
  return found;
}

/**
 * Walk the path. Returns the resolved sections ({ heading, start, end }: lines start..end-1
 * are the section's body, after its heading line) and, if the walk stopped early, where.
 */
function resolve(lines, items) {
  const headings = headingsOf(lines);
  const resolved = [];
  let from = 0;
  let to = lines.length;
  for (const item of items) {
    const heading = headings.find((h) => h.line >= from && h.line < to && h.level === item.level && normalise(h.text) === normalise(item.text));
    if (!heading) break;
    const next = headings.find((h) => h.line > heading.line && h.line < to && h.level <= heading.level);
    const end = next ? next.line : to;
    resolved.push({ heading, start: heading.line + 1, end });
    from = heading.line + 1;
    to = end;
  }
  return { resolved, headings, parentEnd: to };
}

/** Index just after the last line in [start, end) that isn't blank or tags only; `start` if none. */
function afterLastContent(lines, start, end) {
  for (let i = end - 1; i >= start; i -= 1) {
    if (lines[i].trim() && !TAG_ONLY.test(lines[i])) return i + 1;
  }
  return start;
}

function splitContent(content) {
  const text = String(content ?? '').replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '');
  if (!text.trim()) throw new SectionPathError('content is empty');
  return text.split('\n');
}

/**
 * Add `content` to the section at `path`, creating any missing headings. The text goes at
 * the end of the section's own text: before its first subheading, and above any closing
 * tag-only lines. Returns the new markdown plus where the text went (1-based line).
 */
export function insertIntoSection(markdown, path, content) {
  const items = parsePath(path);
  const newLines = splitContent(content);
  const original = String(markdown ?? '').replace(/\r\n/g, '\n');
  // Keep the note's own ending: no final line break is added if it had none.
  const endsWithBreak = original === '' || original.endsWith('\n');
  const lines = original.split('\n');
  if (lines.length && lines[lines.length - 1] === '' && lines.length > 1) lines.pop();
  const { resolved, headings, parentEnd } = resolve(lines, items);
  const missing = items.slice(resolved.length);
  let block;
  let at;
  let contentOffset; // where newLines starts inside block

  if (missing.length === 0) {
    const target = resolved[resolved.length - 1];
    const firstChild = headings.find((h) => h.line >= target.start && h.line < target.end);
    const ownEnd = firstChild ? firstChild.line : target.end;
    at = afterLastContent(lines, target.start, ownEnd);
    // Only the new lines: the note's own spacing is left exactly as it was.
    block = [...newLines];
    contentOffset = 0;
  } else {
    // Create the missing headings at the end of the deepest section found (after its
    // subsections), or at the end of the note if none was found.
    const parent = resolved[resolved.length - 1];
    const start = parent ? parent.start : 0;
    at = afterLastContent(lines, start, parentEnd);
    block = [];
    missing.forEach((item, i) => {
      if (i === 0 && at > 0 && lines[at - 1].trim()) block.push('');
      block.push(`${'#'.repeat(item.level)} ${item.text}`);
    });
    contentOffset = block.length;
    block.push(...newLines);
    const next = lines[at];
    if (next !== undefined && next.trim()) block.push('');
  }

  lines.splice(at, 0, ...block);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return {
    markdown: endsWithBreak ? `${lines.join('\n')}\n` : lines.join('\n'),
    line: at + contentOffset + 1,
    created: missing.map((m) => `${'#'.repeat(m.level)} ${m.text}`)
  };
}

/** The section at `path` (its heading line, body and subsections), or null if it isn't there. */
export function readSection(markdown, path) {
  const items = parsePath(path);
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const { resolved } = resolve(lines, items);
  if (resolved.length < items.length) return null;
  const target = resolved[resolved.length - 1];
  // Closing tag-only lines (the journal's "#daily") belong to the note, not this section.
  const end = afterLastContent(lines, target.start, target.end);
  return lines.slice(target.heading.line, Math.max(end, target.heading.line + 1)).join('\n');
}

/** The note's headings in order, e.g. ["## Worked on with Claude", "### BolsaHotelera"]. */
export function outlineOf(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  return headingsOf(lines).map((h) => `${'#'.repeat(h.level)} ${h.text}`);
}
