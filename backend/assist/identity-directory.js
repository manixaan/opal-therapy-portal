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

/** People from Splose and the portal; failures in one source do not empty the others. */
async function gather() {
  const people = [];
  const push = (role, ref, name) => {
    const n = String(name || '').trim();
    if (n.length >= 2) people.push({ role, ref, name: n });
  };
  const tasks = [
    sploseApi.isConfigured() ? sploseApi.getPatients().then((rows) => rows.forEach((p) => push('client', `splose:patient:${p.id}`, nameOf(p)))) : Promise.resolve(),
    sploseApi.isConfigured() ? sploseApi.getContacts().then((rows) => (rows || []).forEach((c) => {
      if (c && (c.archived || c.deletedAt)) return;
      push('contact', `splose:contact:${c.id}`, nameOf(c));
    })) : Promise.resolve(),
    sploseApi.isConfigured() ? sploseApi.getPractitioners().then((rows) => rows.forEach((p) => push('therapist', `splose:practitioner:${p.id}`, nameOf(p)))) : Promise.resolve(),
    db.pool.query('SELECT id, name, display_name FROM users WHERE is_active = TRUE AND (name IS NOT NULL OR display_name IS NOT NULL)')
      .then((q) => q.rows.forEach((u) => { push('staff', `user:${u.id}`, u.display_name || u.name); if (u.display_name && u.name && lower(u.display_name) !== lower(u.name)) push('staff', `user:${u.id}:name`, u.name); })),
  ];
  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed) console.warn(`[identity-directory] ${failed} of ${tasks.length} sources unavailable — directory is partial`);
  return { people, partial: failed > 0 };
}

/** The directory, cached ten minutes; concurrent callers share one build. */
async function load({ fresh = false } = {}) {
  if (!fresh && _cache && Date.now() - _cache.builtAt < CACHE_TTL_MS) return _cache;
  if (!_building) {
    _building = gather().then(({ people, partial }) => {
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
      _cache = { builtAt: Date.now(), entries, partial, count: entries.length };
      return _cache;
    }).finally(() => { _building = null; });
  }
  return _building;
}

function invalidate() { _cache = null; }

/** Resolve a stable ref back to a directory entry (or null). */
async function byRef(ref) {
  const d = await load();
  return d.entries.find((e) => e.ref === ref) || null;
}

module.exports = { load, invalidate, byRef, strictVariants, EVERYDAY, _setCacheForTests: (c) => { _cache = c ? { builtAt: Date.now(), ...c } : null; } };
