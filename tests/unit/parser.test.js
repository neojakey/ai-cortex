import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  extractWikilinks,
  extractHashtags,
  extractTasks,
  markdownToPlaintext
} from '../../core/services/parser.js';

test('slugify - handles special characters, accents, and spacing', () => {
  assert.equal(slugify('Architecture & System Design'), 'architecture-system-design');
  assert.equal(slugify('Café & Résumé 2026!'), 'cafe-resume-2026');
  assert.equal(slugify('   Multiple   Spaces   '), 'multiple-spaces');
  assert.equal(slugify('already-a-slug'), 'already-a-slug');
  assert.equal(slugify(''), '');
});

test('extractWikilinks - parses simple, aliased, and multiple wikilinks', () => {
  const content = `
    Here is a link to [[Project Apollo]] and another to [[Weekly Sync Notes|Team Meeting]].
    Duplicate [[Project Apollo]] should only be listed once.
    Link with spaces: [[  Clean Room  ]].
  `;

  const links = extractWikilinks(content);
  assert.equal(links.length, 3);

  assert.equal(links[0].targetTitle, 'Project Apollo');
  assert.equal(links[0].targetSlug, 'project-apollo');
  assert.equal(links[0].alias, undefined);

  assert.equal(links[1].targetTitle, 'Weekly Sync Notes');
  assert.equal(links[1].targetSlug, 'weekly-sync-notes');
  assert.equal(links[1].alias, 'Team Meeting');

  assert.equal(links[2].targetTitle, 'Clean Room');
  assert.equal(links[2].targetSlug, 'clean-room');
});

test('extractHashtags - captures tags while ignoring markdown headers', () => {
  const content = `
    # Main Header (not a tag)
    ## Sub Header (not a tag)
    Some text discussing #architecture, #ai-agent, and #project_2026.
    A standalone number like #123 should be ignored.
    Another line with #deep-learning.
  `;

  const tags = extractHashtags(content);
  assert.ok(tags.includes('architecture'));
  assert.ok(tags.includes('ai-agent'));
  assert.ok(tags.includes('project_2026'));
  assert.ok(tags.includes('deep-learning'));
  assert.ok(!tags.includes('main'));
  assert.ok(!tags.includes('sub'));
  assert.ok(!tags.includes('123'));
});

test('extractTasks - parses markdown checkboxes with line numbers', () => {
  const content = `
# Plan
- [ ] First unfinished task
- [x] Second completed task
- [X] Third completed uppercase task
Regular bullet
  `;

  const tasks = extractTasks(content);
  assert.equal(tasks.length, 3);

  assert.equal(tasks[0].text, 'First unfinished task');
  assert.equal(tasks[0].completed, false);

  assert.equal(tasks[1].text, 'Second completed task');
  assert.equal(tasks[1].completed, true);

  assert.equal(tasks[2].text, 'Third completed uppercase task');
  assert.equal(tasks[2].completed, true);
});

test('markdownToPlaintext - cleans markdown syntax for FULLTEXT indexing', () => {
  const markdown = `
# Title

This is **bold** text and *italic* text.
Here is a [Google Link](https://google.com) and a [[Wikilink Target|Alias Text]].

\`\`\`javascript
const x = 42;
\`\`\`

> Blockquote info
- [x] Checkbox done
  `;

  const plain = markdownToPlaintext(markdown);
  assert.ok(!plain.includes('# Title'));
  assert.ok(plain.includes('Title'));
  assert.ok(plain.includes('bold text'));
  assert.ok(plain.includes('Google Link'));
  assert.ok(plain.includes('Alias Text'));
  assert.ok(!plain.includes('const x = 42;'));
  assert.ok(!plain.includes('- [x]'));
});
