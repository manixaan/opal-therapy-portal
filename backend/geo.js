/**
 * SCHEDULER GEOGRAPHY (Phase 5) — privacy-first location helpers.
 *
 * The scheduler map answers "what part of WA is this therapist working in?"
 * — it deliberately works at SUBURB precision. Exact street addresses are
 * never geocoded for map purposes and never leave the server through the
 * map payload.
 *
 * Pure helpers here (suburb extraction, payload allowlist) are unit-tested
 * without a database; centroid resolution uses the suburb_centroids cache
 * and geocodes a safe "<Suburb> WA Australia" string at most once, with a
 * bounded failure backoff.
 */

'use strict';

const axios = require('axios');

// Virtual locations are not geography.
const VIRTUAL_RE = /\b(teams|zoom|online|telehealth|virtual|video|phone)\b/i;

/**
 * Conservative suburb extraction from free-text event locations.
 * Mirrors the frontend rule set: strip country/state/postcode tails, take the
 * last comma component without digits; a digits-only street line yields ''.
 * Structured input (object with suburb) is preferred when present.
 */
function extractSuburb(location) {
  if (location && typeof location === 'object') {
    if (location.suburb) return String(location.suburb).trim();
    location = location.address || location.label || '';
  }
  let s = String(location || '').trim();
  if (!s) return '';
  if (VIRTUAL_RE.test(s)) return '';
  s = s.replace(/,?\s*(Australia)\s*$/i, '');
  s = s.replace(/,?\s*(WA|Western Australia)\s*\.?\s*(\d{4})?\s*$/i, '');
  s = s.replace(/\s+\d{4}\s*$/, '');
  // "Home - Willetton" style prefixes
  s = s.replace(/^\s*(home|office|clinic|school)\s*[-–—:]\s*/i, '');
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  const last = parts[parts.length - 1];
  if (parts.length === 1) return /\d/.test(last) ? '' : (last.length <= 40 ? last : '');
  return /\d/.test(last) ? extractSuburb(parts.slice(0, -1).join(', ')) : last;
}

function suburbKey(suburb, state) {
  return String(suburb || '').trim().toLowerCase().replace(/\s+/g, ' ') + '|' + String(state || 'WA').toUpperCase();
}

/**
 * Explicit allowlist serializer for map points (§32 of the phase spec).
 * Constructs the safe object — never strips fields from a full event.
 */
function buildSchedulerMapPoint(ev, therapist, centroid, startMin, endMin) {
  return {
    eventId: ev.id,
    therapistProfileId: therapist.therapistProfileId,
    therapistName: therapist.displayName,
    therapistColour: therapist.colour || '#0f7c6c',
    startMin,
    endMin,
    suburb: centroid.suburb,
    lat: centroid.lat,
    lng: centroid.lng,
    precision: 'suburb',
  };
}

const FAIL_LIMIT = 3;
const FAIL_RETRY_MS = 7 * 24 * 3600 * 1000; // a failed locality rests for a week

/**
 * Resolve centroids for a set of suburbs using the cache; geocode misses
 * server-side with the safe locality string only. Returns Map(key → row).
 */
async function resolveCentroids(pool, suburbs, state = 'WA') {
  const wanted = new Map(); // key -> display suburb
  suburbs.forEach((s) => { if (s) wanted.set(suburbKey(s, state), s); });
  if (!wanted.size) return new Map();

  const keys = [...wanted.keys()];
  const { rows } = await pool.query(
    'SELECT * FROM suburb_centroids WHERE suburb_key = ANY($1)', [keys]);
  const found = new Map(rows.map((r) => [r.suburb_key, r]));

  const key = process.env.GOOGLE_MAPS_API_KEY || '';
  for (const [k, display] of wanted) {
    const row = found.get(k);
    if (row && row.status === 'ok') continue;
    if (row && row.status === 'failed' &&
        (row.attempts >= FAIL_LIMIT && Date.now() - new Date(row.updated_at).getTime() < FAIL_RETRY_MS)) {
      continue; // resting after repeated failures
    }
    if (!key) continue; // no provider available — degrade gracefully

    let lat = null, lng = null, postcode = null, ok = false;
    try {
      const resp = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: {
          address: `${display} ${state} Australia`, // suburb-level string ONLY
          key, region: 'au', components: `country:AU|administrative_area:${state}`,
        },
        timeout: 6000,
      });
      const best = resp.data && resp.data.results && resp.data.results[0];
      if (best && best.geometry && best.geometry.location) {
        lat = best.geometry.location.lat;
        lng = best.geometry.location.lng;
        const pc = (best.address_components || []).find((c) => c.types.includes('postal_code'));
        postcode = pc ? pc.short_name : null;
        ok = true;
      }
    } catch (_) { /* recorded below */ }

    const upsert = await pool.query(
      `INSERT INTO suburb_centroids (suburb_key, suburb, state, postcode, lat, lng, status, attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
       ON CONFLICT (suburb_key) DO UPDATE SET
         lat = EXCLUDED.lat, lng = EXCLUDED.lng, postcode = EXCLUDED.postcode,
         status = EXCLUDED.status,
         attempts = suburb_centroids.attempts + 1,
         updated_at = NOW()
       RETURNING *`,
      [k, display, state, postcode, lat, lng, ok ? 'ok' : 'failed']);
    found.set(k, upsert.rows[0]);
  }

  // only usable centroids
  const usable = new Map();
  found.forEach((r, k) => { if (r.status === 'ok' && r.lat != null) usable.set(k, r); });
  return usable;
}

module.exports = { extractSuburb, suburbKey, buildSchedulerMapPoint, resolveCentroids, VIRTUAL_RE };
