// The crop window's square, in the photo's own pixels. Kept free of React so it can be
// unit tested. Every function returns whole pixels and keeps the square inside the photo.

export const MIN_CROP_SIZE = 64; // matches the server (core/services/photoCrop.js)

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** The largest square that fits, centred. */
export function initialSquare(width, height) {
  const size = Math.min(width, height);
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}

/** Move by (dx, dy), stopping at the photo's edges. */
export function moveSquare(square, dx, dy, width, height) {
  return {
    x: clamp(Math.round(square.x + dx), 0, width - square.size),
    y: clamp(Math.round(square.y + dy), 0, height - square.size),
    size: square.size
  };
}

/** Resize around the square's centre, between MIN_CROP_SIZE and the photo's short side. */
export function resizeSquare(square, size, width, height) {
  const max = Math.min(width, height);
  const next = clamp(Math.round(size), Math.min(MIN_CROP_SIZE, max), max);
  const cx = square.x + square.size / 2;
  const cy = square.y + square.size / 2;
  return {
    x: clamp(Math.round(cx - next / 2), 0, width - next),
    y: clamp(Math.round(cy - next / 2), 0, height - next),
    size: next
  };
}

/** Whether a photo is big enough to crop at all. */
export function canCrop(width, height) {
  return Math.min(width, height) >= MIN_CROP_SIZE;
}
