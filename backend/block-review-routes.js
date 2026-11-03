'use strict';

/**
 * BLOCK REVIEW ROUTES (migration 086) — blocks booked outside the portal.
 *
 *   GET  /api/block-review?since=YYYY-MM-DD     classify new outside blocks, list the open ones
 *   POST /api/block-review/:eventId/confirm     { kind, clientId?, location? }
 *   POST /api/block-review/:eventId/dismiss     leave the block as it came in
 *   POST /api/block-review/confirm-guessed      { eventIds: [] } accept applied guesses as they stand
 *
 * Guards: signed in, not read-only / pre-employee. The caller's own calendar
 * only, matched against the caller's own caseload (splose-caseload.js) — a
 * client the caller may not see can be neither guessed nor attached. Audited
 * with ids and counts; never titles, client names or addresses.
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { requireAuth } = require('./permissions');
const caseload = require('./splose-caseload');
const { bookingGroup, CLIENT_RULE } = require('./booking-rules');
const { createBlockReview } = require('./block-review');

const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 366;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function denyReadOnly(req, res, next) {
  if (!req.user || req.user.role === 'read_only' || req.user.role === 'pre_employee') {
    return res.status(403).json({ error: 'Your account cannot review calendar blocks', code: 'block_review_denied' });
  }
  next();
}

const safe = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(`[block-review] ${req.method} ${req.path} failed:`, err.message);
  res.status(500).json({ error: 'Block review is unavailable right now' });
});

let _svc = null;
function svc() {
  if (!_svc) {
    _svc = createBlockReview({ db, sploseApi: require('./splose-api'), log: (m) => console.log(`[block-review] ${m}`) });
  }
  return _svc;
}

function ymd(d) { return d.toISOString().slice(0, 10); }
function sinceFrom(q) {
  const today = new Date();
  const floor = new Date(today.getTime() - MAX_LOOKBACK_DAYS * 86400000);
  const s = typeof q.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.since) ? new Date(q.since + 'T00:00:00Z') : null;
  if (!s || isNaN(s.getTime())) return ymd(new Date(today.getTime() - DEFAULT_LOOKBACK_DAYS * 86400000));
  return ymd(s < floor ? floor : s);
}

/** The caller's caseload, or [] (with the reason) when it cannot be read. */
async function ownClients(req) {
  try {
    const { clients } = await caseload.listOwnClients(req);
    return { clients, clientsAvailable: true };
  } catch (err) {
    return { clients: [], clientsAvailable: false, clientsError: err instanceof caseload.CaseloadError ? err.code : 'splose_unavailable' };
  }
}

/** Awaited by every caller: the entry is written before the response goes, so the trail is complete when the client sees success (CI caught the race, 3 Nov 2026). */
function audit(req, action, metadata, targetId) {
  return db.logAuditEvent({
    actorUserId: req.session.userId, organisationId: req.user.organisation_id || null,
    action, targetType: 'event', targetId: targetId || null, metadata, ipAddress: req.ip,
  }).catch(() => {});
}

router.use('/api/block-review', requireAuth, denyReadOnly);

router.get('/api/block-review', safe(async (req, res) => {
  const userId = String(req.session.userId);
  const since = sinceFrom(req.query || {});
  const { clients, clientsAvailable, clientsError } = await ownClients(req);
  const swept = await svc().sweep(userId, { since, clients });
  if (swept.classified) await audit(req, 'block_review.sweep', { since, ...swept });
  const rows = await svc().list(userId, { since });
  // Suggested clients are named from the caller's own caseload only.
  const byId = new Map(clients.map(c => [String(c.id), c]));
  const blocks = rows.map(r => {
    const g = r.guess || {};
    const cands = ((g.fields && g.fields.client && g.fields.client.candidates) || [])
      .map(id => byId.get(String(id))).filter(Boolean).map(c => ({ id: String(c.id), fullName: c.fullName }));
    return {
      eventId: r.event_id, status: r.status, origin: r.origin,
      title: r.title, start: r.start_time, end: r.end_time, location: r.location || null,
      guess: {
        kind: g.kind || null, group: g.group || null,
        clientId: g.clientId || null, clientName: g.clientName || null,
        location: g.location || null, virtual: !!g.virtual,
        fields: g.fields || {}, missing: g.missing || [], unsure: g.unsure || [],
        clientCandidates: cands,
      },
    };
  });
  res.json({
    since, blocks, clientsAvailable, clientsError: clientsError || null,
    counts: { guessed: blocks.filter(b => b.status === 'guessed').length, needsInput: blocks.filter(b => b.status === 'needs_input').length },
  });
}));

router.post('/api/block-review/confirm-guessed', safe(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.eventIds) ? req.body.eventIds.filter(id => UUID_RE.test(String(id))).slice(0, 300) : [];
  if (!ids.length) return res.status(400).json({ error: 'No blocks named' });
  const out = await svc().confirmAllGuessed(String(req.session.userId), ids);
  await audit(req, 'block_review.confirm_guessed', { requested: ids.length, confirmed: out.confirmed });
  res.json(out);
}));

router.post('/api/block-review/:eventId/confirm', safe(async (req, res) => {
  const eventId = String(req.params.eventId);
  if (!UUID_RE.test(eventId)) return res.status(404).json({ error: 'No such block' });
  const b = req.body || {};
  const kind = typeof b.kind === 'string' ? b.kind : '';
  const group = bookingGroup(kind);
  if (!group) return res.status(400).json({ error: 'Choose what this block is', code: 'kind_required' });
  const rule = CLIENT_RULE[group];

  let client = null;
  if (rule !== 'none' && b.clientId != null && b.clientId !== '') {
    if (!caseload.isSploseClientId(b.clientId)) return res.status(400).json({ error: 'Invalid client' });
    try {
      client = await caseload.loadOwnClient(req, String(b.clientId));
    } catch (err) {
      if (err instanceof caseload.CaseloadError) return res.status(err.status).json({ error: err.message, code: err.code });
      return res.status(503).json({ error: 'Your clients could not be read just now — try again' });
    }
    if (!client) return res.status(400).json({ error: 'That client is not on your caseload', code: 'not_on_caseload' });
  }
  if (rule === 'required' && !client) {
    return res.status(400).json({ error: group === 'direct' ? 'Choose the client for this service' : 'Choose the client this report is for', code: 'client_required' });
  }
  const location = typeof b.location === 'string' ? b.location.trim().slice(0, 300) || null : null;

  const out = await svc().confirm(String(req.session.userId), eventId, {
    kind, client: client ? { id: String(client.id), fullName: client.fullName || null } : null, location,
  });
  if (out.error === 'not_found') return res.status(404).json({ error: 'No such block' });
  if (out.error === 'already_resolved') return res.status(409).json({ error: 'This block has already been settled', code: 'already_resolved' });
  await audit(req, 'block_review.confirm', { kind, group, withClient: !!client, withLocation: !!location }, eventId);
  res.json({ ok: true });
}));

router.post('/api/block-review/:eventId/dismiss', safe(async (req, res) => {
  const eventId = String(req.params.eventId);
  if (!UUID_RE.test(eventId)) return res.status(404).json({ error: 'No such block' });
  const out = await svc().dismiss(String(req.session.userId), eventId);
  if (out.error === 'not_found') return res.status(404).json({ error: 'No such block' });
  if (out.error === 'already_resolved') return res.status(409).json({ error: 'This block has already been settled', code: 'already_resolved' });
  await audit(req, 'block_review.dismiss', {}, eventId);
  res.json({ ok: true });
}));

module.exports = router;
module.exports._sinceFrom = sinceFrom;
module.exports._resetForTests = () => { _svc = null; };
