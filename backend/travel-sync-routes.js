'use strict';

/**
 * TRAVEL → OUTLOOK MIRROR route.
 *
 *   PUT /api/travel/outlook-sync         { date, legs: [...], seenEventIds: [...] }
 *   PUT /api/travel/outlook-sync/batch   { days: [ <the same body>, … ] }  (≤ 7)
 *
 * The calendar sends a day's computed travel legs; travel-outlook-sync.js makes
 * the user's Outlook calendar match (create / move / delete, never duplicate).
 * Only accounts that schedule their own diary; Outlook writes stay behind
 * ENABLE_OUTLOOK_WRITE, and the mirror itself behind ENABLE_TRAVEL_OUTLOOK_SYNC.
 * Nothing goes to Splose. Logs carry counts only.
 */

const express = require('express');
const db = require('./database');
const outlookApi = require('./outlook-oauth');
const sync = require('./travel-outlook-sync');
const { requireAuth, requireAnyPermission } = require('./permissions');

const router = express.Router();
router.use('/api/travel/outlook-sync', requireAuth, requireAnyPermission('manage_own_schedule', 'manage_all_schedules'));

const deps = (userId) => ({
  pool: db.pool,
  outlook: outlookApi,
  getAccessToken: async () => require('./routes').getValidAccessToken(await db.getUser(userId)),
});
function logDay(date, body) {
  if (body && (body.created || body.updated || body.removed || body.failed)) {
    console.log(`🚗 Travel → Outlook ${date}: +${body.created} ~${body.updated} -${body.removed}${body.failed ? ' failed ' + body.failed : ''}`);
  }
}
// A thrown sync error as the answer the caller sees — never internal detail.
function errorAnswer(err) {
  if (err && err.code === 'FEATURE_DISABLED') return { status: 403, body: { error: 'Outlook write-back is turned off', code: 'feature_disabled' } };
  if (err && /Outlook not connected|re-authenticate/i.test(err.message || '')) return { status: 409, body: { error: 'Connect Outlook to sync travel', code: 'outlook_not_connected' } };
  console.error('Travel → Outlook sync error:', err && err.message);
  return { status: 500, body: { error: 'Could not sync travel to Outlook' } };
}

router.put('/api/travel/outlook-sync', async (req, res) => {
  try {
    const userId = req.session.userId;
    const result = await sync.syncDay(deps(userId), userId, req.body);
    logDay(req.body && req.body.date, result.body);
    res.status(result.status).json(result.body);
  } catch (err) {
    const a = errorAnswer(err);
    res.status(a.status).json(a.body);
  }
});

/* PUT /api/travel/outlook-sync/batch  { days: [<day body>, …] } — a week's
   ready days in one request (T-08). Each day is the single-day sync above,
   guards and all; the answer lists each day's own status and body. */
router.put('/api/travel/outlook-sync/batch', async (req, res) => {
  try {
    const userId = req.session.userId;
    const r = await sync.syncDays(deps(userId), userId, req.body);
    if (!r.results) return res.status(r.status).json(r.body);
    const results = r.results.map(x => {
      if (!x.error) { logDay(x.date, x.body); return { date: x.date, status: x.status, body: x.body }; }
      const a = errorAnswer(x.error);
      return { date: x.date, status: a.status, body: a.body };
    });
    res.json({ results });
  } catch (err) {
    const a = errorAnswer(err);
    res.status(a.status).json(a.body);
  }
});

module.exports = router;
