'use strict';

/**
 * PAYER DIRECTORY (migration 083) — Opal's own memory of who invoices go to.
 *
 *   billing_payers          the payers: plan managers, participants, nominees.
 *   billing_payer_invoices  every invoice sent, and to whom: all Splose
 *                           invoices (imported), then each finalised Opal one.
 *
 * Seeded from Splose: each Splose invoice names a contact. Contacts of the same
 * type and name are one payer (Splose holds two "NDSP" plan-manager contacts),
 * so the directory has no duplicates. After that Opal keeps it up to date on
 * its own, so it keeps working once Splose invoicing is switched off.
 *
 * A client whose profile has no payer gets the payer of their latest invoice
 * in this history, provided it fits their plan management. A new client has no
 * history: the owner picks a payer from the directory or adds a new one, and
 * that is remembered for every later invoice.
 *
 * Imports only fill blanks. A payer the owner has edited is never overwritten.
 */

const { recordAudit } = require('./billing-audit');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PAYER_TYPES = ['PLAN_MANAGER', 'PARTICIPANT', 'NOMINEE', 'OTHER'];
const NOMINEE_CONTACT_TYPES = ['mother', 'father', 'parent', 'guardian', 'nominee', 'carer', 'spouse', 'partner'];

/** "NDSP ", "ndsp", "N.D.S.P." are one key; "Plan-Manager" is "plan manager". */
function nameKey(name) {
  return String(name || '').toLowerCase().normalize('NFKD')
    .replace(/[-_/&+]+/g, ' ').replace(/[^a-z0-9 ]+/g, '').trim().replace(/\s+/g, ' ');
}

function validEmail(e) {
  const v = String(e || '').trim();
  return v && EMAIL_RE.test(v) ? v : null;
}

/** Splose contact type → payer type. */
function payerTypeForContact(contact) {
  const t = String((contact && contact.type) || '').trim().toLowerCase();
  if (t === 'plan manager') return 'PLAN_MANAGER';
  if (t === 'client') return 'PARTICIPANT';
  if (NOMINEE_CONTACT_TYPES.includes(t)) return 'NOMINEE';
  return 'OTHER';
}

/**
 * Does this payer fit the client's plan management? Fail-closed:
 *   plan-managed → only a plan manager; self-managed → anyone but a plan
 *   manager; NDIA-managed or unknown → nobody (NDIA claims go through the portal).
 */
function fitsManagement(payerType, management) {
  if (management === 'PLAN_MANAGED') return payerType === 'PLAN_MANAGER';
  if (management === 'SELF_MANAGED' || management === 'OTHER') return payerType !== 'PLAN_MANAGER';
  return false;
}

/**
 * A calendar date. Splose sends local midnight as UTC ("2026-10-28T16:00:00Z"
 * is 29 Oct in Perth); pg returns a DATE as a local-midnight Date.
 */
function isoDay(v, tz = 'Australia/Perth') {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return null;
  if (v instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Pure: turn Splose invoices + contacts into payers and per-invoice records.
 * Archived invoices and invoices with no (or a nameless) contact are left out.
 * A payer's email is taken from the most recently invoiced contact that has one.
 */
function buildFromSplose(invoices, contacts) {
  const byId = new Map((contacts || []).map(c => [String(c.id), c]));
  const payers = new Map();   // `${type}|${key}` → payer
  const records = [];
  const sorted = [...(invoices || [])].sort((a, b) => String(b.issueDate || '').localeCompare(String(a.issueDate || '')) || Number(b.id) - Number(a.id));
  for (const inv of sorted) {
    if (!inv || inv.isArchived || inv.patientId == null || inv.contactId == null) continue;
    const c = byId.get(String(inv.contactId));
    const key = c ? nameKey(c.name) : '';
    if (!c || !key) continue;
    const type = payerTypeForContact(c);
    const k = `${type}|${key}`;
    let p = payers.get(k);
    if (!p) {
      p = { type, name: String(c.name).trim(), nameKey: key, email: null, contactIds: new Set(), invoiceCount: 0 };
      payers.set(k, p);
    }
    p.contactIds.add(String(c.id));
    p.invoiceCount++;
    if (!p.email) p.email = validEmail(c.email);   // newest first: the first email seen is the most recent
    records.push({ payerKey: k, clientId: String(inv.patientId), sourceInvoiceId: String(inv.id),
      invoiceNumber: inv.invoiceNumber || null, issueDate: isoDay(inv.issueDate) });
  }
  // Contacts with an email but never invoiced still lend it to a same-named payer.
  for (const c of contacts || []) {
    const p = payers.get(`${payerTypeForContact(c)}|${nameKey(c.name)}`);
    if (p && !p.email) p.email = validEmail(c.email);
    if (p) p.contactIds.add(String(c.id));
  }
  return { payers, records };
}

/**
 * Upsert the Splose history. Idempotent: re-importing the same invoices
 * changes nothing; a Splose invoice moved to another contact is re-pointed.
 * Existing payers only gain blank fields and contact ids.
 */
async function syncFromSplose(q, orgId, { invoices, contacts }, userId = null) {
  const { payers, records } = buildFromSplose(invoices, contacts);
  const ids = new Map();
  let newPayers = 0;
  for (const [k, p] of payers) {
    const { rows: [r] } = await q.query(
      `INSERT INTO billing_payers (organisation_id, payer_type, name, name_key, email, source, splose_contact_ids, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,'SPLOSE_IMPORT',$6,$7)
       ON CONFLICT (organisation_id, payer_type, name_key) DO UPDATE SET
         email = COALESCE(billing_payers.email, EXCLUDED.email),
         splose_contact_ids = ARRAY(SELECT DISTINCT unnest(billing_payers.splose_contact_ids || EXCLUDED.splose_contact_ids)),
         updated_at = CASE WHEN billing_payers.email IS NULL AND EXCLUDED.email IS NOT NULL THEN NOW() ELSE billing_payers.updated_at END
       RETURNING id, (xmax = 0) AS inserted`,
      [orgId, p.type, p.name.slice(0, 255), p.nameKey.slice(0, 255), p.email, [...p.contactIds], userId]);
    ids.set(k, r.id);
    if (r.inserted) newPayers++;
  }
  let newInvoices = 0;
  if (records.length) {
    const { rows } = await q.query(
      `INSERT INTO billing_payer_invoices (organisation_id, payer_id, client_id, source, source_invoice_id, invoice_number, issue_date)
       SELECT $1, x.payer_id, x.client_id, 'SPLOSE', x.source_invoice_id, x.invoice_number, x.issue_date
         FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::date[])
              AS x(payer_id, client_id, source_invoice_id, invoice_number, issue_date)
       ON CONFLICT (organisation_id, source, source_invoice_id) DO UPDATE SET
         payer_id = EXCLUDED.payer_id, client_id = EXCLUDED.client_id,
         invoice_number = EXCLUDED.invoice_number, issue_date = EXCLUDED.issue_date
       RETURNING (xmax = 0) AS inserted`,
      [orgId, records.map(r => ids.get(r.payerKey)), records.map(r => r.clientId), records.map(r => r.sourceInvoiceId),
        records.map(r => r.invoiceNumber), records.map(r => r.issueDate)]);
    newInvoices = rows.filter(r => r.inserted).length;
  }
  const out = { payers: payers.size, newPayers, invoices: records.length, newInvoices,
    clients: new Set(records.map(r => r.clientId)).size };
  if (newPayers || newInvoices) {
    await recordAudit(q, { orgId, actorUserId: userId, action: 'payer_directory.imported_from_splose', entityType: 'payer_directory',
      entityId: String(orgId), after: out });
  }
  return out;
}

/**
 * The payer of the client's latest invoice (Splose or Opal), if it fits their
 * plan management. Only the latest counts: a client who moved plan manager
 * must not be sent back to the old one.
 */
async function latestPayerForClient(q, orgId, clientId, management) {
  const { rows: [r] } = await q.query(
    `SELECT h.source, h.invoice_number, h.issue_date, p.*
       FROM billing_payer_invoices h JOIN billing_payers p ON p.id = h.payer_id
      WHERE h.organisation_id = $1 AND h.client_id = $2
      ORDER BY h.issue_date DESC NULLS LAST, h.created_at DESC LIMIT 1`, [orgId, String(clientId)]);
  if (!r || r.archived || !fitsManagement(r.payer_type, management)) return null;
  return r;
}

/** Where a client's invoices have gone, per payer, newest first. */
async function historyForClient(q, orgId, clientId) {
  const { rows } = await q.query(
    `SELECT p.id AS payer_id, p.name, p.payer_type, p.email, COUNT(*)::int AS invoices,
            MAX(h.issue_date) AS last_issue_date,
            (ARRAY_AGG(h.invoice_number ORDER BY h.issue_date DESC NULLS LAST))[1] AS last_invoice_number,
            (ARRAY_AGG(h.source ORDER BY h.issue_date DESC NULLS LAST))[1] AS last_source
       FROM billing_payer_invoices h JOIN billing_payers p ON p.id = h.payer_id
      WHERE h.organisation_id = $1 AND h.client_id = $2
      GROUP BY p.id ORDER BY MAX(h.issue_date) DESC NULLS LAST`, [orgId, String(clientId)]);
  return rows;
}

async function listPayers(q, orgId, { search, includeArchived = false } = {}) {
  const params = [orgId];
  const where = ['p.organisation_id = $1'];
  if (!includeArchived) where.push('p.archived = FALSE');
  if (search) { params.push(`%${nameKey(search)}%`, `%${String(search).toLowerCase()}%`); where.push(`(p.name_key LIKE $2 OR LOWER(COALESCE(p.email,'')) LIKE $3)`); }
  const { rows } = await q.query(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM billing_payer_invoices h WHERE h.payer_id = p.id) AS invoices,
            (SELECT COUNT(DISTINCT h.client_id)::int FROM billing_payer_invoices h WHERE h.payer_id = p.id) AS history_clients,
            (SELECT MAX(h.issue_date) FROM billing_payer_invoices h WHERE h.payer_id = p.id) AS last_issue_date,
            (SELECT COUNT(*)::int FROM billing_profiles bp WHERE bp.payer_id = p.id) AS linked_clients
       FROM billing_payers p WHERE ${where.join(' AND ')}
      ORDER BY CASE p.payer_type WHEN 'PLAN_MANAGER' THEN 0 ELSE 1 END, LOWER(p.name)`, params);
  return rows;
}

async function getPayer(q, orgId, id) {
  const { rows: [r] } = await q.query(`SELECT * FROM billing_payers WHERE id = $1 AND organisation_id = $2`, [id, orgId]);
  return r || null;
}

function validatePayer(input, { partial = false } = {}) {
  const errors = [];
  const v = {};
  const has = k => Object.prototype.hasOwnProperty.call(input || {}, k);
  if (!partial || has('name')) {
    const name = String((input || {}).name || '').trim();
    if (!name || !nameKey(name)) errors.push('A payer name is required'); else v.name = name.slice(0, 255);
  }
  if (!partial || has('payerType')) {
    if (!PAYER_TYPES.includes(input.payerType)) errors.push('payerType is invalid'); else v.payerType = input.payerType;
  }
  if (has('email')) {
    const e = input.email == null || input.email === '' ? null : String(input.email).trim();
    if (e && !EMAIL_RE.test(e)) errors.push('email is invalid'); else v.email = e;
  }
  if (has('address')) v.address = input.address == null || input.address === '' ? null : String(input.address).slice(0, 2000);
  if (has('reference')) v.reference = input.reference == null || input.reference === '' ? null : String(input.reference).slice(0, 255);
  if (has('archived')) v.archived = input.archived === true || input.archived === 'true';
  return { errors, values: v };
}

/**
 * The directory entry for this payer, created if new. Existing entries are
 * matched by type + name and only gain blank fields: remembering a payer never
 * rewrites one.
 */
async function ensurePayer(q, orgId, { payerType, name, email = null, address = null, reference = null }, userId) {
  const key = nameKey(name);
  if (!key || !PAYER_TYPES.includes(payerType)) return null;
  const { rows: [r] } = await q.query(
    `INSERT INTO billing_payers (organisation_id, payer_type, name, name_key, email, address, reference, source, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'OWNER',$8,$8)
     ON CONFLICT (organisation_id, payer_type, name_key) DO UPDATE SET
       email = COALESCE(billing_payers.email, EXCLUDED.email),
       address = COALESCE(billing_payers.address, EXCLUDED.address),
       reference = COALESCE(billing_payers.reference, EXCLUDED.reference)
     RETURNING *, (xmax = 0) AS inserted`,
    [orgId, payerType, String(name).trim().slice(0, 255), key.slice(0, 255), validEmail(email), address, reference, userId || null]);
  if (r.inserted) {
    await recordAudit(q, { orgId, actorUserId: userId, action: 'payer.created', entityType: 'payer', entityId: r.id,
      after: { payerType, fields: ['name'].concat(email ? ['email'] : [], address ? ['address'] : [], reference ? ['reference'] : []) } });
  }
  return r;
}

/**
 * Edit a directory payer, and carry the change to every client whose profile
 * is linked to it (their next draft refresh picks it up). A name or type that
 * collides with another payer is refused rather than merged.
 */
async function updatePayer(q, orgId, id, values, userId) {
  const before = await getPayer(q, orgId, id);
  if (!before) return { error: 'NOT_FOUND' };
  const cols = { name: 'name', payerType: 'payer_type', email: 'email', address: 'address', reference: 'reference', archived: 'archived' };
  const sets = [];
  const params = [id, orgId];
  for (const [k, v] of Object.entries(values)) { params.push(v); sets.push(`${cols[k]} = $${params.length}`); }
  if ('name' in values) { params.push(nameKey(values.name)); sets.push(`name_key = $${params.length}`); }
  if (!sets.length) return { before, after: before, linkedUpdated: 0 };
  params.push(userId || null);
  sets.push(`updated_by_user_id = $${params.length}`, 'updated_at = NOW()');
  let after;
  try {
    ({ rows: [after] } = await q.query(`UPDATE billing_payers SET ${sets.join(', ')} WHERE id = $1 AND organisation_id = $2 RETURNING *`, params));
  } catch (e) {
    if (e.code === '23505') return { error: 'DUPLICATE' };
    throw e;
  }
  const { rowCount } = await q.query(
    `UPDATE billing_profiles SET payer_type = $3, payer_name = $4, payer_email = $5, payer_address = $6, payer_reference = $7, updated_at = NOW()
      WHERE organisation_id = $1 AND payer_id = $2`,
    [orgId, id, after.payer_type, after.name, after.email, after.address, after.reference]);
  const changed = Object.keys(values).filter(k => String(before[cols[k]] ?? '') !== String(after[cols[k]] ?? ''));
  if (changed.length) {
    await recordAudit(q, { orgId, actorUserId: userId, action: 'payer.updated', entityType: 'payer', entityId: id,
      after: { fields: changed, linkedProfilesUpdated: rowCount } });
  }
  return { before, after, linkedUpdated: rowCount };
}

/**
 * A finalised Opal invoice joins the history, against the directory entry for
 * its recipient (created if new). From here on Opal's own invoices are the memory.
 */
async function recordOpalInvoice(q, orgId, inv, userId) {
  if (!inv || !inv.payer_name || !inv.client_id) return null;
  let payer = null;
  if (inv.billing_profile_id) {
    const { rows: [p] } = await q.query(
      `SELECT bp2.* FROM billing_profiles bp JOIN billing_payers bp2 ON bp2.id = bp.payer_id
        WHERE bp.id = $1 AND bp.organisation_id = $2`, [inv.billing_profile_id, orgId]);
    if (p && p.payer_type === inv.payer_type && p.name_key === nameKey(inv.payer_name)) payer = p;
  }
  if (!payer) {
    payer = await ensurePayer(q, orgId, { payerType: PAYER_TYPES.includes(inv.payer_type) ? inv.payer_type : 'OTHER',
      name: inv.payer_name, email: inv.payer_email, address: inv.payer_address, reference: inv.payer_reference }, userId);
  }
  if (!payer) return null;
  await q.query(
    `INSERT INTO billing_payer_invoices (organisation_id, payer_id, client_id, source, source_invoice_id, invoice_number, issue_date)
     VALUES ($1,$2,$3,'OPAL',$4,$5,$6)
     ON CONFLICT (organisation_id, source, source_invoice_id) DO UPDATE SET payer_id = EXCLUDED.payer_id, invoice_number = EXCLUDED.invoice_number`,
    [orgId, payer.id, String(inv.client_id), String(inv.id), inv.invoice_number, isoDay(inv.issue_date)]);
  return payer;
}

module.exports = {
  PAYER_TYPES, nameKey, payerTypeForContact, fitsManagement, buildFromSplose, syncFromSplose, latestPayerForClient,
  historyForClient, listPayers, getPayer, validatePayer, ensurePayer, updatePayer, recordOpalInvoice, isoDay,
};
