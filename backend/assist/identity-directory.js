'use strict';

/**
 * PRACTICE-WIDE IDENTITY DIRECTORY — everyone the practice knows about.
 *
 * The case-note de-identifier works because it is told exactly whose names
 * may appear (one client, their contacts, the therapist). Opal Assist has no
 * linked client: someone may paste anything. So the directory is the whole
 * practice — Splose patients and their contacts, Splose practitioners, and
 * portal staff — and the matcher is deliberately STRICTER than the case-note
 * one: exact variants only (no phonetic near-misses), single-word variants
 * only when the word is four letters or more and not an everyday word.
 * Hundreds of names with fuzzy matching would hide ordinary English.
 *
 * Nothing here is written to the database. The directory is rebuilt from
 * Splose (already cached in-process for ten minutes) and the users table on
 * demand and cached here for the same window. Entries carry a stable `ref`
 * (e.g. `splose:patient:88167`) so a token can be mapped back to a person
 * without ever storing the name beside a transcript.
 *
 * Nothing in this file may log a name.
 */

const db = require('../database');
const sploseApi = require('../splose-api');

const CACHE_TTL_MS = 10 * 60 * 1000;
let _cache = null; // { builtAt, people }
let _building = null;

/** Everyday words that are also names — never matched on their own. */
const EVERYDAY = new Set((
  'april may june august autumn summer winter rose lily daisy ivy holly hazel amber ruby pearl jade '
  + 'grace hope faith joy mercy victor victoria major minor bill will mark art dawn eve jack john james '
  + 'sunny skye storm river brook forest hunter mason carter cooper baker miller taylor smith young king '
  + 'brown green white black grey gray gold silver stone wood hill lake dale ford field long short strong '
  + 'read reid rich wells park parks price page bell hall wall day knight ray bright west east north south '
  + 'town city state bank church chase dean earl frank guy jean joy kay lane lee lou max moore neil noel '
  + 'paige patience penny reed sage sky star tex wade ward wren'
).split(/\s+/));

const lower = (s) => String(s || '').trim().toLowerCase();
const nameOf = (o) => (o && (o.fullName || `${o.firstname || o.firstName || ''} ${o.lastname || o.lastName || ''}`.trim() || o.name || '')) || '';

/**
 * Build the strict variant set for one name: full name, "First Last",
 * "F Last", and each part of four letters or more that is not an everyday
 * word. No diminutives, no phonetics.
 */
function strictVariants(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).map((p) => p.replace(/[^A-Za-z'’-]/g, '')).filter((p) => p.length > 1);
  const out = new Set();
  if (!parts.length) return out;
  out.add(parts.join(' ').toLowerCase());
  if (parts.length >= 2) {
    out.add(`${parts[0]} ${parts[parts.length - 1]}`.toLowerCase());
    out.add(`${parts[0][0]} ${parts[parts.length - 1]}`.toLowerCase());
  }
  parts.forEach((p) => {
    const w = p.toLowerCase();
    if (w.length >= 4 && !EVERYDAY.has(w)) out.add(w);
    p.split('-').forEach((h) => { const hw = h.toLowerCase(); if (hw.length >= 5 && !EVERYDAY.has(hw)) out.add(hw); });
  });
  return out;
}

/**
 * The four sources. Each returns [{role, ref, name}] and is remembered on its
 * own, so one source failing (a Splose timeout, a 429 while the sync is busy)
 * never takes away names the directory already knew: the last good copy of
 * that source is used and the result is NOT marked partial. A source with no
 * good copy yet IS partial, is named to the caller, and the directory is
 * rebuilt after thirty seconds rather than the usual ten minutes — a partial
 * directory held for ten minutes let real client names through the check
 * (staging, 19 Sep 2026).
 */
const SOURCES = [
  { key: 'splose_clients', label: 'Splose clients', splose: true,
    run: async () => (await sploseApi.getPatients()).map((p) => ({ role: 'client', ref: `splose:patient:${p.id}`, name: nameOf(p) })) },
  { key: 'splose_contacts', label: 'Splose contacts', splose: true,
    run: async () => ((await sploseApi.getContacts()) || []).filter((c) => c && !c.archived && !c.deletedAt)
      .map((c) => ({ role: 'contact', ref: `splose:contact:${c.id}`, name: nameOf(c) })) },
  { key: 'splose_practitioners', label: 'Splose practitioners', splose: true,
    run: async () => (await sploseApi.getPractitioners()).map((p) => ({ role: 'therapist', ref: `splose:practitioner:${p.id}`, name: nameOf(p) })) },
  { key: 'portal_staff', label: 'Portal staff', splose: false,
    run: async () => {
      const q = await db.pool.query('SELECT id, name, display_name FROM users WHERE is_active = TRUE AND (name IS NOT NULL OR display_name IS NOT NULL)');
      const out = [];
      q.rows.forEach((u) => {
        out.push({ role: 'staff', ref: `user:${u.id}`, name: u.display_name || u.name });
        if (u.display_name && u.name && lower(u.display_name) !== lower(u.name)) out.push({ role: 'staff', ref: `user:${u.id}:name`, name: u.name });
      });
      return out;
    } },
];
const PARTIAL_TTL_MS = 30 * 1000;
const _lastGood = new Map(); // source key → people[]

/** People from Splose and the portal; a failed source falls back to its last good copy. */
async function gather() {
  const active = SOURCES.filter((src) => !src.splose || sploseApi.isConfigured());
  const results = await Promise.allSettled(active.map((src) => src.run()));
  const people = []; const missing = []; const stale = [];
  results.forEach((r, i) => {
    const src = active[i];
    if (r.status === 'fulfilled') { _lastGood.set(src.key, r.value); people.push(...r.value); return; }
    // Status code and source name only — never a name, never a payload.
    const code = (r.reason && r.reason.response && r.reason.response.status) || (r.reason && r.reason.code) || 'error';
    if (_lastGood.has(src.key)) { stale.push(src.label); people.push(..._lastGood.get(src.key)); console.warn(`[identity-directory] ${src.key} unavailable (${code}) — using its last good copy`); }
    else { missing.push(src.label); console.warn(`[identity-directory] ${src.key} unavailable (${code}) — no earlier copy, directory is partial`); }
  });
  const notConnected = SOURCES.filter((src) => src.splose && !sploseApi.isConfigured()).map((src) => src.label);
  return { people: people.filter((p) => String(p.name || '').trim().length >= 2).map((p) => ({ ...p, name: String(p.name).trim() })), partial: missing.length > 0, missing, stale, notConnected };
}

/** The directory, cached ten minutes (thirty seconds while partial); concurrent callers share one build. */
async function load({ fresh = false } = {}) {
  if (!fresh && _cache && Date.now() - _cache.builtAt < (_cache.partial ? PARTIAL_TTL_MS : CACHE_TTL_MS)) return _cache;
  if (!_building) {
    _building = gather().then(({ people, partial, missing, stale, notConnected }) => {
      const seen = new Set();
      const entries = [];
      for (const p of people) {
        const key = `${p.role}|${lower(p.name)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const variants = strictVariants(p.name);
        if (!variants.size) continue;
        entries.push({ role: p.role, ref: p.ref, name: p.name, variants });
      }
      _cache = { builtAt: Date.now(), entries, partial, missing, stale, notConnected, count: entries.length };
      return _cache;
    }).finally(() => { _building = null; });
  }
  return _building;
}

function invalidate() { _cache = null; }
function _resetForTests() { _cache = null; _building = null; _lastGood.clear(); }

/** Resolve a stable ref back to a directory entry (or null). */
async function byRef(ref) {
  const d = await load();
  return d.entries.find((e) => e.ref === ref) || null;
}

module.exports = { load, invalidate, byRef, strictVariants, EVERYDAY, _resetForTests, _setCacheForTests: (c) => { _cache = c ? { builtAt: Date.now(), ...c } : null; } };
