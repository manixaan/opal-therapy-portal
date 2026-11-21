'use strict';

/**
 * OPAL INVOICE → XERO (migration 092, 21 Nov 2026).
 *
 * Owner decision: Opal creates and emails the invoice; a copy goes to Xero
 * as AUTHORISED with the SAME invoice number, so the bank feed reconciles it;
 * Xero never emails it (no /Email call, ever); payments flow Xero → Opal.
 *
 * Exactly once, fail-closed:
 *   • the link row is claimed (PENDING) under the invoice's lock before any
 *     Xero call, and every POST carries the same Idempotency-Key for that
 *     invoice, so a retry or a lost response never makes a second invoice;
 *   • before creating, Xero is asked for the invoice number: an existing copy
 *     with the same contact and total is adopted; anything else with that
 *     number stops the push (XERO_NUMBER_CLASH) — never a duplicate number;
 *   • the created invoice's total must equal Opal's to the cent, else it is
 *     voided in Xero at once and the push fails;
 *   • no Xero contact for the payer, no sales account code, or the push not
 *     switched on → nothing is written and the reason is said.
 *
 * Switch: ENABLE_XERO_WRITE=true AND ENABLE_XERO_INVOICE_PUSH=true. When on,
 * an invoice is copied before it is emailed (the email waits for Xero).
 *
 * The Xero HTTP client is injectable (setClient) so tests never touch Xero.
 */

const Settings = require('./billing-settings');
const { recordAudit } = require('./billing-audit');
const M = require('./money');

const FINAL = ['READY', 'SENT', 'PART_PAID', 'PAID'];
function err(status, message, code) { return Object.assign(new Error(message), { status, code }); }

function isEnabled() {
  return process.env.ENABLE_XERO_WRITE === 'true' && process.env.ENABLE_XERO_INVOICE_PUSH === 'true';
}

/* ── Xero client (real one below; tests inject a fake) ─────────────────── */

let client = null;
function setClient(c) { client = c; }

function realClient() {
  const axios = require('axios');
  const xeroApi = require('../xero-api');
  const adb = require('../accounting-db');
  const API = 'https://api.xero.com/api.xro/2.0';
  async function ctx(orgId) {
    const conn = await adb.getConnection(orgId);
    if (!conn) throw err(409, 'Xero is not connected', 'XERO_NOT_CONNECTED');
    const token = await xeroApi.ensureValidToken(conn, (r) => adb.updateConnectionTokens(conn.id, r));
    return { tenantId: conn.xero_tenant_id, headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': conn.xero_tenant_id, Accept: 'application/json' } };
  }
  async function call(fn) {
    for (let attempt = 0; ; attempt++) {
      try { return (await fn()).data; } catch (e) {
        const st = e.response && e.response.status;
        if ((st === 429 || st === 503) && attempt < 3) {
          const wait = Math.min(Number(e.response.headers && e.response.headers['retry-after']) || 2 ** attempt, 30);
          await new Promise(r => setTimeout(r, wait * 1000));
          continue;
        }
        throw e;
      }
    }
  }
  return {
    async tenant(orgId) { return (await ctx(orgId)).tenantId; },
    async findInvoiceByNumber(orgId, number) {
      const c = await ctx(orgId);
      const d = await call(() => axios.get(`${API}/Invoices`, { headers: c.headers, params: { InvoiceNumbers: number, Statuses: 'DRAFT,SUBMITTED,AUTHORISED,PAID' }, timeout: 30000 }));
      return (d && d.Invoices || []).filter(i => i.Type === 'ACCREC');
    },
    async getInvoices(orgId, ids) {
      const c = await ctx(orgId);
      const d = await call(() => axios.get(`${API}/Invoices`, { headers: c.headers, params: { IDs: ids.join(',') }, timeout: 30000 }));
      return d && d.Invoices || [];
    },
    async findContacts(orgId, name) {
      const c = await ctx(orgId);
      const safe = String(name).replace(/"/g, '');
      const d = await call(() => axios.get(`${API}/Contacts`, { headers: c.headers, params: { where: `Name=="${safe}"`, includeArchived: false }, timeout: 30000 }));
      return d && d.Contacts || [];
    },
    async createContact(orgId, { name, email }) {
      const c = await ctx(orgId);
      const d = await call(() => axios.post(`${API}/Contacts`, { Contacts: [{ Name: name, EmailAddress: email || undefined }] }, { headers: c.headers, timeout: 30000 }));
      return d && d.Contacts && d.Contacts[0];
    },
    async createInvoice(orgId, payload, idempotencyKey) {
      const c = await ctx(orgId);
      const d = await call(() => axios.post(`${API}/Invoices`, { Invoices: [payload] },
        { headers: { ...c.headers, 'Idempotency-Key': idempotencyKey }, timeout: 30000 }));
      return d && d.Invoices && d.Invoices[0];
    },
    async voidInvoice(orgId, xeroInvoiceId, idempotencyKey) {
      const c = await ctx(orgId);
      const d = await call(() => axios.post(`${API}/Invoices/${encodeURIComponent(xeroInvoiceId)}`, { Invoices: [{ InvoiceID: xeroInvoiceId, Status: 'VOIDED' }] },
        { headers: { ...c.headers, 'Idempotency-Key': idempotencyKey }, timeout: 30000 }));
      return d && d.Invoices && d.Invoices[0];
    },
  };
}
function xc() { return client || (client = realClient()); }

/** A Xero error as something the owner can act on — never a token or a payload. */
function xeroErrorText(e) {
  if (e && e.code && e.message && e.status) return e.message;
  const st = e && e.response && e.response.status;
  const d = e && e.response && e.response.data;
  const v = d && d.Elements && d.Elements[0] && d.Elements[0].ValidationErrors;
  if (st === 400 && v && v.length) return 'Xero refused it: ' + v.map(x => x.Message).join('; ').slice(0, 300);
  if (st === 401 || st === 403) return 'Xero refused access — reconnect Xero with invoice permission (Accounting › Connect)';
  if (st === 429) return 'Xero is limiting requests; try again in a minute';
  return 'Xero could not be reached';
}

/* ── Pure: the Xero invoice for an Opal invoice ─────────────────────────── */

function buildXeroInvoice(inv, lines, settings, contactId) {
  const taxType = inv.tax_treatment === 'GST_10_EXCLUSIVE' ? settings.xeroTaxTypeGst : settings.xeroTaxTypeGstFree;
  const ymd = v => (typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10));
  return {
    Type: 'ACCREC',
    Status: 'AUTHORISED',
    InvoiceNumber: inv.invoice_number,
    Reference: [inv.client_name, inv.ndis_number ? `NDIS ${inv.ndis_number}` : null].filter(Boolean).join(' · ').slice(0, 255) || undefined,
    Contact: { ContactID: contactId },
    Date: ymd(inv.issue_date),
    DueDate: inv.due_date ? ymd(inv.due_date) : undefined,
    LineAmountTypes: 'Exclusive',
    CurrencyCode: 'AUD',
    LineItems: lines.map(l => ({
      Description: [l.item_code, l.description].filter(Boolean).join(' — ').slice(0, 4000),
      Quantity: Number(l.quantity),
      UnitAmount: Number(l.unit_price),
      LineAmount: Number(l.amount),
      AccountCode: settings.xeroSalesAccountCode,
      TaxType: taxType,
    })),
  };
}

/* ── Contacts ───────────────────────────────────────────────────────────── */

async function resolveContact(pool, orgId, tenantId, inv, userId) {
  const { rows: [m] } = await pool.query(
    `SELECT xero_contact_id FROM xero_payer_contacts WHERE organisation_id = $1 AND xero_tenant_id = $2 AND payer_key = $3`, [orgId, tenantId, inv.payer_key]);
  if (m) return m.xero_contact_id;
  if (!inv.payer_name) throw err(409, 'The invoice has no payer', 'NO_RECIPIENT');
  const found = (await xc().findContacts(orgId, inv.payer_name)).filter(c => c.ContactStatus !== 'ARCHIVED');
  let contactId = null, source = null;
  if (found.length === 1) { contactId = found[0].ContactID; source = 'EXACT_MATCH'; }
  else if (found.length > 1) {
    throw err(409, `Xero has ${found.length} contacts named "${inv.payer_name}". Choose the right one for this payer in Invoicing › Payers.`, 'XERO_CONTACT_AMBIGUOUS');
  } else if (process.env.ENABLE_XERO_WRITE === 'true' && process.env.ENABLE_XERO_CONTACT_CREATE === 'true') {
    const c = await xc().createContact(orgId, { name: inv.payer_name, email: inv.payer_email });
    if (!c || !c.ContactID) throw err(502, 'Xero did not create the contact', 'XERO_CONTACT_FAILED');
    contactId = c.ContactID; source = 'CREATED';
  } else {
    throw err(409, `"${inv.payer_name}" is not a contact in Xero yet. Add it in Xero (exact same name), then send again.`, 'XERO_CONTACT_MISSING');
  }
  await pool.query(
    `INSERT INTO xero_payer_contacts (organisation_id, payer_key, xero_tenant_id, xero_contact_id, contact_name, source, set_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (organisation_id, xero_tenant_id, payer_key) DO NOTHING`,
    [orgId, inv.payer_key, tenantId, contactId, inv.payer_name, source, userId || null]);
  return contactId;
}

/* ── Push ───────────────────────────────────────────────────────────────── */

async function withTx(pool, fn) {
  const tx = await pool.connect();
  try { await tx.query('BEGIN'); const out = await fn(tx); await tx.query('COMMIT'); return out; }
  catch (e) { await tx.query('ROLLBACK').catch(() => {}); throw e; }
  finally { tx.release(); }
}

async function markLink(pool, invoiceId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE xero_invoice_links SET ${sets}, updated_at = NOW() WHERE invoice_id = $1`, [invoiceId, ...keys.map(k => fields[k])]);
}

/**
 * Copy one final Opal invoice to Xero. Returns { state:'PUSHED', xeroInvoiceId, adopted }
 * or throws { status, code: XERO_* , message }. Safe to call again at any time.
 */
async function pushInvoice({ pool, orgId, userId, invoiceId }) {
  if (!isEnabled()) throw err(409, 'Copying invoices to Xero is switched off', 'XERO_PUSH_DISABLED');
  const settings = await Settings.ensureSettings(pool, orgId);
  if (!settings.xeroSalesAccountCode) throw err(409, 'Set the Xero sales account code in Billing settings first', 'XERO_NOT_SET_UP');
  const tenantId = await xc().tenant(orgId);

  // 1. Claim the link under the invoice lock (or find it done).
  const claim = await withTx(pool, async tx => {
    const { rows: [inv] } = await tx.query(`SELECT * FROM invoices WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [invoiceId, orgId]);
    if (!inv) throw err(404, 'Invoice not found');
    if (!FINAL.includes(inv.status)) throw err(409, 'Only a finalised invoice is copied to Xero', 'NOT_FINAL');
    const { rows: [link] } = await tx.query(`SELECT * FROM xero_invoice_links WHERE invoice_id = $1 FOR UPDATE`, [invoiceId]);
    if (link && link.state === 'PUSHED') return { done: link, inv };
    if (link && link.state === 'VOIDED') throw err(409, 'This invoice was voided in Xero', 'XERO_VOIDED');
    if (link && link.xero_tenant_id !== tenantId) throw err(409, 'This invoice was linked to a different Xero organisation', 'XERO_TENANT_CHANGED');
    const key = `opal-inv-${invoiceId}-${inv.invoice_number}`.slice(0, 120);
    if (!link) {
      await tx.query(
        `INSERT INTO xero_invoice_links (invoice_id, organisation_id, xero_tenant_id, invoice_number, idempotency_key, state, attempts)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', 1)`, [invoiceId, orgId, tenantId, inv.invoice_number, key]);
    } else {
      await tx.query(`UPDATE xero_invoice_links SET state = 'PENDING', attempts = attempts + 1, updated_at = NOW() WHERE invoice_id = $1`, [invoiceId]);
    }
    const { rows: lines } = await tx.query(
      `SELECT item_code, description, quantity, unit_price, amount FROM invoice_lines
        WHERE invoice_id = $1 AND line_status = 'ACTIVE' ORDER BY sort_order, created_at`, [invoiceId]);
    return { inv, lines, key: link ? link.idempotency_key : key };
  }).catch(e => {
    if (e && e.code === '23505') throw err(409, 'Another Opal invoice is already linked to this Xero invoice number. Nothing was copied; check the invoice numbering.', 'XERO_NUMBER_CLASH');
    throw e;
  });
  if (claim.done) return { state: 'PUSHED', xeroInvoiceId: claim.done.xero_invoice_id, adopted: false, already: true };
  const { inv, lines, key } = claim;

  const fail = async (e) => {
    const msg = xeroErrorText(e);
    await markLink(pool, invoiceId, { state: 'FAILED', last_error: msg });
    await recordAudit(pool, { orgId, actorUserId: userId, action: 'invoice.xero_push_failed', entityType: 'invoice', entityId: invoiceId, invoiceId,
      after: { code: e.code || 'XERO_ERROR', message: msg } });
    throw err(e.status && e.status < 500 ? e.status : 502, msg, e.code && /^XERO_|NO_RECIPIENT/.test(e.code) ? e.code : 'XERO_PUSH_FAILED');
  };

  try {
    const contactId = await resolveContact(pool, orgId, tenantId, inv, userId);
    const totalCents = M.toCents(inv.total);

    // 2. Is this number already in Xero? Adopt an identical copy; refuse anything else.
    const existing = (await xc().findInvoiceByNumber(orgId, inv.invoice_number)).filter(x => !['VOIDED', 'DELETED'].includes(x.Status));
    if (existing.length) {
      const same = existing.find(x => x.Contact && x.Contact.ContactID === contactId && M.toCents(x.Total) === totalCents);
      if (!same || existing.length > 1) {
        throw err(409, `Xero already has invoice ${inv.invoice_number} for a different contact or amount. Nothing was copied; check Xero and the invoice numbering.`, 'XERO_NUMBER_CLASH');
      }
      await markLink(pool, invoiceId, { state: 'PUSHED', xero_invoice_id: same.InvoiceID, xero_contact_id: contactId, xero_status: same.Status,
        xero_total: same.Total, xero_amount_paid: same.AmountPaid || 0, last_error: null, pushed_at: new Date() });
      await recordAudit(pool, { orgId, actorUserId: userId, action: 'invoice.xero_adopted', entityType: 'invoice', entityId: invoiceId, invoiceId,
        after: { xeroInvoiceId: same.InvoiceID, number: inv.invoice_number } });
      return { state: 'PUSHED', xeroInvoiceId: same.InvoiceID, adopted: true };
    }

    // 3. Create it, once.
    const payload = buildXeroInvoice(inv, lines, settings, contactId);
    const created = await xc().createInvoice(orgId, payload, key);
    if (!created || !created.InvoiceID) throw err(502, 'Xero did not return the invoice', 'XERO_PUSH_FAILED');
    if (M.toCents(created.Total) !== totalCents) {
      await xc().voidInvoice(orgId, created.InvoiceID, `${key}-void-mismatch`).catch(() => {});
      throw err(502, `Xero calculated ${created.Total} but the invoice is ${inv.total}; the Xero copy was voided. Check the line amounts.`, 'XERO_TOTAL_MISMATCH');
    }
    await markLink(pool, invoiceId, { state: 'PUSHED', xero_invoice_id: created.InvoiceID, xero_contact_id: contactId, xero_status: created.Status,
      xero_total: created.Total, xero_amount_paid: created.AmountPaid || 0, last_error: null, pushed_at: new Date() });
    await recordAudit(pool, { orgId, actorUserId: userId, action: 'invoice.xero_pushed', entityType: 'invoice', entityId: invoiceId, invoiceId,
      after: { xeroInvoiceId: created.InvoiceID, number: inv.invoice_number, total: inv.total, status: created.Status } });
    return { state: 'PUSHED', xeroInvoiceId: created.InvoiceID, adopted: false };
  } catch (e) {
    return fail(e);
  }
}

/** Before an Opal invoice is emailed: copy it to Xero when that is switched on. */
async function beforeEmail({ pool, orgId, userId, invoiceId }) {
  if (!isEnabled()) return null;
  return pushInvoice({ pool, orgId, userId, invoiceId });
}

/**
 * Before an Opal invoice is voided: void its Xero copy first. A Xero invoice
 * with payments cannot be voided — then nothing changes and the owner is told.
 */
async function beforeVoid({ pool, orgId, userId, invoiceId }) {
  const { rows: [link] } = await pool.query(`SELECT * FROM xero_invoice_links WHERE invoice_id = $1 AND organisation_id = $2`, [invoiceId, orgId]);
  if (!link || link.state === 'VOIDED') return null;
  if (link.state === 'PENDING') throw err(409, 'This invoice is being copied to Xero; try again in a moment', 'XERO_PENDING');
  if (link.state === 'FAILED' && !link.xero_invoice_id) { await markLink(pool, invoiceId, { state: 'VOIDED' }); return null; }
  if (!isEnabled()) throw err(409, 'This invoice is in Xero, and copying to Xero is switched off — void it in Xero first, or switch it back on', 'XERO_PUSH_DISABLED');
  try {
    const [x] = await xc().getInvoices(orgId, [link.xero_invoice_id]);
    if (x && Number(x.AmountPaid) > 0) throw err(409, 'Xero has payments on this invoice. Remove them in Xero (or raise a credit note) before voiding.', 'XERO_HAS_PAYMENTS');
    if (!x || x.Status !== 'VOIDED') await xc().voidInvoice(orgId, link.xero_invoice_id, `${link.idempotency_key}-void`);
  } catch (e) {
    if (e.code === 'XERO_HAS_PAYMENTS') throw e;
    throw err(502, xeroErrorText(e), 'XERO_VOID_FAILED');
  }
  await markLink(pool, invoiceId, { state: 'VOIDED', xero_status: 'VOIDED' });
  await recordAudit(pool, { orgId, actorUserId: userId, action: 'invoice.xero_voided', entityType: 'invoice', entityId: invoiceId, invoiceId,
    after: { xeroInvoiceId: link.xero_invoice_id } });
  return { voided: true };
}

/**
 * Payments: Xero is the record (bank feed). For every invoice copied to
 * Xero and not fully paid in Opal, read Xero's AmountPaid and set Opal's
 * amount_paid and status from it. Audited per change. Never writes to Xero.
 */
async function syncPayments({ pool, orgId, userId }) {
  const { rows: links } = await pool.query(
    `SELECT l.invoice_id, l.xero_invoice_id FROM xero_invoice_links l JOIN invoices i ON i.id = l.invoice_id
      WHERE l.organisation_id = $1 AND l.state = 'PUSHED' AND i.status IN ('READY', 'SENT', 'PART_PAID')`, [orgId]);
  const out = { checked: links.length, updated: 0, voidedInXero: 0 };
  for (let i = 0; i < links.length; i += 50) {
    const chunk = links.slice(i, i + 50);
    const xs = await xc().getInvoices(orgId, chunk.map(l => l.xero_invoice_id));
    const byId = new Map(xs.map(x => [x.InvoiceID, x]));
    for (const l of chunk) {
      const x = byId.get(l.xero_invoice_id);
      if (!x) continue;
      if (x.Status === 'VOIDED' || x.Status === 'DELETED') {
        // Voided in Xero by hand: say so; Opal's invoice is not changed silently.
        await markLink(pool, l.invoice_id, { xero_status: x.Status, last_error: 'Voided in Xero but not in Opal — void it in Opal too, or re-approve it in Xero' });
        out.voidedInXero++;
        continue;
      }
      const paidCents = M.toCents(x.AmountPaid || 0);
      await withTx(pool, async tx => {
        const { rows: [inv] } = await tx.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [l.invoice_id]);
        await tx.query(`UPDATE xero_invoice_links SET xero_status = $2, xero_amount_paid = $3, payments_synced_at = NOW(), updated_at = NOW() WHERE invoice_id = $1`,
          [l.invoice_id, x.Status, M.fromCents(paidCents)]);
        if (M.toCents(inv.amount_paid) === paidCents) return;
        const total = M.toCents(inv.total);
        const status = paidCents >= total ? 'PAID' : paidCents > 0 ? 'PART_PAID' : (inv.sent_status === 'SENT' ? 'SENT' : 'READY');
        await tx.query(`UPDATE invoices SET amount_paid = $2, status = $3, updated_at = NOW() WHERE id = $1`, [l.invoice_id, M.fromCents(paidCents), status]);
        await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.payment_from_xero', entityType: 'invoice', entityId: l.invoice_id, invoiceId: l.invoice_id,
          before: { amountPaid: inv.amount_paid, status: inv.status }, after: { amountPaid: M.fromCents(paidCents), status } });
        out.updated++;
      });
    }
  }
  return out;
}

/** Is this invoice's money tracked in Xero (so payments are not entered in Opal)? */
async function isLinked(q, invoiceId) {
  const { rows } = await q.query(`SELECT 1 FROM xero_invoice_links WHERE invoice_id = $1 AND state IN ('PUSHED', 'PENDING')`, [invoiceId]);
  return rows.length > 0;
}

module.exports = { isEnabled, setClient, buildXeroInvoice, pushInvoice, beforeEmail, beforeVoid, syncPayments, isLinked, xeroErrorText };
