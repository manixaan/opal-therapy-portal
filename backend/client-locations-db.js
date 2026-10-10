'use strict';

/**
 * CLIENT SERVICE LOCATIONS + TRAVEL DESTINATIONS — data access (migration 072).
 *
 * Smart Booking offers every place a client is known to be seen: the Splose
 * address (read live, never stored here), the extra locations clinicians have
 * added (client_service_locations), and the addresses earlier bookings for the
 * client used (events.location — read, not copied). "Go Somewhere Else" keeps
 * a clinician's own non-client destinations (travel_destinations), which are
 * never tied to a client.
 *
 * Duplicates are caught three ways, in order: the same Google Place ID, the
 * same normalised address ("12 Example St, Como WA 6152" ≡ "12 Example Street,
 * Como WA 6152, Australia"), or coordinates within DUP_RADIUS_M of a saved
 * location. A duplicate is never written — the existing row is returned and
 * marked as used instead.
 *
 * Raw parameterised SQL only. Nothing here logs an address.
 */

const DUP_RADIUS_M = 25;

const LABELS = ['Home', 'School', 'Day Program', 'Work', 'Hospital', 'Other'];

// Street-type and direction words collapse to one spelling so formatting
// differences do not create a second location.
const ABBREV = {
  st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', dr: 'drive', ct: 'court', cres: 'crescent',
  cr: 'crescent', pl: 'place', hwy: 'highway', pde: 'parade', tce: 'terrace', blvd: 'boulevard',
  bvd: 'boulevard', ln: 'lane', cl: 'close', cct: 'circuit', gr: 'grove', sq: 'square', esp: 'esplanade',
  mt: 'mount', n: 'north', s: 'south', e: 'east', w: 'west',
};

function normaliseAddress(input) {
  if (input == null) return '';
  let a = String(input).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  a = a.replace(/,?\s*(australia|au)\s*$/i, '');
  a = a.replace(/\b(western australia|wa)\b/g, ' ');
  a = a.replace(/[^a-z0-9/ ]+/g, ' ');
  a = a.split(/\s+/).filter(Boolean).map((w) => ABBREV[w] || w).join(' ');
  return a.trim().slice(0, 300);
}

function haversineMetres(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const hasCoords = (x) => x && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng))
  && !(Number(x.lat) === 0 && Number(x.lng) === 0);

/** The row in `rows` that `cand` duplicates, or null. Rows use DB column names. */
function findDuplicate(rows, cand) {
  const norm = normaliseAddress(cand.address);
  for (const r of rows) if (cand.placeId && r.place_id && r.place_id === cand.placeId) return r;
  for (const r of rows) if (norm && r.normalized_address === norm) return r;
  if (hasCoords(cand)) {
    const c = { lat: Number(cand.lat), lng: Number(cand.lng) };
    for (const r of rows) {
      if (hasCoords(r) && haversineMetres(c, { lat: Number(r.lat), lng: Number(r.lng) }) <= DUP_RADIUS_M) return r;
    }
  }
  return null;
}

/** Validate and clean a location body. Returns { value } or { error }. */
function cleanLocationInput(body, { labelMax = 40, requireLabel = false } = {}) {
  const b = body || {};
  const address = typeof b.address === 'string' ? b.address.replace(/\0/g, '').trim().slice(0, 300) : '';
  if (address.length < 4) return { error: 'address is required' };
  let label = typeof b.label === 'string' ? b.label.replace(/\0/g, '').trim().slice(0, labelMax) : '';
  if (!label && requireLabel) return { error: 'label is required' };
  const placeId = typeof b.placeId === 'string' && /^[A-Za-z0-9_-]{1,300}$/.test(b.placeId) ? b.placeId : null;
  let lat = b.lat == null || b.lat === '' ? null : Number(b.lat);
  let lng = b.lng == null || b.lng === '' ? null : Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { lat = null; lng = null; }
  return { value: { address, label, placeId, lat, lng, normalized: normaliseAddress(address) } };
}

const toClientLocation = (r) => ({
  id: r.id, label: r.label, address: r.formatted_address, placeId: r.place_id || null,
  lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
  source: r.source, lastUsedAt: r.last_used_at || null, useCount: r.use_count || 0,
});

async function listSavedClientLocations(pool, { clientId, organisationId }) {
  const { rows } = await pool.query(
    `SELECT * FROM client_service_locations
      WHERE client_id = $1 AND archived_at IS NULL
        AND (organisation_id IS NOT DISTINCT FROM $2 OR organisation_id IS NULL)
      ORDER BY last_used_at DESC NULLS LAST, created_at DESC
      LIMIT 50`,
    [String(clientId), organisationId || null]);
  return rows;
}

/** Distinct addresses earlier bookings for this client used. userId null = practice-wide. */
async function previousBookingAddresses(pool, { clientId, userId = null, limit = 10 }) {
  const { rows } = await pool.query(
    `SELECT location, MAX(start_time) AS last_used
       FROM events
      WHERE client_id = $1
        AND location IS NOT NULL AND LENGTH(TRIM(location)) > 3
        AND (is_deleted IS NULL OR is_deleted = FALSE)
        AND ($2::uuid IS NULL OR user_id = $2::uuid)
      GROUP BY location
      ORDER BY MAX(start_time) DESC
      LIMIT $3`,
    [String(clientId), userId, Math.max(1, Math.min(25, limit))]);
  return rows.map((r) => ({ address: String(r.location).trim(), lastUsedAt: r.last_used || null }));
}

/**
 * Save a location for a client unless it duplicates one already saved (or the
 * Splose address, passed as `authoritative`). Returns { location, duplicate, of }.
 * `of` is 'splose' when the candidate is just the Splose address again.
 */
async function addClientLocation(pool, { clientId, organisationId, userId, input, source = 'manual', sourceRef = null, authoritative = null }) {
  if (authoritative && authoritative.address) {
    const dupSplose = findDuplicate([{ normalized_address: normaliseAddress(authoritative.address), place_id: null }], input);
    if (dupSplose) return { location: null, duplicate: true, of: 'splose' };
  }
  const existing = await listSavedClientLocations(pool, { clientId, organisationId });
  const dup = findDuplicate(existing, input);
  if (dup) {
    const { rows } = await pool.query(
      `UPDATE client_service_locations
          SET place_id = COALESCE(place_id, $2), lat = COALESCE(lat, $3), lng = COALESCE(lng, $4),
              updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [dup.id, input.placeId, input.lat, input.lng]);
    return { location: toClientLocation(rows[0] || dup), duplicate: true, of: 'saved' };
  }
  const label = LABELS.includes(input.label) ? input.label : (input.label || 'Other');
  const { rows } = await pool.query(
    `INSERT INTO client_service_locations
       (organisation_id, client_id, label, formatted_address, normalized_address, place_id, lat, lng,
        source, source_ref, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [organisationId || null, String(clientId), label.slice(0, 40), input.address, input.normalized,
      input.placeId, input.lat, input.lng, source, sourceRef, userId || null]);
  if (!rows.length) {
    // Lost a race with an identical insert: report the row that won.
    const again = findDuplicate(await listSavedClientLocations(pool, { clientId, organisationId }), input);
    return { location: again ? toClientLocation(again) : null, duplicate: true, of: 'saved' };
  }
  return { location: toClientLocation(rows[0]), duplicate: false, of: null };
}

async function markClientLocationUsed(pool, { clientId, locationId }) {
  const { rows } = await pool.query(
    `UPDATE client_service_locations
        SET use_count = use_count + 1, last_used_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND client_id = $2 AND archived_at IS NULL
      RETURNING *`,
    [locationId, String(clientId)]);
  return rows[0] ? toClientLocation(rows[0]) : null;
}

const toDestination = (r) => ({
  id: r.id, label: r.label, address: r.formatted_address, placeId: r.place_id || null,
  lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
  lastUsedAt: r.last_used_at || null, useCount: r.use_count || 0,
});

async function listDestinations(pool, { userId }) {
  const { rows } = await pool.query(
    `SELECT * FROM travel_destinations
      WHERE user_id = $1 AND archived_at IS NULL
      ORDER BY last_used_at DESC NULLS LAST, created_at DESC
      LIMIT 30`,
    [userId]);
  return rows;
}

/** Remember a destination (or bump the existing duplicate). */
async function upsertDestination(pool, { userId, input }) {
  const existing = await listDestinations(pool, { userId });
  const dup = findDuplicate(existing, input);
  if (dup) {
    const { rows } = await pool.query(
      `UPDATE travel_destinations
          SET use_count = use_count + 1, last_used_at = NOW(), updated_at = NOW(),
              place_id = COALESCE(place_id, $2), lat = COALESCE(lat, $3), lng = COALESCE(lng, $4)
        WHERE id = $1 AND user_id = $5 RETURNING *`,
      [dup.id, input.placeId, input.lat, input.lng, userId]);
    return { destination: toDestination(rows[0] || dup), duplicate: true };
  }
  const { rows } = await pool.query(
    `INSERT INTO travel_destinations
       (user_id, label, formatted_address, normalized_address, place_id, lat, lng, use_count, last_used_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,NOW())
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [userId, (input.label || input.address).slice(0, 80), input.address, input.normalized, input.placeId, input.lat, input.lng]);
  if (!rows.length) {
    const again = findDuplicate(await listDestinations(pool, { userId }), input);
    return { destination: again ? toDestination(again) : null, duplicate: true };
  }
  return { destination: toDestination(rows[0]), duplicate: false };
}

module.exports = {
  DUP_RADIUS_M, LABELS,
  normaliseAddress, haversineMetres, findDuplicate, cleanLocationInput,
  toClientLocation, toDestination,
  listSavedClientLocations, previousBookingAddresses, addClientLocation, markClientLocationUsed,
  listDestinations, upsertDestination,
};
