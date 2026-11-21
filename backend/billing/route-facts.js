'use strict';

/**
 * ROUTE FACTS — persisted minutes + km per origin→destination.
 *
 * The calendar caches Google routes for ten minutes in the browser; billing
 * needs the same facts to be stable and reusable, so the first answer is
 * stored in travel_route_facts and reused by every later run. An owner may
 * enter a manual fact (audited) when Google cannot route a leg.
 *
 * The key canonicalisation mirrors travel.js `canonAddr`/`routeKey`, so the
 * same address strings the calendar routes resolve to the same fact here.
 */

const { getMapsProvider } = require('./maps-adapter');

/* Before 21 Nov 2026 a Splose "Street, Suburb, WA, 6108" or a Google
   "…, Suburb WA 6108, Australia" kept the empty segments state/postcode/country
   left behind ("street, suburb, ,"), so one place had several keys. Facts
   already stored under such a key — an owner's manual fact included — are
   still found through legacyRouteKey. Never change this function. */
function legacyCanonAddr(input) {
  if (input == null) return '';
  return String(input)
    .toLowerCase()
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\b(wa|western australia|australia)\b/g, '')
    .replace(/\s*\d{4}\b/g, '')
    .replace(/[^\w ,\-]/g, '')
    .trim();
}

/* Identical to travel.js canonAddr — travel-address-suburb.test.js runs both
   over the same strings. */
function canonAddr(input) {
  if (input == null) return '';
  return legacyCanonAddr(input)
    .replace(/\s*,(\s*,)+/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function routeKey(origin, destination) {
  return `${canonAddr(origin)}|${canonAddr(destination)}|driving`;
}
function legacyRouteKey(origin, destination) {
  return `${legacyCanonAddr(origin)}|${legacyCanonAddr(destination)}|driving`;
}

// A failed lookup is retried on a later run, but not more than this often.
const FAILED_RETRY_MS = 10 * 60 * 1000;

/**
 * Resolve facts for many legs. Cached rows are read in one query; misses are
 * fetched from the provider (sequentially, de-duplicated) and persisted.
 * @param {object} q     pool (NOT a transaction client — network calls happen here)
 * @param {Array<{origin, destination}>} pairs
 * @returns {Map<routeKey, {minutes, km, provider, status}>}
 */
async function resolveRouteFacts(q, orgId, pairs) {
  const wanted = new Map();
  for (const p of pairs) {
    if (!p.origin || !p.destination) continue;
    wanted.set(routeKey(p.origin, p.destination), p);
  }
  const out = new Map();
  if (!wanted.size) return out;
  const legacy = new Map();
  for (const [key, p] of wanted) {
    const old = legacyRouteKey(p.origin, p.destination);
    if (old !== key) legacy.set(key, old);
  }
  const { rows } = await q.query(
    `SELECT route_key, minutes, km, provider, status, fetched_at FROM travel_route_facts
      WHERE organisation_id = $1 AND route_key = ANY($2::text[])`, [orgId, [...wanted.keys(), ...legacy.values()]]);
  const cached = new Map(rows.map(r => [r.route_key, r]));
  for (const [key, pair] of wanted) {
    let hit = cached.get(key);
    // A fact stored under the pre-21-Nov key still counts when it is good.
    if ((!hit || hit.status !== 'ok') && legacy.has(key)) {
      const old = cached.get(legacy.get(key));
      if (old && old.status === 'ok') hit = old;
    }
    if (hit && hit.status === 'ok') {
      out.set(key, { minutes: Number(hit.minutes), km: hit.km == null ? null : Number(hit.km), provider: hit.provider, status: 'ok', cached: true });
      continue;
    }
    if (hit && hit.status === 'failed' && Date.now() - new Date(hit.fetched_at).getTime() < FAILED_RETRY_MS) {
      out.set(key, { status: 'failed', cached: true });
      continue;
    }
    // Same place → a zero leg, no provider call.
    if (canonAddr(pair.origin) === canonAddr(pair.destination)) {
      out.set(key, { minutes: 0, km: 0, provider: 'same_location', status: 'ok', cached: false });
      continue;
    }
    const fact = await getMapsProvider().route(pair.origin, pair.destination);
    if (fact && Number.isFinite(Number(fact.minutes))) {
      await q.query(
        `INSERT INTO travel_route_facts (organisation_id, route_key, origin, destination, minutes, km, provider, status, attempts, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ok',1,NOW())
         ON CONFLICT (organisation_id, route_key) DO UPDATE SET minutes = EXCLUDED.minutes, km = EXCLUDED.km,
           provider = EXCLUDED.provider, status = 'ok', attempts = travel_route_facts.attempts + 1, fetched_at = NOW()
         WHERE travel_route_facts.status = 'failed'`,
        [orgId, key, String(pair.origin).slice(0, 1000), String(pair.destination).slice(0, 1000), fact.minutes, fact.km ?? null, fact.provider || 'google_routes']);
      out.set(key, { minutes: Number(fact.minutes), km: fact.km == null ? null : Number(fact.km), provider: fact.provider || 'google_routes', status: 'ok', cached: false });
    } else {
      await q.query(
        `INSERT INTO travel_route_facts (organisation_id, route_key, origin, destination, status, attempts, fetched_at)
         VALUES ($1,$2,$3,$4,'failed',1,NOW())
         ON CONFLICT (organisation_id, route_key) DO UPDATE SET status = 'failed',
           attempts = travel_route_facts.attempts + 1, fetched_at = NOW()
         WHERE travel_route_facts.status = 'failed'`,
        [orgId, key, String(pair.origin).slice(0, 1000), String(pair.destination).slice(0, 1000)]);
      out.set(key, { status: 'failed', cached: false });
    }
  }
  return out;
}

/** Owner-entered fact for a leg Google could not route (audited by the caller). */
async function setManualRouteFact(q, orgId, userId, { origin, destination, minutes, km, reason }) {
  const key = routeKey(origin, destination);
  const { rows: [before] } = await q.query(
    `SELECT minutes, km, provider, status FROM travel_route_facts WHERE organisation_id = $1 AND route_key = $2`, [orgId, key]);
  await q.query(
    `INSERT INTO travel_route_facts (organisation_id, route_key, origin, destination, minutes, km, provider, status, set_by_user_id, override_reason, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,'manual','ok',$7,$8,NOW())
     ON CONFLICT (organisation_id, route_key) DO UPDATE SET minutes = EXCLUDED.minutes, km = EXCLUDED.km,
       provider = 'manual', status = 'ok', set_by_user_id = EXCLUDED.set_by_user_id,
       override_reason = EXCLUDED.override_reason, fetched_at = NOW()`,
    [orgId, key, String(origin).slice(0, 1000), String(destination).slice(0, 1000), minutes, km, userId || null, reason]);
  return { key, before: before || null };
}

module.exports = { canonAddr, routeKey, legacyRouteKey, resolveRouteFacts, setManualRouteFact };
