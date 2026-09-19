'use strict';

/**
 * KNOWN-VALUE MATCHER — a client's own recorded details, caught in any format.
 *
 * Shape rules find "0412 345 678". They do not find "0412-345.678 (mum)", a
 * birth date written 3.4.19 with no "DOB" beside it, or an address typed
 * without its street type. But Splose already records each client's phone,
 * birth date, NDIS number and address — so the question "is THIS number one of
 * ours?" can be answered exactly.
 *
 * WHAT IS HELD IN MEMORY, AND WHAT IS NOT
 *   The recorded values are never kept. Each is normalised (digits only, or
 *   "12 smith"), run through HMAC-SHA-256 with a key generated at random when
 *   this process starts, and DISCARDED. Only the fingerprints remain.
 *   The key exists in this process's memory alone: it is never written to
 *   disk, the database, a log, an environment variable or a response, and it
 *   dies with the process. Fingerprints without the key match nothing, and
 *   nothing here can be listed back out as a phone number or a birth date.
 *   Matching works by fingerprinting each candidate found in the text the
 *   same way and looking it up.
 *
 *   The table is rebuilt every ten minutes from the cached Splose patient
 *   fetch and dropped (with its key) when Splose is disconnected. Nothing in
 *   this file may log a value, a fingerprint, or a count per client.
 */

const crypto = require('crypto');
const sploseApi = require('../splose-api');
const { parseDate, DATE_SHAPES } = require('../ai/deidentify');

const TTL_MS = 10 * 60 * 1000;
let KEY = crypto.randomBytes(32);
let _table = null; // { builtAt, prints: Map<hex, role> }
let _building = null;

const print = (kind, norm) => crypto.createHmac('sha256', KEY).update(`${kind}|${norm}`).digest('hex');

/** Australian phone → national digits: "+61 412 345 678" and "0412345678" are one value. */
function normPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0061')) d = `0${d.slice(4)}`;
  else if (d.startsWith('61') && d.length >= 11) d = `0${d.slice(2)}`;
  return d.length >= 8 ? d : '';
}
const normDate = (p) => (p && p.y && p.y > 1900 ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : '');
/** "Unit 4/12 Smith St" → "12 smith": the house number and the first street word. */
function normAddress(raw) {
  const all = String(raw || '').toLowerCase().match(/(\d{1,5})[a-z]?\s+([a-z][a-z'’-]{2,})/g);
  if (!all) return '';
  const last = all[all.length - 1].match(/(\d{1,5})[a-z]?\s+([a-z][a-z'’-]{2,})/);
  return `${last[1]} ${last[2]}`;
}

async function build() {
  const prints = new Map();
  if (!sploseApi.isConfigured()) return { builtAt: Date.now(), prints };
  const rows = await sploseApi.getPatientIdentifiers();
  for (const r of rows) {
    (r.phones || []).forEach((ph) => {
      const n = normPhone(ph);
      if (!n) return;
      prints.set(print('phone', n), 'phone');
      // A landline is often typed without its area code.
      if (n.length === 10 && /^0[2378]/.test(n)) prints.set(print('phone', n.slice(2)), 'phone');
    });
    const nd = String(r.ndisNumber || '').replace(/\D/g, '');
    if (nd.length >= 8) prints.set(print('ndis_number', nd), 'ndis_number');
    const mc = String(r.medicareNumber || '').replace(/\D/g, '');
    if (mc.length >= 10) prints.set(print('medicare', mc.slice(0, 10)), 'medicare');
    const dob = normDate(parseDate(String(r.dateOfBirth || '').slice(0, 10)));
    if (dob) prints.set(print('dob', dob), 'dob');
    const ad = normAddress(r.addressL1);
    if (ad) prints.set(print('address', ad), 'address');
  }
  return { builtAt: Date.now(), prints };
}

async function load() {
  if (_table && Date.now() - _table.builtAt < TTL_MS) return _table;
  if (!_building) {
    _building = build().then((t) => { _table = t; return t; })
      // A failed rebuild keeps the previous table; with none, matching is off and the shape rules still run.
      .catch((err) => {
        console.warn(`[known-values] rebuild failed (${(err && err.response && err.response.status) || (err && err.code) || 'error'})`);
        return _table || { builtAt: 0, prints: new Map() };
      })
      .finally(() => { _building = null; });
  }
  return _building;
}

const DIGIT_RUN = /\+?\d[\d\s().-]{5,}\d/g;
const ANY_DATE = new RegExp(DATE_SHAPES, 'gi');
const HOUSE = /\b\d{1,5}[a-z]?\s+[A-Za-z][A-Za-z'’-]{2,}/g;

/**
 * A matcher for deidentify()'s `knownSpans` option: given text, the spans that
 * are a recorded client detail. Returns null when there is nothing to match.
 */
async function matcher() {
  const { prints } = await load();
  if (!prints.size) return null;
  return (text) => {
    const spans = [];
    const t = String(text || '');
    let m;
    ANY_DATE.lastIndex = 0;
    while ((m = ANY_DATE.exec(t)) !== null) {
      const p = parseDate(m[0]);
      if (!p || p.y === null) continue;
      const years = p.y < 100 ? [1900 + p.y, 2000 + p.y] : [p.y];
      if (years.some((y) => prints.get(print('dob', normDate({ ...p, y }))) === 'dob')) spans.push({ start: m.index, end: m.index + m[0].length, role: 'dob' });
    }
    DIGIT_RUN.lastIndex = 0;
    while ((m = DIGIT_RUN.exec(t)) !== null) {
      const digits = m[0].replace(/\D/g, '');
      const role = prints.get(print('phone', normPhone(m[0]))) || prints.get(print('phone', digits))
        || prints.get(print('ndis_number', digits)) || prints.get(print('medicare', digits.slice(0, 10)));
      if (role) spans.push({ start: m.index, end: m.index + m[0].length, role });
    }
    HOUSE.lastIndex = 0;
    while ((m = HOUSE.exec(t)) !== null) {
      if (prints.get(print('address', normAddress(m[0]))) === 'address') spans.push({ start: m.index, end: m.index + m[0].length, role: 'address' });
    }
    return spans;
  };
}

/** Drop everything, key included — called when Splose is disconnected or re-keyed. */
function clear() { _table = null; KEY = crypto.randomBytes(32); }

module.exports = { matcher, clear, _normPhone: normPhone, _normAddress: normAddress };
