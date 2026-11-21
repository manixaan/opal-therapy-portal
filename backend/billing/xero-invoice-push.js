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
function isUpstream(e) { return !!(e && (e.isAxiosError || e.response)); }
function xeroErrorText(e) {
  if (!isUpstream(e) && e && e.code && e.message && e.status) return e.message;   // our own err()
  const st = e && e.response && e.response.status;
  const d = e && e.response && e.response.data;
  const v = d && d.Elements && d.Elements[0] && d.Elements[0].ValidationErrors;
  if (st === 400 && v && v.length) return 'Xero refused it: ' + v.map(x => x.Message).join('; ').slice(0, 300);
  if (st === 401 || st === 403) return 'Xero refused access — reconnect Xero with invoice permission (Accounting › Connect)';
  if (st === 429) return 'Xero is limiting requests; try again in a minute';
  return 'Xero could not be reached';
}
/** Any failure as our own error: upstream (Xero/network) is always 502, never a 401 that looks like a lost session. */
function asOwn(e, fallbackCode = 'XERO_PUSH_FAILED') {
  if (!isUpstream(e) && e && e.code && e.status) return e;
  return err(502, xeroErrorText(e), fallbackCode);
}

/* ── Pure: the Xero invoice for an Opal invoice ─────────────────────────── */

function buildXeroInvoice(inv, lines, settings, contactId) {
  const taxType = inv.tax_treatment === 'GST_10_EXCLUSIVE' ? settings.xeroTaxTypeGst : settings.xeroTaxTypeGstFree;
  // Dates arrive as 'YYYY-MM-DD' text (to_char in the query) — never through a Date, which shifts a day outside UTC.
  const ymd = v => String(v).slice(0, 10);
  return {
    Type: 'ACCREC',
    Status: 'AUTHORISED',
    InvoiceNumber: inv.invoice_number,
    Reference: [inv.client_name, inv.ndis_number ? `NDIS ${inv.ndis_number}` : null].filter(Boolean).join(' · ').slice(0, 255) || undefined,
    Contact: { ContactID: contactId },
    Date: ymd(inv.issue_ymd || inv.issue_date),
    DueDate: (inv.due_ymd || inv.due_date) ? ymd(inv.due_ymd || inv.due_date) : undefined,
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
    throw err(409, `Xero has ${found.length} contacts named "${inv.payer_name}". Merge or rename them in Xero so one matches, then send again.`, 'XERO_CONTACT_AMBIGUOUS');
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

/** Update the link only while it is still in `expect` state (a late failure never overwrites a success). */
async function markLink(pool, invoiceId, fields, expect = null) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const guard = expect ? ` AND state = $${keys.length + 2}` : '';
  const { rowCount } = await pool.query(`UPDATE xero_invoice_links SET ${sets}, updated_at = NOW() WHERE invoice_id = $1${guard}`,
    [invoiceId, ...keys.map(k => fields[k]), ...(expect ? [expect] : [])]);
  return rowCount;
}

const PENDING_STALE_MS = 5 * 60 * 1000;
const isFreshPending = l => l && l.state === 'PENDING' && Date.now() - new Date(l.updated_at).getTime() < PENDING_STALE_MS;

/**
 * Copy one final Opal invoice to Xero. Returns { state:'PUSHED', xeroInvoiceId, adopted }
 * or throws { status, code: XERO_* , message }. Safe to call again at any time.
 */
async function pushInvoice({ pool, orgId, userId, invoiceId }) {
  if (!isEnabled()) throw err(409, 'Copying invoices to Xero is switched off', 'XERO_PUSH_DISABLED');
  const settings = await Settings.ensureSettings(pool, orgId);
  if (!settings.xeroSalesAccountCode) throw err(409, 'Set the Xero sales account code in Billing settings first', 'XERO_NOT_SET_UP');
  let tenantId;
  try { tenantId = await xc().tenant(orgId); } catch (e) { throw asOwn(e); }

  // 1. Claim the link under the invoice lock (or find it done / in flight).
  const claim = await withTx(pool, async tx => {
    const { rows: [inv] } = await tx.query(
      `SELECT *, to_char(issue_date, 'YYYY-MM-DD') AS issue_ymd, to_char(due_date, 'YYYY-MM-DD') AS due_ymd
         FROM invoices WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [invoiceId, orgId]);
    if (!inv) throw err(404, 'Invoice not found');
    if (!FINAL.includes(inv.status)) throw err(409, 'Only a finalised invoice is copied to Xero', 'NOT_FINAL');
    // Money recorded in Opal would be wiped by Xero's AmountPaid: Xero must hold the payments first.
    if (M.toCents(inv.amount_paid) > 0) {
      throw err(409, 'This invoice has payments recorded in Opal. Copy it to Xero by hand with those payments, or reverse them in Opal first.', 'XERO_HAS_OPAL_PAYMENTS');
    }
    const { rows: [link] } = await tx.query(`SELECT * FROM xero_invoice_links WHERE invoice_id = $1 FOR UPDATE`, [invoiceId]);
    if (link && link.state === 'PUSHED') return { done: link, inv };
    if (link && link.state === 'VOIDED') throw err(409, 'This invoice was voided in Xero', 'XERO_VOIDED');
    if (isFreshPending(link)) throw err(409, 'This invoice is being copied to Xero right now', 'XERO_PENDING');
    if (link && link.xero_tenant_id !== tenantId) throw err(409, 'This invoice was linked to a different Xero organisation', 'XERO_TENANT_CHANGED');
    const attempt = link ? link.attempts + 1 : 1;
    // A fresh key per attempt: safe, because every attempt first looks the number up in Xero and adopts what is there.
    const base = link ? link.idempotency_key : `opal-inv-${invoiceId}-${inv.invoice_number}`.slice(0, 110);
    if (!link) {
      await tx.query(
        `INSERT INTO xero_invoice_links (invoice_id, organisation_id, xero_tenant_id, invoice_number, idempotency_key, state, attempts)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', 1)`, [invoiceId, orgId, tenantId, inv.invoice_number, base]);
    } else {
      await tx.query(`UPDATE xero_invoice_links SET state = 'PENDING', attempts = $2, updated_at = NOW() WHERE invoice_id = $1`, [invoiceId, attempt]);
    }
    const { rows: lines } = await tx.query(
      `SELECT item_code, description, quantity, unit_price, amount FROM invoice_lines
        WHERE invoice_id = $1 AND line_status = 'ACTIVE' ORDER BY sort_order, created_at`, [invoiceId]);
    return { inv, lines, key: `${base}-a${attempt}`, knownXeroId: link ? link.xero_invoice_id : null };
  }).catch(e => {
    if (e && e.code === '23505') throw err(409, 'Another Opal invoice is already linked to this Xero invoice number. Nothing was copied; check the invoice numbering.', 'XERO_NUMBER_CLASH');
    throw e;
  });
  if (claim.done) return { state: 'PUSHED', xeroInvoiceId: claim.done.xero_invoice_id, adopted: false, already: true };
  const { inv, lines, key } = claim;

  const fail = async (e) => {
    const own = asOwn(e);
    await markLink(pool, invoiceId, { state: 'FAILED', last_error: own.message }, 'PENDING');
    await recordAudit(pool, { orgId, actorUserId: userId, action: 'invoice.xero_push_failed', entityType: 'invoice', entityId: invoiceId, invoiceId,
      after: { code: own.code, message: own.message } });
    throw own;
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
        xero_total: same.Total, xero_amount_paid: same.AmountPaid || 0, last_error: null, pushed_at: new Date() }, 'PENDING');
      await recordAudit(pool, { orgId, actorUserId: userId, action: 'invoice.xero_adopted', entityType: 'invoice', entityId: invoiceId, invoiceId,
        after: { xeroInvoiceId: same.InvoiceID, number: inv.invoice_number } });
      return { state: 'PUSHED', xeroInvoiceId: same.InvoiceID, adopted: true };
    }

    // 3. Create it, once.
    const payload = buildXeroInvoice(inv, lines, settings, contactId);
    const created = await xc().createInvoice(orgId, payload, key);
    if (!created || !created.InvoiceID) throw err(502, 'Xero did not return the invoice', 'XERO_PUSH_FAILED');
    // Remember the Xero id at once, so nothing can lose track of a live Xero invoice.
    await markLink(pool, invoiceId, { xero_invoice_id: created.InvoiceID, xero_contact_id: contactId, xero_status: created.Status }, 'PENDING');
    if (M.toCents(created.Total) !== totalCents) {
      let voided = false;
      try { await xc().voidInvoice(orgId, created.InvoiceID, `${key}-void-mismatch`); voided = true; } catch (_) { /* reported below */ }
      if (voided) await markLink(pool, invoiceId, { xero_status: 'VOIDED' }, 'PENDING');
      throw err(502, `Xero calculated ${created.Total} but the invoice is ${inv.total}; ${voided ? 'the Xero copy was voided' : 'the Xero copy could NOT be voided — void it in Xero'}. Check the line amounts.`, 'XERO_TOTAL_MISMATCH');
    }
    await markLink(pool, invoiceId, { state: 'PUSHED', xero_total: created.Total, xero_amount_paid: created.AmountPaid || 0,
      last_error: null, pushed_at: new Date() }, 'PENDING');
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
 * Before an Opal invoice is voided: void its Xero copy first. A link that
 * never recorded a Xero id (a lost response, a crash) is looked up by number
 * so a live Xero invoice is never left behind. A Xero invoice with payments
 * or credits cannot be voided — then nothing changes and the owner is told.
 */
async function beforeVoid({ pool, orgId, userId, invoiceId }) {
  const { rows: [link] } = await pool.query(`SELECT * FROM xero_invoice_links WHERE invoice_id = $1 AND organisation_id = $2`, [invoiceId, orgId]);
  if (!link || link.state === 'VOIDED') return null;
  if (isFreshPending(link)) throw err(409, 'This invoice is being copied to Xero; try again in a moment', 'XERO_PENDING');
  if (!isEnabled()) throw err(409, 'This invoice is linked to Xero, and copying to Xero is switched off — void it in Xero first, or switch it back on', 'XERO_PUSH_DISABLED');
  let target = null;
  try {
    if (link.xero_invoice_id) {
      [target] = await xc().getInvoices(orgId, [link.xero_invoice_id]);
    } else {
      const found = (await xc().findInvoiceByNumber(orgId, link.invoice_number)).filter(x => !['VOIDED', 'DELETED'].includes(x.Status));
      if (found.length > 1) throw err(409, `Xero has more than one invoice ${link.invoice_number}; void the right one in Xero first`, 'XERO_NUMBER_CLASH');
      target = found[0] || null;
    }
    if (target && (Number(target.AmountPaid) > 0 || Number(target.AmountCredited) > 0)) {
      throw err(409, 'Xero has payments or credits on this invoice. Remove them in Xero (or raise a credit note) before voiding.', 'XERO_HAS_PAYMENTS');
    }
    if (target && !['VOIDED', 'DELETED'].includes(target.Status)) await xc().voidInvoice(orgId, target.InvoiceID, `${link.idempotency_key}-void`);
  } catch (e) {
    throw asOwn(e, 'XERO_VOID_FAILED');
  }
  await markLink(pool, invoiceId, { state: 'VOIDED', xero_status: 'VOIDED', ...(target ? { xero_invoice_id: target.InvoiceID } : {}) });
  await recordAudit(pool, { orgId, actorUserId: userId, action: 'invoice.xero_voided', entityType: 'invoice', entityId: invoiceId, invoiceId,
    after: { xeroInvoiceId: target ? target.InvoiceID : null } });
  return { voided: true };
}

/**
 * Payments: Xero is the record (bank feed, credit notes). For every invoice
 * copied to Xero, Opal's amount_paid = Xero's Total − AmountDue (payments
 * plus credits), both ways — a payment reversed in Xero comes back too.
 * Audited per change. Never writes to Xero.
 */
async function syncPayments({ pool, orgId, userId }) {
  const { rows: links } = await pool.query(
    `SELECT l.invoice_id, l.xero_invoice_id FROM xero_invoice_links l JOIN invoices i ON i.id = l.invoice_id
      WHERE l.organisation_id = $1 AND l.state = 'PUSHED' AND l.xero_invoice_id IS NOT NULL
        AND i.status IN ('READY', 'SENT', 'PART_PAID', 'PAID')`, [orgId]);
  const out = { checked: links.length, updated: 0, voidedInXero: 0 };
  for (let i = 0; i < links.length; i += 50) {
    const chunk = links.slice(i, i + 50);
    let xs;
    try { xs = await xc().getInvoices(orgId, chunk.map(l => l.xero_invoice_id)); } catch (e) { throw asOwn(e, 'XERO_SYNC_FAILED'); }
    const byId = new Map(xs.map(x => [x.InvoiceID, x]));
    for (const l of chunk) {
      const x = byId.get(l.xero_invoice_id);
      if (!x) continue;
      if (x.Status === 'VOIDED' || x.Status === 'DELETED') {
        // Voided in Xero by hand: say so; Opal's invoice is not changed silently.
        await markLink(pool, l.invoice_id, { xero_status: x.Status, last_error: 'Voided in Xero but not in Opal — void it in Opal too, or re-approve it in Xero' }, 'PUSHED');
        out.voidedInXero++;
        continue;
      }
      const totalX = M.toCents(x.Total || 0);
      const dueCents = x.AmountDue != null ? M.toCents(x.AmountDue) : totalX - M.toCents(x.AmountPaid || 0) - M.toCents(x.AmountCredited || 0);
      const paidCents = Math.min(totalX, Math.max(0, totalX - dueCents));
      await withTx(pool, async tx => {
        const { rows: [inv] } = await tx.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [l.invoice_id]);
        const { rows: [lk] } = await tx.query(`SELECT state FROM xero_invoice_links WHERE invoice_id = $1 FOR UPDATE`, [l.invoice_id]);
        if (!inv || inv.status === 'VOID' || !lk || lk.state !== 'PUSHED') return;      // voided meanwhile
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

/** Is this invoice's money tracked in Xero (so payments are not entered in Opal, and voids go through Xero)? */
async function isLinked(q, invoiceId) {
  const { rows } = await q.query(`SELECT 1 FROM xero_invoice_links WHERE invoice_id = $1 AND state IN ('PUSHED', 'PENDING')`, [invoiceId]);
  return rows.length > 0;
}

module.exports = { isEnabled, setClient, buildXeroInvoice, pushInvoice, beforeEmail, beforeVoid, syncPayments, isLinked, xeroErrorText };
