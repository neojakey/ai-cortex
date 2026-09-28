import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGooglePhotosUrl,
  extractPhotoUrl,
  importGooglePhoto,
  GooglePhotosImportError
} from '../../core/services/googlePhotosImport.js';

const SHORT = 'https://photos.app.goo.gl/RwiUGGaB1PkDFVHD8';
const SHARE = 'https://photos.google.com/share/AF1QipOi2g4RvK8r4c1g?key=elk4c2pXSU5Z';
const PHOTO = 'https://lh3.googleusercontent.com/pw/AP1GczMqaMYOKZ2Hvt';
const OTHER_PHOTO = 'https://lh3.googleusercontent.com/pw/AP1GczOtherPhoto99';
const MB = 1024 * 1024;

function sharePage({ og = `${PHOTO}=w600-h315-p-k`, extra = [] } = {}) {
  const body = [PHOTO, ...extra].map((u) => `<img src="${u}=w100">`).join('');
  return `<html><head>${og === null ? '' : `<meta property="og:image" content="${og}">`}</head><body>${body}</body></html>`;
}

// A fake fetch keyed by URL. Each value is a Response (served once) or a function returning one.
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const route = routes[url];
    if (!route) throw new Error(`Unexpected fetch: ${url}`);
    return typeof route === 'function' ? route(options) : route;
  };
  impl.calls = calls;
  return impl;
}

const redirect = (location) => new Response(null, { status: 302, headers: { location } });
const html = (text) => new Response(text, { status: 200, headers: { 'content-type': 'text/html' } });
const image = (bytes, type = 'image/jpeg') => new Response(bytes, { status: 200, headers: { 'content-type': type } });

function happyRoutes(overrides = {}) {
  return {
    [SHORT]: redirect(SHARE),
    [SHARE]: html(sharePage()),
    [`${PHOTO}=w2048-h2048`]: image(Buffer.from('jpeg-bytes')),
    ...overrides
  };
}

async function rejectsWith(promise, status, messagePattern) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof GooglePhotosImportError, `expected GooglePhotosImportError, got ${err}`);
    assert.equal(err.status, status);
    if (messagePattern) assert.match(err.message, messagePattern);
    return true;
  });
}

test('classify: short and full share links are importable', () => {
  assert.equal(classifyGooglePhotosUrl(SHORT), 'share');
  assert.equal(classifyGooglePhotosUrl(`  ${SHORT}\n`), 'share');
  assert.equal(classifyGooglePhotosUrl(SHARE), 'share');
});

test('classify: signed-in library links are reported as private', () => {
  assert.equal(classifyGooglePhotosUrl('https://photos.google.com/u/0/photo/AF1QipM8Vg5M'), 'private');
  assert.equal(classifyGooglePhotosUrl('https://photos.google.com/photo/AF1QipM8Vg5M'), 'private');
});

test('classify: anything else is rejected', () => {
  for (const url of [
    'http://photos.app.goo.gl/RwiUGGaB1PkDFVHD8',
    'https://evil.example/photos.app.goo.gl/x',
    'https://photos.app.goo.gl.evil.example/x',
    'https://user@photos.app.goo.gl/RwiUGGaB1PkDFVHD8',
    'https://photos.app.goo.gl:8443/RwiUGGaB1PkDFVHD8',
    'https://photos.google.com/share/AF1QipOi2g4RvK8r4c1g',
    'https://photos.google.com/albums',
    'not a url',
    ''
  ]) {
    assert.equal(classifyGooglePhotosUrl(url), null, url);
  }
});

test('import: follows the share link and downloads the photo resized to 2048px', async () => {
  const fetch = fakeFetch(happyRoutes());
  const result = await importGooglePhoto(SHORT, { fetch, maxBytes: MB });
  assert.equal(result.buffer.toString(), 'jpeg-bytes');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.ext, '.jpg');
  assert.deepEqual(fetch.calls.map((c) => c.url), [SHORT, SHARE, `${PHOTO}=w2048-h2048`]);
  assert.equal(fetch.calls[0].options.redirect, 'manual');
});

test('import: private link is refused before any fetch', async () => {
  const fetch = fakeFetch({});
  await rejectsWith(importGooglePhoto('https://photos.google.com/u/0/photo/AF1QipM8', { fetch, maxBytes: MB }), 400, /private link/);
  assert.equal(fetch.calls.length, 0);
});

test('import: non-Google link is refused before any fetch', async () => {
  const fetch = fakeFetch({});
  await rejectsWith(importGooglePhoto('https://example.com/a.jpg', { fetch, maxBytes: MB }), 400);
  assert.equal(fetch.calls.length, 0);
});

test('import: a redirect to a non-Google host is refused without following it', async () => {
  const fetch = fakeFetch(happyRoutes({ [SHORT]: redirect('https://169.254.169.254/latest/meta-data') }));
  await rejectsWith(importGooglePhoto(SHORT, { fetch, maxBytes: MB }), 502, /redirect/i);
  assert.equal(fetch.calls.length, 1);
});

test('import: a redirect downgrading to http is refused', async () => {
  const fetch = fakeFetch(happyRoutes({ [SHORT]: redirect(SHARE.replace('https:', 'http:')) }));
  await rejectsWith(importGooglePhoto(SHORT, { fetch, maxBytes: MB }), 502, /redirect/i);
});

test('import: more than 3 redirects is refused', async () => {
  const hop = (n) => `https://photos.google.com/share/hop${n}?key=k`;
  const fetch = fakeFetch({
    [SHORT]: redirect(hop(1)),
    [hop(1)]: redirect(hop(2)),
    [hop(2)]: redirect(hop(3)),
    [hop(3)]: redirect(hop(4)),
    [hop(4)]: html(sharePage())
  });
  await rejectsWith(importGooglePhoto(SHORT, { fetch, maxBytes: MB }), 502, /redirect/i);
});

test('import: a revoked link (404 from Google) reports the link is not accessible', async () => {
  const fetch = fakeFetch(happyRoutes({ [SHARE]: new Response('gone', { status: 404 }) }));
  await rejectsWith(importGooglePhoto(SHORT, { fetch, maxBytes: MB }), 502, /accessible/);
});

test('extract: a page with no og:image fails clearly', () => {
  assert.throws(() => extractPhotoUrl(sharePage({ og: null })), (err) => err.status === 502 && /changed/.test(err.message));
});

test('extract: og:image on a non-Google host is refused', () => {
  assert.throws(() => extractPhotoUrl(sharePage({ og: 'https://evil.example/pw/AP1GczMqaMYOKZ2Hvt=w600' })), (err) => err.status === 502);
});

test('extract: a page listing more than one photo (an album) is refused', () => {
  assert.throws(
    () => extractPhotoUrl(sharePage({ extra: [OTHER_PHOTO] })),
    (err) => err.status === 422 && /2 photos/.test(err.message)
  );
});

test('extract: the same photo repeated at different sizes still counts as one', () => {
  const page = sharePage({ extra: [`${PHOTO}=w2000`, PHOTO] });
  assert.equal(extractPhotoUrl(page), PHOTO);
});

test('extract: og:image on the Google image host but not a shared photo fails clearly', () => {
  assert.throws(
    () => extractPhotoUrl(sharePage({ og: 'https://lh3.googleusercontent.com/a/ACg8ocProfilePic=s96' })),
    (err) => err.status === 502 && /changed/.test(err.message)
  );
});

test('import: a non-image response (e.g. a video) is refused and nothing is returned', async () => {
  const fetch = fakeFetch(happyRoutes({ [`${PHOTO}=w2048-h2048`]: image(Buffer.from('mp4'), 'video/mp4') }));
  await rejectsWith(importGooglePhoto(SHORT, { fetch, maxBytes: MB }), 415, /video\/mp4/);
});

test('import: HEIC is refused as unsupported', async () => {
  const fetch = fakeFetch(happyRoutes({ [`${PHOTO}=w2048-h2048`]: image(Buffer.from('heic'), 'image/heic') }));
  await rejectsWith(importGooglePhoto(SHORT, { fetch, maxBytes: MB }), 415);
});

test('import: PNG, WebP and GIF get matching extensions', async () => {
  for (const [type, ext] of [['image/png', '.png'], ['image/webp', '.webp'], ['image/gif', '.gif']]) {
    const fetch = fakeFetch(happyRoutes({ [`${PHOTO}=w2048-h2048`]: image(Buffer.from('x'), `${type}; charset=binary`) }));
    const result = await importGooglePhoto(SHORT, { fetch, maxBytes: MB });
    assert.equal(result.ext, ext);
    assert.equal(result.mimeType, type);
  }
});

test('import: a declared size over the cap is refused', async () => {
  const big = new Response(Buffer.alloc(10), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(2 * MB) } });
  const fetch = fakeFetch(happyRoutes({ [`${PHOTO}=w2048-h2048`]: () => big }));
  await rejectsWith(importGooglePhoto(SHORT, { fetch, maxBytes: MB }), 413);
});

test('import: an undeclared body is cut off as soon as it passes the cap', async () => {
  let chunksSent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      chunksSent += 1;
      if (chunksSent > 100) return controller.close();
      controller.enqueue(new Uint8Array(256 * 1024));
    }
  });
  const fetch = fakeFetch(happyRoutes({
    [`${PHOTO}=w2048-h2048`]: () => new Response(stream, { status: 200, headers: { 'content-type': 'image/jpeg' } })
  }));
  await rejectsWith(importGooglePhoto(SHORT, { fetch, maxBytes: MB }), 413);
  assert.ok(chunksSent < 10, `stopped reading after ${chunksSent} chunks`);
});

test('import: a slow response times out', async () => {
  const fetch = fakeFetch(happyRoutes({
    [SHARE]: (options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    })
  }));
  // AbortSignal.timeout doesn't hold the event loop open; a live server does, this test must.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await rejectsWith(importGooglePhoto(SHORT, { fetch, maxBytes: MB, timeoutMs: 50 }), 504);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('import: a network failure is reported as not accessible', async () => {
  const fetch = fakeFetch(happyRoutes({ [SHARE]: () => { throw new TypeError('fetch failed'); } }));
  await rejectsWith(importGooglePhoto(SHORT, { fetch, maxBytes: MB }), 502, /accessible/);
});
