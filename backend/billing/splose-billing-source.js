'use strict';

/**
 * SPLOSE AS A BILLING SOURCE (migration 082) — read-only. Nothing here writes
 * to Splose.
 *
 *   1. Payer. Splose's client record says how the plan is managed
 *      (ndisInfo.fundManagement) but not who the plan manager is. The only
 *      link is the contact on each Splose invoice. Every run imports them
 *      into Opal's payer directory (billing/payer-directory.js), and a blank
 *      payer is filled from the client's latest invoice there. Blanks are
 *      filled; owner data never is.
 *   2. Support activities. Report writing and other work logged in Splose as
 *      a "support activity" is billed as a SPLOSE_ACTIVITY line. An activity
 *      Splose has already invoiced (invoiceId) or marked doNotInvoice is not.
 *   3. Numbering. Opal continues after the highest number Splose has issued
 *      with the same prefix, and a draft whose number Splose has since used is
 *      renumbered before it is finalised.
 *
 * Fail-closed: when Splose is connected but cannot be read completely, the
 * run holds back whatever it would have needed Splose to judge.
 */

const BP = require('./billing-profiles');
const PD = require('./payer-directory');
const { recordAudit } = require('./billing-audit');

let injected = null;
/** Tests replace the Splose client; production uses ../splose-api. */
function setSploseSource(source) { injected = source || null; }
function api() { return injected || require('../splose-api'); }

function isConnected() {
  const a = api();
  return typeof a.isConfigured === 'function' ? !!a.isConfigured() : false;
}

function complete(list) {
  return Array.isArray(list) && list._fetchComplete !== false;
}

function addDaysIso(ymd, n) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/** Latest invoice per patient: issue date, then id. Archived invoices do not count. */
function latestInvoices(invoices) {
  const out = new Map();
  for (const inv of invoices) {
    if (!inv || inv.isArchived || inv.patientId == null) continue;
    const k = String(inv.patientId);
    const cur = out.get(k);
    const newer = !cur || String(inv.issueDate || '') > String(cur.issueDate || '')
      || (String(inv.issueDate || '') === String(cur.issueDate || '') && Number(inv.id) > Number(cur.id));
    if (newer) out.set(k, inv);
  }
  return out;
}

/** Highest numeric suffix among Splose invoice numbers that are exactly prefix + digits. */
function highestNumber(numbers, prefix) {
  const p = String(prefix || '');
  let high = 0;
  for (const n of numbers) {
    const s = String(n || '');
    if (!s.startsWith(p)) continue;
    const rest = s.slice(p.length);
    if (!/^\d+$/.test(rest)) continue;
    high = Math.max(high, Number(rest));
  }
  return high;
}

/**
 * Everything a run needs from Splose, read once.
 * @returns {{status:'OK'|'NOT_CONNECTED'|'UNAVAILABLE', ...}}
 */
async function loadForRun({ from, to }) {
  if (!isConnected()) return { status: 'NOT_CONNECTED' };
  const a = api();
  try {
    // Invoices, activities and appointments decide what is already billed,
    // so they are read fresh; a stale copy could bill something twice.
    const invoices = await a.getInvoices({}, { fresh: true });
    const activities = await a.getSupportActivities({ fresh: true });
    const appointments = await a.getAppointments(addDaysIso(from, -1), addDaysIso(to, 1), null, { fresh: true });
    const contacts = await a.getContacts();
    const patients = await a.getPatientBillingDetails();
    const services = await a.getServices();
    if (![invoices, activities, appointments, contacts, patients].every(complete)) {
      return { status: 'UNAVAILABLE', reason: 'incomplete' };
    }
    const apptPatients = new Map();
    for (const ap of appointments) {
      for (const pt of ap.patients || []) apptPatients.set(`${ap.id}|${pt.patientId}`, pt);
    }
    return {
      status: 'OK',
      invoices,
      latestInvoiceByPatient: latestInvoices(invoices),
      contacts: new Map(contacts.map(c => [String(c.id), c])),
      contactList: contacts,
      patients: new Map(patients.map(p => [String(p.id), p])),
      services: new Map((services || []).map(s => [String(s.id), s])),
      activities,
      apptPatients,
      invoiceNumbers: new Set(invoices.map(i => i.invoiceNumber).filter(Boolean)),
    };
  } catch (_) {
    return { status: 'UNAVAILABLE', reason: 'error' };
  }
}

/** Just what filling one client's profile needs (the client's own invoices, contacts, patient). */
async function loadForClient(clientId) {
  if (!isConnected()) return { status: 'NOT_CONNECTED' };
  const a = api();
  try {
    const invoices = await a.getInvoices({ patientId: clientId }, { fresh: true });
    const contacts = await a.getContacts();
    const patients = await a.getPatientBillingDetails();
    if (![invoices, contacts, patients].every(complete)) return { status: 'UNAVAILABLE', reason: 'incomplete' };
    const own = invoices.filter(i => String(i.patientId) === String(clientId));
    return {
      status: 'OK',
      invoices: own,
      contactList: contacts,
      patients: new Map(patients.map(p => [String(p.id), p])),
    };
  } catch (_) {
    return { status: 'UNAVAILABLE', reason: 'error' };
  }
}

/** Every Splose invoice and contact, for the payer directory import. */
async function loadDirectorySource() {
  if (!isConnected()) return { status: 'NOT_CONNECTED' };
  try {
    const invoices = await api().getInvoices({}, { fresh: true });
    const contacts = await api().getContacts();
    if (![invoices, contacts].every(complete)) return { status: 'UNAVAILABLE', reason: 'incomplete' };
    return { status: 'OK', invoices, contacts };
  } catch (_) {
    return { status: 'UNAVAILABLE', reason: 'error' };
  }
}

// ── 1. Payer ─────────────────────────────────────────────────────────────────

function managementFromFund(fund) {
  const f = String(fund || '').toLowerCase();
  if (!f) return null;
  if (f.includes('plan')) return 'PLAN_MANAGED';
  if (f.includes('self')) return 'SELF_MANAGED';
  if (f.includes('ndia') || f.includes('agency')) return 'NDIA_MANAGED';
  return null;
}

/** The blank client fields Splose's patient record can fill. Owner-entered values are never replaced. */
function sploseProfileFill(data, profile) {
  const patient = data && data.patients ? data.patients.get(String(profile.client_id)) : null;
  if (!patient) return {};
  const values = BP.fieldsFromSplosePatient(patient, profile);
  const management = managementFromFund(patient.fundManagement);
  if (!profile.management_type && management) values.managementType = management;
  return values;
}

/**
 * Fill one profile's blanks. Client details come from Splose's patient record
 * (when Splose was read). The payer comes from the payer directory: the payer
 * of the client's latest invoice, Splose or Opal, if it fits their plan
 * management (billing/payer-directory.js). That works with Splose switched off.
 * The audit lists which fields were filled, never their values.
 */
async function fillProfile(q, orgId, profile, data, userId) {
  const values = sploseProfileFill(data, profile);
  const management = profile.management_type || values.managementType || null;
  let payer = null;
  if (!profile.payer_type && !profile.payer_name && management) {
    payer = await PD.latestPayerForClient(q, orgId, profile.client_id, management);
    if (payer) {
      values.payerType = payer.payer_type;
      values.payerName = payer.name;
      if (payer.email && !profile.payer_email) values.payerEmail = payer.email;
      if (payer.address && !profile.payer_address) values.payerAddress = payer.address;
      if (payer.reference && !profile.payer_reference) values.payerReference = payer.reference;
    }
  }
  if (!Object.keys(values).length) return { profile, fields: [] };
  const r = await BP.upsertProfile(q, orgId, profile.client_id, userId || null, values);
  let after = r.after;
  const detail = payer ? `${payer.source === 'OPAL' ? 'Opal' : 'Splose'} invoice ${payer.invoice_number || ''}`.trim() : null;
  if (payer) {
    const { rows: [p] } = await q.query(
      `UPDATE billing_profiles SET payer_id = $3, payer_source = $4, payer_source_detail = $5
        WHERE organisation_id = $1 AND client_id = $2 RETURNING *`,
      [orgId, profile.client_id, payer.id, payer.source === 'OPAL' ? 'OPAL_INVOICE' : 'SPLOSE_INVOICE', detail.slice(0, 255)]);
    after = p;
  }
  await recordAudit(q, { orgId, actorUserId: userId || null, action: 'billing_profile.imported_from_splose',
    entityType: 'billing_profile', entityId: profile.client_id,
    after: { fields: Object.keys(values), payerSource: detail } });
  return { profile: after, fields: Object.keys(values) };
}

/** Profiles that still lack a payer, an NDIS number or a management type. */
function needsFill(p) {
  return !!p && (!BP.resolvePayer(p) || !p.ndis_number || !p.management_type || !p.service_address);
}

// ── 2. Support activities ───────────────────────────────────────────────────

function localDate(iso, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso));
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "15_617_0128_1_3_RR" → "15_617_0128_1_3" (Splose appends a two-letter claim type). */
function baseItemCode(code) {
  return String(code || '').trim().replace(/_[A-Z]{2}$/, '');
}

/** Splose's own line wording: "FCA (Report Writing)", "Case Management (Occupational Therapy)". */
function serviceLabel(service) {
  if (!service) return null;
  const title = String(service.title || service.name || '').trim();
  const type = String(service.type || '').trim();
  if (!title) return null;
  return type ? `${title} (${type})` : title;
}

/**
 * Splose support activities in [from, to] (local dates) that are candidates
 * for billing, with why each is or is not billable.
 */
function activitiesInRange(data, { from, to, tz }) {
  const out = [];
  for (const a of data.activities) {
    if (!a || a.archived || a.deletedAt || !a.start || !a.end || a.patientId == null) continue;
    const date = localDate(a.start, tz);
    if (date < from || date > to) continue;
    const minutes = Math.round((Date.parse(a.end) - Date.parse(a.start)) / 60000);
    const service = data.services.get(String(a.serviceId)) || null;
    let skip = null;
    if (a.doNotInvoice) skip = 'splose_do_not_invoice';
    else if (a.invoiceId) skip = 'invoiced_in_splose';
    else if (!(minutes > 0 && minutes <= 24 * 60)) skip = 'invalid_duration';
    out.push({ activity: a, id: String(a.id), clientId: String(a.patientId), date, minutes,
      practitionerSploseId: a.practitionerId != null ? String(a.practitionerId) : null,
      serviceTitle: serviceLabel(service), skip });
  }
  return out;
}

/** Splose practitioner id → portal user, from Users & Roles (therapist_profiles.splose_practitioner_id). */
async function practitionerMap(q, orgId) {
  const { rows } = await q.query(
    `SELECT tp.splose_practitioner_id::text AS splose_id, u.id AS user_id, COALESCE(tp.display_name, u.name) AS name
       FROM therapist_profiles tp JOIN users u ON u.id = tp.user_id
      WHERE u.organisation_id = $1 AND tp.splose_practitioner_id IS NOT NULL`, [orgId]);
  return new Map(rows.map(r => [String(r.splose_id), { userId: r.user_id, name: r.name }]));
}

// ── 3. Numbering ────────────────────────────────────────────────────────────

/** Remember Splose's highest number for this prefix (never lowered). */
async function recordSploseHigh(q, orgId, high) {
  if (!(high > 0)) return;
  await q.query(
    `UPDATE billing_settings SET splose_invoice_number_high = GREATEST(COALESCE(splose_invoice_number_high, 0), $2),
            splose_numbers_checked_at = NOW() WHERE organisation_id = $1`, [orgId, high]);
}

/**
 * Is this invoice number free in Splose? Reads Splose fresh.
 * @returns {Promise<{status:'NOT_CONNECTED'|'UNAVAILABLE'|'FREE'|'TAKEN', high?:number}>}
 */
async function checkNumber(q, orgId, number, prefix) {
  if (!isConnected()) return { status: 'NOT_CONNECTED' };
  let invoices;
  try { invoices = await api().getInvoices({}, { fresh: true }); } catch (_) { return { status: 'UNAVAILABLE' }; }
  if (!complete(invoices)) return { status: 'UNAVAILABLE' };
  const numbers = invoices.map(i => i.invoiceNumber).filter(Boolean);
  const high = highestNumber(numbers, prefix);
  await recordSploseHigh(q, orgId, high);
  return { status: numbers.includes(number) ? 'TAKEN' : 'FREE', high };
}

module.exports = {
  setSploseSource, isConnected, loadForRun, loadForClient, loadDirectorySource, managementFromFund, sploseProfileFill,
  fillProfile, needsFill, activitiesInRange, serviceLabel, baseItemCode, practitionerMap, highestNumber, recordSploseHigh,
  checkNumber, localDate, latestInvoices,
};
