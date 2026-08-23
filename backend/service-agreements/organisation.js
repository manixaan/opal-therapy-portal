'use strict';

/**
 * SERVICE AGREEMENT — THE PROVIDER'S OWN IDENTITY
 *
 * A service agreement names the provider: legal entity, ABN, NDIS registration
 * number, registered address, and who to contact about a complaint or a
 * privacy question. Those are the practice's facts, not a participant's and
 * not a staff member's.
 *
 * ── WHERE THIS LIVES, AND WHY IT IS NOT A NEW TABLE ────────────────────────
 * Before this feature the portal had nowhere to put them. `organisations` is
 * (id, name, created_at) and nothing more; `org_settings.settings` is a JSONB
 * bag holding four letterhead keys (businessAddress / Phone / Email / website)
 * behind an owner-only PATCH allowlist in app-routes.js.
 *
 * A new `organisation_profiles` table would be the tidier schema and the wrong
 * call: this IS organisation settings, it is owner-controlled, and org_settings
 * already has the owner-only write path, the merge rule (organisation row over
 * the 'opal' singleton) and a reader other document types share. Adding a
 * second store would mean the letter's letterhead and the agreement's provider
 * block could disagree about the practice's own phone number.
 *
 * So the values live under ONE key, `serviceAgreement`, inside the existing
 * settings object, and are read through the existing merge.
 *
 * ── VALIDATION IS REAL, NOT COSMETIC ───────────────────────────────────────
 * An ABN is checked against the ATO's modulus-89 algorithm — the same one
 * onboarding-engine.js already implements for employee super funds. A wrong
 * ABN on a service agreement is a compliance defect that survives into every
 * agreement issued from the day it was typed, and it is cheap to catch here.
 * An NDIS registration number is checked for shape only: the Commission
 * publishes no checksum, and inventing one would reject valid numbers.
 *
 * ── THE SNAPSHOT IS THE POINT ──────────────────────────────────────────────
 * `snapshotFor()` returns the provider block as scalar values, and an issued
 * agreement stores that snapshot. Changing the practice's phone number
 * tomorrow must not rewrite an agreement a participant signed last month:
 * what they signed said what it said.
 */

const { pool } = require('../database');
const map = require('./template-map');

/**
 * Owner-writable keys under `org_settings.settings.serviceAgreement`.
 *
 * An allowlist, not a merge of whatever was posted: the settings object is
 * shared with several other features and a caller must not be able to reach
 * them through this endpoint.
 */
const SETTINGS_FIELDS = [
  { key: 'legalName', label: 'Legal entity name', tag: 'OPAL_ORG_LEGAL_NAME', max: 200 },
  { key: 'tradingName', label: 'Trading name', tag: 'OPAL_ORG_TRADING_NAME', max: 200 },
  { key: 'abn', label: 'ABN', tag: 'OPAL_ORG_ABN', max: 20 },
  { key: 'ndisRegistrationNumber', label: 'NDIS registration number', tag: 'OPAL_ORG_NDIS_REGISTRATION_NUMBER', max: 40 },
  { key: 'complaintsContact', label: 'Complaints contact', tag: 'OPAL_ORG_COMPLAINTS_CONTACT', max: 300 },
  { key: 'privacyContact', label: 'Privacy contact', tag: 'OPAL_ORG_PRIVACY_CONTACT', max: 300 },
  { key: 'paymentTermsDays', label: 'Payment terms in days', tag: 'OPAL_PAYMENT_TERMS_DAYS', max: 10 },
];

/** Keys that already exist in org_settings and are reused rather than copied. */
const SHARED_FIELDS = [
  { keys: ['businessAddress', 'address'], tag: 'OPAL_ORG_ADDRESS' },
  { keys: ['businessPhone', 'phone'], tag: 'OPAL_ORG_PHONE' },
  { keys: ['businessEmail', 'email'], tag: 'OPAL_ORG_EMAIL' },
  { keys: ['website', 'websiteUrl'], tag: 'OPAL_ORG_WEBSITE' },
  { keys: ['name'], tag: 'OPAL_ORG_TRADING_NAME' },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ATO's ABN check: subtract 1 from the first digit, apply the fixed
 * weights, and the weighted sum must be divisible by 89.
 *
 * Reimplemented rather than imported from onboarding-engine.js on purpose —
 * that module reaches the database and the onboarding catalogue, and this file
 * is required by the pure document path. The algorithm is eleven weights and a
 * modulus; sharing it would cost more than restating it.
 */
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

function isValidAbn(value) {
  const digits = String(value || '').replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i += 1) {
    const d = Number(digits[i]) - (i === 0 ? 1 : 0);
    sum += d * ABN_WEIGHTS[i];
  }
  return sum % 89 === 0;
}

/** "51824753556" → "51 824 753 556". The ATO's own presentation. */
function formatAbn(value) {
  const d = String(value || '').replace(/\s/g, '');
  if (!/^\d{11}$/.test(d)) return String(value || '').trim();
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 11)}`;
}

/**
 * Validate a settings patch. Returns `{ values, errors }`.
 *
 * Every field is optional: a practice part-way through NDIS registration
 * genuinely has no registration number, and refusing to save the rest until
 * they have one would stop them using the feature at all. What is NOT
 * tolerated is a value that is present and wrong.
 */
function validateSettings(input) {
  const values = {};
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};

  for (const f of SETTINGS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(src, f.key)) continue;
    const raw = src[f.key];
    if (raw === null || raw === '') { values[f.key] = null; continue; }

    const s = String(raw).trim();
    if (s.length > f.max) {
      errors.push({ field: f.key, message: `${f.label} must be ${f.max} characters or fewer.` });
      continue;
    }

    if (f.key === 'abn') {
      if (!isValidAbn(s)) {
        errors.push({
          field: 'abn',
          message: 'That ABN is not valid. An ABN is 11 digits and must pass the ATO check.',
        });
        continue;
      }
      values.abn = formatAbn(s);
      continue;
    }

    if (f.key === 'ndisRegistrationNumber') {
      // Shape only. The Commission publishes no checksum, so anything stricter
      // would reject real registration numbers.
      if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/.test(s)) {
        errors.push({
          field: 'ndisRegistrationNumber',
          message: 'An NDIS registration number may contain letters, numbers, spaces and hyphens.',
        });
        continue;
      }
      values.ndisRegistrationNumber = s;
      continue;
    }

    if (f.key === 'paymentTermsDays') {
      if (!/^\d{1,3}$/.test(s) || Number(s) < 1 || Number(s) > 365) {
        errors.push({
          field: 'paymentTermsDays',
          message: 'Payment terms must be a whole number of days between 1 and 365.',
        });
        continue;
      }
      values.paymentTermsDays = String(Number(s));
      continue;
    }

    values[f.key] = s;
  }

  return { values, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Read / write
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The merged settings object for an organisation: the 'opal' installation
 * singleton overlaid by the organisation's own row. Same rule as
 * fca/data-layers.js loadOrganisationSettings, so the two cannot disagree.
 */
async function loadRawSettings(organisationId, q = pool) {
  const keys = organisationId ? [String(organisationId), 'opal'] : ['opal'];
  const { rows } = await q.query(
    'SELECT org_id, settings FROM org_settings WHERE org_id = ANY($1::text[])',
    [keys]
  );
  const byId = new Map(rows.map((r) => [r.org_id, r.settings || {}]));
  return {
    ...(byId.get('opal') || {}),
    ...(organisationId ? (byId.get(String(organisationId)) || {}) : {}),
  };
}

/** The owner-facing settings view: every field, with its current value. */
async function getSettings(organisationId, q = pool) {
  const merged = await loadRawSettings(organisationId, q);
  const sa = (merged && typeof merged.serviceAgreement === 'object' && merged.serviceAgreement)
    ? merged.serviceAgreement : {};

  const out = {};
  for (const f of SETTINGS_FIELDS) out[f.key] = sa[f.key] || null;

  // The four shared letterhead values are shown here read-only, so an owner
  // filling in the provider block can see what the agreement will actually say
  // without opening a second settings screen.
  out.shared = {
    businessAddress: pickString(merged, 'businessAddress', 'address'),
    businessPhone: pickString(merged, 'businessPhone', 'phone'),
    businessEmail: pickString(merged, 'businessEmail', 'email'),
    website: pickString(merged, 'website', 'websiteUrl'),
    organisationName: pickString(merged, 'name'),
  };

  out.complete = requiredMissing(out).length === 0;
  out.missing = requiredMissing(out);
  return out;
}

/**
 * Fields without which an agreement should not be ISSUED.
 *
 * Deliberately short. An agreement that does not name the legal entity or its
 * ABN is not a contract anybody should sign, and a participant cannot raise a
 * complaint against a provider whose complaints contact is blank. Everything
 * else can reasonably be absent.
 */
function requiredMissing(settings) {
  const missing = [];
  if (!settings.legalName) missing.push('legalName');
  if (!settings.abn) missing.push('abn');
  if (!settings.complaintsContact) missing.push('complaintsContact');
  if (!settings.shared || !settings.shared.businessAddress) missing.push('businessAddress');
  return missing;
}

/**
 * Write the patch. Read-modify-write inside a transaction with a row lock: two
 * owners saving different fields at once must not lose one of the edits, and
 * the settings object is shared with other features whose keys must survive.
 */
async function saveSettings(organisationId, patch, q = null) {
  const { values, errors } = validateSettings(patch);
  if (errors.length) return { ok: false, errors };

  const orgKey = organisationId ? String(organisationId) : 'opal';
  const client = q || await pool.connect();
  const owned = !q;

  try {
    if (owned) await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT settings FROM org_settings WHERE org_id = $1 FOR UPDATE', [orgKey]
    );
    const current = rows.length ? (rows[0].settings || {}) : {};
    const sa = { ...(current.serviceAgreement || {}) };

    for (const [k, v] of Object.entries(values)) {
      if (v === null) delete sa[k];
      else sa[k] = v;
    }

    const next = { ...current, serviceAgreement: sa };
    await client.query(
      `INSERT INTO org_settings (org_id, settings, updated_at)
            VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (org_id) DO UPDATE SET settings = $2::jsonb, updated_at = NOW()`,
      [orgKey, JSON.stringify(next)]
    );

    if (owned) await client.query('COMMIT');
    return { ok: true, errors: [] };
  } catch (err) {
    if (owned) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (owned) client.release();
  }
}

/**
 * The provider block as scalar values, ready for the manifest.
 *
 * Returned as `{ values, sources, missing }` so the wizard can say WHERE each
 * value came from and which are absent, exactly as the FCA resolver does.
 */
async function snapshotFor(organisationId, q = pool) {
  const merged = await loadRawSettings(organisationId, q);
  const sa = (merged && typeof merged.serviceAgreement === 'object' && merged.serviceAgreement)
    ? merged.serviceAgreement : {};

  const values = {};
  const sources = {};
  const missing = [];

  for (const f of SETTINGS_FIELDS) {
    const v = sa[f.key];
    if (typeof v === 'string' && v.trim()) {
      values[f.tag] = v.trim();
      sources[f.tag] = 'organisation_settings';
    }
  }

  for (const f of SHARED_FIELDS) {
    if (values[f.tag]) continue;   // a serviceAgreement value already won
    const v = pickString(merged, ...f.keys);
    if (v) {
      values[f.tag] = v;
      sources[f.tag] = 'organisation_settings';
    }
  }

  for (const tag of map.OWNER_TAGS) {
    if (!values[tag]) missing.push(tag);
  }

  return { values, sources, missing };
}

function pickString(obj, ...names) {
  for (const n of names) {
    const v = obj ? obj[n] : null;
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

module.exports = {
  SETTINGS_FIELDS,
  getSettings,
  saveSettings,
  validateSettings,
  snapshotFor,
  requiredMissing,
  isValidAbn,
  formatAbn,
  loadRawSettings,
};
