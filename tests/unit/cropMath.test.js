import test from 'node:test';
import assert from 'node:assert/strict';

const { initialSquare, moveSquare, resizeSquare, canCrop, MIN_CROP_SIZE } = await import('../../client/src/lib/cropMath.js');
const { MIN_CROP_SIZE: SERVER_MIN } = await import('../../core/services/photoCrop.js');

const W = 2048;
const H = 1542;

test('crop window: starts as the largest square that fits, centred', () => {
  assert.deepEqual(initialSquare(W, H), { x: 253, y: 0, size: 1542 });
  assert.deepEqual(initialSquare(H, W), { x: 0, y: 253, size: 1542 });
  assert.deepEqual(initialSquare(500, 500), { x: 0, y: 0, size: 500 });
});

test('crop window: moving stops at every edge of the photo', () => {
  const sq = { x: 100, y: 0, size: 1000 };
  assert.deepEqual(moveSquare(sq, -500, 0, W, H), { x: 0, y: 0, size: 1000 });
  assert.deepEqual(moveSquare(sq, 5000, 0, W, H), { x: 1048, y: 0, size: 1000 });
  assert.deepEqual(moveSquare(sq, 0, -10, W, H), { x: 100, y: 0, size: 1000 });
  assert.deepEqual(moveSquare(sq, 0, 5000, W, H), { x: 100, y: 542, size: 1000 });
});

test('crop window: moves by fractions of a pixel land on whole pixels', () => {
  const moved = moveSquare({ x: 100, y: 100, size: 200 }, 10.6, -3.4, W, H);
  assert.deepEqual(moved, { x: 111, y: 97, size: 200 });
});

test('crop window: resizing keeps the centre where it can', () => {
  assert.deepEqual(resizeSquare({ x: 500, y: 500, size: 400 }, 200, W, H), { x: 600, y: 600, size: 200 });
});

test('crop window: resizing near an edge pushes the square back inside', () => {
  assert.deepEqual(resizeSquare({ x: 0, y: 0, size: 200 }, 600, W, H), { x: 0, y: 0, size: 600 });
  assert.deepEqual(resizeSquare({ x: 1848, y: 1342, size: 200 }, 600, W, H), { x: 1448, y: 942, size: 600 });
});

test('crop window: size stays between the minimum and the short side', () => {
  assert.equal(resizeSquare({ x: 0, y: 0, size: 100 }, 1, W, H).size, MIN_CROP_SIZE);
  assert.equal(resizeSquare({ x: 0, y: 0, size: 100 }, 99999, W, H).size, H);
});

test('crop window: every result fits the server check', () => {
  const inside = ({ x, y, size }) => Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(size) &&
    x >= 0 && y >= 0 && x + size <= W && y + size <= H && size >= SERVER_MIN;
  let sq = initialSquare(W, H);
  for (const [dx, dy, size] of [[-9999, 3.3, 77.7], [9999, 9999, 3000], [12.5, -40.5, 64], [0, 0, 1541.5]]) {
    sq = moveSquare(sq, dx, dy, W, H);
    assert.ok(inside(sq), JSON.stringify(sq));
    sq = resizeSquare(sq, size, W, H);
    assert.ok(inside(sq), JSON.stringify(sq));
  }
});

test('crop window: the minimum matches the server', () => {
  assert.equal(MIN_CROP_SIZE, SERVER_MIN);
});

test('crop window: a photo smaller than the minimum cannot be cropped', () => {
  assert.equal(canCrop(63, 1000), false);
  assert.equal(canCrop(64, 64), true);
});
