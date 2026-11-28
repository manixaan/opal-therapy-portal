#!/usr/bin/env node
'use strict';

/**
 * Build the "Opal" Microsoft 365 app — the icon in the Outlook (and Teams)
 * app bar that opens the whole portal.
 *
 *   node scripts/build-m365-app.js --host https://portal.example.com --client-id <entra app id>
 *
 * Writes office-addin/dist/opal-portal-m365.zip (manifest.json + color.png +
 * outline.png) for Microsoft 365 admin centre → Integrated apps → Upload
 * custom apps. The app id is a stable UUID derived from the host, so a
 * rebuild for the same host updates the same app rather than adding another.
 *
 * Reuses Opal Assist's Entra app registration (same client id and
 * Application ID URI api://<host>/<client id>) — see office-addin/README.md.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const JSZip = require(path.join(__dirname, '..', 'backend', 'node_modules', 'jszip'));

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const host = (opt('--host') || '').replace(/\/+$/, '');
const clientId = opt('--client-id') || '';
if (!/^https:\/\/[^/]+$/.test(host)) { console.error('Need --host https://<portal host> (https, no path)'); process.exit(2); }
if (!/^[0-9a-f-]{36}$/i.test(clientId)) { console.error('Need --client-id <Entra application (client) id>'); process.exit(2); }

const uuidFor = (seed) => {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const hostNoScheme = host.replace(/^https:\/\//, '');

const manifest = {
  $schema: 'https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json',
  manifestVersion: '1.17',
  version: '1.0.1',
  id: uuidFor(`opal-portal-m365:${host}`),
  developer: {
    name: 'Opal Therapy',
    websiteUrl: `${host}/`,
    privacyUrl: `${host}/`,
    termsOfUseUrl: `${host}/`,
  },
  name: { short: 'Opal', full: 'Opal Therapy Portal' },
  description: {
    short: 'The Opal Therapy portal inside Outlook.',
    full: 'Calendar, case notes, assessments and the rest of the Opal Therapy portal, opened from the Outlook app bar and signed in with your Microsoft 365 account.',
  },
  icons: { color: 'color.png', outline: 'outline.png' },
  accentColor: '#1F8A70',
  staticTabs: [{
    entityId: 'opal-portal',
    name: 'Opal',
    contentUrl: `${host}/outlook`,
    websiteUrl: `${host}/`,
    scopes: ['personal'],
  }],
  permissions: ['identity'],
  validDomains: [hostNoScheme],
  webApplicationInfo: { id: clientId, resource: `api://${hostNoScheme}/${clientId}` },
};

// ── outline.png: 32×32, white on transparent (Microsoft's rule for the
// monochrome icon) — the Opal mark drawn as a ring with its inner dot.
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function outlinePng(size = 32) {
  const SS = 4; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS; const py = y + (sy + 0.5) / SS;
        const d = Math.hypot(px - c, py - c);
        const ring = d <= 14.5 && d >= 12;
        const dot = ((px - 13.5) / 5.5) ** 2 + ((py - 12.5) / 4.5) ** 2 <= 1;
        if (ring || dot) hit++;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = 255; raw[o + 1] = 255; raw[o + 2] = 255; raw[o + 3] = Math.round((hit / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── color.png: the Opal cell alone on transparent. The portal's icon-512 has
// the cell on an opaque white square; cut the white away (flood-fill from the
// edges, un-blending the anti-aliased rim), then box-downsample to 192×192.
function decodePngRgba(buf) {
  let o = 8; let w = 0; let h = 0; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IHDR') {
      w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12);
      if (buf[o + 16] !== 8 || buf[o + 17] !== 6 || buf[o + 20] !== 0) throw new Error('icon must be 8-bit RGBA, not interlaced');
    }
    if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4; const px = Buffer.alloc(h * stride); let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      let v = raw[p++];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const q = a + b - c; const pa = Math.abs(q - a); const pb = Math.abs(q - b); const pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c); }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, px };
}

function encodePngRgba(px, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function transparentCellPng(srcFile, size = 192) {
  const { w, h, px } = decodePngRgba(fs.readFileSync(srcFile));
  const n = w * h; const minC = (i) => Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  // 1. Background = near-white pixels reachable from the border.
  const bg = new Uint8Array(n); const stack = [];
  const seed = (i) => { if (!bg[i] && minC(i) >= 245) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop(); const x = i % w; const y = (i - x) / w;
    if (x > 0) seed(i - 1); if (x < w - 1) seed(i + 1); if (y > 0) seed(i - w); if (y < h - 1) seed(i + w);
  }
  // 2. Alpha: background 0; a rim pixel touching background is un-blended
  //    from white against the cell colour just inside it; the rest is opaque.
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    if (bg[i]) continue;
    const x = i % w; const y = (i - x) / w;
    let rim = false;
    for (let dy = -1; dy <= 1 && !rim; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx; const yy = y + dy;
      if (xx >= 0 && xx < w && yy >= 0 && yy < h && bg[yy * w + xx]) { rim = true; break; }
    }
    let a = 1;
    if (rim) {
      // Reference colour: step inward (away from the centre's opposite) 3 px.
      const cx = w / 2; const cy = h / 2; const d = Math.hypot(x - cx, y - cy) || 1;
      const rx = Math.round(x - ((x - cx) / d) * 3); const ry = Math.round(y - ((y - cy) / d) * 3);
      const ref = minC(ry * w + rx);
      a = Math.max(0, Math.min(1, (255 - minC(i)) / Math.max(1, 255 - ref)));
    }
    for (let k = 0; k < 3; k++) {
      const c = px[i * 4 + k];
      out[i * 4 + k] = a > 0 ? Math.max(0, Math.min(255, Math.round((c - 255 * (1 - a)) / a))) : 0;
    }
    out[i * 4 + 3] = Math.round(a * 255);
  }
  // 3. Box-downsample with alpha-weighted colour.
  const dst = Buffer.alloc(size * size * 4); const sc = w / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let aS = 0; let rS = 0; let gS = 0; let bS = 0; let cnt = 0;
    for (let yy = Math.floor(y * sc); yy < Math.floor((y + 1) * sc); yy++) for (let xx = Math.floor(x * sc); xx < Math.floor((x + 1) * sc); xx++) {
      const j = (yy * w + xx) * 4; const al = out[j + 3];
      aS += al; rS += out[j] * al; gS += out[j + 1] * al; bS += out[j + 2] * al; cnt++;
    }
    const o = (y * size + x) * 4;
    if (aS > 0) { dst[o] = Math.round(rS / aS); dst[o + 1] = Math.round(gS / aS); dst[o + 2] = Math.round(bS / aS); }
    dst[o + 3] = Math.round(aS / cnt);
  }
  return encodePngRgba(dst, size);
}

(async () => {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  zip.file('color.png', transparentCellPng(path.join(__dirname, '..', 'frontend', 'current', 'icons', 'icon-512.png')));
  zip.file('outline.png', outlinePng());
  const out = path.join(__dirname, '..', 'office-addin', 'dist');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'opal-portal-m365.zip');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`Wrote ${path.relative(process.cwd(), file)} (app id ${manifest.id})`);
})();

module.exports = { outlinePng, transparentCellPng };
