// Which tags the sidebar's Hashtags list shows by default. With a couple of hundred tags,
// most used by a single note, the list buried the useful ones, so it shows tags used by at
// least two notes and hides the system tags every journal entry carries; "Show N more"
// reveals the rest. The server's order (most used first) is kept.

const SYSTEM_TAGS = new Set(['journal', 'daily', 'dayone']);

/** journal, daily, dayone and the YYYY-MM month tags: bookkeeping, not topics. */
export function isSystemTag(name) {
  return SYSTEM_TAGS.has(name) || /^\d{4}-\d{2}$/.test(name);
}

/**
 * @param {Array<{name: string, count: number}>} tags
 * @param {{showAll?: boolean, activeKey?: string|null, minCount?: number}} [options]
 * @returns {{visible: Array, hiddenCount: number}} the selected tag is always visible
 */
export function splitTagList(tags, { showAll = false, activeKey = null, minCount = 2 } = {}) {
  const all = Array.isArray(tags) ? tags : [];
  if (showAll) return { visible: all, hiddenCount: 0 };
  const visible = all.filter((t) => t.name === activeKey || (t.count >= minCount && !isSystemTag(t.name)));
  return { visible, hiddenCount: all.length - visible.length };
}
