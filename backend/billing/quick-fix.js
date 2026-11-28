'use strict';

/**
 * QUICK FIX — one Needs-attention item, fixed from a small pop-up, without a
 * full invoicing run (a run reads all of Splose and takes a minute or more).
 *
 * Remembering: a client fix is saved on the client's billing profile (and a
 * payer in the payer directory) by PUT /api/invoicing/clients/:id before this
 * is called, so every later run uses it. Here it is applied to the client's
 * open drafts straight away. A payer's email entered once is reused for every
 * client invoiced to that payer (the payer directory).
 *
 * Case noting: a session with no case noting in the calendar gets a case-noting
 * line priced like its session, placed straight after it on the draft.
 */

const M = require('./money');
const S = require('./session-billing');
const BP = require('./billing-profiles');
const { recordAudit } = require('./billing-audit');

const EDITABLE = ['DRAFT', 'NEEDS_ATTENTION'];
const RECIPIENT_ISSUES = ['CLIENT_MISSING_PAYER', 'NDIS_NUMBER_MISSING'];

function err(status, message, code) { return Object.assign(new Error(message), { status, code }); }

async function refreshTotals(tx, invoiceId) {
  const { rows } = await tx.query(`SELECT amount, gst_amount, line_status FROM invoice_lines WHERE invoice_id = $1`, [invoiceId]);
  const t = S.invoiceTotals(rows);
  await tx.query(`UPDATE invoices SET subtotal = $2, gst_total = $3, total = $4, updated_at = NOW() WHERE id = $1`,
    [invoiceId, M.fromCents(t.subtotalCents), M.fromCents(t.gstCents), M.fromCents(t.totalCents)]);
  return t;
}

/**
 * Copy the client's saved profile (payer, NDIS number) onto every open draft of
 * theirs, and close the recipient items it answers. Returns what changed.
 */
async function applyProfileToDrafts(tx, { orgId, userId, clientId }) {
  const p = await BP.getProfile(tx, orgId, clientId);
  if (!p) throw err(404, 'Client billing profile not found');
  const payer = BP.resolvePayer(p);
  const missing = [];
  if (!payer) missing.push('CLIENT_MISSING_PAYER');
  if (BP.ndisNumberRequired(p) && !p.ndis_number) missing.push('NDIS_NUMBER_MISSING');
  const { rows: drafts } = await tx.query(
    `SELECT * FROM invoices WHERE organisation_id = $1 AND client_id = $2 AND status = ANY($3::text[]) FOR UPDATE`,
    [orgId, clientId, EDITABLE]);
  for (const inv of drafts) {
    // Another BLOCKING item on this draft keeps it in Needs attention.
    const { rows: [other] } = await tx.query(
      `SELECT 1 FROM billing_issues WHERE organisation_id = $1 AND status = 'OPEN' AND severity = 'BLOCKING'
          AND invoice_id = $2 AND NOT (issue_type = ANY($3::text[])) LIMIT 1`, [orgId, inv.id, RECIPIENT_ISSUES]);
    const status = missing.length || other ? 'NEEDS_ATTENTION' : 'DRAFT';
    await tx.query(
      `UPDATE invoices SET ndis_number = $2, management_type = $3, payer_type = $4, payer_name = $5, payer_email = $6,
              payer_reference = $7, payer_address = $8, payer_key = $9, client_name = COALESCE($10, client_name),
              status = $11, updated_at = NOW()
        WHERE id = $1`,
      [inv.id, p.ndis_number || null, p.management_type || null, payer ? payer.type : null, payer ? payer.name : null,
        payer ? payer.email : null, payer ? payer.reference : null, payer ? payer.address : null, BP.payerKey(payer),
        p.participant_name || null, status]);
    await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.recipient_corrected', entityType: 'invoice', entityId: inv.id,
      invoiceId: inv.id, before: { payer_name: inv.payer_name, payer_email: inv.payer_email, ndis_number: inv.ndis_number, status: inv.status },
      after: { payer_name: payer ? payer.name : null, payer_email: payer ? payer.email : null, ndis_number: p.ndis_number || null, status },
      reason: 'Quick fix from the client billing profile' });
  }
  const fixed = RECIPIENT_ISSUES.filter(t => !missing.includes(t));
  const { rowCount: resolved } = await tx.query(
    `UPDATE billing_issues SET status = 'RESOLVED', resolved_at = NOW(), resolved_by_user_id = $3, resolution_note = 'Quick fix'
      WHERE organisation_id = $1 AND client_id = $2 AND status = 'OPEN' AND issue_type = ANY($4::text[])`,
    [orgId, clientId, userId || null, fixed]);
  return { draftsUpdated: drafts.length, issuesResolved: resolved, stillMissing: missing };
}

/** Case-noting minutes for a session that has none: a line after the session, priced like it. */
async function addCaseNoteLine(tx, { orgId, userId, eventId, minutes }) {
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0 || mins > 600) throw err(400, 'Enter the case-noting minutes (1–600)');
  const { rows: [sess] } = await tx.query(
    `SELECT l.*, i.status AS invoice_status, i.tax_treatment, to_char(l.service_date,'YYYY-MM-DD') AS sd
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE l.organisation_id = $1 AND l.calendar_event_id = $2 AND l.component = 'SESSION' AND l.line_status = 'ACTIVE'
      ORDER BY l.created_at DESC LIMIT 1 FOR UPDATE OF i`, [orgId, eventId]);
  if (!sess) throw err(409, 'This session is not on a draft yet. Create drafts for its week first.', 'SESSION_NOT_DRAFTED');
  if (!EDITABLE.includes(sess.invoice_status)) throw err(409, 'The session is on a finalised invoice, which is locked.', 'INVOICE_LOCKED');
  const { rows: [dup] } = await tx.query(
    `SELECT id FROM invoice_lines WHERE organisation_id = $1 AND line_status = 'ACTIVE' AND calculation->>'caseNoteFor' = $2`,
    [orgId, String(eventId)]);
  if (dup) throw err(409, 'This session already has a case-noting line.', 'ALREADY_ADDED');
  const qE4 = M.toQtyE4((mins / 60).toFixed(4));
  const unit = M.toCents(sess.unit_price);
  const amount = M.lineAmount(qE4, unit);
  const gst = S.gstFor(amount, sess.tax_treatment);
  const description = `Case noting${sess.sd ? ' — ' + S.displayDate(sess.sd) : ''} (${Math.round(mins)} min)`;
  const { rows: [l] } = await tx.query(
    `INSERT INTO invoice_lines (invoice_id, organisation_id, component, client_id, practitioner_user_id, service_date, item_code,
        description, duration_minutes, quantity, unit_price, gst_rate, gst_amount, amount, is_overridden, calculation, sort_order, mmm_zone,
        rate_card_id, rate_card_version)
     VALUES ($1,$2,'MANUAL',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE,$14,$15,$16,$17,$18) RETURNING id`,
    [sess.invoice_id, orgId, sess.client_id, sess.practitioner_user_id, sess.service_date, sess.item_code, description,
      Math.round(mins), M.qtyToString(qE4), M.fromCents(unit), gst.rate, M.fromCents(gst.cents), M.fromCents(amount),
      JSON.stringify({ method: 'case_note', caseNoteFor: String(eventId), minutes: Math.round(mins), by: userId, at: new Date().toISOString() }),
      Number(sess.sort_order || 0) + 1, sess.mmm_zone, sess.rate_card_id, sess.rate_card_version]);
  const t = await refreshTotals(tx, sess.invoice_id);
  await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.line_added', entityType: 'invoice_line', entityId: l.id,
    invoiceId: sess.invoice_id, after: { description, quantity: M.qtyToString(qE4), unitPrice: M.fromCents(unit), amount: M.fromCents(amount) },
    reason: 'Quick fix: case noting for a session' });
  await tx.query(
    `UPDATE billing_issues SET status = 'RESOLVED', resolved_at = NOW(), resolved_by_user_id = $3, resolution_note = 'Case-noting line added'
      WHERE organisation_id = $1 AND calendar_event_id = $2 AND issue_type = 'CASE_NOTE_MISSING' AND status = 'OPEN'`,
    [orgId, eventId, userId || null]);
  return { invoiceId: sess.invoice_id, lineId: l.id, total: M.fromCents(t.totalCents) };
}

/** Remember the owner's answer for a calendar block (migration 096) and close its items. */
async function decideEvent(tx, { orgId, userId, eventId, decision }) {
  if (!['BILL', 'NOT_BILLABLE', 'SPLOSE'].includes(decision)) throw err(400, 'Choose an answer');
  const { rows: [ev] } = await tx.query(
    `SELECT e.id FROM events e JOIN users u ON u.id = e.user_id WHERE e.id = $1 AND u.organisation_id = $2`, [eventId, orgId]);
  if (!ev) throw err(404, 'Calendar block not found');
  await tx.query(
    `INSERT INTO billing_event_decisions (event_id, organisation_id, decision, set_by_user_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (event_id) DO UPDATE SET decision = EXCLUDED.decision, set_by_user_id = EXCLUDED.set_by_user_id, set_at = NOW()`,
    [eventId, orgId, decision, userId || null]);
  await recordAudit(tx, { orgId, actorUserId: userId, action: 'billing.event_decided', entityType: 'event', entityId: eventId,
    after: { decision }, reason: 'Quick fix' });
  await tx.query(
    `UPDATE billing_issues SET status = 'RESOLVED', resolved_at = NOW(), resolved_by_user_id = $3, resolution_note = $4
      WHERE organisation_id = $1 AND calendar_event_id = $2 AND status = 'OPEN'
        AND issue_type IN ('REPORT_NOT_BILLED','TRAVEL_BLOCK_NOT_INVOICED','TRAVEL_BLOCK_NO_CLIENT','FLIGHT_NO_TRIP')`,
    [orgId, eventId, userId || null, 'Answered: ' + decision.toLowerCase().replace('_', ' ')]);
  return { ok: true, decision };
}

/**
 * A travel block for a client that is not one of the day's travel legs: bill its
 * minutes at the provider-travel rate for the client's zone, on the client's open draft.
 */
async function addTravelBlockLine(tx, { orgId, userId, eventId, clientId, rateCards, resolveRule, effectiveMmm }) {
  const { rows: [ev] } = await tx.query(
    `SELECT e.id, e.start_time, e.end_time, e.user_id, e.title,
            to_char(((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(bs.timezone, 'Australia/Perth'))::date, 'YYYY-MM-DD') AS local_date
       FROM events e JOIN users u ON u.id = e.user_id LEFT JOIN billing_settings bs ON bs.organisation_id = u.organisation_id
      WHERE e.id = $1 AND u.organisation_id = $2`, [eventId, orgId]);
  if (!ev) throw err(404, 'Calendar block not found');
  const { rows: [inv] } = await tx.query(
    `SELECT * FROM invoices WHERE organisation_id = $1 AND client_id = $2 AND status = ANY($3::text[])
      ORDER BY (period_start <= $4::date AND period_end >= $4::date) DESC, created_at DESC LIMIT 1 FOR UPDATE`,
    [orgId, clientId, EDITABLE, ev.local_date]);
  if (!inv) throw err(409, 'This client has no open draft. Create drafts for that week first.', 'NO_DRAFT');
  const { rows: [dup] } = await tx.query(
    `SELECT 1 FROM invoice_lines WHERE organisation_id = $1 AND line_status = 'ACTIVE' AND calculation->>'travelBlock' = $2`, [orgId, String(eventId)]);
  if (dup) throw err(409, 'This travel block is already on an invoice.', 'ALREADY_ADDED');
  const p = await BP.getProfile(tx, orgId, clientId);
  const mmm = p ? effectiveMmm(p) : null;
  const rate = resolveRule(rateCards, { serviceDate: ev.local_date, mmm, discipline: 'OT' });
  if (!rate) throw err(409, "The client's MMM zone or rate card is not set, so travel cannot be priced. Fix the client first.", 'NO_RATE');
  const mins = Math.max(1, Math.round((new Date(ev.end_time) - new Date(ev.start_time)) / 60000));
  const qE4 = M.toQtyE4((mins / 60).toFixed(4));
  const amount = M.lineAmount(qE4, rate.travelRateCents);
  const gst = S.gstFor(amount, inv.tax_treatment);
  const description = `${S.displayDate(ev.local_date)}, ${mins} minutes, Provider Travel`;
  const { rows: [l] } = await tx.query(
    `INSERT INTO invoice_lines (invoice_id, organisation_id, component, client_id, practitioner_user_id, service_date, item_code,
        description, duration_minutes, quantity, unit_price, gst_rate, gst_amount, amount, is_overridden, calculation, sort_order, mmm_zone,
        rate_card_id, rate_card_version)
     VALUES ($1,$2,'MANUAL',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE,$14,$15,$16,$17,$18) RETURNING id`,
    [inv.id, orgId, clientId, ev.user_id, ev.local_date, rate.rule.travelItemCode || null, description, mins, M.qtyToString(qE4),
      M.fromCents(rate.travelRateCents), gst.rate, M.fromCents(gst.cents), M.fromCents(amount),
      JSON.stringify({ method: 'travel_block', travelBlock: String(eventId), minutes: mins, mmm, by: userId, at: new Date().toISOString() }),
      (Math.floor(new Date(ev.start_time).getTime() / 60000) % 100000000) * 10 + 3, mmm, rate.card.id, rate.card.version]);
  const t = await refreshTotals(tx, inv.id);
  await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.line_added', entityType: 'invoice_line', entityId: l.id,
    invoiceId: inv.id, after: { description, amount: M.fromCents(amount) }, reason: 'Quick fix: travel block billed' });
  await decideEvent(tx, { orgId, userId, eventId, decision: 'BILL' });
  return { invoiceId: inv.id, lineId: l.id, total: M.fromCents(t.totalCents) };
}

/** Delete a draft that was never finalised. Its sessions come back on the next run. */
async function deleteDraft(tx, { orgId, userId, invoiceId }) {
  const { rows: [inv] } = await tx.query(`SELECT * FROM invoices WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [invoiceId, orgId]);
  if (!inv) throw err(404, 'Invoice not found');
  if (!EDITABLE.includes(inv.status) || inv.finalised_at) throw err(409, 'Only a draft can be deleted. Void a finalised invoice instead.', 'INVOICE_LOCKED');
  const { rows: [x] } = await tx.query(`SELECT 1 FROM xero_invoice_links WHERE invoice_id = $1`, [invoiceId]);
  if (x) throw err(409, 'This invoice is linked to Xero; void it instead.', 'INVOICE_LOCKED');
  await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.draft_deleted', entityType: 'invoice', entityId: invoiceId, invoiceId,
    before: { invoice_number: inv.invoice_number, client_id: inv.client_id, total: inv.total, status: inv.status }, reason: 'Draft deleted' });
  await tx.query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]);
  return { ok: true, invoiceNumber: inv.invoice_number };
}

module.exports = { applyProfileToDrafts, addCaseNoteLine, decideEvent, addTravelBlockLine, deleteDraft, RECIPIENT_ISSUES };
