'use strict';

/**
 * CLIENT BILLING PROFILES — keyed by the Splose patient id (events.client_id),
 * because the portal has no local clients table.
 *
 * A profile is created as a stub (name only) the first time invoicing meets a
 * client; nothing is invented — a missing payer or NDIS number becomes a
 * Needs Attention issue. The owner completes the profile by hand or imports
 * name / NDIS number / address from Splose.
 */

const MANAGEMENT_TYPES = ['PLAN_MANAGED', 'SELF_MANAGED', 'NDIA_MANAGED', 'OTHER'];
const PAYER_TYPES = ['PLAN_MANAGER', 'PARTICIPANT', 'NOMINEE', 'OTHER'];

const EDITABLE = {
  participantName: 'participant_name',
  ndisNumber: 'ndis_number',
  planStart: 'plan_start',
  planEnd: 'plan_end',
  managementType: 'management_type',
  payerType: 'payer_type',
  payerName: 'payer_name',
  payerEmail: 'payer_email',
  payerReference: 'payer_reference',
  payerAddress: 'payer_address',
  participantBillingAddress: 'participant_billing_address',
  defaultPractitionerUserId: 'default_practitioner_user_id',
  serviceAddress: 'service_address',
  billingNotes: 'billing_notes',
  paymentTermsDays: 'payment_terms_days',
};

function validateProfilePatch(patch) {
  const errors = [];
  const values = {};
  for (const [k, raw] of Object.entries(patch || {})) {
    if (!(k in EDITABLE)) continue;
    const v = raw === '' ? null : raw;
    switch (k) {
      case 'ndisNumber':
        if (v != null && !/^\d{9}$/.test(String(v).replace(/\s+/g, ''))) errors.push('NDIS number must be 9 digits');
        else values[k] = v == null ? null : String(v).replace(/\s+/g, '');
        break;
      case 'managementType':
        if (v != null && !MANAGEMENT_TYPES.includes(v)) errors.push('managementType is invalid'); else values[k] = v;
        break;
      case 'payerType':
        if (v != null && !PAYER_TYPES.includes(v)) errors.push('payerType is invalid'); else values[k] = v;
        break;
      case 'payerEmail':
        if (v != null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) errors.push('payerEmail is invalid'); else values[k] = v;
        break;
      case 'planStart': case 'planEnd':
        if (v != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors.push(`${k} must be YYYY-MM-DD`); else values[k] = v;
        break;
      case 'paymentTermsDays':
        if (v != null && !(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 365)) errors.push('paymentTermsDays must be 0–365');
        else values[k] = v == null ? null : Number(v);
        break;
      case 'defaultPractitionerUserId':
        if (v != null && !/^[0-9a-f-]{36}$/i.test(String(v))) errors.push('defaultPractitionerUserId is invalid'); else values[k] = v;
        break;
      default:
        values[k] = v == null ? null : String(v).slice(0, 2000);
    }
  }
  return { errors, values };
}

/**
 * Who the invoice goes to. Returns null when the profile cannot say — the
 * caller raises CLIENT_MISSING_PAYER rather than guessing.
 */
function resolvePayer(p) {
  if (!p) return null;
  const type = p.payer_type || (p.management_type === 'SELF_MANAGED' ? 'PARTICIPANT' : null);
  if (!type) return null;
  if (type === 'PARTICIPANT') {
    const name = p.payer_name || p.participant_name;
    if (!name) return null;
    return { type, name, email: p.payer_email || null, reference: p.payer_reference || null,
      address: p.payer_address || p.participant_billing_address || null };
  }
  if (!p.payer_name) return null;
  return { type, name: p.payer_name, email: p.payer_email || null, reference: p.payer_reference || null,
    address: p.payer_address || null };
}

/** Stable grouping key: invoices never mix payers. */
function payerKey(payer) {
  if (!payer) return 'MISSING';
  return `${payer.type}|${String(payer.email || payer.name || '').trim().toLowerCase()}`;
}

/** NDIS number is required unless the payer is a private/other arrangement. */
function ndisNumberRequired(p) {
  return !p || p.management_type !== 'OTHER';
}

async function getProfilesByClient(q, orgId, clientIds) {
  if (!clientIds.length) return new Map();
  const { rows } = await q.query(
    `SELECT * FROM billing_profiles WHERE organisation_id = $1 AND client_id = ANY($2::text[])`, [orgId, clientIds]);
  return new Map(rows.map(r => [r.client_id, r]));
}

/** Create stub profiles (name only) for clients that have none. */
async function ensureStubProfiles(q, orgId, clients) {
  for (const c of clients) {
    await q.query(
      `INSERT INTO billing_profiles (organisation_id, client_id, participant_name)
       VALUES ($1,$2,$3) ON CONFLICT (organisation_id, client_id) DO NOTHING`,
      [orgId, c.clientId, c.clientName || null]);
  }
}

async function listProfiles(q, orgId, { search, limit = 500 } = {}) {
  const params = [orgId];
  let where = 'bp.organisation_id = $1';
  if (search) {
    params.push(`%${String(search).toLowerCase()}%`);
    where += ` AND (LOWER(bp.participant_name) LIKE $2 OR bp.ndis_number LIKE $2 OR LOWER(bp.payer_name) LIKE $2 OR bp.client_id LIKE $2)`;
  }
  params.push(Math.min(Number(limit) || 500, 2000));
  const { rows } = await q.query(
    `SELECT bp.*, u.name AS default_practitioner_name,
            (SELECT COUNT(*)::int FROM billing_issues b WHERE b.organisation_id = bp.organisation_id
               AND b.client_id = bp.client_id AND b.status = 'OPEN') AS open_issues
       FROM billing_profiles bp LEFT JOIN users u ON u.id = bp.default_practitioner_user_id
      WHERE ${where} ORDER BY LOWER(COALESCE(bp.participant_name, bp.client_id)) LIMIT $${params.length}`, params);
  return rows;
}

async function getProfile(q, orgId, clientId) {
  const { rows: [r] } = await q.query(
    `SELECT * FROM billing_profiles WHERE organisation_id = $1 AND client_id = $2`, [orgId, clientId]);
  return r || null;
}

async function upsertProfile(q, orgId, clientId, userId, values) {
  await q.query(
    `INSERT INTO billing_profiles (organisation_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [orgId, clientId]);
  const before = await getProfile(q, orgId, clientId);
  const sets = [];
  const params = [orgId, clientId];
  for (const [k, v] of Object.entries(values)) {
    params.push(v);
    sets.push(`${EDITABLE[k]} = $${params.length}`);
  }
  // A changed service address invalidates the stored coordinates.
  if ('serviceAddress' in values && (before.service_address || '') !== (values.serviceAddress || '')) {
    sets.push('latitude = NULL', 'longitude = NULL', 'mmm_checked_at = NULL');
  }
  params.push(userId || null);
  sets.push(`updated_by_user_id = $${params.length}`, 'updated_at = NOW()');
  const { rows: [after] } = await q.query(
    `UPDATE billing_profiles SET ${sets.join(', ')} WHERE organisation_id = $1 AND client_id = $2 RETURNING *`, params);
  return { before, after };
}

async function setMmmOverride(q, orgId, clientId, userId, { zone, reason }) {
  const before = await getProfile(q, orgId, clientId);
  if (!before) return { error: 'NOT_FOUND' };
  const { rows: [after] } = await q.query(
    `UPDATE billing_profiles SET mmm_manual_override = $3, mmm_override_reason = $4,
            mmm_override_by_user_id = $5, mmm_override_at = CASE WHEN $3::smallint IS NULL THEN NULL ELSE NOW() END,
            updated_at = NOW()
      WHERE organisation_id = $1 AND client_id = $2 RETURNING *`,
    [orgId, clientId, zone == null ? null : Number(zone), zone == null ? null : reason, zone == null ? null : userId]);
  return { before, after };
}

/** Fills blank name / NDIS number / service address from a Splose patient. Never overwrites owner data. */
function fieldsFromSplosePatient(patient, existing) {
  const out = {};
  if (!patient) return out;
  if (!existing || !existing.participant_name) out.participantName = patient.fullName || null;
  if ((!existing || !existing.ndis_number) && patient.ndisNumber && /^\d{9}$/.test(String(patient.ndisNumber).replace(/\s+/g, ''))) {
    out.ndisNumber = String(patient.ndisNumber).replace(/\s+/g, '');
  }
  if ((!existing || !existing.service_address) && patient.formattedAddress) out.serviceAddress = patient.formattedAddress;
  return out;
}

module.exports = {
  MANAGEMENT_TYPES, PAYER_TYPES, EDITABLE, validateProfilePatch, resolvePayer, payerKey, ndisNumberRequired,
  getProfilesByClient, ensureStubProfiles, listProfiles, getProfile, upsertProfile, setMmmOverride,
  fieldsFromSplosePatient,
};
