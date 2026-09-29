'use strict';

/**
 * INVOICE LIFECYCLE + QUERIES
 *
 *   DRAFT / NEEDS_ATTENTION  editable; lines may be overridden (with reason),
 *                            removed, restored or added; may be regenerated.
 *   READY (finalised)        numbers locked; a final PDF is written once and
 *                            never regenerated.
 *   SENT → PART_PAID → PAID  payments recorded; PAID when outstanding = 0.
 *   OVERDUE                  derived for display (sent, past due, owing).
 *   VOID                     lines set VOIDED, which frees their calendar
 *                            claims; "void & reissue" regenerates a fresh
 *                            draft from the same sources.
 * A finalised invoice is never rewritten. Every financial action is audited
 * in the same transaction as the change.
 */

const crypto = require('crypto');
const { pool: defaultPool } = require('../database');
const M = require('./money');
const S = require('./session-billing');
const BP = require('./billing-profiles');
const Settings = require('./billing-settings');
const { recordAudit } = require('./billing-audit');
const { renderInvoicePdf } = require('./invoice-pdf');
const storage = require('../storage');

const EDITABLE_STATUSES = ['DRAFT', 'NEEDS_ATTENTION'];
const FINAL_STATUSES = ['READY', 'SENT', 'PART_PAID', 'PAID'];

function err(status, message, code) { return Object.assign(new Error(message), { status, code }); }
const ymd = v => (v == null ? null : (typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10)));

async function withTx(pool, fn) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const out = await fn(tx);
    await tx.query('COMMIT');
    return out;
  } catch (e) {
    await tx.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { tx.release(); }
}

async function lockInvoice(tx, orgId, invoiceId) {
  const { rows: [inv] } = await tx.query(
    `SELECT * FROM invoices WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [invoiceId, orgId]);
  if (!inv) throw err(404, 'Invoice not found');
  return inv;
}

// ── Queries ────────────────────────────────────────────────────────────────

const LIST_SORTS = { number: 'i.invoice_number', issue: 'i.issue_date', due: 'i.due_date', total: 'i.total', client: 'LOWER(i.client_name)' };

async function listInvoices(q, orgId, f = {}, { tz = 'Australia/Perth' } = {}) {
  const params = [orgId];
  const where = ['i.organisation_id = $1'];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  const today = S.todayInTz(tz);
  if (f.status) {
    const statuses = String(f.status).split(',').filter(Boolean);
    const clauses = [];
    for (const st of statuses) {
      if (st === 'OVERDUE') { params.push(today); clauses.push(`(i.status IN ('SENT','PART_PAID') AND i.due_date < $${params.length} AND i.total > i.amount_paid)`); }
      else if (/^[A-Z_]+$/.test(st)) { params.push(st); clauses.push(`i.status = $${params.length}`); }
    }
    if (clauses.length) where.push(`(${clauses.join(' OR ')})`);
  }
  if (f.practitionerId) add(`EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = i.id AND l.practitioner_user_id = ?::uuid)`, f.practitionerId);
  if (f.clientId) add('i.client_id = ?', f.clientId);
  if (f.payer) add('LOWER(i.payer_name) LIKE ?', `%${String(f.payer).toLowerCase()}%`);
  if (f.from) add('i.issue_date >= ?::date', f.from);
  if (f.to) add('i.issue_date <= ?::date', f.to);
  if (f.trip === 'true' || f.trip === true) where.push('i.trip_id IS NOT NULL');
  if (f.tripId) add('i.trip_id = ?::uuid', f.tripId);
  if (f.mmm) add(`EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = i.id AND l.mmm_zone = ?::smallint AND l.line_status = 'ACTIVE')`, Number(f.mmm));
  if (f.stale === 'true') where.push('(i.is_stale OR i.source_changed_after_finalise)');
  if (f.q) {
    params.push(`%${String(f.q).toLowerCase().trim()}%`);
    const p = `$${params.length}`;
    where.push(`(LOWER(i.invoice_number) LIKE ${p} OR LOWER(COALESCE(i.client_name,'')) LIKE ${p}
                 OR COALESCE(i.ndis_number,'') LIKE ${p} OR LOWER(COALESCE(i.payer_name,'')) LIKE ${p})`);
  }
  const sort = LIST_SORTS[f.sort] || 'i.issue_date';
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(f.limit) || 200, 1000);
  const offset = Math.max(Number(f.offset) || 0, 0);
  const { rows } = await q.query(
    `SELECT i.id, i.invoice_number, i.client_id, i.client_name, i.ndis_number, i.payer_name, i.payer_type,
            i.practitioner_names, to_char(i.issue_date,'YYYY-MM-DD') AS issue_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date,
            to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end,
            i.total, i.amount_paid, (i.total - i.amount_paid) AS outstanding, i.status, i.sent_status, i.is_stale,
            i.source_changed_after_finalise, i.trip_id, t.name AS trip_name,
            (SELECT array_agg(DISTINCT l.mmm_zone) FROM invoice_lines l WHERE l.invoice_id = i.id AND l.line_status = 'ACTIVE' AND l.mmm_zone IS NOT NULL) AS mmm_zones,
            (SELECT COUNT(*)::int FROM billing_issues b WHERE b.invoice_id = i.id AND b.status = 'OPEN') AS open_issues,
            COUNT(*) OVER() AS total_count
       FROM invoices i LEFT JOIN trips t ON t.id = i.trip_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${sort} ${dir} NULLS LAST, i.invoice_number DESC
      LIMIT ${limit} OFFSET ${offset}`, params);
  return {
    total: rows.length ? Number(rows[0].total_count) : 0,
    invoices: rows.map(r => {
      const { total_count, ...rest } = r;
      return { ...rest, display_status: S.displayStatus(r, today) };
    }),
  };
}

async function invoiceCounts(q, orgId, { tz = 'Australia/Perth' } = {}) {
  const today = S.todayInTz(tz);
  const { rows: [r] } = await q.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
            COUNT(*) FILTER (WHERE status = 'NEEDS_ATTENTION')::int AS needs_attention,
            COUNT(*) FILTER (WHERE status = 'READY')::int AS ready,
            COUNT(*) FILTER (WHERE status = 'SENT')::int AS sent,
            COUNT(*) FILTER (WHERE status = 'PART_PAID')::int AS part_paid,
            COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid,
            COUNT(*) FILTER (WHERE status = 'VOID')::int AS void,
            COUNT(*) FILTER (WHERE status IN ('SENT','PART_PAID') AND due_date < $2 AND total > amount_paid)::int AS overdue,
            COALESCE(SUM(total - amount_paid) FILTER (WHERE status IN ('READY','SENT','PART_PAID')), 0) AS outstanding,
            COALESCE(SUM(total) FILTER (WHERE status IN ('DRAFT','NEEDS_ATTENTION')), 0) AS draft_value,
            (SELECT COUNT(*)::int FROM billing_issues b WHERE b.organisation_id = $1 AND b.status = 'OPEN' AND b.severity = 'BLOCKING') AS open_issues
       FROM invoices WHERE organisation_id = $1`, [orgId, today]);
  return r;
}

async function getInvoiceDetail(q, orgId, invoiceId, { tz = 'Australia/Perth' } = {}) {
  const { rows: [inv] } = await q.query(
    `SELECT i.*, to_char(i.issue_date,'YYYY-MM-DD') AS issue_date, to_char(i.due_date,'YYYY-MM-DD') AS due_date,
            to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end,
            (i.total - i.amount_paid) AS outstanding, t.name AS trip_name,
            fu.name AS finalised_by_name, vu.name AS voided_by_name,
            ri.invoice_number AS reissue_of_number,
            (SELECT r.invoice_number FROM invoices r WHERE r.reissue_of_invoice_id = i.id ORDER BY r.created_at DESC LIMIT 1) AS reissued_as_number,
            (SELECT r.id FROM invoices r WHERE r.reissue_of_invoice_id = i.id ORDER BY r.created_at DESC LIMIT 1) AS reissued_as_id
       FROM invoices i LEFT JOIN trips t ON t.id = i.trip_id
       LEFT JOIN users fu ON fu.id = i.finalised_by_user_id LEFT JOIN users vu ON vu.id = i.voided_by_user_id
       LEFT JOIN invoices ri ON ri.id = i.reissue_of_invoice_id
      WHERE i.id = $1 AND i.organisation_id = $2`, [invoiceId, orgId]);
  if (!inv) return null;
  const { rows: lines } = await q.query(
    `SELECT l.*, to_char(l.service_date,'YYYY-MM-DD') AS service_date, u.name AS practitioner_name,
            e.title AS event_title, e.start_time AS event_start, e.end_time AS event_end, e.is_deleted AS event_deleted,
            tba.day_total_minutes, tba.day_total_km, tba.sessions_in_day, tba.allocated_minutes_before_cap,
            tba.cap_minutes, tba.cap_applied, tba.claimable_minutes, tba.travel_rate, tba.allocated_km,
            tba.vehicle_rate_per_km, tba.legs AS travel_legs, tba.return_payable
       FROM invoice_lines l
       LEFT JOIN users u ON u.id = l.practitioner_user_id
       LEFT JOIN events e ON e.id = l.calendar_event_id
       LEFT JOIN travel_billing_allocations tba ON tba.id = l.travel_allocation_id
      WHERE l.invoice_id = $1 ORDER BY l.sort_order, l.created_at`, [invoiceId]);
  const { rows: payments } = await q.query(
    `SELECT p.id, p.amount, to_char(p.paid_on,'YYYY-MM-DD') AS paid_on, p.method, p.reference, p.created_at, u.name AS recorded_by
       FROM invoice_payments p LEFT JOIN users u ON u.id = p.recorded_by_user_id
      WHERE p.invoice_id = $1 ORDER BY p.paid_on, p.created_at`, [invoiceId]);
  const { rows: documents } = await q.query(
    `SELECT id, version, is_final, file_name, byte_size, sha256, generated_at FROM invoice_documents
      WHERE invoice_id = $1 ORDER BY version DESC`, [invoiceId]);
  const { rows: issues } = await q.query(
    `SELECT id, issue_type, severity, message, fix_target, created_at FROM billing_issues
      WHERE status = 'OPEN' AND (invoice_id = $1 OR (organisation_id = $2 AND client_id = $3 AND issue_type IN ('CLIENT_MISSING_PAYER','NDIS_NUMBER_MISSING')))
      ORDER BY created_at DESC`, [invoiceId, orgId, inv.client_id]);
  const today = S.todayInTz(tz);
  return { invoice: { ...inv, display_status: S.displayStatus(inv, today) }, lines, payments, documents, issues };
}

// ── Draft editing ──────────────────────────────────────────────────────────

async function refreshTotals(tx, invoiceId) {
  const { rows: lines } = await tx.query(`SELECT amount, gst_amount, line_status FROM invoice_lines WHERE invoice_id = $1`, [invoiceId]);
  const t = S.invoiceTotals(lines);
  await tx.query(`UPDATE invoices SET subtotal = $2, gst_total = $3, total = $4, updated_at = NOW() WHERE id = $1`,
    [invoiceId, M.fromCents(t.subtotalCents), M.fromCents(t.gstCents), M.fromCents(t.totalCents)]);
  return t;
}

function requireReason(reason) {
  if (!reason || String(reason).trim().length < 3) throw err(400, 'A reason is required for this change');
  return String(reason).trim().slice(0, 1000);
}

/** Override description / quantity / unit price of a draft line. Financial changes need a reason. */
async function editLine({ pool = defaultPool, orgId, userId, invoiceId, lineId, patch }) {
  return withTx(pool, async tx => {
    const inv = await lockInvoice(tx, orgId, invoiceId);
    if (!EDITABLE_STATUSES.includes(inv.status)) throw err(409, 'Only a draft invoice can be edited', 'INVOICE_LOCKED');
    const { rows: [line] } = await tx.query(`SELECT * FROM invoice_lines WHERE id = $1 AND invoice_id = $2 FOR UPDATE`, [lineId, invoiceId]);
    if (!line) throw err(404, 'Line not found');
    const before = { description: line.description, quantity: line.quantity, unit_price: line.unit_price, amount: line.amount };
    const next = { ...before };
    const financial = patch.quantity != null || patch.unitPrice != null;
    if (patch.description != null) {
      const d = String(patch.description).trim();
      if (!d) throw err(400, 'Description cannot be empty');
      next.description = d.slice(0, 500);
    }
    if (patch.quantity != null) {
      let qE4; try { qE4 = M.toQtyE4(patch.quantity); } catch (_) { throw err(400, 'Quantity is invalid'); }
      if (!(qE4 > 0)) throw err(400, 'Quantity must be positive');
      next.quantity = M.qtyToString(qE4);
    }
    if (patch.unitPrice != null) {
      let c; try { c = M.toCents(patch.unitPrice); } catch (_) { throw err(400, 'Unit price is invalid'); }
      if (!(c >= 0)) throw err(400, 'Unit price must not be negative');
      next.unit_price = M.fromCents(c);
    }
    const reason = financial ? requireReason(patch.reason) : (patch.reason ? String(patch.reason).slice(0, 1000) : null);
    const amountCents = M.lineAmount(M.toQtyE4(next.quantity), M.toCents(next.unit_price));
    next.amount = M.fromCents(amountCents);
    const gst = S.gstFor(amountCents, inv.tax_treatment);
    const calc = line.calculation || {};
    const overrides = Array.isArray(calc.overrides) ? calc.overrides : [];
    overrides.push({ at: new Date().toISOString(), by: userId, reason, from: before, to: next });
    await tx.query(
      `UPDATE invoice_lines SET description = $2, quantity = $3, unit_price = $4, amount = $5, gst_amount = $6,
              is_overridden = is_overridden OR $7, calculation = $8, updated_at = NOW() WHERE id = $1`,
      [lineId, next.description, next.quantity, next.unit_price, next.amount, M.fromCents(gst.cents), financial,
        JSON.stringify({ ...calc, overrides })]);
    const t = await refreshTotals(tx, invoiceId);
    await recordAudit(tx, { orgId, actorUserId: userId, action: financial ? 'invoice.line_overridden' : 'invoice.line_edited',
      entityType: 'invoice_line', entityId: lineId, invoiceId, before, after: next, reason });
    return { total: M.fromCents(t.totalCents) };
  });
}

async function setLineStatus({ pool = defaultPool, orgId, userId, invoiceId, lineId, remove, reason }) {
  return withTx(pool, async tx => {
    const inv = await lockInvoice(tx, orgId, invoiceId);
    if (!EDITABLE_STATUSES.includes(inv.status)) throw err(409, 'Only a draft invoice can be edited', 'INVOICE_LOCKED');
    const why = requireReason(reason);
    const { rows: [line] } = await tx.query(`SELECT * FROM invoice_lines WHERE id = $1 AND invoice_id = $2 FOR UPDATE`, [lineId, invoiceId]);
    if (!line) throw err(404, 'Line not found');
    if (remove && line.line_status !== 'ACTIVE') throw err(409, 'Line is not active');
    if (!remove && line.line_status !== 'REMOVED') throw err(409, 'Line is not removed');
    await tx.query(
      `UPDATE invoice_lines SET line_status = $2, removed_reason = $3, removed_by_user_id = $4,
              removed_at = CASE WHEN $2 = 'REMOVED' THEN NOW() ELSE NULL END, updated_at = NOW() WHERE id = $1`,
      [lineId, remove ? 'REMOVED' : 'ACTIVE', remove ? why : null, remove ? userId : null]);
    const t = await refreshTotals(tx, invoiceId);
    await recordAudit(tx, { orgId, actorUserId: userId, action: remove ? 'invoice.line_removed' : 'invoice.line_restored',
      entityType: 'invoice_line', entityId: lineId, invoiceId,
      before: { status: line.line_status, amount: line.amount, component: line.component },
      after: { status: remove ? 'REMOVED' : 'ACTIVE' }, reason: why });
    return { total: M.fromCents(t.totalCents) };
  });
}

async function addManualLine({ pool = defaultPool, orgId, userId, invoiceId, input }) {
  return withTx(pool, async tx => {
    const inv = await lockInvoice(tx, orgId, invoiceId);
    if (!EDITABLE_STATUSES.includes(inv.status)) throw err(409, 'Only a draft invoice can be edited', 'INVOICE_LOCKED');
    const why = requireReason(input.reason);
    const description = String(input.description || '').trim();
    if (!description) throw err(400, 'Description is required');
    let qE4, unit;
    try { qE4 = M.toQtyE4(input.quantity ?? 1); unit = M.toCents(input.unitPrice); } catch (_) { throw err(400, 'Quantity or unit price is invalid'); }
    if (!(qE4 > 0) || !(unit >= 0)) throw err(400, 'Quantity must be positive and unit price not negative');
    if (input.serviceDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate)) throw err(400, 'serviceDate must be YYYY-MM-DD');
    const amount = M.lineAmount(qE4, unit);
    const gst = S.gstFor(amount, inv.tax_treatment);
    const { rows: [l] } = await tx.query(
      `INSERT INTO invoice_lines (invoice_id, organisation_id, component, client_id, service_date, item_code, description,
          quantity, unit_price, gst_rate, gst_amount, amount, is_overridden, calculation, sort_order)
       VALUES ($1,$2,'MANUAL',$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,2100000000) RETURNING id`,
      [invoiceId, orgId, inv.client_id, input.serviceDate || null, input.itemCode ? String(input.itemCode).slice(0, 40) : null,
        description.slice(0, 500), M.qtyToString(qE4), M.fromCents(unit), gst.rate, M.fromCents(gst.cents), M.fromCents(amount),
        JSON.stringify({ method: 'manual', reason: why, by: userId, at: new Date().toISOString() })]);
    const t = await refreshTotals(tx, invoiceId);
    await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.line_added', entityType: 'invoice_line', entityId: l.id,
      invoiceId, after: { description, quantity: M.qtyToString(qE4), unitPrice: M.fromCents(unit), amount: M.fromCents(amount) }, reason: why });
    return { lineId: l.id, total: M.fromCents(t.totalCents) };
  });
}

/** Header fields of a draft: notes, due date, and (audited) recipient correction. */
async function updateDraftHeader({ pool = defaultPool, orgId, userId, invoiceId, patch }) {
  return withTx(pool, async tx => {
    const inv = await lockInvoice(tx, orgId, invoiceId);
    const notesOnly = Object.keys(patch).every(k => k === 'notes');
    if (!EDITABLE_STATUSES.includes(inv.status) && !notesOnly) throw err(409, 'Only a draft invoice can be edited', 'INVOICE_LOCKED');
    if (!EDITABLE_STATUSES.includes(inv.status) && notesOnly) throw err(409, 'A finalised invoice is locked', 'INVOICE_LOCKED');
    const sets = []; const params = [invoiceId];
    const before = {}; const after = {};
    const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); before[col] = inv[col]; after[col] = v; };
    if ('notes' in patch) set('notes', patch.notes ? String(patch.notes).slice(0, 2000) : null);
    if ('dueDate' in patch) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(patch.dueDate || ''))) throw err(400, 'dueDate must be YYYY-MM-DD');
      set('due_date', patch.dueDate);
    }
    if ('issueDate' in patch) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(patch.issueDate || ''))) throw err(400, 'issueDate must be YYYY-MM-DD');
      set('issue_date', patch.issueDate);
    }
    const recipientKeys = ['payerName', 'payerEmail', 'payerReference', 'payerAddress', 'payerType'];
    let reason = null;
    if (recipientKeys.some(k => k in patch)) {
      reason = requireReason(patch.reason);
      if ('payerType' in patch && !BP.PAYER_TYPES.includes(patch.payerType)) throw err(400, 'payerType is invalid');
      if ('payerName' in patch) set('payer_name', patch.payerName ? String(patch.payerName).slice(0, 255) : null);
      if ('payerEmail' in patch) set('payer_email', patch.payerEmail ? String(patch.payerEmail).slice(0, 255) : null);
      if ('payerReference' in patch) set('payer_reference', patch.payerReference ? String(patch.payerReference).slice(0, 255) : null);
      if ('payerAddress' in patch) set('payer_address', patch.payerAddress ? String(patch.payerAddress).slice(0, 2000) : null);
      if ('payerType' in patch) set('payer_type', patch.payerType);
    }
    if (!sets.length) return { ok: true };
    await tx.query(`UPDATE invoices SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params);
    await recordAudit(tx, { orgId, actorUserId: userId, action: reason ? 'invoice.recipient_corrected' : 'invoice.header_edited',
      entityType: 'invoice', entityId: invoiceId, invoiceId, before, after, reason });
    return { ok: true };
  });
}

// ── PDFs ───────────────────────────────────────────────────────────────────

async function pdfViewModel(q, orgId, invoiceId) {
  const detail = await getInvoiceDetail(q, orgId, invoiceId);
  if (!detail) throw err(404, 'Invoice not found');
  const business = await Settings.businessProfile(q, orgId);
  const inv = detail.invoice;
  return {
    detail,
    vm: {
      business,
      draft: EDITABLE_STATUSES.includes(inv.status),
      invoice: {
        invoiceNumber: inv.invoice_number, status: inv.status,
        issueDate: S.displayDate(inv.issue_date), dueDate: inv.due_date ? S.displayDate(inv.due_date) : null,
        clientName: inv.client_name, ndisNumber: inv.ndis_number, payerName: inv.payer_name,
        payerReference: inv.payer_reference, payerAddress: inv.payer_address, practitionerNames: inv.practitioner_names,
        subtotal: inv.subtotal, gstTotal: inv.gst_total, total: inv.total, amountPaid: inv.amount_paid,
        outstanding: M.fromCents(M.toCents(inv.total) - M.toCents(inv.amount_paid)), taxTreatment: inv.tax_treatment,
        notes: inv.notes,
      },
      lines: detail.lines.filter(l => l.line_status === 'ACTIVE').map(l => ({
        itemCode: l.item_code, description: l.description, unitPrice: l.unit_price, quantity: l.quantity,
        gstRate: l.gst_rate, amount: l.amount,
      })),
    },
  };
}

async function storeDocument(tx, orgId, userId, inv, bytes, isFinal) {
  const { rows: [{ v }] } = await tx.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM invoice_documents WHERE invoice_id = $1`, [inv.id]);
  const fileName = `${inv.invoice_number}${isFinal ? '' : `-draft-v${v}`}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');
  const docId = crypto.randomUUID();
  const backend = storage.getBackend(storage.getBackendName());
  const put = await backend.put({ userId: `invoices-${orgId}`, docId, fileName, mime: 'application/pdf', base64: bytes.toString('base64') });
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  await tx.query(
    `INSERT INTO invoice_documents (id, invoice_id, organisation_id, version, is_final, file_name, byte_size, sha256,
        storage_backend, storage_key, file_data, generated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [docId, inv.id, orgId, v, isFinal, fileName, bytes.length, sha, put.backend, put.storageKey || null, put.inlineData || null, userId || null]);
  return { id: docId, version: v, fileName, sha256: sha };
}

async function readDocument(q, orgId, docId) {
  const { rows: [d] } = await q.query(
    `SELECT * FROM invoice_documents WHERE id = $1 AND organisation_id = $2`, [docId, orgId]);
  if (!d) return null;
  const got = await storage.getBackend(d.storage_backend).get({ backend: d.storage_backend, storageKey: d.storage_key, fileData: d.file_data });
  return { doc: d, bytes: Buffer.from(got.base64 || '', 'base64') };
}

/**
 * The PDF to show for an invoice: the immutable final document when one
 * exists, otherwise a freshly rendered draft (stored as a new draft version).
 */
async function currentPdf({ pool = defaultPool, orgId, userId, invoiceId, store = true }) {
  const { rows: [finalDoc] } = await pool.query(
    `SELECT id FROM invoice_documents WHERE invoice_id = $1 AND organisation_id = $2 AND is_final`, [invoiceId, orgId]);
  if (finalDoc) {
    const r = await readDocument(pool, orgId, finalDoc.id);
    return { bytes: r.bytes, fileName: r.doc.file_name, final: true };
  }
  const { vm, detail } = await pdfViewModel(pool, orgId, invoiceId);
  const bytes = await renderInvoicePdf(vm);
  if (!store) return { bytes, fileName: `${detail.invoice.invoice_number}-draft.pdf`, final: false };
  return withTx(pool, async tx => {
    const inv = await lockInvoice(tx, orgId, invoiceId);
    const doc = await storeDocument(tx, orgId, userId, inv, bytes, false);
    return { bytes, fileName: doc.fileName, final: false };
  });
}

// ── Lifecycle transitions ──────────────────────────────────────────────────

async function finalise({ pool = defaultPool, orgId, userId, invoiceId }) {
  // Render outside the lock from current data, then re-check under the lock that nothing moved.
  const { vm } = await pdfViewModel(pool, orgId, invoiceId);
  vm.draft = false;
  vm.invoice.status = 'READY';
  return withTx(pool, async tx => {
    const inv = await lockInvoice(tx, orgId, invoiceId);
    if (!EDITABLE_STATUSES.includes(inv.status)) throw err(409, 'Invoice is not a draft', 'INVOICE_LOCKED');
    if (inv.status === 'NEEDS_ATTENTION') throw err(409, 'Resolve the attention items (recipient / NDIS number) first', 'NEEDS_ATTENTION');
    if (inv.is_stale) throw err(409, 'A source event changed — regenerate the draft before finalising', 'STALE');
    if (!inv.payer_name) throw err(409, 'The invoice has no recipient', 'NO_RECIPIENT');
    const business = await Settings.businessProfile(tx, orgId);
    if (!business.abn) throw err(409, 'Set the business ABN in Billing Settings before finalising a tax invoice', 'NO_ABN');
    const { rows: [{ n, total }] } = await tx.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total FROM invoice_lines WHERE invoice_id = $1 AND line_status = 'ACTIVE'`, [invoiceId]);
    if (!n) throw err(409, 'The invoice has no active lines', 'EMPTY');
    if (M.toCents(total) !== M.toCents(inv.subtotal)) throw err(409, 'Invoice totals are out of date — regenerate first', 'TOTALS_MISMATCH');
    if (vm.invoice.total !== inv.total || vm.lines.length !== n) throw err(409, 'The invoice changed while finalising — try again', 'CHANGED');
    const bytes = await renderInvoicePdf(vm);
    await tx.query(
      `UPDATE invoices SET status = 'READY', finalised_at = NOW(), finalised_by_user_id = $2, updated_at = NOW() WHERE id = $1`,
      [invoiceId, userId]);
    const doc = await storeDocument(tx, orgId, userId, { ...inv, status: 'READY' }, bytes, true);
    await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.finalised', entityType: 'invoice', entityId: invoiceId, invoiceId,
      before: { status: inv.status }, after: { status: 'READY', total: inv.total, documentSha256: doc.sha256 } });
    return { status: 'READY', documentId: doc.id };
  });
}

function statusForPaid(inv, paidCents) {
  const totalCents = M.toCents(inv.total);
  if (paidCents >= totalCents) return 'PAID';
  if (paidCents > 0) return 'PART_PAID';
  return inv.sent_status === 'SENT' ? 'SENT' : 'READY';
}

async function recordPayment({ pool = defaultPool, orgId, userId, invoiceId, input }) {
  return withTx(pool, async tx => {
    const inv = await lockInvoice(tx, orgId, invoiceId);
    if (!['READY', 'SENT', 'PART_PAID'].includes(inv.status)) throw err(409, 'Payments can be recorded only on a finalised, unpaid invoice', 'INVALID_STATE');
    let cents; try { cents = M.toCents(input.amount); } catch (_) { throw err(400, 'Amount is invalid'); }
    if (!(cents > 0)) throw err(400, 'Amount must be positive');
    const outstanding = M.toCents(inv.total) - M.toCents(inv.amount_paid);
    if (cents > outstanding) throw err(400, `Amount exceeds the outstanding ${M.formatAud(outstanding)}`, 'OVERPAYMENT');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.paidOn || ''))) throw err(400, 'paidOn must be YYYY-MM-DD');
    const { rows: [p] } = await tx.query(
      `INSERT INTO invoice_payments (invoice_id, organisation_id, amount, paid_on, method, reference, recorded_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [invoiceId, orgId, M.fromCents(cents), input.paidOn, input.method ? String(input.method).slice(0, 40) : null,
        input.reference ? String(input.reference).slice(0, 255) : null, userId]);
    const paid = M.toCents(inv.amount_paid) + cents;
    const status = statusForPaid(inv, paid);
    await tx.query(`UPDATE invoices SET amount_paid = $2, status = $3, updated_at = NOW() WHERE id = $1`, [invoiceId, M.fromCents(paid), status]);
    await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.payment_recorded', entityType: 'invoice_payment', entityId: p.id, invoiceId,
      before: { status: inv.status, amountPaid: inv.amount_paid }, after: { status, amountPaid: M.fromCents(paid), payment: M.fromCents(cents), paidOn: input.paidOn } });
    return { status, amountPaid: M.fromCents(paid), outstanding: M.fromCents(M.toCents(inv.total) - paid) };
  });
}

async function markSent({ pool = defaultPool, orgId, userId, invoiceId, sentTo, via }) {
  return withTx(pool, async tx => {
    const inv = await lockInvoice(tx, orgId, invoiceId);
    if (!['READY', 'SENT', 'PART_PAID', 'PAID'].includes(inv.status)) throw err(409, 'Finalise the invoice before sending it', 'NOT_FINAL');
    const status = inv.status === 'READY' ? 'SENT' : inv.status;
    await tx.query(`UPDATE invoices SET sent_status = 'SENT', sent_at = NOW(), sent_to = $2, status = $3, updated_at = NOW() WHERE id = $1`,
      [invoiceId, sentTo ? String(sentTo).slice(0, 255) : null, status]);
    await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.sent', entityType: 'invoice', entityId: invoiceId, invoiceId,
      before: { status: inv.status, sentStatus: inv.sent_status }, after: { status, sentStatus: 'SENT', via: via || 'manual', sentTo: sentTo || null } });
    return { status };
  });
}

/** Email the final PDF through the shared mail transport; falls back cleanly when SMTP is unconfigured. */
async function emailInvoice({ pool = defaultPool, orgId, userId, invoiceId, to, mailer }) {
  const email = mailer || require('../email');
  const { rows: [inv] } = await pool.query(`SELECT * FROM invoices WHERE id = $1 AND organisation_id = $2`, [invoiceId, orgId]);
  if (!inv) throw err(404, 'Invoice not found');
  if (!FINAL_STATUSES.includes(inv.status)) throw err(409, 'Finalise the invoice before emailing it', 'NOT_FINAL');
  const recipient = to || inv.payer_email;
  if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) throw err(400, 'No valid recipient email address', 'NO_EMAIL');
  const pdf = await currentPdf({ pool, orgId, userId, invoiceId });
  const business = await Settings.businessProfile(pool, orgId);
  const esc = email.escapeHtml || (s => String(s));
  const subject = `Tax invoice ${inv.invoice_number} from ${business.name}`;
  const html = `<p>Hello${inv.payer_name ? ` ${esc(inv.payer_name)}` : ''},</p>
<p>Please find attached tax invoice <strong>${esc(inv.invoice_number)}</strong> for ${esc(inv.client_name || 'our client')}${inv.ndis_number ? ` (NDIS ${esc(inv.ndis_number)})` : ''}.</p>
<p>Amount due: <strong>${esc(M.formatAud(M.toCents(inv.total) - M.toCents(inv.amount_paid)))}</strong>${inv.due_date ? `, due ${esc(S.displayDate(ymd(inv.due_date)))}` : ''}.</p>
<p>Kind regards,<br>${esc(business.name)}</p>`;
  const result = await email.sendTemplated({ to: recipient, subject, html,
    text: `Tax invoice ${inv.invoice_number} attached. Amount due ${M.formatAud(M.toCents(inv.total) - M.toCents(inv.amount_paid))}.`,
    attachments: [{ filename: pdf.fileName, content: pdf.bytes, contentType: 'application/pdf' }] });
  if (result && result.skipped) return { sent: false, reason: 'EMAIL_NOT_CONFIGURED' };
  await markSent({ pool, orgId, userId, invoiceId, sentTo: recipient, via: 'email' });
  return { sent: true };
}

async function voidInvoice({ pool = defaultPool, orgId, userId, invoiceId, reason }) {
  const why = requireReason(reason);
  return withTx(pool, async tx => {
    const inv = await lockInvoice(tx, orgId, invoiceId);
    if (inv.status === 'VOID') throw err(409, 'Invoice is already void');
    if (M.toCents(inv.amount_paid) > 0) throw err(409, 'Refund or reverse the recorded payments before voiding', 'HAS_PAYMENTS');
    await tx.query(`UPDATE invoices SET status = 'VOID', voided_at = NOW(), voided_by_user_id = $2, void_reason = $3, updated_at = NOW() WHERE id = $1`,
      [invoiceId, userId, why]);
    // Freeing the claims is what lets a corrected invoice be issued for the same events.
    await tx.query(`UPDATE invoice_lines SET line_status = 'VOIDED', updated_at = NOW() WHERE invoice_id = $1 AND line_status IN ('ACTIVE','REMOVED')`, [invoiceId]);
    await tx.query(`UPDATE trip_allocations SET is_current = FALSE WHERE id IN (SELECT trip_allocation_id FROM invoice_lines WHERE invoice_id = $1 AND trip_allocation_id IS NOT NULL)`, [invoiceId]);
    await tx.query(`UPDATE billing_issues SET status = 'RESOLVED', resolved_at = NOW(), resolved_by_user_id = $2, resolution_note = 'Invoice voided'
                     WHERE invoice_id = $1 AND status = 'OPEN'`, [invoiceId, userId]);
    await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.voided', entityType: 'invoice', entityId: invoiceId, invoiceId,
      before: { status: inv.status, total: inv.total }, after: { status: 'VOID' }, reason: why });
    return { status: 'VOID', invoice: inv };
  });
}

/**
 * Void & reissue: void the invoice (freeing its claims) and regenerate a new
 * draft from the same sources with today's calendar and profile data. The new
 * draft records which invoice it replaces.
 */
async function voidAndReissue({ pool = defaultPool, orgId, userId, invoiceId, reason }) {
  const { invoice: inv } = await voidInvoice({ pool, orgId, userId, invoiceId, reason });
  const Gen = require('./invoice-generation');
  let result;
  if (inv.trip_id) {
    result = await require('./trips').generateTripInvoices({ pool, orgId, userId, tripId: inv.trip_id });
  } else {
    result = await Gen.runInvoicing({ pool, orgId, userId, kind: 'REISSUE', clientIds: [inv.client_id],
      from: ymd(inv.period_start), to: ymd(inv.period_end) });
  }
  const { rows } = await pool.query(
    `UPDATE invoices SET reissue_of_invoice_id = $2, updated_at = NOW()
      WHERE id = ANY($3::uuid[]) AND client_id = $4 AND organisation_id = $1 AND status IN ('DRAFT','NEEDS_ATTENTION')
      RETURNING id, invoice_number`, [orgId, invoiceId, result.summary.invoiceIds || [], inv.client_id]);
  if (rows[0]) {
    await recordAudit(pool, { orgId, actorUserId: userId, action: 'invoice.reissued', entityType: 'invoice', entityId: rows[0].id,
      invoiceId: rows[0].id, before: { voidedInvoice: inv.invoice_number }, after: { newInvoice: rows[0].invoice_number }, reason });
  }
  return { voided: inv.invoice_number, reissued: rows[0] || null, summary: result.summary };
}

module.exports = {
  voidAndReissue,
  EDITABLE_STATUSES, FINAL_STATUSES, withTx, listInvoices, invoiceCounts, getInvoiceDetail, editLine, setLineStatus,
  addManualLine, updateDraftHeader, currentPdf, readDocument, finalise, recordPayment, markSent, emailInvoice,
  voidInvoice, statusForPaid, pdfViewModel,
};
