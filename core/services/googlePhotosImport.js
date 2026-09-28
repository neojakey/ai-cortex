// Fetch the photo behind a Google Photos share link, without a Google login.
//
// A share link (photos.app.goo.gl/… → photos.google.com/share/…?key=…) opens a public page
// whose og:image tag points at the photo on lh3.googleusercontent.com; swapping that URL's
// size suffix asks Google to resize it for us (a 3.3 MB phone original comes back ~250 KB). None of this is an official API, so every
// step that depends on Google's page layout fails with a clear error instead of guessing.
//
// The server fetches a URL the user pasted, so every hop is pinned to Google's own hosts:
// nothing here can be steered at another machine.

const SHARE_HOSTS = new Set(['photos.app.goo.gl', 'photos.google.com']);
const IMAGE_HOST = 'lh3.googleusercontent.com';
const MAX_REDIRECTS = 3;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20000;
// Fit within 2048px on the longest side, aspect ratio kept ("=d" would be the full original).
const SIZE_SUFFIX = '=w2048-h2048';

// Same set the app renders inline (see INLINE_PREVIEW_TYPES in server.js).
const IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const PHOTO_URL_PATTERN = /https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]+/g;

export class GooglePhotosImportError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GooglePhotosImportError';
    this.status = status;
  }
}

function parseUrl(value) {
  try {
    return new URL(String(value).trim());
  } catch {
    return null;
  }
}

/**
 * Classify a pasted link. Returns 'share' for a link this importer can follow,
 * 'private' for a signed-in library address, or null for anything else.
 */
export function classifyGooglePhotosUrl(value) {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (url.hostname === 'photos.app.goo.gl' && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return 'share';
  if (url.hostname === 'photos.google.com') {
    if (/^\/share\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) && url.searchParams.get('key')) return 'share';
    if (/^\/(u\/\d+\/)?photo\//.test(url.pathname)) return 'private';
  }
  return null;
}

// Read a response body, aborting as soon as it passes maxBytes.
async function readCapped(res, maxBytes, tooLarge) {
  const declared = Number(res.headers.get('content-length'));
  if (declared && declared > maxBytes) throw tooLarge();

  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

async function fetchSharePage(startUrl, fetchImpl, signal) {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = parseUrl(current);
    if (!url || url.protocol !== 'https:' || !SHARE_HOSTS.has(url.hostname)) {
      throw new GooglePhotosImportError(502, 'Unexpected redirect away from Google Photos');
    }

    const res = await fetchImpl(url.href, { redirect: 'manual', signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new GooglePhotosImportError(502, 'Unexpected redirect away from Google Photos');
      current = new URL(location, url).href;
      continue;
    }
    if (!res.ok) {
      throw new GooglePhotosImportError(502, "That link isn't accessible. Is it still shared?");
    }
    const body = await readCapped(res, MAX_PAGE_BYTES, () =>
      new GooglePhotosImportError(502, "Couldn't find the photo on that page (Google may have changed it)"));
    return body.toString('utf8');
  }
  throw new GooglePhotosImportError(502, 'Too many redirects from Google Photos');
}

/**
 * Find the single photo on a share page. Returns its base URL (no size suffix).
 */
export function extractPhotoUrl(html) {
  const og = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html);
  const ogUrl = og ? parseUrl(og[1].replace(/&amp;/g, '&')) : null;
  if (!ogUrl || ogUrl.protocol !== 'https:' || ogUrl.hostname !== IMAGE_HOST) {
    throw new GooglePhotosImportError(502, "Couldn't find the photo on that page (Google may have changed it)");
  }
  const ogBase = (ogUrl.origin + ogUrl.pathname).split('=')[0];

  // Google treats a shared photo as an album of one; a real album lists several.
  const photos = new Set(html.match(PHOTO_URL_PATTERN) || []);
  if (photos.size > 1) {
    throw new GooglePhotosImportError(422, `This link has ${photos.size} photos. Share a single photo instead.`);
  }
  if (photos.size === 0 || !photos.has(ogBase)) {
    throw new GooglePhotosImportError(502, "Couldn't find the photo on that page (Google may have changed it)");
  }
  return ogBase;
}

/**
 * Download the photo behind a Google Photos share link, resized to fit within 2048px.
 * @param {string} shareUrl
 * @param {Object} [options]
 * @param {Function} [options.fetch] fetch implementation (tests pass a fake)
 * @param {number} options.maxBytes size cap for the photo
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{buffer: Buffer, mimeType: string, ext: string}>}
 */
export async function importGooglePhoto(shareUrl, { fetch: fetchImpl = globalThis.fetch, maxBytes, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const kind = classifyGooglePhotosUrl(shareUrl);
  if (kind === 'private') {
    throw new GooglePhotosImportError(400, "That's a private link. Use Share → Create link in Google Photos.");
  }
  if (kind !== 'share') {
    throw new GooglePhotosImportError(400, 'Not a Google Photos share link');
  }

  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const html = await fetchSharePage(String(shareUrl).trim(), fetchImpl, signal);
    const photoBase = extractPhotoUrl(html);

    const res = await fetchImpl(`${photoBase}${SIZE_SUFFIX}`, { redirect: 'error', signal });
    if (!res.ok) {
      throw new GooglePhotosImportError(502, "That link isn't accessible. Is it still shared?");
    }
    const mimeType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = IMAGE_TYPES[mimeType];
    if (!ext) {
      res.body?.cancel().catch(() => {}); // don't download a body we're refusing
      throw new GooglePhotosImportError(415, `Unsupported photo type (${mimeType || 'unknown'})`);
    }
    const buffer = await readCapped(res, maxBytes, () =>
      new GooglePhotosImportError(413, `Photo is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`));
    return { buffer, mimeType, ext };
  } catch (err) {
    if (err instanceof GooglePhotosImportError) throw err;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new GooglePhotosImportError(504, 'Google Photos took too long to respond');
    }
    throw new GooglePhotosImportError(502, "That link isn't accessible. Is it still shared?");
  }
}
