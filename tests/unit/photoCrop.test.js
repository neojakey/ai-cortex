import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateCropRect,
  outputSize,
  readUprightSize,
  renderSquare,
  PhotoCropError,
  MIN_CROP_SIZE,
  MAX_OUTPUT_SIZE
} from '../../core/services/photoCrop.js';
import { magickBin, makeImage, withRotateTag, describeImage, isBlue, isRed } from '../helpers/testImages.js';

const IMAGE = { width: 800, height: 600 };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cortex-crop-unit-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function writeImage(name, buffer) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  return file;
}

function refusedWith400(rect, pattern) {
  assert.throws(() => validateCropRect(rect, IMAGE), (err) => {
    assert.ok(err instanceof PhotoCropError, `expected PhotoCropError, got ${err}`);
    assert.equal(err.status, 400);
    if (pattern) assert.match(err.message, pattern);
    return true;
  }, JSON.stringify(rect));
}

test('validate: a square inside the photo is accepted as-is', () => {
  assert.deepEqual(validateCropRect({ x: 100, y: 0, size: 600 }, IMAGE), { x: 100, y: 0, size: 600 });
});

test('validate: a square touching every edge it can is accepted', () => {
  assert.deepEqual(validateCropRect({ x: 200, y: 0, size: 600 }, IMAGE), { x: 200, y: 0, size: 600 });
  assert.deepEqual(validateCropRect({ x: 0, y: 0, size: MIN_CROP_SIZE }, IMAGE), { x: 0, y: 0, size: MIN_CROP_SIZE });
});

test('validate: a square past any edge is refused', () => {
  refusedWith400({ x: 201, y: 0, size: 600 }, /inside the photo/);
  refusedWith400({ x: 0, y: 1, size: 600 }, /inside the photo/);
  refusedWith400({ x: -1, y: 0, size: 100 }, /inside the photo/);
  refusedWith400({ x: 0, y: -1, size: 100 }, /inside the photo/);
  refusedWith400({ x: 0, y: 0, size: 601 }, /inside the photo/);
});

test('validate: a square under the minimum size is refused', () => {
  refusedWith400({ x: 0, y: 0, size: MIN_CROP_SIZE - 1 }, /at least/);
  refusedWith400({ x: 0, y: 0, size: 0 }, /at least/);
});

test('validate: anything but whole pixel numbers is refused', () => {
  for (const rect of [
    { x: 0.5, y: 0, size: 100 },
    { x: '0', y: 0, size: 100 },
    { x: 0, y: 0 },
    { x: 0, y: 0, size: NaN },
    { x: 0, y: 0, size: Infinity },
    null,
    undefined
  ]) {
    refusedWith400(rect, /whole numbers/);
  }
});

test('output size: never enlarged, capped at 2048 px', () => {
  assert.equal(outputSize(MIN_CROP_SIZE), MIN_CROP_SIZE);
  assert.equal(outputSize(1542), 1542);
  assert.equal(outputSize(MAX_OUTPUT_SIZE), 2048);
  assert.equal(outputSize(6144), 2048);
});

test('upright size: a photo with a rotate tag reports its size as shown, not as stored', { skip: !magickBin }, async () => {
  const file = writeImage('rotated.jpg', withRotateTag(makeImage({ width: 300, height: 200 })));
  assert.deepEqual(await readUprightSize(file, magickBin), { width: 200, height: 300 });
});

test('render: crops the chosen square of the photo', { skip: !magickBin }, async () => {
  const file = writeImage('split.png', makeImage({ width: 400, height: 200, format: 'png' }));
  const left = await renderSquare(file, { x: 0, y: 0, size: 200 }, 'image/png', magickBin);
  const right = await renderSquare(file, { x: 200, y: 0, size: 200 }, 'image/png', magickBin);
  const l = describeImage(left, { x: 100, y: 100 });
  const r = describeImage(right, { x: 100, y: 100 });
  assert.deepEqual([l.width, l.height], [200, 200]);
  assert.ok(isBlue(l.pixel), `left square should be blue, got ${l.pixel}`);
  assert.ok(isRed(r.pixel), `right square should be red, got ${r.pixel}`);
});

test('render: a rotate-tagged photo is cropped where the user saw the square, and comes out upright', { skip: !magickBin }, async () => {
  // Stored 300×200 with blue on the left; shown 200×300 with blue on top. The bottom
  // square of the upright photo (y 100–300) doesn't even exist in the stored layout.
  const file = writeImage('rotated.jpg', withRotateTag(makeImage({ width: 300, height: 200 })));
  const square = await renderSquare(file, { x: 0, y: 100, size: 200 }, 'image/jpeg', magickBin);
  const top = describeImage(square, { x: 100, y: 10 });
  const bottom = describeImage(square, { x: 100, y: 190 });
  assert.deepEqual([top.width, top.height], [200, 200]);
  assert.ok(isBlue(top.pixel), `top should be blue, got ${top.pixel}`);
  assert.ok(isRed(bottom.pixel), `bottom should be red, got ${bottom.pixel}`);
  assert.notEqual(top.orientation, 'RightTop', 'the result must not be rotated a second time by viewers');
});

test('render: keeps the format (JPEG, PNG, WebP)', { skip: !magickBin }, async () => {
  for (const [format, mimeType, expected] of [['jpeg', 'image/jpeg', 'JPEG'], ['png', 'image/png', 'PNG'], ['webp', 'image/webp', 'WEBP']]) {
    const file = writeImage(`fmt.${format}`, makeImage({ width: 120, height: 100, format }));
    const out = await renderSquare(file, { x: 0, y: 0, size: 100 }, mimeType, magickBin);
    assert.equal(describeImage(out).format, expected, format);
  }
});

test('render: a square bigger than 2048 px is shrunk to 2048', { skip: !magickBin }, async () => {
  const file = writeImage('big.jpg', makeImage({ width: 2600, height: 2400 }));
  const out = await renderSquare(file, { x: 100, y: 0, size: 2400 }, 'image/jpeg', magickBin);
  const info = describeImage(out);
  assert.deepEqual([info.width, info.height], [2048, 2048]);
});

test('render: a small square is not enlarged', { skip: !magickBin }, async () => {
  const file = writeImage('small.jpg', makeImage({ width: 300, height: 200 }));
  const out = await renderSquare(file, { x: 10, y: 10, size: 90 }, 'image/jpeg', magickBin);
  const info = describeImage(out);
  assert.deepEqual([info.width, info.height], [90, 90]);
});
