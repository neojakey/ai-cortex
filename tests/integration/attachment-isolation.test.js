import '../helpers/test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../../core/api/server.js';
import { pool } from '../../core/db/pool.js';
import { attachmentService } from '../../core/services/attachmentService.js';

let server;
let baseUrl;
const createdAttachments = [];

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  for (const id of createdAttachments) await attachmentService.deleteAttachment(id);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function saveAttachment(filename, mimeType, contents) {
  const attachment = await attachmentService.saveAttachment({
    filename,
    mimeType,
    buffer: Buffer.from(contents)
  });
  createdAttachments.push(attachment.id);
  return attachment;
}

test('Attachments: an HTML attachment is forced to download, not rendered inline', async () => {
  const att = await saveAttachment('evil.html', 'text/html', '<script>alert(1)</script>');
  const res = await fetch(`${baseUrl}/api/attachments/${att.id}/file`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const disposition = res.headers.get('content-disposition');
  assert.match(disposition, /^attachment/, 'an HTML file must not get an inline disposition');
  assert.match(disposition, /evil\.html/);
});

test('Attachments: an SVG attachment is forced to download, not rendered inline', async () => {
  const att = await saveAttachment('evil.svg', 'image/svg+xml', '<svg onload="alert(1)"></svg>');
  const res = await fetch(`${baseUrl}/api/attachments/${att.id}/file`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-disposition'), /^attachment/);
});

test('Attachments: an unrecognized type is also forced to download, not allowed by default', async () => {
  const att = await saveAttachment('mystery.bin', 'application/x-mystery', 'whatever');
  const res = await fetch(`${baseUrl}/api/attachments/${att.id}/file`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment/);
});

test('Attachments: a real photo still gets an inline disposition and nosniff', async () => {
  // Not a valid JPEG, but only the declared mime type drives the disposition choice here.
  const att = await saveAttachment('photo.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const res = await fetch(`${baseUrl}/api/attachments/${att.id}/file`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-disposition'), /^inline/);
  assert.match(res.headers.get('content-disposition'), /photo\.jpg/);
});

test('Attachments: a PDF still gets an inline disposition', async () => {
  const att = await saveAttachment('doc.pdf', 'application/pdf', '%PDF-1.4 fake');
  const res = await fetch(`${baseUrl}/api/attachments/${att.id}/file`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^inline/);
});

test('Attachments: a filename with quotes and unicode does not break the header', async () => {
  const att = await saveAttachment('weird "name" café.html', 'text/html', '<script></script>');
  const res = await fetch(`${baseUrl}/api/attachments/${att.id}/file`);
  assert.equal(res.status, 200);
  const disposition = res.headers.get('content-disposition');
  assert.match(disposition, /^attachment/);
  assert.doesNotThrow(() => new Headers({ 'content-disposition': disposition }));
});

test('Attachments: range requests on an inline image keep working, with the new headers added', async () => {
  const bytes = Buffer.from('0123456789');
  const att = await saveAttachment('clip.mp4', 'video/mp4', bytes);
  const res = await fetch(`${baseUrl}/api/attachments/${att.id}/file`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 0-3/${bytes.length}`);
  assert.match(res.headers.get('content-disposition'), /^inline/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('Attachments: the thumbnail endpoint also sets nosniff', async () => {
  const att = await saveAttachment('doc2.pdf', 'application/pdf', '%PDF-1.4 fake');
  const res = await fetch(`${baseUrl}/api/attachments/${att.id}/thumb`);
  // pdftoppm may not be installed in every environment; only the header matters here when it renders.
  if (res.status === 200) {
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  }
});
