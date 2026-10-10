#!/usr/bin/env node
'use strict';

/**
 * Build the hard-coded WA locality → MMM 2023 table that session billing uses.
 *
 * Source (Department of Health, Disability and Ageing / ABS, CC BY 2.5 AU):
 *   https://data.gov.au/data/dataset/f50d81d1-59e0-417f-858b-808ca5550cdd
 *   → mmm23_sal21_poa21.xlsx  "Suburbs and Localities (SAL) 2021 - Postal Areas
 *     (POA) 2021 - Modified Monash Model 2023" (resource updated 6 Nov 2025).
 *
 * One row per SAL × POA × MMM piece; a locality that straddles a zone boundary
 * has one row per zone with the area of each piece. The output keeps every
 * piece so the lookup can flag straddling localities for review.
 *
 * Usage (from backend/):
 *   node scripts/build-mmm-locality-table.js path/to/mmm23_sal21_poa21.xlsx
 *
 * Writes billing/data/mmm2023-wa-localities.json. No database, no network.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const OUT = path.join(__dirname, '..', 'billing', 'data', 'mmm2023-wa-localities.json');

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

async function readRows(file) {
  const z = await JSZip.loadAsync(fs.readFileSync(file));
  const shared = [];
  const ssFile = z.file('xl/sharedStrings.xml');
  if (ssFile) {
    const x = await ssFile.async('string');
    for (const si of x.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(unescapeXml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')));
    }
  }
  const x = await z.file('xl/worksheets/sheet1.xml').async('string');
  const rows = [];
  for (const r of x.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const row = {};
    for (const c of r.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const col = c.match(/r="([A-Z]+)\d+"/)[1];
      const type = (c.match(/ t="([^"]+)"/) || [])[1];
      let v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (v == null) { const is = c.match(/<t[^>]*>([\s\S]*?)<\/t>/); v = is ? unescapeXml(is[1]) : null; }
      if (type === 's' && v != null) v = shared[Number(v)];
      row[col] = v;
    }
    rows.push(row);
  }
  return rows;
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/build-mmm-locality-table.js mmm23_sal21_poa21.xlsx'); process.exit(1); }
  const rows = await readRows(file);
  const headerIdx = rows.findIndex(r => r.B === 'SAL 2021 Code');
  if (headerIdx < 0 || rows[headerIdx].F !== 'MMM 2023' || rows[headerIdx].E !== 'POA 2021 Code') {
    throw new Error('Unexpected spreadsheet layout: expected SAL 2021 Code / … / POA 2021 Code / MMM 2023 columns');
  }
  const bySal = new Map();
  for (const r of rows.slice(headerIdx + 1)) {
    if (r.H !== 'Western Australia' || !r.B || !r.C) continue;
    const mmm = Number(r.F);
    if (!(mmm >= 1 && mmm <= 7)) throw new Error(`Bad MMM value for ${r.C}: ${r.F}`);
    const key = `${r.B}|${r.E}`;
    if (!bySal.has(key)) bySal.set(key, { sal: r.B, name: r.C, postcode: String(r.E).padStart(4, '0'), zones: [] }); // the sheet stores 0872 (Ngaanyatjarra lands) as 872
    bySal.get(key).zones.push([mmm, Math.round(Number(r.G) * 100) / 100]);
  }
  const localities = [...bySal.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(l => [l.name, l.postcode, l.zones.sort((a, b) => a[0] - b[0])]);
  const out = {
    source: 'Suburbs and Localities (SAL) 2021 - Postal Areas (POA) 2021 - Modified Monash Model 2023',
    sourceUrl: 'https://data.gov.au/data/dataset/f50d81d1-59e0-417f-858b-808ca5550cdd',
    licence: 'CC BY 2.5 AU',
    version: 'MMM2023',
    state: 'WA',
    format: '[localityName, postcode, [[mmm, areaKm2], ...]]',
    localities,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out).replace(/\],\[/g, '],\n[') + '\n');
  const straddling = localities.filter(l => l[2].length > 1).length;
  console.log(`Wrote ${localities.length} WA localities (${straddling} straddle a zone boundary) → ${path.relative(process.cwd(), OUT)}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
