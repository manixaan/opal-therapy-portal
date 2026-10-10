'use strict';

/**
 * SESSION MMM ZONE — hard-coded WA locality → MMM 2023 lookup.
 *
 * The NDIS price limit follows the Modified Monash zone of where the session
 * is delivered, so the zone comes from the session's address, not the
 * client's home address. The table (billing/data/mmm2023-wa-localities.json)
 * is the Department of Health "SAL 2021 – POA 2021 – MMM 2023" correspondence,
 * built by scripts/build-mmm-locality-table.js. No network, no database.
 *
 * Fail-closed: a zone is CONFIDENT only when the address names a WA locality
 * that sits wholly in one zone (or, with no locality named, a postcode whose
 * localities all share one zone). A locality straddling a boundary, a postcode
 * that disagrees with the locality, or a postcode spanning zones is REVIEW;
 * nothing recognisable is UNRESOLVED. Neither is billed until someone sets
 * the session's zone.
 */

const TABLE = require('./data/mmm2023-wa-localities.json');

const DATASET_VERSION = TABLE.version;

function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\s*\(wa\)\s*$/, '')
    .replace(/[^a-z0-9' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const byName = new Map();     // normalised locality → {name, postcode, zones}
const byPostcode = new Map(); // postcode → [{name, postcode, zones}]
let maxWords = 1;
for (const [name, postcode, zones] of TABLE.localities) {
  const entry = { name: name.replace(/\s*\(WA\)$/, ''), postcode, zones };
  byName.set(normName(name), entry);
  if (!byPostcode.has(postcode)) byPostcode.set(postcode, []);
  byPostcode.get(postcode).push(entry);
  maxWords = Math.max(maxWords, normName(name).split(' ').length);
}

const TRAILING = /(\s+(wa|w a|western australia|australia|\d{4}))+$/;

/** The WA locality an address names, preferring the last comma segment (suburb follows street). */
function findLocality(address) {
  const segments = String(address).split(/[,\n]/).map(s => normName(s).replace(TRAILING, '').trim()).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const words = segments[i].split(' ');
    for (let k = Math.min(maxWords, words.length); k >= 1; k--) {
      const hit = byName.get(words.slice(words.length - k).join(' '));
      if (hit) return hit;
    }
  }
  return null;
}

function findPostcode(address) {
  const all = String(address).match(/\b(6\d{3}|0872)\b/g);
  return all ? all[all.length - 1] : null;
}

function zoneSet(entries) {
  return [...new Set(entries.flatMap(e => e.zones.map(z => z[0])))].sort((a, b) => a - b);
}

/**
 * @param {string} address
 * @returns {{zone:number|null, confident:boolean, reason:string|null, locality:string|null,
 *            postcode:string|null, zones:number[], suggestedZone:number|null, matchedBy:string|null,
 *            datasetVersion:string}}
 */
function lookupAddress(address) {
  const base = { zone: null, confident: false, reason: null, locality: null, postcode: null, zones: [],
    suggestedZone: null, matchedBy: null, datasetVersion: DATASET_VERSION };
  if (!address || !String(address).trim()) return { ...base, reason: 'no_address' };
  const postcode = findPostcode(address);
  const loc = findLocality(address);

  if (loc) {
    const zones = zoneSet([loc]);
    const out = { ...base, locality: loc.name, postcode: loc.postcode, zones, matchedBy: 'locality' };
    if (postcode && postcode !== loc.postcode) {
      return { ...out, reason: 'postcode_mismatch', suggestedZone: zones.length === 1 ? zones[0] : null };
    }
    if (zones.length === 1) return { ...out, zone: zones[0], confident: true };
    const largest = [...loc.zones].sort((a, b) => b[1] - a[1])[0][0];
    return { ...out, reason: 'straddles_boundary', suggestedZone: largest };
  }

  if (postcode) {
    const entries = byPostcode.get(postcode);
    if (!entries) return { ...base, postcode, reason: 'unknown_postcode' };
    const zones = zoneSet(entries);
    const out = { ...base, postcode, zones, matchedBy: 'postcode' };
    if (zones.length === 1) return { ...out, zone: zones[0], confident: true };
    return { ...out, reason: 'postcode_spans_zones' };
  }
  return { ...base, reason: 'no_wa_locality' };
}

const REASON_TEXT = {
  no_address: 'the session has no address',
  no_wa_locality: 'no WA suburb or postcode was recognised in the address',
  unknown_postcode: 'the postcode is not a WA postcode in the MMM 2023 table',
  postcode_spans_zones: 'the postcode covers more than one MMM zone and no suburb was recognised',
  postcode_mismatch: "the postcode does not match the suburb",
  straddles_boundary: 'the suburb straddles an MMM zone boundary',
};

function reasonText(reason) { return REASON_TEXT[reason] || reason || ''; }

module.exports = { lookupAddress, reasonText, normName, DATASET_VERSION };
