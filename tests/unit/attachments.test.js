import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AttachmentService } from '../../core/services/attachmentService.js';
import path from 'node:path';
import fs from 'node:fs';

test('AttachmentService - computes identical SHA-256 hash for identical data', () => {
  const service = new AttachmentService();
  const buffer1 = Buffer.from('SecondBrain Test Attachment Payload');
  const buffer2 = Buffer.from('SecondBrain Test Attachment Payload');
  const buffer3 = Buffer.from('Different content');

  const hash1 = service.computeHash(buffer1);
  const hash2 = service.computeHash(buffer2);
  const hash3 = service.computeHash(buffer3);

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
  assert.equal(hash1.length, 64);
});
