#!/usr/bin/env node
'use strict';

/**
 * Build the Opal Assist Office manifests for one portal host.
 *
 *   node scripts/build-office-manifest.js --host https://portal.example.com --client-id <entra app id>
 *
 * Writes office-addin/dist/opal-assist-word-excel.xml and
 * office-addin/dist/opal-assist-outlook.xml. The add-in ids are stable
 * UUIDs derived from the host so re-running for the same host updates the
 * same add-in rather than installing a second one.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
const fill = (tpl) => tpl
  .replace(/__HOST_NO_SCHEME__/g, hostNoScheme)
  .replace(/__HOST__/g, host)
  .replace(/__CLIENT_ID__/g, clientId)
  .replace(/__WORD_EXCEL_ID__/g, uuidFor(`opal-assist-word-excel:${host}`))
  .replace(/__OUTLOOK_ID__/g, uuidFor(`opal-assist-outlook:${host}`));

const dir = path.join(__dirname, '..', 'office-addin');
const out = path.join(dir, 'dist');
fs.mkdirSync(out, { recursive: true });
for (const [tpl, name] of [['manifest-word-excel.template.xml', 'opal-assist-word-excel.xml'], ['manifest-outlook.template.xml', 'opal-assist-outlook.xml']]) {
  fs.writeFileSync(path.join(out, name), fill(fs.readFileSync(path.join(dir, tpl), 'utf8')));
  console.log('wrote office-addin/dist/' + name);
}
console.log(`Entra "Application ID URI" must be: api://${hostNoScheme}/${clientId}`);
