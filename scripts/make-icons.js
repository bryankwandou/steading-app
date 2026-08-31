#!/usr/bin/env node
/**
 * Generate the PWA icons.
 *
 * Android's install prompt wants real PNGs, and pulling in a raster library for four
 * flat shapes would break the zero-dependency rule for no good reason. A PNG is a
 * handful of length-prefixed, CRC'd chunks around a zlib stream, so we write it here:
 * about 60 lines, run once, output committed.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const ACCENT = [0x1b, 0x6e, 0xf3];
const WHITE = [0xff, 0xff, 0xff];

/* ------------------------------------------------------------------- png */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const body = out.subarray(4, 8 + data.length);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** @param {Uint8Array} rgba length = size*size*4 */
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace

  // One filter byte (0 = None) in front of every scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const from = y * size * 4;
    const to = y * (size * 4 + 1);
    raw[to] = 0;
    Buffer.from(rgba.buffer, from, size * 4).copy(raw, to + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- shapes */

/** Signed coverage helpers, evaluated per sub-sample. */
const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const inCornerBox = (x < x0 + r || x > x1 - r) && (y < y0 + r || y > y1 - r);
  return inCornerBox ? (x - cx) ** 2 + (y - cy) ** 2 <= r * r : true;
};

const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** Downward-pointing isoceles triangle. */
const inTriangle = (x, y, cx, top, halfWidth, height) => {
  if (y < top || y > top + height) return false;
  const t = (y - top) / height;
  const half = halfWidth * (1 - t);
  return Math.abs(x - cx) <= half;
};

/**
 * Render one icon.
 * @param {number} size
 * @param {boolean} maskable  full-bleed background, glyph inside the 80% safe zone
 */
function render(size, maskable) {
  const rgba = new Uint8Array(size * size * 4);
  const S = 3; // supersampling factor per axis -- enough for flat shapes

  // Geometry in 0..1 units, then scaled. The maskable variant shrinks the glyph so it
  // survives Android's circular mask.
  const pad = maskable ? 0 : 0.0;
  const plate = { x0: pad * size, y0: pad * size, x1: size - pad * size, y1: size - pad * size, r: maskable ? 0 : size * 0.22 };

  const g = maskable ? 0.30 : 0.24;      // glyph inset
  const cx = size / 2;
  const stemTop = size * g;
  const stemBottom = size * (1 - g - 0.10);
  const stemHalf = size * 0.045;
  const headHalf = size * 0.145;
  const headHeight = size * 0.135;
  const trayY0 = size * (1 - g - 0.02);
  const trayY1 = trayY0 + size * 0.055;
  const trayHalf = size * 0.20;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;

      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;

          if (inRoundedRect(px, py, plate.x0, plate.y0, plate.x1, plate.y1, plate.r)) bg += 1;

          const onGlyph =
            inRect(px, py, cx - stemHalf, stemTop, cx + stemHalf, stemBottom - headHeight * 0.4)
            || inTriangle(px, py, cx, stemBottom - headHeight, headHalf, headHeight)
            || inRoundedRect(px, py, cx - trayHalf, trayY0, cx + trayHalf, trayY1, size * 0.027);
          if (onGlyph) fg += 1;
        }
      }

      const total = S * S;
      const bgA = bg / total;
      const fgA = fg / total;

      // Composite: white glyph over the blue plate, plate over transparency.
      const alpha = bgA;
      const mix = Math.min(fgA, bgA); // the glyph never spills outside the plate
      const colour = [
        ACCENT[0] * (1 - mix) + WHITE[0] * mix,
        ACCENT[1] * (1 - mix) + WHITE[1] * mix,
        ACCENT[2] * (1 - mix) + WHITE[2] * mix,
      ];

      const i = (y * size + x) * 4;
      rgba[i] = Math.round(colour[0]);
      rgba[i + 1] = Math.round(colour[1]);
      rgba[i + 2] = Math.round(colour[2]);
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(rgba, size);
}

/* ------------------------------------------------------------------- main */

mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['favicon-64.png', 64, false],
];

for (const [name, size, maskable] of targets) {
  const png = render(size, maskable);
  writeFileSync(join(OUT, name), png);
  console.log(`  ${name.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

// The in-page mark: vector, so it stays sharp and costs ~300 bytes.
writeFileSync(join(OUT, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1b6ef3"/>
  <path d="M32 16v20m0 0 8-8m-8 8-8-8" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M19 45h26" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
</svg>
`);
console.log('  icon.svg');
