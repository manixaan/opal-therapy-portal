'use strict';

/**
 * SPLOSE DRAFT-AND-PUBLISH ROUTES (migration 058)
 *
 *   GET    /api/splose-sync/pending             this user's queued changes
 *   DELETE /api/splose-sync/pending/:id         discard one queued change
 *   POST   /api/splose-sync/publish             start publishing { queueIds?, overrides? }
 *   GET    /api/splose-sync/status              running? last result? counts
 *   GET    /api/splose-sync/alerts              open "changed inside Splose" alerts
 *   POST   /api/splose-sync/alerts/:id/ack      { verdict: 'valid'|'invalid', note? }
 *   GET    /api/splose/cancellation-reasons     reference list for the review panel
 *
 * Guards: signed in, not read-only. Everything is scoped to the caller's own
 * calendar (user_id) — owners and admins see their own queue too; a manager
 * booking on a therapist's behalf queues onto that therapist's calendar and
 * the therapist publishes it. Owner/admin may publish for another user via
 * ?userId= on publish/pending, which is how reception drives a week.
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { requireAuth } = require('./permissions');
const sploseApi = require('./splose-api');
const outlookApi = require('./outlook-oauth');
const draftSync = require('./splose-draft-sync');
const flags = require('./feature-flags');
const { getIo } = require('./webhook-state');

function denyReadOnly(req, res, next) {
  if (!req.user || req.user.role === 'read_only' || req.user.role === 'pre_employee') {
    return res.status(403).json({ error: 'Your account cannot change bookings', code: 'splose_sync_denied' });
  }
  next();
}

function requireDraftSync(req, res, next) {
  if (!flags.isSploseDraftSyncEnabled()) {
    return res.status(403).json({ error: 'Splose sync is switched off in this environment', code: 'feature_disabled', flag: 'ENABLE_SPLOSE_DRAFT_SYNC' });
  }
  next();
}

/** Whose queue: own, or (owner/admin only) a named user. */
function targetUserId(req) {
  const asked = (req.query && req.query.userId) || (req.body && req.body.userId);
  if (asked && ['owner', 'admin'].includes(req.user.role)) return String(asked);
  return req.session.userId;
}

const safe = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error('splose-sync route error:', err.message);
  res.status(500).json({ error: 'Something went wrong with Splose sync' });
});

// Lazily built so tests can mock splose-api before the first request.
let _publisher = null;
function publisher() {
  if (!_publisher) {
    _publisher = draftSync.createPublisher({
      db, sploseApi, io: getIo(),
      // When a queued move finds Splose already cancelled the appointment, the
      // portal copy is cancelled to match; keep the Outlook mirror in step.
      onLocalCancelled: async (eventId, userId) => {
        if (!flags.isOutlookWriteEnabled()) return;
        const r = await db.pool.query('SELECT outlook_id FROM events WHERE id = $1', [eventId]);
        const outlookId = r.rows[0] && r.rows[0].outlook_id;
        if (!outlookId) return;
        const token = await outlookTokenFor(userId);
        if (token) await outlookApi.deleteOutlookEvent(token, outlookId);
      },
      gapMs: process.env.NODE_ENV === 'test' ? 0 : draftSync.DEFAULT_GAP_MS,
      log: (m) => console.log('📤 ' + m),
    });
  }
  return _publisher;
}

// Auto-sync shares the publisher (one `running` map, so an automatic run and
// a manual Sync Splose can never overlap for the same user).
let _autoSync = null;
function autoSync() {
  if (!_autoSync) {
    const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
    _autoSync = draftSync.createAutoSync({
      db, publisher: publisher(),
      delayMs:   num(process.env.SPLOSE_AUTO_SYNC_DELAY_MS,    draftSync.AUTO_SYNC_DELAY_MS),
      maxWaitMs: num(process.env.SPLOSE_AUTO_SYNC_MAX_WAIT_MS, draftSync.AUTO_SYNC_MAX_WAIT_MS),
      minGapMs:  num(process.env.SPLOSE_AUTO_SYNC_MIN_GAP_MS,  draftSync.AUTO_SYNC_MIN_GAP_MS),
      log: (m) => console.log('📤 ' + m),
    });
  }
  return _autoSync;
}

/**
 * Called by the calendar routes after a change is queued. Starts (or
 * restarts) that user's quiet-period timer; a no-op when auto-sync is off.
 */
function notifyQueued(userId) {
  if (!userId || !flags.isSploseAutoSyncEnabled()) return false;
  autoSync().touch(userId);
  return true;
}

router.use('/api/splose-sync', requireAuth, denyReadOnly, requireDraftSync);

function rowView(r) {
  const p = r.payload || {};
  return {
    id: r.id, eventId: r.event_id, action: r.action, status: r.status, error: r.error || null,
    attempts: r.attempts, createdAt: r.created_at, updatedAt: r.updated_at,
    sploseAppointmentId: r.splose_appointment_id || r.splose_id || null,
    title: r.event_title, start: p.start || r.start_time, end: p.end || r.end_time,
    clientName: r.client_name || null,
    payload: {
      patientId: p.patientId || null, serviceId: p.serviceId || null, locationId: p.locationId || null,
      caseId: p.caseId || null, practitionerId: p.practitionerId || null, reasonId: p.reasonId || null,
      note: p.note || '', sessionType: p.sessionType || null,
    },
  };
}

router.get('/api/splose-sync/pending', safe(async (req, res) => {
  const userId = targetUserId(req);
  const rows = await draftSync.listPending(db, userId);
  res.json({ userId, count: rows.filter(r => r.status !== 'publishing').length, changes: rows.map(rowView) });
}));

router.delete('/api/splose-sync/pending/:id', safe(async (req, res) => {
  const userId = targetUserId(req);
  const r = await db.pool.query(
    `UPDATE splose_sync_queue SET status = 'discarded', updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'failed') RETURNING id`,
    [req.params.id, userId]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'No such pending change' });
  res.json({ ok: true, discarded: r.rows[0].id });
}));

router.post('/api/splose-sync/publish', safe(async (req, res) => {
  const userId = targetUserId(req);
  const queueIds = Array.isArray(req.body && req.body.queueIds) ? req.body.queueIds.map(String) : null;
  const overrides = (req.body && typeof req.body.overrides === 'object' && req.body.overrides) || {};
  // Only allow overriding the review-time fields, never the target event/client.
  const cleaned = {};
  for (const [id, o] of Object.entries(overrides)) {
    if (!o || typeof o !== 'object') continue;
    const c = {};
    if (o.serviceId)  c.serviceId  = Number(o.serviceId);
    if (o.locationId) c.locationId = Number(o.locationId);
    if (o.caseId)     c.caseId     = Number(o.caseId);
    if (o.reasonId)   c.reasonId   = Number(o.reasonId);
    if (typeof o.note === 'string') c.note = o.note.slice(0, 500);
    cleaned[id] = c;
  }
  const pub = publisher();
  const already = pub.status(userId);
  if (already) return res.status(409).json({ error: 'A sync is already running', status: already });

  const batchId = require('crypto').randomUUID();
  await db.logAuditEvent({
    actorUserId: req.session.userId, action: 'splose_sync_publish_started', targetType: 'splose_sync_queue', targetId: batchId,
    metadata: { forUser: userId, queueIds: queueIds ? queueIds.length : 'all' }, organisationId: req.user.organisation_id || null,
  }).catch(() => {});
  // Fire and forget — the run is paced under the rate limit and can take minutes.
  pub.publish(userId, { queueIds, batchId, overrides: cleaned }).catch((err) => {
    console.error('Splose publish run failed:', err.message);
  });
  res.status(202).json({ ok: true, batchId, started: true });
}));

router.get('/api/splose-sync/status', safe(async (req, res) => {
  const userId = targetUserId(req);
  const pub = publisher();
  const counts = await db.pool.query(
    `SELECT status, COUNT(*)::int AS n FROM splose_sync_queue WHERE user_id = $1 GROUP BY status`, [userId]
  );
  const byStatus = {};
  for (const r of counts.rows) byStatus[r.status] = r.n;
  res.json({
    userId,
    running: pub.status(userId),
    lastRun: pub.lastResult(userId),
    counts: byStatus,
    writeEnabled: flags.isSploseWriteEnabled(),
    autoSyncEnabled: flags.isSploseAutoSyncEnabled(),
    autoSync: flags.isSploseAutoSyncEnabled() ? autoSync().status(userId) : null,
  });
}));

router.get('/api/splose-sync/alerts', safe(async (req, res) => {
  const userId = targetUserId(req);
  const manager = ['owner', 'admin'].includes(req.user.role);
  // Managers also see alerts for practitioners with no portal account yet.
  const r = await db.pool.query(
    `SELECT a.*, e.title AS event_title FROM splose_change_alerts a
       LEFT JOIN events e ON e.id = a.event_id
      WHERE a.acknowledged_at IS NULL AND (a.user_id = $1 ${manager ? 'OR a.user_id IS NULL' : ''})
      ORDER BY a.detected_at
      LIMIT 50`,
    [userId]
  );
  res.json({ alerts: r.rows.map(a => ({
    id: a.id, kind: a.kind, sploseAppointmentId: a.splose_appointment_id, eventId: a.event_id,
    title: a.event_title || (a.details && a.details.title) || null, details: a.details || {}, detectedAt: a.detected_at,
  })) });
}));

/**
 * Acknowledge an alert. verdict 'valid' applies the Splose-side change to the
 * portal's copy (and best-effort to Outlook); 'invalid' records it for the
 * owner and leaves the portal as it is — the correction is made in Splose.
 */
router.post('/api/splose-sync/alerts/:id/ack', safe(async (req, res) => {
  const userId = req.session.userId;
  const verdict = req.body && req.body.verdict;
  if (!['valid', 'invalid'].includes(verdict)) return res.status(400).json({ error: "verdict must be 'valid' or 'invalid'" });
  const note = req.body && typeof req.body.note === 'string' ? req.body.note.slice(0, 500) : null;
  const manager = ['owner', 'admin'].includes(req.user.role);

  const found = await db.pool.query(
    `SELECT * FROM splose_change_alerts WHERE id = $1 AND acknowledged_at IS NULL
        AND (user_id = $2 ${manager ? 'OR user_id IS NULL' : ''})`,
    [req.params.id, userId]
  );
  const alert = found.rows[0];
  if (!alert) return res.status(404).json({ error: 'No such open alert' });

  let applied = null;
  if (verdict === 'valid') {
    applied = await applyExternalChange(alert, alert.user_id || userId);
  }
  await db.pool.query(
    `UPDATE splose_change_alerts SET acknowledged_at = NOW(), acknowledged_by = $2, verdict = $3, note = $4 WHERE id = $1`,
    [alert.id, userId, verdict, note]
  );
  await db.logAuditEvent({
    actorUserId: userId, action: 'splose_external_change_' + verdict, targetType: 'splose_change_alerts', targetId: alert.id,
    metadata: { kind: alert.kind, sploseAppointmentId: alert.splose_appointment_id, applied: !!applied }, organisationId: req.user.organisation_id || null,
  }).catch(() => {});
  res.json({ ok: true, verdict, applied });
}));

async function outlookTokenFor(userId) {
  try {
    const user = await db.getUser(userId);
    if (!user || !user.access_token) return null;
    const expiresAt = user.token_expires_at ? new Date(user.token_expires_at).getTime() : 0;
    if (expiresAt > Date.now() + 60000) return user.access_token;
    if (!user.refresh_token) return null;
    const refreshed = await outlookApi.refreshAccessToken(user.refresh_token);
    await db.updateUserTokens(user.id, refreshed.accessToken, refreshed.refreshToken, refreshed.expiresIn);
    return refreshed.accessToken;
  } catch (_) { return null; }
}

/** Bring the portal (and Outlook, best effort) into line with a valid Splose-side change. */
async function applyExternalChange(alert, userId) {
  const d = alert.details || {};
  if (alert.kind === 'cancelled' || alert.kind === 'deleted') {
    if (!alert.event_id) return { kind: alert.kind, changed: false };
    const r = await db.pool.query(
      `UPDATE events SET is_deleted = TRUE, deleted_at = NOW(), last_modified_by = 'splose', updated_at = NOW()
        WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = FALSE) RETURNING outlook_id`,
      [alert.event_id]
    );
    // A queued change for a now-cancelled appointment has nothing left to do.
    await db.pool.query(`UPDATE splose_sync_queue SET status = 'discarded', updated_at = NOW() WHERE event_id = $1 AND status IN ('pending','failed')`, [alert.event_id]);
    const outlookId = r.rows[0] && r.rows[0].outlook_id;
    let outlook = false;
    if (outlookId && flags.isOutlookWriteEnabled()) {
      const token = await outlookTokenFor(userId);
      if (token) { try { await outlookApi.deleteOutlookEvent(token, outlookId); outlook = true; } catch (_) { /* best effort */ } }
    }
    return { kind: alert.kind, changed: r.rows.length > 0, outlook };
  }
  if (alert.kind === 'moved') {
    if (!alert.event_id || !d.to) return { kind: 'moved', changed: false };
    const r = await db.pool.query(
      `UPDATE events SET start_time = $2, end_time = $3, last_modified_by = 'splose', updated_at = NOW()
        WHERE id = $1 RETURNING outlook_id`,
      [alert.event_id, d.to.start, d.to.end]
    );
    const outlookId = r.rows[0] && r.rows[0].outlook_id;
    let outlook = false;
    if (outlookId && flags.isOutlookWriteEnabled()) {
      const token = await outlookTokenFor(userId);
      if (token) { try { await outlookApi.updateOutlookEvent(token, outlookId, { startTime: d.to.start, endTime: d.to.end }); outlook = true; } catch (_) { /* best effort */ } }
    }
    return { kind: 'moved', changed: r.rows.length > 0, outlook };
  }
  if (alert.kind === 'unlinked') {
    // Queue the portal booking for Splose. The service is chosen at review if
    // the booking type did not carry one.
    if (!alert.event_id) return { kind: 'unlinked', changed: false };
    const ev = await db.pool.query(`SELECT id, user_id, title, start_time, end_time, client_id, splose_id FROM events WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = FALSE)`, [alert.event_id]);
    const e = ev.rows[0];
    if (!e || e.splose_id || !e.client_id) return { kind: 'unlinked', changed: false };
    const qrow = await draftSync.enqueueChange(db, {
      userId: e.user_id, createdBy: userId, eventId: e.id, action: 'create',
      payload: { start: new Date(e.start_time).toISOString(), end: new Date(e.end_time).toISOString(), patientId: Number(e.client_id) || e.client_id, serviceId: null, summary: e.title },
    });
    try { require('./splose-sync-routes').notifyQueued(e.user_id); } catch (_) { /* optional */ }
    return { kind: 'unlinked', changed: !!qrow, queued: qrow ? qrow.id : null };
  }
  if (alert.kind === 'created') {
    if (!d.start || !d.end) return { kind: 'created', changed: false };
    // Any local row for this Splose id — live OR cancelled — means the portal
    // already knows the appointment; never insert a second copy.
    const exists = await db.pool.query(`SELECT id, is_deleted FROM events WHERE splose_id = $1 ORDER BY is_deleted NULLS FIRST, updated_at DESC LIMIT 1`, [alert.splose_appointment_id]);
    if (exists.rows.length) return { kind: 'created', changed: false, eventId: exists.rows[0].id, alreadyCancelled: exists.rows[0].is_deleted === true };
    const r = await db.pool.query(
      `INSERT INTO events (user_id, title, start_time, end_time, event_type, splose_id, client_id, source, sync_status, last_modified_by, last_synced_to_splose)
       VALUES ($1, $2, $3, $4, 'therapy', $5, $6, 'splose', 'synced', 'splose', NOW()) RETURNING id`,
      [userId, 'Client Appointment (booked in Splose)', d.start, d.end, alert.splose_appointment_id, d.patientId ? String(d.patientId) : null]
    );
    const eventId = r.rows[0].id;
    let outlook = false;
    if (flags.isOutlookWriteEnabled()) {
      const token = await outlookTokenFor(userId);
      if (token) {
        try {
          const created = await outlookApi.createOutlookEvent(token, {
            title: 'Client Appointment (booked in Splose)', startTime: d.start, endTime: d.end,
            location: '', categories: ['Client Appointments'], appEventId: eventId, sploseId: alert.splose_appointment_id,
          });
          if (created && created.outlookId) { await db.updateEventOutlookId(eventId, created.outlookId); outlook = true; }
        } catch (_) { /* best effort */ }
      }
    }
    return { kind: 'created', changed: true, eventId, outlook };
  }
  return { kind: alert.kind, changed: false };
}

// Reference data for the review panel (read, cached in splose-api).
router.get('/api/splose/cancellation-reasons', requireAuth, denyReadOnly, safe(async (req, res) => {
  const reasons = await sploseApi.getCancellationReasons();
  res.json({ data: reasons.map(r => ({ id: r.id, reason: r.reason, code: r.code || null })) });
}));

module.exports = router;
module.exports._applyExternalChange = applyExternalChange;
module.exports.notifyQueued = notifyQueued;
module.exports._resetPublisher = () => { if (_autoSync) _autoSync.stop(); _autoSync = null; _publisher = null; };
