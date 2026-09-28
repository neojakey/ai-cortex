// Small test photos made with ImageMagick, so the crop tests run on real image files.
import { execFileSync, spawnSync } from 'node:child_process';

export const magickBin = ['magick', 'convert'].find((bin) => {
  try { return spawnSync(bin, ['-version'], { timeout: 5000 }).status === 0; } catch { return false; }
});

/**
 * A photo split in two colours: `left` fills the left half, `right` the right half.
 * @param {string} format jpeg | png | webp | gif
 */
export function makeImage({ width, height, format = 'jpeg', left = 'blue', right = 'red' }) {
  return execFileSync(magickBin, [
    '-size', `${width}x${height}`, `xc:${right}`,
    '-fill', left, '-draw', `rectangle 0,0 ${Math.floor(width / 2) - 1},${height - 1}`,
    `${format}:-`
  ], { maxBuffer: 64 * 1024 * 1024 });
}

/**
 * The same JPEG with an EXIF "rotate 90° clockwise" tag (orientation 6), as a phone writes
 * for a photo taken holding it upright. Shown upright, a W×H file is H×W and its left half
 * becomes the top half.
 */
export function withRotateTag(jpeg) {
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF header, first IFD at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, // Orientation = 6
    0x00, 0x00, 0x00, 0x00 // no next IFD
  ]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const length = body.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, length >> 8, length & 0xff]), body]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** Width, height, format, EXIF orientation and the colour at (x, y) of an image buffer. */
export function describeImage(buffer, { x = 0, y = 0 } = {}) {
  const out = execFileSync(magickBin, [
    '-', '-format', `%w %h %m %[orientation] %[pixel:p{${x},${y}}]`, 'info:'
  ], { input: buffer }).toString().trim().split(' ');
  return { width: Number(out[0]), height: Number(out[1]), format: out[2], orientation: out[3], pixel: out[4] };
}

/** True if a colour string from describeImage is (close to) pure blue / red. */
export const isBlue = (pixel) => /^srgba?\(\s*[0-9]\s*,\s*[0-9]\s*,\s*2[45][0-9]/.test(pixel);
export const isRed = (pixel) => /^srgba?\(\s*2[45][0-9]\s*,\s*[0-9]\s*,\s*[0-9]\s*[,)]/.test(pixel);
