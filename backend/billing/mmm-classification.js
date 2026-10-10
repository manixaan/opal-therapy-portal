'use strict';

/**
 * MMM CLASSIFICATION SERVICE
 *
 *   client service address → geocode (lat/lng) → official MMM boundary
 *   lookup (active dataset) → MM 1–7 + source/version → stored on the
 *   billing profile.
 *
 * Never postcode-based. The dataset is the Department of Health MMM shapefile
 * imported by scripts/import-mmm-dataset.js into mmm_datasets /
 * mmm_dataset_rings; a new release is a new dataset row, so billing code does
 * not change when MMM is re-issued.
 *
 * Re-use: a stored zone is reused while the address and the active dataset
 * version are unchanged (address fingerprint). A manual override (owner,
 * with reason, audited by the caller) always wins.
 *
 * Low confidence — the point sits within ~250 m of a zone boundary, geocoding
 * was imprecise, or the point is outside every polygon — is stored as
 * REVIEW and surfaces as a Needs Attention issue instead of being billed.
 */

const crypto = require('crypto');
const G = require('./mmm-geometry');
const { getMapsProvider } = require('./maps-adapter');

const PROBE_DEG = 0.01; // bbox pre-filter margin (> the 250 m probe)

function normaliseAddress(a) {
  return String(a || '').toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim();
}

function addressFingerprint(address, datasetVersion) {
  return crypto.createHash('sha256').update(`${normaliseAddress(address)}|${datasetVersion || ''}`).digest('hex');
}

async function activeDataset(q) {
  const { rows: [d] } = await q.query(
    `SELECT id, version, source, source_url, published_on FROM mmm_datasets WHERE is_active LIMIT 1`);
  return d || null;
}

function bufferToFloat64(buf) {
  // Copy into an aligned buffer — pg returns a Buffer view that may be unaligned.
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return new Float64Array(ab);
}

/** Classify a WGS84/GDA point against the active dataset. */
async function lookupPoint(q, lng, lat, dataset) {
  const ds = dataset || await activeDataset(q);
  if (!ds) return { mmm: null, confident: false, reason: 'no_active_dataset' };
  const { rows } = await q.query(
    `SELECT mmm, min_lng, min_lat, max_lng, max_lat, coords FROM mmm_dataset_rings
      WHERE dataset_id = $1 AND min_lng <= $2::float8 + $4::float8 AND max_lng >= $2::float8 - $4::float8
        AND min_lat <= $3::float8 + $4::float8 AND max_lat >= $3::float8 - $4::float8`,
    [ds.id, lng, lat, PROBE_DEG]);
  const rings = rows.map(r => ({
    mmm: Number(r.mmm),
    bbox: [Number(r.min_lng), Number(r.min_lat), Number(r.max_lng), Number(r.max_lat)],
    coords: bufferToFloat64(r.coords),
  }));
  return { ...G.classifyWithConfidence(rings, lng, lat), datasetVersion: ds.version };
}

/** The zone billing uses for a profile, or null when unresolved / under review. */
function effectiveMmm(profile) {
  if (!profile) return null;
  if (profile.mmm_manual_override) return Number(profile.mmm_manual_override);
  if (profile.mmm_zone && profile.mmm_confidence === 'CONFIDENT') return Number(profile.mmm_zone);
  return null;
}

function mmmSnapshot(profile) {
  if (!profile) return null;
  if (profile.mmm_manual_override) {
    return { zone: Number(profile.mmm_manual_override), source: 'manual_override', reason: profile.mmm_override_reason,
      overriddenAt: profile.mmm_override_at, computedZone: profile.mmm_zone ?? null, datasetVersion: profile.mmm_dataset_version };
  }
  return { zone: profile.mmm_zone ?? null, source: profile.mmm_source, datasetVersion: profile.mmm_dataset_version,
    checkedAt: profile.mmm_checked_at, confidence: profile.mmm_confidence };
}

/**
 * Ensure the profile carries a current classification. Network (geocode) may
 * happen here, so call with the pool, before the invoicing transaction.
 * @returns the refreshed profile row
 */
async function ensureClassified(q, profile, { force = false } = {}) {
  if (!profile) return profile;
  const address = profile.service_address;
  if (!address || !String(address).trim()) return profile;
  const ds = await activeDataset(q);
  const version = ds ? ds.version : null;
  const fp = addressFingerprint(address, version);
  if (!force && profile.mmm_address_fingerprint === fp && profile.mmm_checked_at) return profile;

  let lat = profile.latitude, lng = profile.longitude, precise = true, geocodeSource = profile.geocode_source;
  const addressChanged = profile.mmm_address_fingerprint
    && profile.mmm_address_fingerprint !== addressFingerprint(address, profile.mmm_dataset_version);
  if (lat == null || lng == null || addressChanged || force) {
    const g = await getMapsProvider().geocode(address);
    if (g) { lat = g.lat; lng = g.lng; precise = g.precise !== false; geocodeSource = g.provider || 'geocoder'; }
    else { lat = null; lng = null; }
  }

  let result;
  if (lat == null || lng == null) result = { mmm: null, confident: false, reason: 'geocode_failed' };
  else if (!ds) result = { mmm: null, confident: false, reason: 'no_active_dataset' };
  else {
    result = await lookupPoint(q, Number(lng), Number(lat), ds);
    if (result.mmm != null && !precise && result.confident) result = { ...result, confident: false, reason: 'imprecise_geocode' };
  }

  const { rows: [updated] } = await q.query(
    `UPDATE billing_profiles SET latitude = $2, longitude = $3, geocode_source = $4, mmm_zone = $5,
            mmm_source = $6, mmm_dataset_version = $7, mmm_checked_at = NOW(), mmm_confidence = $8,
            mmm_review_reason = $9, mmm_address_fingerprint = $10, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [profile.id, lat, lng, geocodeSource || null, result.mmm, result.mmm != null ? 'dataset' : null, version,
      result.mmm != null && result.confident ? 'CONFIDENT' : 'REVIEW', result.reason || null, fp]);
  return updated;
}

module.exports = {
  addressFingerprint, activeDataset, lookupPoint, effectiveMmm, mmmSnapshot, ensureClassified, bufferToFloat64,
};
