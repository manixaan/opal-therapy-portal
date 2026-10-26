'use strict';

/**
 * SYNC SETTINGS ROUTES (migration 081)
 *
 *   GET  /api/sync-settings                       my effective settings (+ the practice's, for the Owner)
 *   PUT  /api/sync-settings                       { directions: { <dir>: { enabled?, auto?, syncFrom? } } }
 *   PUT  /api/sync-settings/practice              Owner: { directions: { <dir>: { allowed?, allowAuto?, enabled?, auto?, syncFrom?, earliestFrom? } } }
 *   POST /api/sync-settings/:direction/plan       what "Sync now" would do — reads only, writes nothing
 *   POST /api/sync-settings/:direction/apply      { decisions: [{ key, action, counterpartId? }] }
 *   POST /api/sync-settings/outlook/pull          run the Outlook → portal catch-up now (this calendar)
 *
 * Guards: signed in, not read-only / pre-employee. Everything is the caller's
 * own calendar; an Owner or Admin may name another person with ?userId= (the
 * way reception drives a week in Sync Splose). Practice defaults and limits
 * are the Owner's alone. Every save and every apply is audited with ids and
 * counts only — never titles, client names or times.
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { requireAuth, requireRole } = require('./permissions');
const prefs = require('./sync-preferences');
const backfillMod = require('./sync-backfill');

const DIR_RE = /^(portal_to_outlook|outlook_to_portal|portal_to_splose|splose_to_portal|splose_to_outlook)$/;

function denyReadOnly(req, res, next) {
  if (!req.user || req.user.role === 'read_only' || req.user.role === 'pre_employee') {
    return res.status(403).json({ error: 'Your account cannot change calendar sync', code: 'sync_settings_denied' });
  }
  next();
}

const safe = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(`[sync-settings] ${req.method} ${req.path} failed:`, err.message);
  res.status(500).json({ error: 'Sync settings are unavailable right now' });
});

/** Whose calendar: own, or (owner/admin only) a named person in the same practice. */
async function targetUserId(req) {
  const asked = (req.query && req.query.userId) || (req.body && req.body.userId);
  if (!asked || String(asked) === String(req.session.userId)) return { id: String(req.session.userId) };
  if (!['owner', 'admin'].includes(req.user.role)) return { error: { status: 403, code: 'not_your_calendar', error: 'Only an Owner or Admin can manage someone else’s sync' } };
  const u = await db.getUser(String(asked)).catch(() => null);
  if (!u || (req.user.organisation_id && u.organisation_id && u.organisation_id !== req.user.organisation_id)) {
    return { error: { status: 404, code: 'not_found', error: 'No such person' } };
  }
  return { id: String(u.id) };
}

let _backfill = null;
function backfill() {
  if (!_backfill) {
    _backfill = backfillMod.createBackfill({
      db,
      outlookApi: require('./outlook-oauth'),
      sploseApi: require('./splose-api'),
      draftSync: require('./splose-draft-sync'),
      getToken: async (userId) => {
        const u = await db.getUser(userId);
        if (!u || !u.access_token) return null;
        try { return await require('./routes').getValidAccessToken(u); } catch (_) { return null; }
      },
      practitionerFor: (userId) => require('./splose-match')._practitionerFor(db, userId),
      log: (m) => console.log('🔁 ' + m),
    });
  }
  return _backfill;
}

// One Sync now per calendar and direction at a time.
const running = new Set();

function audit(req, action, targetId, metadata) {
  return db.logAuditEvent({
    actorUserId: req.session.userId, action, targetType: 'sync_settings', targetId: String(targetId),
    metadata, ipAddress: req.ip, organisationId: req.user.organisation_id || null,
  }).catch(() => {});
}

router.use('/api/sync-settings', requireAuth, denyReadOnly);

router.get('/api/sync-settings', safe(async (req, res) => {
  const t = await targetUserId(req);
  if (t.error) return res.status(t.error.status).json(t.error);
  const effective = await prefs.effectiveFor(db, t.id);
  res.json({ userId: t.id, isOwner: req.user.role === 'owner', directions: prefs.DIRECTIONS, effective });
}));

router.put('/api/sync-settings', safe(async (req, res) => {
  const t = await targetUserId(req);
  if (t.error) return res.status(t.error.status).json(t.error);
  const resolved = await prefs.effectiveFor(db, t.id);
  const { errors, changes } = prefs.validateUserUpdate(resolved, req.body && req.body.directions);
  if (errors.length) return res.status(400).json({ error: errors[0], errors, code: 'invalid' });
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to save', code: 'invalid' });
  await prefs.saveChanges(db, { scope: 'user', userId: t.id, actorUserId: req.session.userId, changes });
  await audit(req, 'sync_settings.user_updated', t.id, { forUser: t.id, changed: summarise(changes) });
  res.json({ ok: true, effective: await prefs.effectiveFor(db, t.id) });
}));

router.put('/api/sync-settings/practice', requireRole('owner'), safe(async (req, res) => {
  const { errors, changes } = prefs.validatePracticeUpdate(req.body && req.body.directions);
  if (errors.length) return res.status(400).json({ error: errors[0], errors, code: 'invalid' });
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to save', code: 'invalid' });
  await prefs.saveChanges(db, { scope: 'practice', actorUserId: req.session.userId, changes });
  await audit(req, 'sync_settings.practice_updated', 'practice', { changed: summarise(changes) });
  res.json({ ok: true, effective: await prefs.effectiveFor(db, req.session.userId) });
}));

/** Which fields changed per direction — names only, for the audit row. */
function summarise(changes) {
  const out = {};
  for (const [d, c] of Object.entries(changes)) out[d] = Object.keys(c);
  return out;
}

function planError(res, err) {
  const known = {
    sync_off: 409, outlook_not_connected: 409, splose_not_connected: 409, no_practitioner: 409,
    incomplete_read: 502, bad_direction: 400,
  };
  if (known[err.code]) return res.status(known[err.code]).json({ error: err.message, code: err.code, blockedBy: err.blockedBy || undefined });
  if (err.response || /Failed to fetch Outlook/.test(err.message)) {
    return res.status(502).json({ error: 'The other calendar could not be read just now — nothing was changed', code: 'read_failed' });
  }
  throw err;
}

router.post('/api/sync-settings/outlook/pull', safe(async (req, res) => {
  const t = await targetUserId(req);
  if (t.error) return res.status(t.error.status).json(t.error);
  const effective = await prefs.effectiveFor(db, t.id);
  if (!prefs.allows(effective, 'outlook_to_portal', { manual: true })) {
    return res.status(409).json({ error: 'Outlook → portal is switched off for this calendar', code: 'sync_off' });
  }
  const runner = req.app.get('forceSyncRunner');
  if (typeof runner !== 'function') return res.status(503).json({ error: 'Outlook sync is not running on this server', code: 'runner_unavailable' });
  const stats = await runner({ manual: true, userId: t.id });
  await audit(req, 'sync_settings.outlook_pulled', t.id, { forUser: t.id, upserted: stats.upserted, removed: stats.removed, skippedOld: stats.skippedOld });
  res.json({ ok: true, skipped: !!stats.skipped, upserted: stats.upserted, cancelled: stats.cancelled, removed: stats.removed, skippedOld: stats.skippedOld, errors: (stats.errors || []).length });
}));

router.post('/api/sync-settings/:direction/plan', safe(async (req, res) => {
  if (!DIR_RE.test(req.params.direction)) return res.status(400).json({ error: 'Unknown direction', code: 'bad_direction' });
  const t = await targetUserId(req);
  if (t.error) return res.status(t.error.status).json(t.error);
  try {
    const p = await backfill().plan(req.params.direction, t.id);
    res.json(backfill().present(p));
  } catch (err) { return planError(res, err); }
}));

router.post('/api/sync-settings/:direction/apply', safe(async (req, res) => {
  const direction = req.params.direction;
  if (!DIR_RE.test(direction)) return res.status(400).json({ error: 'Unknown direction', code: 'bad_direction' });
  const t = await targetUserId(req);
  if (t.error) return res.status(t.error.status).json(t.error);
  const decisions = req.body && req.body.decisions;
  if (!Array.isArray(decisions) || !decisions.length) return res.status(400).json({ error: 'Choose at least one item', code: 'invalid' });
  if (decisions.length > 1000) return res.status(400).json({ error: 'Too many items at once — at most 1000', code: 'invalid' });
  const lock = t.id + ':' + direction;
  if (running.has(lock)) return res.status(409).json({ error: 'A sync for this is already running', code: 'sync_running' });
  running.add(lock);
  try {
    const result = await backfill().apply(direction, t.id, req.session.userId, decisions);
    const tally = {};
    for (const d of result.done) tally[d.action] = (tally[d.action] || 0) + 1;
    await audit(req, 'sync_settings.applied', t.id, { forUser: t.id, direction, done: tally, failed: result.failed.length });
    res.json({ ok: true, ...result });
  } catch (err) {
    return planError(res, err);
  } finally {
    running.delete(lock);
  }
}));

module.exports = router;
module.exports._backfill = backfill;
module.exports._resetBackfill = () => { _backfill = null; running.clear(); };
