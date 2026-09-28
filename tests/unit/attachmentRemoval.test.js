import test from 'node:test';
import assert from 'node:assert/strict';
import { stripAttachmentLinks } from '../../core/services/attachmentRemoval.js';

const ID = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const url = (id = ID) => `/api/attachments/${id}/file`;

test('strip: an image on its own line goes, with no gap left behind', () => {
  assert.equal(
    stripAttachmentLinks(`Intro\n\n![Photo](${url()})\n\nAfter`, ID),
    'Intro\n\nAfter'
  );
});

test('strip: an uploaded image at the end of the note goes', () => {
  // What the upload adds: "\n\n![name](url)\n"
  assert.equal(stripAttachmentLinks(`Intro\n\n![phone.jpg](${url()})\n`, ID), 'Intro\n');
});

test('strip: a file link (📎) goes too', () => {
  assert.equal(
    stripAttachmentLinks(`Report:\n\n[📎 report.pdf](${url()})\n\nThanks`, ID),
    'Report:\n\nThanks'
  );
});

test('strip: a link inside a sentence goes, the sentence stays', () => {
  assert.equal(
    stripAttachmentLinks(`See ![Photo](${url()}) above.`, ID),
    'See  above.'
  );
});

test('strip: every link to the attachment goes', () => {
  assert.equal(
    stripAttachmentLinks(`![a](${url()})\n\nText ![b](${url()})\n\n![c](${url()}) ![d](${url()})\n`, ID),
    'Text \n'
  );
});

test('strip: links to other attachments, and everything else, are untouched', () => {
  const text = `# Title\n\n![Other](${url(OTHER)})\n\n[site](https://example.com)\n\n\n\nkept   spacing\n`;
  assert.equal(stripAttachmentLinks(text, ID), text);
});

test('strip: an id that merely starts the same does not match', () => {
  const text = `![x](/api/attachments/${ID}0/file)\n![y](/api/attachments/${ID}/thumb)`;
  assert.equal(stripAttachmentLinks(text, ID), text);
});

test('strip: blank lines elsewhere in the note are left as they were', () => {
  assert.equal(
    stripAttachmentLinks(`A\n\n\n\nB\n\n![Photo](${url()})\n\nC`, ID),
    'A\n\n\n\nB\n\nC'
  );
});

test('strip: a note that is only the image becomes empty', () => {
  assert.equal(stripAttachmentLinks(`![Photo](${url()})`, ID), '');
});

test('strip: empty or missing text is fine', () => {
  assert.equal(stripAttachmentLinks('', ID), '');
  assert.equal(stripAttachmentLinks(null, ID), '');
});
