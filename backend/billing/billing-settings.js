'use strict';

/**
 * BILLING SETTINGS — one row per organisation, created on first use.
 *
 * Business name / address / phone / email are NOT duplicated: when the billing
 * row leaves them blank they fall back to the organisation settings the
 * Settings tab already manages (org_settings). ABN, payment details, footer,
 * numbering and billing policy live here because nothing held them before.
 */

const SETTINGS_FIELDS = {
  invoicePrefix: 'invoice_prefix',
  nextInvoiceNumber: 'next_invoice_number',
  invoiceNumberPadding: 'invoice_number_padding',
  paymentTermsDays: 'payment_terms_days',
  businessName: 'business_name',
  abn: 'abn',
  businessEmail: 'business_email',
  businessPhone: 'business_phone',
  businessAddress: 'business_address',
  paymentDetails: 'payment_details',
  invoiceFooter: 'invoice_footer',
  returnTravelPayable: 'return_travel_payable',
  defaultTaxTreatment: 'default_tax_treatment',
  defaultTripAllocationMethod: 'default_trip_allocation_method',
  completionRule: 'completion_rule',
  timezone: 'timezone',
  sessionDescription: 'session_description',
};

function rowToSettings(r) {
  const out = {};
  for (const [k, col] of Object.entries(SETTINGS_FIELDS)) out[k] = r[col];
  out.nextInvoiceNumber = Number(out.nextInvoiceNumber);
  out.invoiceNumberPadding = Number(out.invoiceNumberPadding);
  out.paymentTermsDays = Number(out.paymentTermsDays);
  out.updatedAt = r.updated_at;
  return out;
}

async function ensureSettings(q, orgId) {
  await q.query(`INSERT INTO billing_settings (organisation_id) VALUES ($1) ON CONFLICT DO NOTHING`, [orgId]);
  const { rows: [r] } = await q.query(`SELECT * FROM billing_settings WHERE organisation_id = $1`, [orgId]);
  return rowToSettings(r);
}

/** org_settings (Settings tab) — org row merged over the 'opal' singleton. */
async function loadOrgProfile(q, orgId) {
  const { rows } = await q.query(
    `SELECT org_id, settings FROM org_settings WHERE org_id = ANY($1::text[])`, [[String(orgId), 'opal']]);
  const base = (rows.find(r => r.org_id === 'opal') || {}).settings || {};
  const own = (rows.find(r => r.org_id === String(orgId)) || {}).settings || {};
  const s = { ...base, ...own };
  return {
    name: s.name || null,
    businessAddress: s.businessAddress || null,
    businessPhone: s.businessPhone || null,
    businessEmail: s.businessEmail || null,
    website: s.website || null,
  };
}

/** The business identity printed on an invoice. */
async function businessProfile(q, orgId) {
  const [st, org] = await Promise.all([ensureSettings(q, orgId), loadOrgProfile(q, orgId)]);
  return {
    name: st.businessName || org.name || 'Opal Therapy',
    abn: st.abn || null,
    email: st.businessEmail || org.businessEmail || null,
    phone: st.businessPhone || org.businessPhone || null,
    address: st.businessAddress || org.businessAddress || null,
    website: org.website || null,
    paymentDetails: st.paymentDetails || null,
    footer: st.invoiceFooter || null,
    paymentTermsDays: st.paymentTermsDays,
  };
}

function validateSettingsPatch(patch) {
  const errors = [];
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in SETTINGS_FIELDS)) continue;
    switch (k) {
      case 'nextInvoiceNumber':
        if (!(Number.isInteger(Number(v)) && Number(v) > 0)) errors.push('nextInvoiceNumber must be a positive whole number');
        else out[k] = Number(v);
        break;
      case 'invoiceNumberPadding':
        if (!(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 10)) errors.push('invoiceNumberPadding must be 0–10');
        else out[k] = Number(v);
        break;
      case 'paymentTermsDays':
        if (!(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 365)) errors.push('paymentTermsDays must be 0–365');
        else out[k] = Number(v);
        break;
      case 'returnTravelPayable':
        out[k] = v === true || v === 'true';
        break;
      case 'defaultTaxTreatment':
        if (!['GST_FREE', 'GST_10_EXCLUSIVE'].includes(v)) errors.push('defaultTaxTreatment is invalid'); else out[k] = v;
        break;
      case 'defaultTripAllocationMethod':
        if (!['EQUAL_PER_CLIENT', 'PER_SESSION', 'MANUAL_WEIGHTED'].includes(v)) errors.push('defaultTripAllocationMethod is invalid'); else out[k] = v;
        break;
      case 'completionRule':
        if (!['PAST_CONFIRMED', 'EXPLICIT_ONLY'].includes(v)) errors.push('completionRule is invalid'); else out[k] = v;
        break;
      case 'abn': {
        const digits = String(v || '').replace(/\s+/g, '');
        if (digits && !/^\d{11}$/.test(digits)) errors.push('ABN must be 11 digits');
        else out[k] = digits ? `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}` : null;
        break;
      }
      case 'invoicePrefix':
        if (!/^[A-Za-z0-9\-_/]{0,20}$/.test(String(v || ''))) errors.push('invoicePrefix may use letters, digits, - _ / (max 20)');
        else out[k] = String(v || '');
        break;
      case 'timezone':
        if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(String(v || ''))) errors.push('timezone is invalid'); else out[k] = v;
        break;
      default:
        out[k] = v == null ? null : String(v).slice(0, 4000);
    }
  }
  return { errors, values: out };
}

async function updateSettings(q, orgId, userId, values) {
  await ensureSettings(q, orgId);
  const sets = [];
  const params = [orgId];
  for (const [k, v] of Object.entries(values)) {
    params.push(v);
    sets.push(`${SETTINGS_FIELDS[k]} = $${params.length}`);
  }
  if (!sets.length) return ensureSettings(q, orgId);
  params.push(userId || null);
  await q.query(
    `UPDATE billing_settings SET ${sets.join(', ')}, updated_by_user_id = $${params.length}, updated_at = NOW()
      WHERE organisation_id = $1`, params);
  return ensureSettings(q, orgId);
}

function formatInvoiceNumber(prefix, n, padding) {
  return `${prefix || ''}${padding ? String(n).padStart(padding, '0') : String(n)}`;
}

/**
 * Allocates the next invoice number under a row lock, skipping any number
 * already used (e.g. the owner lowered the counter). Must run in a transaction.
 */
async function allocateInvoiceNumber(q, orgId) {
  await ensureSettings(q, orgId);
  const { rows: [s] } = await q.query(
    `SELECT invoice_prefix, next_invoice_number, invoice_number_padding FROM billing_settings
      WHERE organisation_id = $1 FOR UPDATE`, [orgId]);
  let n = Number(s.next_invoice_number);
  for (let guard = 0; guard < 10000; guard++, n++) {
    const candidate = formatInvoiceNumber(s.invoice_prefix, n, Number(s.invoice_number_padding));
    const { rows } = await q.query(
      `SELECT 1 FROM invoices WHERE organisation_id = $1 AND invoice_number = $2`, [orgId, candidate]);
    if (!rows.length) {
      await q.query(`UPDATE billing_settings SET next_invoice_number = $2 WHERE organisation_id = $1`, [orgId, n + 1]);
      return candidate;
    }
  }
  throw new Error('Could not allocate an invoice number');
}

module.exports = {
  SETTINGS_FIELDS, ensureSettings, loadOrgProfile, businessProfile, validateSettingsPatch,
  updateSettings, formatInvoiceNumber, allocateInvoiceNumber,
};
