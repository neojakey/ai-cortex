// Small per-browser preferences. localStorage can throw (private mode, blocked site data),
// so every access is guarded and falls back to the default.
export const THUMB_SIZES = ['small', 'medium', 'large'];
const THUMB_KEY = 'ai_cortex_thumb_default';

export function getDefaultThumbSize() {
  try {
    const v = localStorage.getItem(THUMB_KEY);
    return THUMB_SIZES.includes(v) ? v : 'medium';
  } catch {
    return 'medium';
  }
}

export function setDefaultThumbSize(size) {
  try { localStorage.setItem(THUMB_KEY, size); } catch { /* ignore */ }
}
