'use strict';

/**
 * TRAVEL → OUTLOOK MIRROR route.
 *
 *   PUT /api/travel/outlook-sync   { date, legs: [...], seenEventIds: [...] }
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

router.put('/api/travel/outlook-sync', async (req, res) => {
  try {
    const userId = req.session.userId;
    const result = await sync.syncDay({
      pool: db.pool,
      outlook: outlookApi,
      getAccessToken: async () => require('./routes').getValidAccessToken(await db.getUser(userId)),
    }, userId, req.body);
    if (result.body && (result.body.created || result.body.updated || result.body.removed || result.body.failed)) {
      console.log(`🚗 Travel → Outlook ${req.body.date}: +${result.body.created} ~${result.body.updated} -${result.body.removed}${result.body.failed ? ' failed ' + result.body.failed : ''}`);
    }
    res.status(result.status).json(result.body);
  } catch (err) {
    if (err && err.code === 'FEATURE_DISABLED') return res.status(403).json({ error: 'Outlook write-back is turned off', code: 'feature_disabled' });
    if (err && /Outlook not connected|re-authenticate/i.test(err.message || '')) return res.status(409).json({ error: 'Connect Outlook to sync travel', code: 'outlook_not_connected' });
    console.error('Travel → Outlook sync error:', err && err.message);
    res.status(500).json({ error: 'Could not sync travel to Outlook' });
  }
});

module.exports = router;
