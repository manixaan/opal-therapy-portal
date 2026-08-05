#!/usr/bin/env node
'use strict';

/**
 * Generates the Opal Therapy Portal icon set — favicon.ico, apple-touch-icon,
 * and web-app-manifest PNGs — with zero dependencies (pure Node + zlib).
 *
 * Design (mirrors frontend/current/favicon.svg):
 *   - rounded-square background, vertical gradient #00b8d9 → #007a9c
 *     (derived from the app's --accent / --accent-deep palette)
 *   - white "O" ring for Opal
 *   - 4-point sparkle top-right (the opal glint)
 *
 * Full-bleed (square, opaque) variants are emitted where the OS applies its
 * own corner mask: apple-touch-icon and the maskable manifest icon.
 *
 * Rerun after design changes:  node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'frontend', 'current');

// ── palette / geometry (normalized 0..1 coordinates) ─────────────────────────
const GRAD_TOP = [0x00, 0xb8, 0xd9];
const GRAD_BOT = [0x00, 0x7a, 0x9c];
const CORNER_R = 0.22;                       // rounded-square corner radius
const RING = { cx: 0.48, cy: 0.56, outer: 0.28, inner: 0.175 };
const SPARK = { cx: 0.76, cy: 0.25, r: 0.115, p: 0.5 }; // |x|^p+|y|^p ≤ 1 star

function insideRoundedSquare(u, v, r) {
  const x = Math.min(u, 1 - u), y = Math.min(v, 1 - v);
  if (x < 0 || y < 0) return false;
  if (x >= r || y >= r) return true;
  const dx = r - x, dy = r - y;
  return dx * dx + dy * dy <= r * r;
}

function insideForeground(u, v) {
  const dx = u - RING.cx, dy = v - RING.cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d >= RING.inner && d <= RING.outer) return true;
  const sx = Math.abs(u - SPARK.cx) / SPARK.r, sy = Math.abs(v - SPARK.cy) / SPARK.r;
  return sx <= 1 && sy <= 1 && Math.pow(sx, SPARK.p) + Math.pow(sy, SPARK.p) <= 1;
}

/** Render RGBA pixels at `size`, 4×4 supersampled. fullBleed = opaque square. */
function render(size, fullBleed) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let covered = 0, rSum = 0, gSum = 0, bSum = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (!fullBleed && !insideRoundedSquare(u, v, CORNER_R)) continue;
          covered++;
          if (insideForeground(u, v)) { rSum += 255; gSum += 255; bSum += 255; continue; }
          rSum += GRAD_TOP[0] + (GRAD_BOT[0] - GRAD_TOP[0]) * v;
          gSum += GRAD_TOP[1] + (GRAD_BOT[1] - GRAD_TOP[1]) * v;
          bSum += GRAD_TOP[2] + (GRAD_BOT[2] - GRAD_TOP[2]) * v;
        }
      }
      const i = (y * size + x) * 4;
      if (covered === 0) continue; // fully transparent
      px[i] = Math.round(rSum / covered);
      px[i + 1] = Math.round(gSum / covered);
      px[i + 2] = Math.round(bSum / covered);
      px[i + 3] = Math.round((covered / (SS * SS)) * 255);
    }
  }
  return px;
}

// ── minimal PNG encoder (RGBA8, no interlace) ────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** favicon.ico as a container of PNG-compressed entries (all modern browsers). */
function encodeIco(pngsBySize) {
  const entries = Object.entries(pngsBySize).map(([s, b]) => [Number(s), b]);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = [];
  let offset = 6 + 16 * entries.length;
  for (const [size, png] of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);  // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...dir, ...entries.map(([, b]) => b)]);
}

// ── emit ─────────────────────────────────────────────────────────────────────
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });

const png = (size, fullBleed) => encodePng(render(size, fullBleed), size);

const files = {
  'favicon.ico': encodeIco({ 16: png(16), 32: png(32), 48: png(48) }),
  'icons/apple-touch-icon.png': png(180, true),
  'icons/icon-192.png': png(192),
  'icons/icon-512.png': png(512),
  'icons/icon-maskable-512.png': png(512, true),
};
for (const [rel, buf] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, rel), buf);
  console.log(`wrote ${rel} (${buf.length} bytes)`);
}
