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
  version: '1.0.0',
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

(async () => {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  zip.file('color.png', fs.readFileSync(path.join(__dirname, '..', 'frontend', 'current', 'icons', 'icon-192.png')));
  zip.file('outline.png', outlinePng());
  const out = path.join(__dirname, '..', 'office-addin', 'dist');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'opal-portal-m365.zip');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`Wrote ${path.relative(process.cwd(), file)} (app id ${manifest.id})`);
})();

module.exports = { outlinePng };
