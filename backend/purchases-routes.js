'use strict';

/**
 * PURCHASE REQUESTS (Resource Hub V1)
 *
 * Governed request → approval → order → receipt workflow. Backend-enforced
 * RBAC (default-deny), independent of the Resource Hub flag:
 *   - therapist: create/edit/submit/cancel OWN requests, see own only
 *   - owner:     see all, approve/decline/request-changes, mark ordered/received
 *   - admin:     LIMITED operational view — approved/ordered/received requests
 *                only, with clinical fields (clinical_rationale,
 *                client_reference) STRIPPED from every response; may mark
 *                ordered/received; cannot create requests
 *   - read_only: 403 on everything (reads included)
 *
 * Every status transition writes a purchase_request_events row AND an
 * audit_logs row ('purchase.<event>'). Event metadata carries status only —
 * never clinical fields. No external calls of any kind.
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth, requireRole } = require('./permissions');
const log = require('./logger').createLogger('purchases');

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

router.use('/api/purchases', requireAuth, (req, res, next) => {
  // read_only: no purchase data at all (the global write guard already blocks
  // their unsafe methods; this closes the reads too).
  if (req.user?.role === 'read_only') {
    return res.status(403).json({
      error: 'Read-only accounts cannot access purchase requests',
      code: 'purchases_read_only_denied',
    });
  }
  next();
});

// Async-handler guard (same rationale as resources-routes: an unhandled
// rejection in an Express 4 async handler would hang the request).
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('purchases route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

// ── Visibility + presentation ────────────────────────────────────────────────

const ADMIN_VISIBLE_STATUSES = ['approved', 'ordered', 'received'];

/** Admin never sees clinical content. */
function presentFor(user, row) {
  if (!row) return row;
  if (user.role !== 'admin') return row;
  const out = { ...row };
  delete out.clinical_rationale;
  delete out.client_reference;
  return out;
}

/** Load a request the caller is allowed to see, or null (→ 404). */
async function loadVisible(req, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    'SELECT * FROM purchase_requests WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2',
    [id, orgOf(req)]);
  const row = rows[0];
  if (!row) return null;
  if (req.user.role === 'owner') return row;
  if (req.user.role === 'admin') return ADMIN_VISIBLE_STATUSES.includes(row.status) ? row : null;
  return row.requester_user_id === req.user.id ? row : null; // therapist: own only
}

/** Event row + audit entry for every transition. Metadata: status only. */
async function recordEvent(req, requestId, event, comment, metadata) {
  await pool.query(
    `INSERT INTO purchase_request_events (request_id, actor_user_id, action, comment, metadata)
     VALUES ($1,$2,$3,$4,$5)`,
    [requestId, req.user?.id || null, event, comment || null, metadata ? JSON.stringify(metadata) : null]);
  await db.logAuditEvent({
    action: `purchase.${event}`, targetType: 'purchase_request', targetId: requestId,
    actorUserId: req.user?.id, organisationId: orgOf(req), ipAddress: req.ip,
    metadata: metadata || null,
  }).catch(() => {});
}

// ── Field mapping + validation ───────────────────────────────────────────────

const CREATE_FIELDS = [
  ['productName', 'product_name'], ['productUrl', 'product_url'], ['supplier', 'supplier'],
  ['quantity', 'quantity'], ['approxCostCents', 'approx_cost_cents'], ['costCheckedOn', 'cost_checked_on'],
  ['intendedUse', 'intended_use'], ['clinicalRationale', 'clinical_rationale'],
  ['clientReference', 'client_reference'], ['alternativeOption', 'alternative_option'],
  ['safetyConsiderations', 'safety_considerations'], ['note', 'note'],
];

function validateFields(b, { requireName }) {
  if (requireName && !(typeof b.productName === 'string' && b.productName.trim())) {
    return 'productName is required';
  }
  if (b.productName !== undefined && !(typeof b.productName === 'string' && b.productName.trim())) {
    return 'productName must be a non-empty string';
  }
  if (b.quantity !== undefined && (!Number.isInteger(b.quantity) || b.quantity < 1)) {
    return 'quantity must be an integer >= 1';
  }
  if (b.approxCostCents !== undefined && b.approxCostCents !== null
      && (!Number.isInteger(b.approxCostCents) || b.approxCostCents < 0)) {
    return 'approxCostCents must be a non-negative integer';
  }
  if (b.costCheckedOn !== undefined && b.costCheckedOn !== null && !isDate(b.costCheckedOn)) {
    return 'costCheckedOn must be YYYY-MM-DD';
  }
  return null;
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Create (therapist/owner; admin has no create — operational view only).
router.post('/api/purchases', safe(async (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Admin accounts cannot create purchase requests', code: 'role_denied' });
  }
  const b = req.body || {};
  const invalid = validateFields(b, { requireName: true });
  if (invalid) return res.status(400).json({ error: invalid });
  const status = b.submit === true ? 'submitted' : 'draft';
  const { rows } = await pool.query(
    `INSERT INTO purchase_requests (organisation_id, requester_user_id, product_name, product_url,
        supplier, quantity, approx_cost_cents, cost_checked_on, intended_use, clinical_rationale,
        client_reference, alternative_option, safety_considerations, note, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [orgOf(req), req.user.id, b.productName.trim(), b.productUrl || null, b.supplier || null,
     Number.isInteger(b.quantity) ? b.quantity : 1, b.approxCostCents ?? null, b.costCheckedOn || null,
     b.intendedUse || null, b.clinicalRationale || null, b.clientReference || null,
     b.alternativeOption || null, b.safetyConsiderations || null, b.note || null, status]);
  const request = rows[0];
  await recordEvent(req, request.id, 'created', null, { status });
  res.status(201).json({ request: presentFor(req.user, request) });
}));

// List — owner: all; therapist: own; admin: approved/ordered/received, stripped.
router.get('/api/purchases', safe(async (req, res) => {
  const params = [orgOf(req)];
  let where = 'organisation_id IS NOT DISTINCT FROM $1';
  if (req.user.role === 'admin') {
    where += ` AND status = ANY($2)`;
    params.push(ADMIN_VISIBLE_STATUSES);
  } else if (req.user.role !== 'owner') {
    where += ` AND requester_user_id = $2`;
    params.push(req.user.id);
  }
  const { rows } = await pool.query(
    `SELECT * FROM purchase_requests WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params);
  res.json({ requests: rows.map((r) => presentFor(req.user, r)) });
}));

router.get('/api/purchases/:id', safe(async (req, res) => {
  const row = await loadVisible(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ request: presentFor(req.user, row) });
}));

// Edit — requester only, while draft / changes_requested.
router.patch('/api/purchases/:id', safe(async (req, res) => {
  const row = await loadVisible(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.requester_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the requester can edit a purchase request' });
  }
  if (!['draft', 'changes_requested'].includes(row.status)) {
    return res.status(409).json({ error: `Cannot edit a request in status '${row.status}'`, code: 'invalid_status_transition' });
  }
  const b = req.body || {};
  const invalid = validateFields(b, { requireName: false });
  if (invalid) return res.status(400).json({ error: invalid });
  const sets = [];
  const params = [row.id];
  for (const [bodyKey, col] of CREATE_FIELDS) {
    if (b[bodyKey] !== undefined) {
      params.push(bodyKey === 'productName' ? b.productName.trim() : b[bodyKey]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' });
  const { rows } = await pool.query(
    `UPDATE purchase_requests SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
  await recordEvent(req, row.id, 'edited', null, { status: rows[0].status });
  res.json({ request: presentFor(req.user, rows[0]) });
}));

// ── Status transitions ───────────────────────────────────────────────────────

/**
 * Shared transition executor. Loads with visibility (404), checks the
 * from-status set (409), applies extra column sets atomically against the
 * observed status, records the event, returns the updated row.
 */
async function transition(req, res, { from, to, event, requesterOnly = false, comment = null, sets = {}, metadataExtra = {} }) {
  const row = await loadVisible(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (requesterOnly && row.requester_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the requester can perform this action' });
  }
  if (!from.includes(row.status)) {
    return res.status(409).json({
      error: `Cannot move a request from '${row.status}' to '${to}'`,
      code: 'invalid_status_transition',
    });
  }
  const params = [row.id, row.status, to];
  const setSql = ['status = $3', 'updated_at = NOW()'];
  for (const [col, value] of Object.entries(sets)) {
    params.push(value);
    setSql.push(`${col} = $${params.length}`);
  }
  const { rows } = await pool.query(
    `UPDATE purchase_requests SET ${setSql.join(', ')} WHERE id = $1 AND status = $2 RETURNING *`, params);
  if (!rows.length) {
    return res.status(409).json({ error: 'Request changed concurrently — reload and retry', code: 'invalid_status_transition' });
  }
  await recordEvent(req, row.id, event, comment, { status: to, ...metadataExtra });
  res.json({ ok: true, request: presentFor(req.user, rows[0]) });
}

router.post('/api/purchases/:id/submit', safe(async (req, res) => transition(req, res, {
  from: ['draft', 'changes_requested'], to: 'submitted', event: 'submitted', requesterOnly: true,
})));

router.post('/api/purchases/:id/cancel', safe(async (req, res) => transition(req, res, {
  from: ['draft', 'submitted'], to: 'cancelled', event: 'cancelled', requesterOnly: true,
})));

router.post('/api/purchases/:id/approve', requireRole('owner'), safe(async (req, res) => {
  const b = req.body || {};
  if (b.spendLimitCents !== undefined && b.spendLimitCents !== null
      && (!Number.isInteger(b.spendLimitCents) || b.spendLimitCents < 0)) {
    return res.status(400).json({ error: 'spendLimitCents must be a non-negative integer' });
  }
  return transition(req, res, {
    from: ['submitted', 'changes_requested'], to: 'approved', event: 'approve',
    comment: b.comment || null,
    sets: {
      owner_comment: b.comment || null,
      spend_limit_cents: b.spendLimitCents ?? null,
      decided_by_user_id: req.user.id,
      decided_at: new Date(),
    },
  });
}));

router.post('/api/purchases/:id/decline', requireRole('owner'), safe(async (req, res) => transition(req, res, {
  from: ['submitted', 'changes_requested'], to: 'declined', event: 'decline',
  comment: req.body?.comment || null,
  sets: {
    owner_comment: req.body?.comment || null,
    decided_by_user_id: req.user.id,
    decided_at: new Date(),
  },
})));

router.post('/api/purchases/:id/request-changes', requireRole('owner'), safe(async (req, res) => {
  const comment = (req.body?.comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'comment is required when requesting changes' });
  return transition(req, res, {
    from: ['submitted'], to: 'changes_requested', event: 'request_changes',
    comment, sets: { owner_comment: comment },
  });
}));

router.post('/api/purchases/:id/mark-ordered', requireRole('owner', 'admin'), safe(async (req, res) => {
  const b = req.body || {};
  if (b.finalCostCents !== undefined && b.finalCostCents !== null
      && (!Number.isInteger(b.finalCostCents) || b.finalCostCents < 0)) {
    return res.status(400).json({ error: 'finalCostCents must be a non-negative integer' });
  }
  const sets = { ordered_at: new Date() };
  if (b.poReference !== undefined) sets.po_reference = b.poReference || null;
  if (b.supplier !== undefined) sets.supplier = b.supplier || null;
  if (b.finalCostCents !== undefined) sets.final_cost_cents = b.finalCostCents ?? null;
  return transition(req, res, { from: ['approved'], to: 'ordered', event: 'mark_ordered', sets });
}));

router.post('/api/purchases/:id/mark-received', requireRole('owner', 'admin'), safe(async (req, res) => {
  const sets = { received_at: new Date() };
  if (req.body?.invoiceReference !== undefined) sets.invoice_reference = req.body.invoiceReference || null;
  return transition(req, res, { from: ['ordered'], to: 'received', event: 'mark_received', sets });
}));

// Event trail — owner: all; requester: own; admin: post-approval requests only.
// Metadata never contains clinical fields (recordEvent writes status only).
router.get('/api/purchases/:id/events', safe(async (req, res) => {
  const row = await loadVisible(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT e.id, e.action, e.comment, e.metadata, e.actor_user_id, u.name AS actor_name, e.created_at
       FROM purchase_request_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.request_id = $1 ORDER BY e.created_at ASC`, [row.id]);
  res.json({ events: rows });
}));

module.exports = router;
