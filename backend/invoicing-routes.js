'use strict';

/**
 * INVOICING ROUTES — Owner Portal › Invoicing.
 *
 * Calendar → travel → MMM + rate card → invoice → PDF → audit trail.
 * Architecture: docs/accounting/INVOICING_ARCHITECTURE.md
 *
 * Guard: every route requires authentication and the `manage_billing`
 * permission (owner by default; grantable per user for a future finance
 * role). A practitioner never gains access by owning the source event.
 * Tenant boundary: every query is scoped to req.user.organisation_id; a user
 * with no organisation is refused.
 *
 * All money is computed server-side (billing/*); the browser only displays.
 */

const express = require('express');
const router = express.Router();
const { pool } = require('./database');
const { requireAuth, requirePermission } = require('./permissions');
const log = require('./logger').createLogger('invoicing');
const { contentDisposition } = require('./content-disposition');

const Gen = require('./billing/invoice-generation');
const Life = require('./billing/invoice-lifecycle');
const Trips = require('./billing/trips');
const Settings = require('./billing/billing-settings');
const RC = require('./billing/rate-cards');
const BP = require('./billing/billing-profiles');
const MMM = require('./billing/mmm-classification');
const RF = require('./billing/route-facts');
const Issues = require('./billing/billing-issues');
const { recordAudit, listAudit } = require('./billing/billing-audit');
const storage = require('./storage');

const guard = [requireAuth, requirePermission('manage_billing')];
router.use('/api/invoicing', ...guard);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function orgId(req) { return req.user && req.user.organisation_id ? req.user.organisation_id : null; }

const safe = (fn) => (req, res) => {
  if (!orgId(req)) return res.status(403).json({ error: 'Your account is not linked to an organisation' });
  return Promise.resolve(fn(req, res)).catch((err) => {
    if (err && err.status && err.status < 500) {
      return res.status(err.status).json({ error: err.message, code: err.code || undefined });
    }
    if (err && err.code === '23505') return res.status(409).json({ error: 'That change conflicts with an existing billing record' });
    log.error('invoicing route error', { error: err, path: req.path });
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  });
};

function uuidParam(...names) {
  return (req, res, next) => {
    for (const n of names) if (!UUID_RE.test(String(req.params[n] || ''))) return res.status(404).json({ error: 'Not found' });
    next();
  };
}

async function tz(req) {
  const s = await Settings.ensureSettings(pool, orgId(req));
  return s.timezone || 'Australia/Perth';
}

// ── Overview ──────────────────────────────────────────────────────────────

router.get('/api/invoicing/overview', safe(async (req, res) => {
  const t = await tz(req);
  const [counts, runs, practitioners] = await Promise.all([
    Life.invoiceCounts(pool, orgId(req), { tz: t }),
    pool.query(`SELECT r.id, r.kind, to_char(r.period_start,'YYYY-MM-DD') AS period_start, to_char(r.period_end,'YYYY-MM-DD') AS period_end,
                       r.status, r.summary, r.created_at, u.name AS created_by, t.name AS trip_name
                  FROM invoice_runs r LEFT JOIN users u ON u.id = r.created_by_user_id LEFT JOIN trips t ON t.id = r.trip_id
                 WHERE r.organisation_id = $1 ORDER BY r.created_at DESC LIMIT 10`, [orgId(req)]),
    practitionersFor(orgId(req)),
  ]);
  res.json({ counts, runs: runs.rows, practitioners, timezone: t });
}));

async function practitionersFor(org) {
  const { rows } = await pool.query(
    `SELECT u.id, COALESCE(tp.display_name, u.name, u.email) AS name
       FROM users u LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
      WHERE u.organisation_id = $1 AND COALESCE(u.is_active, TRUE)
        AND (u.is_treating_therapist OR tp.id IS NOT NULL OR u.role IN ('owner','therapist'))
      ORDER BY 2`, [org]);
  return rows;
}

router.get('/api/invoicing/practitioners', safe(async (req, res) => {
  res.json({ practitioners: await practitionersFor(orgId(req)) });
}));

// The letterhead logo for the on-screen invoice preview (same file the PDF embeds).
router.get('/api/invoicing/logo', safe(async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(require('path').join(__dirname, 'assets', 'opal-therapy-logo.png'));
}));

// ── Complete invoicing ────────────────────────────────────────────────────

router.post('/api/invoicing/runs', safe(async (req, res) => {
  const { from, to, practitionerId } = req.body || {};
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from > to) return res.status(400).json({ error: 'Choose a valid date range' });
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (days > 93) return res.status(400).json({ error: 'An invoicing run covers at most three months' });
  let practitionerIds = null;
  if (practitionerId) {
    if (!UUID_RE.test(practitionerId)) return res.status(400).json({ error: 'Invalid practitioner' });
    const { rows } = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND organisation_id = $2`, [practitionerId, orgId(req)]);
    if (!rows.length) return res.status(400).json({ error: 'Invalid practitioner' });
    practitionerIds = [practitionerId];
  }
  const result = await Gen.runInvoicing({ pool, orgId: orgId(req), userId: req.user.id, from, to, practitionerIds, kind: 'NORMAL' });
  res.status(201).json(result);
}));

router.get('/api/invoicing/runs', safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.kind, to_char(r.period_start,'YYYY-MM-DD') AS period_start, to_char(r.period_end,'YYYY-MM-DD') AS period_end,
            r.status, r.summary, r.created_at, u.name AS created_by, t.name AS trip_name
       FROM invoice_runs r LEFT JOIN users u ON u.id = r.created_by_user_id LEFT JOIN trips t ON t.id = r.trip_id
      WHERE r.organisation_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [orgId(req)]);
  res.json({ runs: rows });
}));

// ── Invoices ──────────────────────────────────────────────────────────────

router.get('/api/invoicing/invoices', safe(async (req, res) => {
  const f = { ...req.query };
  if (f.practitionerId && !UUID_RE.test(f.practitionerId)) delete f.practitionerId;
  if (f.tripId && !UUID_RE.test(f.tripId)) delete f.tripId;
  if (f.from && !DATE_RE.test(f.from)) delete f.from;
  if (f.to && !DATE_RE.test(f.to)) delete f.to;
  if (f.mmm && !/^[1-7]$/.test(String(f.mmm))) delete f.mmm;
  res.json(await Life.listInvoices(pool, orgId(req), f, { tz: await tz(req) }));
}));

router.get('/api/invoicing/invoices/:id', uuidParam('id'), safe(async (req, res) => {
  const d = await Life.getInvoiceDetail(pool, orgId(req), req.params.id, { tz: await tz(req) });
  if (!d) return res.status(404).json({ error: 'Invoice not found' });
  const business = await Settings.businessProfile(pool, orgId(req));
  res.json({ ...d, business });
}));

router.patch('/api/invoicing/invoices/:id', uuidParam('id'), safe(async (req, res) => {
  res.json(await Life.updateDraftHeader({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id, patch: req.body || {} }));
}));

router.post('/api/invoicing/invoices/:id/regenerate', uuidParam('id'), safe(async (req, res) => {
  const { rows: [inv] } = await pool.query(
    `SELECT id, status, client_id, trip_id, to_char(period_start,'YYYY-MM-DD') AS ps, to_char(period_end,'YYYY-MM-DD') AS pe
       FROM invoices WHERE id = $1 AND organisation_id = $2`, [req.params.id, orgId(req)]);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!Life.EDITABLE_STATUSES.includes(inv.status)) return res.status(409).json({ error: 'Only a draft can be regenerated', code: 'INVOICE_LOCKED' });
  const result = inv.trip_id
    ? await Trips.generateTripInvoices({ pool, orgId: orgId(req), userId: req.user.id, tripId: inv.trip_id })
    : await Gen.runInvoicing({ pool, orgId: orgId(req), userId: req.user.id, from: inv.ps, to: inv.pe, clientIds: [inv.client_id], kind: 'NORMAL' });
  res.json(result);
}));

router.post('/api/invoicing/invoices/:id/finalise', uuidParam('id'), safe(async (req, res) => {
  res.json(await Life.finalise({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id }));
}));

router.post('/api/invoicing/invoices/:id/void', uuidParam('id'), safe(async (req, res) => {
  const r = await Life.voidInvoice({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id, reason: (req.body || {}).reason });
  res.json({ status: r.status });
}));

router.post('/api/invoicing/invoices/:id/reissue', uuidParam('id'), safe(async (req, res) => {
  res.json(await Life.voidAndReissue({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id, reason: (req.body || {}).reason }));
}));

router.post('/api/invoicing/invoices/:id/payments', uuidParam('id'), safe(async (req, res) => {
  res.status(201).json(await Life.recordPayment({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id, input: req.body || {} }));
}));

router.post('/api/invoicing/invoices/:id/mark-sent', uuidParam('id'), safe(async (req, res) => {
  res.json(await Life.markSent({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id, sentTo: (req.body || {}).sentTo, via: 'manual' }));
}));

router.post('/api/invoicing/invoices/:id/email', uuidParam('id'), safe(async (req, res) => {
  res.json(await Life.emailInvoice({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id, to: (req.body || {}).to }));
}));

function sendPdf(req, res, bytes, fileName) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', contentDisposition(req.query.disposition === 'inline' ? 'inline' : 'attachment', fileName));
  res.send(bytes);
}

router.get('/api/invoicing/invoices/:id/pdf', uuidParam('id'), safe(async (req, res) => {
  const { rows } = await pool.query(`SELECT 1 FROM invoices WHERE id = $1 AND organisation_id = $2`, [req.params.id, orgId(req)]);
  if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
  // Previews are rendered without storing a version; an explicit download stores the draft version.
  const out = await Life.currentPdf({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id, store: req.query.disposition !== 'inline' });
  sendPdf(req, res, out.bytes, out.fileName);
}));

router.get('/api/invoicing/documents/:docId', uuidParam('docId'), safe(async (req, res) => {
  const r = await Life.readDocument(pool, orgId(req), req.params.docId);
  if (!r) return res.status(404).json({ error: 'Document not found' });
  sendPdf(req, res, r.bytes, r.doc.file_name);
}));

router.get('/api/invoicing/invoices/:id/audit', uuidParam('id'), safe(async (req, res) => {
  const { rows } = await pool.query(`SELECT 1 FROM invoices WHERE id = $1 AND organisation_id = $2`, [req.params.id, orgId(req)]);
  if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ events: await listAudit(pool, orgId(req), { invoiceId: req.params.id }) });
}));

router.patch('/api/invoicing/invoices/:id/lines/:lineId', uuidParam('id', 'lineId'), safe(async (req, res) => {
  res.json(await Life.editLine({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id, lineId: req.params.lineId, patch: req.body || {} }));
}));

router.post('/api/invoicing/invoices/:id/lines/:lineId/remove', uuidParam('id', 'lineId'), safe(async (req, res) => {
  res.json(await Life.setLineStatus({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id, lineId: req.params.lineId, remove: true, reason: (req.body || {}).reason }));
}));

router.post('/api/invoicing/invoices/:id/lines/:lineId/restore', uuidParam('id', 'lineId'), safe(async (req, res) => {
  res.json(await Life.setLineStatus({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id, lineId: req.params.lineId, remove: false, reason: (req.body || {}).reason }));
}));

router.post('/api/invoicing/invoices/:id/lines', uuidParam('id'), safe(async (req, res) => {
  res.status(201).json(await Life.addManualLine({ pool, orgId: orgId(req), userId: req.user.id, invoiceId: req.params.id, input: req.body || {} }));
}));

// ── Calendar integration ──────────────────────────────────────────────────

/** Invoice numbers + billing marks for a set of calendar events (badges). */
router.post('/api/invoicing/events/links', safe(async (req, res) => {
  const ids = Array.isArray((req.body || {}).eventIds) ? req.body.eventIds.filter(id => UUID_RE.test(String(id))).slice(0, 500) : [];
  if (!ids.length) return res.json({ links: {} });
  const { rows } = await pool.query(
    `SELECT e.id AS event_id, ceb.attendance,
            (SELECT json_agg(json_build_object('invoiceId', i.id, 'invoiceNumber', i.invoice_number, 'status', i.status,
                                               'component', l.component, 'lineStatus', l.line_status) ORDER BY i.created_at)
               FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
              WHERE l.calendar_event_id = e.id AND l.line_status IN ('ACTIVE','REMOVED')) AS invoices
       FROM events e JOIN users u ON u.id = e.user_id
       LEFT JOIN calendar_event_billing ceb ON ceb.event_id = e.id
      WHERE e.id = ANY($1::uuid[]) AND u.organisation_id = $2`, [ids, orgId(req)]);
  const links = {};
  for (const r of rows) if (r.invoices || r.attendance) links[r.event_id] = { attendance: r.attendance, invoices: r.invoices || [] };
  res.json({ links });
}));

router.get('/api/invoicing/events/:eventId', uuidParam('eventId'), safe(async (req, res) => {
  const { rows: [ev] } = await pool.query(
    `SELECT e.id, e.title, e.start_time, e.end_time, e.client_id, e.client_name, e.location, e.manual_location, e.status,
            e.event_type, e.is_deleted, u.name AS practitioner_name, ceb.attendance, ceb.reason AS attendance_reason
       FROM events e JOIN users u ON u.id = e.user_id LEFT JOIN calendar_event_billing ceb ON ceb.event_id = e.id
      WHERE e.id = $1 AND u.organisation_id = $2`, [req.params.eventId, orgId(req)]);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  const { rows: lines } = await pool.query(
    `SELECT l.id, l.component, l.line_status, l.amount, l.description, i.id AS invoice_id, i.invoice_number, i.status
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE l.calendar_event_id = $1 ORDER BY l.created_at`, [ev.id]);
  res.json({ event: ev, lines });
}));

router.put('/api/invoicing/events/:eventId/attendance', uuidParam('eventId'), safe(async (req, res) => {
  const { attendance, reason } = req.body || {};
  if (attendance != null && !['COMPLETED', 'DID_NOT_ATTEND', 'CANCELLED', 'NOT_BILLABLE'].includes(attendance)) {
    return res.status(400).json({ error: 'Invalid attendance' });
  }
  const { rows: [ev] } = await pool.query(
    `SELECT e.id FROM events e JOIN users u ON u.id = e.user_id WHERE e.id = $1 AND u.organisation_id = $2`, [req.params.eventId, orgId(req)]);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  await Life.withTx(pool, async tx => {
    const { rows: [before] } = await tx.query(`SELECT attendance, reason FROM calendar_event_billing WHERE event_id = $1`, [ev.id]);
    if (attendance == null) await tx.query(`DELETE FROM calendar_event_billing WHERE event_id = $1`, [ev.id]);
    else {
      await tx.query(
        `INSERT INTO calendar_event_billing (event_id, organisation_id, attendance, reason, set_by_user_id)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (event_id) DO UPDATE SET attendance = EXCLUDED.attendance,
           reason = EXCLUDED.reason, set_by_user_id = EXCLUDED.set_by_user_id, set_at = NOW()`,
        [ev.id, orgId(req), attendance, reason ? String(reason).slice(0, 1000) : null, req.user.id]);
    }
    // A billed event changing billability flags its drafts / finalised invoices like any source change.
    await tx.query(`SELECT billing_flag_event_change_for($1, 'marked ' || $2)`, [ev.id, (attendance || 'unmarked').toLowerCase().replace(/_/g, ' ')]);
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'event.attendance_marked', entityType: 'calendar_event',
      entityId: ev.id, before: before || null, after: { attendance: attendance || null }, reason });
  });
  res.json({ ok: true });
}));

// ── Needs attention ───────────────────────────────────────────────────────

router.get('/api/invoicing/issues', safe(async (req, res) => {
  const status = ['OPEN', 'RESOLVED', 'DISMISSED'].includes(req.query.status) ? req.query.status : 'OPEN';
  res.json({ issues: await Issues.listIssues(pool, orgId(req), { status, type: req.query.type || null, clientId: req.query.clientId || null }) });
}));

router.post('/api/invoicing/issues/:id/dismiss', uuidParam('id'), safe(async (req, res) => {
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'A reason is required to dismiss an attention item' });
  const r = await Life.withTx(pool, async tx => {
    const { rows: [it] } = await tx.query(
      `UPDATE billing_issues SET status = 'DISMISSED', resolved_at = NOW(), resolved_by_user_id = $3, resolution_note = $4
        WHERE id = $1 AND organisation_id = $2 AND status = 'OPEN' RETURNING id, issue_type, invoice_id`,
      [req.params.id, orgId(req), req.user.id, reason.slice(0, 1000)]);
    if (!it) return null;
    if (it.issue_type === 'SOURCE_CHANGED_AFTER_FINALISE' && it.invoice_id) {
      const { rows: [{ n }] } = await tx.query(
        `SELECT COUNT(*)::int AS n FROM billing_issues WHERE invoice_id = $1 AND status = 'OPEN' AND issue_type = 'SOURCE_CHANGED_AFTER_FINALISE'`, [it.invoice_id]);
      if (!n) await tx.query(`UPDATE invoices SET source_changed_after_finalise = FALSE, updated_at = NOW() WHERE id = $1`, [it.invoice_id]);
    }
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'issue.dismissed', entityType: 'billing_issue',
      entityId: it.id, invoiceId: it.invoice_id, after: { issueType: it.issue_type }, reason });
    return it;
  });
  if (!r) return res.status(404).json({ error: 'Attention item not found' });
  res.json({ ok: true });
}));

/** Reprocess: re-run invoicing over the issue's scope after the record was fixed. */
router.post('/api/invoicing/issues/:id/reprocess', uuidParam('id'), safe(async (req, res) => {
  const { rows: [it] } = await pool.query(
    `SELECT b.*, to_char(b.service_date,'YYYY-MM-DD') AS sd FROM billing_issues b WHERE b.id = $1 AND b.organisation_id = $2`,
    [req.params.id, orgId(req)]);
  if (!it) return res.status(404).json({ error: 'Attention item not found' });
  if (it.trip_id) {
    return res.json(await Trips.generateTripInvoices({ pool, orgId: orgId(req), userId: req.user.id, tripId: it.trip_id }));
  }
  let from = it.sd, to = it.sd;
  if (!from) {
    // Client-level issue: re-run the periods of the client's open drafts, else the issue's last 31 days.
    const { rows: [p] } = await pool.query(
      `SELECT to_char(MIN(period_start),'YYYY-MM-DD') AS f, to_char(MAX(period_end),'YYYY-MM-DD') AS t FROM invoices
        WHERE organisation_id = $1 AND client_id = $2 AND status IN ('DRAFT','NEEDS_ATTENTION')`, [orgId(req), it.client_id]);
    const end = new Date(it.last_seen_at).toISOString().slice(0, 10);
    from = (p && p.f) || new Date(Date.parse(end) - 31 * 86400000).toISOString().slice(0, 10);
    to = (p && p.t) || end;
  }
  const result = await Gen.runInvoicing({ pool, orgId: orgId(req), userId: req.user.id, from, to,
    clientIds: it.client_id && !it.sd ? [it.client_id] : null,
    practitionerIds: it.sd && it.practitioner_user_id ? [it.practitioner_user_id] : null, kind: 'NORMAL' });
  const { rows: [after] } = await pool.query(`SELECT status FROM billing_issues WHERE id = $1`, [it.id]);
  res.json({ ...result, issueStatus: after ? after.status : null });
}));

// ── Client billing profiles ───────────────────────────────────────────────

router.get('/api/invoicing/clients', safe(async (req, res) => {
  res.json({ clients: await BP.listProfiles(pool, orgId(req), { search: req.query.q || null }) });
}));

router.get('/api/invoicing/clients/:clientId', safe(async (req, res) => {
  const p = await BP.getProfile(pool, orgId(req), String(req.params.clientId));
  if (!p) return res.status(404).json({ error: 'Client billing profile not found' });
  const ds = await MMM.activeDataset(pool);
  res.json({ profile: p, effectiveMmm: MMM.effectiveMmm(p), mmmDataset: ds ? { version: ds.version, source: ds.source } : null });
}));

router.put('/api/invoicing/clients/:clientId', safe(async (req, res) => {
  const clientId = String(req.params.clientId).slice(0, 255);
  const { errors, values } = BP.validateProfilePatch(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const out = await Life.withTx(pool, async tx => {
    const r = await BP.upsertProfile(tx, orgId(req), clientId, req.user.id, values);
    const changed = Object.keys(values).reduce((acc, k) => {
      const col = BP.EDITABLE[k];
      if (String(r.before ? r.before[col] ?? '' : '') !== String(r.after[col] ?? '')) acc[k] = { from: r.before ? r.before[col] : null, to: r.after[col] };
      return acc;
    }, {});
    if (Object.keys(changed).length) {
      await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'billing_profile.updated', entityType: 'billing_profile',
        entityId: clientId, before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
        after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])) });
    }
    return r.after;
  });
  // Classify now (may geocode) so the owner sees the zone immediately.
  const classified = await MMM.ensureClassified(pool, out);
  res.json({ profile: classified, effectiveMmm: MMM.effectiveMmm(classified) });
}));

router.post('/api/invoicing/clients/:clientId/mmm/refresh', safe(async (req, res) => {
  const p = await BP.getProfile(pool, orgId(req), String(req.params.clientId));
  if (!p) return res.status(404).json({ error: 'Client billing profile not found' });
  const after = await MMM.ensureClassified(pool, p, { force: true });
  await recordAudit(pool, { orgId: orgId(req), actorUserId: req.user.id, action: 'billing_profile.mmm_reclassified', entityType: 'billing_profile',
    entityId: p.client_id, before: { mmm: p.mmm_zone, confidence: p.mmm_confidence }, after: { mmm: after.mmm_zone, confidence: after.mmm_confidence, dataset: after.mmm_dataset_version } });
  res.json({ profile: after, effectiveMmm: MMM.effectiveMmm(after) });
}));

router.put('/api/invoicing/clients/:clientId/mmm-override', safe(async (req, res) => {
  const { zone, reason } = req.body || {};
  const z = zone === null || zone === '' || zone === undefined ? null : Number(zone);
  if (z != null && !(Number.isInteger(z) && z >= 1 && z <= 7)) return res.status(400).json({ error: 'zone must be 1–7 or empty to clear' });
  if (z != null && String(reason || '').trim().length < 3) return res.status(400).json({ error: 'A reason is required for an MMM override' });
  const r = await Life.withTx(pool, async tx => {
    const out = await BP.setMmmOverride(tx, orgId(req), String(req.params.clientId), req.user.id, { zone: z, reason: reason ? String(reason).slice(0, 1000) : null });
    if (out.error) return out;
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'billing_profile.mmm_override', entityType: 'billing_profile',
      entityId: String(req.params.clientId), before: { override: out.before.mmm_manual_override, computed: out.before.mmm_zone },
      after: { override: z }, reason: reason || 'Override cleared' });
    return out;
  });
  if (r.error) return res.status(404).json({ error: 'Client billing profile not found' });
  res.json({ profile: r.after, effectiveMmm: MMM.effectiveMmm(r.after) });
}));

router.post('/api/invoicing/clients/:clientId/import-splose', safe(async (req, res) => {
  const clientId = String(req.params.clientId);
  const splose = require('./splose-api');
  if (typeof splose.isConfigured === 'function' && !(await splose.isConfigured())) return res.status(409).json({ error: 'Splose is not connected' });
  let patient;
  try { patient = await splose.getPatient(clientId); } catch (_) { return res.status(502).json({ error: 'Could not read the client from Splose' }); }
  const existing = await BP.getProfile(pool, orgId(req), clientId);
  const values = BP.fieldsFromSplosePatient(patient, existing);
  const out = await Life.withTx(pool, async tx => {
    const r = await BP.upsertProfile(tx, orgId(req), clientId, req.user.id, values);
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'billing_profile.imported_from_splose',
      entityType: 'billing_profile', entityId: clientId, after: { fields: Object.keys(values) } });
    return r.after;
  });
  const classified = await MMM.ensureClassified(pool, out);
  res.json({ profile: classified, imported: Object.keys(values) });
}));

// ── Route facts (manual entry when Google cannot route a leg) ─────────────

router.post('/api/invoicing/routes/manual', safe(async (req, res) => {
  const { origin, destination, minutes, km, reason } = req.body || {};
  if (!origin || !destination) return res.status(400).json({ error: 'origin and destination are required' });
  const mins = Number(minutes), kms = Number(km);
  if (!(mins >= 0 && mins <= 1440) || !(kms >= 0 && kms <= 3000)) return res.status(400).json({ error: 'minutes (0–1440) and km (0–3000) are required' });
  if (String(reason || '').trim().length < 3) return res.status(400).json({ error: 'A reason is required' });
  await Life.withTx(pool, async tx => {
    const r = await RF.setManualRouteFact(tx, orgId(req), req.user.id, { origin: String(origin).slice(0, 1000), destination: String(destination).slice(0, 1000), minutes: mins, km: kms, reason: String(reason).slice(0, 1000) });
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'route_fact.manual', entityType: 'route_fact', entityId: r.key,
      before: r.before, after: { minutes: mins, km: kms }, reason });
  });
  res.json({ ok: true });
}));

// ── Settings + rate cards ─────────────────────────────────────────────────

router.get('/api/invoicing/settings', safe(async (req, res) => {
  const settings = await Settings.ensureSettings(pool, orgId(req));
  await RC.ensureDefaultRateCard(pool, orgId(req));
  const [org, cards, ds] = await Promise.all([Settings.loadOrgProfile(pool, orgId(req)), RC.loadRateCards(pool, orgId(req)), MMM.activeDataset(pool)]);
  res.json({ settings, organisation: org, rateCards: cards, mmmDataset: ds,
    nextInvoiceNumberPreview: Settings.formatInvoiceNumber(settings.invoicePrefix, settings.nextInvoiceNumber, settings.invoiceNumberPadding),
    emailConfigured: require('./email').isEmailConfigured(), mapsConfigured: !!process.env.GOOGLE_MAPS_API_KEY });
}));

router.put('/api/invoicing/settings', safe(async (req, res) => {
  const { errors, values } = Settings.validateSettingsPatch(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const out = await Life.withTx(pool, async tx => {
    const before = await Settings.ensureSettings(tx, orgId(req));
    const after = await Settings.updateSettings(tx, orgId(req), req.user.id, values);
    const diff = Object.keys(values).filter(k => String(before[k] ?? '') !== String(after[k] ?? ''));
    if (diff.length) {
      await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'billing_settings.updated', entityType: 'billing_settings',
        entityId: orgId(req), before: Object.fromEntries(diff.map(k => [k, before[k]])), after: Object.fromEntries(diff.map(k => [k, after[k]])) });
    }
    return after;
  });
  res.json({ settings: out });
}));

router.get('/api/invoicing/rate-cards', safe(async (req, res) => {
  await RC.ensureDefaultRateCard(pool, orgId(req));
  res.json({ rateCards: await RC.loadRateCards(pool, orgId(req)) });
}));

router.post('/api/invoicing/rate-cards', safe(async (req, res) => {
  const errors = RC.validateCardInput(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const card = await Life.withTx(pool, async tx => {
    const c = await RC.createRateCard(tx, orgId(req), req.user.id, req.body);
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'rate_card.created', entityType: 'rate_card', entityId: c.id,
      after: { name: req.body.name, version: c.version, effectiveFrom: req.body.effectiveFrom, effectiveTo: req.body.effectiveTo || null, rules: req.body.rules } });
    return c;
  });
  res.status(201).json({ id: card.id, version: card.version });
}));

router.put('/api/invoicing/rate-cards/:id', uuidParam('id'), safe(async (req, res) => {
  const body = req.body || {};
  if (body.rules || body.effectiveFrom || body.name) {
    const current = (await RC.loadRateCards(pool, orgId(req))).find(c => c.id === req.params.id);
    if (!current) return res.status(404).json({ error: 'Rate card not found' });
    const errors = RC.validateCardInput({ ...current, ...body, rules: body.rules || current.rules });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  }
  const r = await Life.withTx(pool, async tx => {
    const before = (await RC.loadRateCards(tx, orgId(req))).find(c => c.id === req.params.id) || null;
    const out = await RC.updateRateCard(tx, orgId(req), req.params.id, body);
    if (out.ok) {
      await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'rate_card.updated', entityType: 'rate_card', entityId: req.params.id,
        before, after: body });
    }
    return out;
  });
  if (r.error === 'NOT_FOUND') return res.status(404).json({ error: 'Rate card not found' });
  if (r.error === 'RATE_CARD_IN_USE') return res.status(409).json({ error: 'This rate card has priced finalised invoices. Create a new version with a new effective date instead.', code: 'RATE_CARD_IN_USE' });
  res.json({ ok: true });
}));

router.get('/api/invoicing/audit', safe(async (req, res) => {
  res.json({ events: await listAudit(pool, orgId(req), { entityType: req.query.entityType || null, entityId: req.query.entityId || null, limit: req.query.limit }) });
}));

// ── Trips ─────────────────────────────────────────────────────────────────

router.get('/api/invoicing/trips', safe(async (req, res) => {
  res.json({ trips: await Trips.listTrips(pool, orgId(req)) });
}));

router.post('/api/invoicing/trips', safe(async (req, res) => {
  const { errors, values } = Trips.validateTrip(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  if (!values.allocationMethod) values.allocationMethod = (await Settings.ensureSettings(pool, orgId(req))).defaultTripAllocationMethod;
  const trip = await Life.withTx(pool, async tx => {
    const t = await Trips.createTrip(tx, orgId(req), req.user.id, values);
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'trip.created', entityType: 'trip', entityId: t.id, after: values });
    return t;
  });
  res.status(201).json({ trip });
}));

router.get('/api/invoicing/trips/:id', uuidParam('id'), safe(async (req, res) => {
  const trip = await Trips.getTrip(pool, orgId(req), req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const t = await tz(req);
  const sessions = await Trips.tripSessions(pool, orgId(req), trip, t);
  await Trips.syncTripClients(pool, trip, sessions);
  const [clients, costs, allocation, invoices, current] = await Promise.all([
    Trips.tripClients(pool, orgId(req), trip.id),
    Trips.listCosts(pool, trip.id),
    Trips.computeAllocation(pool, orgId(req), trip, { tz: t }),
    Life.listInvoices(pool, orgId(req), { tripId: trip.id, limit: 500 }, { tz: t }),
    pool.query(`SELECT client_id, amount, method, calculation, created_at FROM trip_allocations WHERE trip_id = $1 AND is_current`, [trip.id]),
  ]);
  const { rows: travel } = await pool.query(
    `SELECT tba.*, to_char(tba.service_date,'YYYY-MM-DD') AS service_date FROM travel_billing_allocations tba
       JOIN invoice_lines l ON l.travel_allocation_id = tba.id AND l.line_status = 'ACTIVE' AND l.trip_id = $1
      GROUP BY tba.id ORDER BY tba.service_date`, [trip.id]);
  const { raw, ...preview } = allocation;
  res.json({
    trip, clients, costs, allocationPreview: preview, currentAllocations: current.rows, invoices: invoices.invoices, travel,
    sessions: sessions.map(s => ({ id: s.id, title: s.title, clientId: s.client_id, clientName: s.client_name, start: s.start_time,
      end: s.end_time, date: s.local_date, practitioner: s.practitioner_name, status: s.status, attendance: s.attendance,
      location: s.location, invoice: s.invoice })),
  });
}));

router.put('/api/invoicing/trips/:id', uuidParam('id'), safe(async (req, res) => {
  const { errors, values } = Trips.validateTrip(req.body || {}, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const r = await Life.withTx(pool, async tx => {
    const before = await Trips.getTrip(tx, orgId(req), req.params.id);
    if (!before) return null;
    await Trips.updateTrip(tx, orgId(req), req.params.id, values);
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'trip.updated', entityType: 'trip', entityId: req.params.id,
      before: { name: before.name, start: before.start_date, end: before.end_date, method: before.allocation_method, status: before.status }, after: values });
    return true;
  });
  if (!r) return res.status(404).json({ error: 'Trip not found' });
  res.json({ ok: true });
}));

router.post('/api/invoicing/trips/:id/clients', uuidParam('id'), safe(async (req, res) => {
  const { clientId, clientName } = req.body || {};
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });
  const trip = await Trips.getTrip(pool, orgId(req), req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  await pool.query(
    `INSERT INTO trip_clients (trip_id, client_id, client_name, added_manually) VALUES ($1,$2,$3,TRUE)
     ON CONFLICT (trip_id, client_id) DO UPDATE SET included = TRUE`, [trip.id, String(clientId).slice(0, 255), clientName ? String(clientName).slice(0, 255) : null]);
  await recordAudit(pool, { orgId: orgId(req), actorUserId: req.user.id, action: 'trip.client_added', entityType: 'trip', entityId: trip.id, after: { clientId } });
  res.status(201).json({ ok: true });
}));

router.put('/api/invoicing/trips/:id/clients/:clientId', uuidParam('id'), safe(async (req, res) => {
  const { included, weight, reason } = req.body || {};
  const trip = await Trips.getTrip(pool, orgId(req), req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (weight != null && !(Number(weight) >= 0 && Number(weight) <= 1000)) return res.status(400).json({ error: 'weight must be 0–1000' });
  if (String(reason || '').trim().length < 3) return res.status(400).json({ error: 'A reason is required to change a trip allocation input' });
  const r = await Life.withTx(pool, async tx => {
    const { rows: [before] } = await tx.query(`SELECT included, weight FROM trip_clients WHERE trip_id = $1 AND client_id = $2 FOR UPDATE`, [trip.id, req.params.clientId]);
    if (!before) return null;
    await tx.query(`UPDATE trip_clients SET included = COALESCE($3, included), weight = COALESCE($4, weight) WHERE trip_id = $1 AND client_id = $2`,
      [trip.id, req.params.clientId, typeof included === 'boolean' ? included : null, weight != null ? Number(weight) : null]);
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'trip.allocation_input_changed', entityType: 'trip', entityId: trip.id,
      before: { clientId: req.params.clientId, ...before }, after: { included, weight }, reason });
    return true;
  });
  if (!r) return res.status(404).json({ error: 'Client is not on this trip' });
  res.json({ ok: true });
}));

const RECEIPT_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'image/webp']);
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

router.post('/api/invoicing/trips/:id/costs', uuidParam('id'), safe(async (req, res) => {
  const trip = await Trips.getTrip(pool, orgId(req), req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const { errors, values } = Trips.validateCost(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const cost = await Life.withTx(pool, async tx => {
    const { rows: [c] } = await tx.query(
      `INSERT INTO trip_costs (trip_id, organisation_id, category, description, cost_date, supplier, amount, billable_mode, notes, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'UNCLASSIFIED'),$9,$10) RETURNING id`,
      [trip.id, orgId(req), values.category, values.description || null, values.costDate || null, values.supplier || null, values.amount,
        values.billableMode || null, values.notes || null, req.user.id]);
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'trip.cost_added', entityType: 'trip_cost', entityId: c.id, after: { tripId: trip.id, ...values } });
    return c;
  });
  res.status(201).json({ id: cost.id });
}));

router.put('/api/invoicing/trips/:id/costs/:costId', uuidParam('id', 'costId'), safe(async (req, res) => {
  const { errors, values } = Trips.validateCost(req.body || {}, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const r = await Life.withTx(pool, async tx => {
    const { rows: [before] } = await tx.query(
      `SELECT c.* FROM trip_costs c JOIN trips t ON t.id = c.trip_id WHERE c.id = $1 AND c.trip_id = $2 AND t.organisation_id = $3 AND c.deleted_at IS NULL FOR UPDATE`,
      [req.params.costId, req.params.id, orgId(req)]);
    if (!before) return null;
    const map = { category: 'category', description: 'description', costDate: 'cost_date', supplier: 'supplier', amount: 'amount', billableMode: 'billable_mode', notes: 'notes' };
    const sets = []; const params = [req.params.costId];
    for (const [k, col] of Object.entries(map)) if (k in values) { params.push(values[k]); sets.push(`${col} = $${params.length}`); }
    if (sets.length) await tx.query(`UPDATE trip_costs SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params);
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'trip.cost_updated', entityType: 'trip_cost', entityId: req.params.costId,
      before: { category: before.category, amount: before.amount, billableMode: before.billable_mode, description: before.description }, after: values });
    return true;
  });
  if (!r) return res.status(404).json({ error: 'Cost not found' });
  res.json({ ok: true });
}));

router.delete('/api/invoicing/trips/:id/costs/:costId', uuidParam('id', 'costId'), safe(async (req, res) => {
  const r = await Life.withTx(pool, async tx => {
    const { rows: [c] } = await tx.query(
      `UPDATE trip_costs c SET deleted_at = NOW() FROM trips t WHERE t.id = c.trip_id AND c.id = $1 AND c.trip_id = $2
         AND t.organisation_id = $3 AND c.deleted_at IS NULL RETURNING c.id, c.amount, c.billable_mode, c.category`,
      [req.params.costId, req.params.id, orgId(req)]);
    if (!c) return null;
    await recordAudit(tx, { orgId: orgId(req), actorUserId: req.user.id, action: 'trip.cost_removed', entityType: 'trip_cost', entityId: c.id,
      before: { amount: c.amount, billableMode: c.billable_mode, category: c.category } });
    return c;
  });
  if (!r) return res.status(404).json({ error: 'Cost not found' });
  res.json({ ok: true });
}));

router.post('/api/invoicing/trips/:id/costs/:costId/receipt', uuidParam('id', 'costId'), safe(async (req, res) => {
  const { fileName, mime, base64 } = req.body || {};
  if (!RECEIPT_MIME.has(mime)) return res.status(400).json({ error: 'Receipts must be PDF or an image' });
  const bytes = Buffer.from(String(base64 || ''), 'base64');
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES) return res.status(400).json({ error: 'Receipt must be under 8 MB' });
  const { rows: [c] } = await pool.query(
    `SELECT c.id FROM trip_costs c JOIN trips t ON t.id = c.trip_id WHERE c.id = $1 AND c.trip_id = $2 AND t.organisation_id = $3 AND c.deleted_at IS NULL`,
    [req.params.costId, req.params.id, orgId(req)]);
  if (!c) return res.status(404).json({ error: 'Cost not found' });
  const clean = String(fileName || 'receipt').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
  const put = await storage.getBackend(storage.getBackendName()).put({ userId: `trip-receipts-${orgId(req)}`, docId: c.id, fileName: clean, mime, base64: bytes.toString('base64') });
  await pool.query(
    `UPDATE trip_costs SET receipt_file_name = $2, receipt_mime = $3, receipt_storage_backend = $4, receipt_storage_key = $5, receipt_file_data = $6, updated_at = NOW() WHERE id = $1`,
    [c.id, clean, mime, put.backend, put.storageKey || null, put.inlineData || null]);
  await recordAudit(pool, { orgId: orgId(req), actorUserId: req.user.id, action: 'trip.cost_receipt_attached', entityType: 'trip_cost', entityId: c.id, after: { fileName: clean, bytes: bytes.length } });
  res.json({ ok: true });
}));

router.get('/api/invoicing/trips/:id/costs/:costId/receipt', uuidParam('id', 'costId'), safe(async (req, res) => {
  const { rows: [c] } = await pool.query(
    `SELECT c.* FROM trip_costs c JOIN trips t ON t.id = c.trip_id WHERE c.id = $1 AND c.trip_id = $2 AND t.organisation_id = $3 AND c.receipt_file_name IS NOT NULL`,
    [req.params.costId, req.params.id, orgId(req)]);
  if (!c) return res.status(404).json({ error: 'Receipt not found' });
  const got = await storage.getBackend(c.receipt_storage_backend).get({ backend: c.receipt_storage_backend, storageKey: c.receipt_storage_key, fileData: c.receipt_file_data });
  res.setHeader('Content-Type', c.receipt_mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', contentDisposition(req.query.disposition === 'inline' ? 'inline' : 'attachment', c.receipt_file_name));
  res.send(Buffer.from(got.base64 || '', 'base64'));
}));

router.post('/api/invoicing/trips/:id/generate', uuidParam('id'), safe(async (req, res) => {
  const result = await Trips.generateTripInvoices({ pool, orgId: orgId(req), userId: req.user.id, tripId: req.params.id });
  res.status(201).json(result);
}));

module.exports = router;
