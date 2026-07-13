'use strict';

/**
 * SPLOSE CANCELLATION POLLER (extracted from server.js for testability)
 *
 * Every cycle: fetch Splose appointments for ±90 days, and soft-delete any
 * local event whose Splose appointment is gone or fully cancelled — cascading
 * a best-effort delete to Outlook so all three calendars converge.
 *
 * DATA-LOSS SAFETY (Phase 3): before deleting anything, the batch is assessed
 * by sync-safety. Empty results, truncated pagination, or abnormally large
 * drops block ALL deletions for the cycle, write an audit record, and notify
 * owners. The poller then simply waits for a later healthy cycle.
 *
 * All external services are injected so the full behaviour matrix (timeouts,
 * 429s, auth failures, empty responses, partial pagination, legitimate
 * cancellations, safe retry) is unit-testable without network or timers.
 */

const { assessDeletionSafety, recordSafetyBlock, syncSafetyState } = require('./sync-safety');

function createSplosePoller(deps) {
  const {
    db,                    // database module (pool, logAuditEvent)
    sploseApi,             // getAppointments
    outlookApi,            // deleteOutlookEvent
    io,                    // socket server (may be null in tests)
    getValidTokenForUser,  // (userRow) → accessToken
    storeNotification,     // (userId, payload) — app-routes helper
    windowDays = 90,
  } = deps;

  let running = false;

  async function runSploseSync() {
    if (running) return { skipped: true, reason: 'already_running' };
    running = true;
    try {
      const now = new Date();
      const startDate = new Date(now.getTime() - windowDays * 86400000).toISOString().slice(0, 10);
      const endDate   = new Date(now.getTime() + windowDays * 86400000).toISOString().slice(0, 10);

      let sploseAppts;
      try {
        sploseAppts = await sploseApi.getAppointments(startDate, endDate);
      } catch (fetchErr) {
        // Timeout / 429 / auth failure / network: no evidence — never delete.
        syncSafetyState.splose.lastError = fetchErr.message;
        syncSafetyState.splose.lastErrorAt = new Date().toISOString();
        console.error('⚠️  Splose poller fetch failed — no deletions this cycle:', fetchErr.message);
        return { blocked: true, reason: 'fetch_failed', error: fetchErr.message, cancelled: 0 };
      }

      const fetchComplete = sploseAppts._fetchComplete !== false;

      // IDs that are live and NOT fully cancelled
      const liveIds = new Set(
        sploseAppts
          .filter(a => !((a.patients || []).length > 0 && a.patients.every(p => p.status === 'Cancelled')))
          .map(a => String(a.id))
      );

      const { rows } = await db.pool.query(
        `SELECT id, splose_id, title, outlook_id, user_id
           FROM events
          WHERE splose_id IS NOT NULL AND is_deleted = FALSE`
      );

      const candidates = rows.filter(r => !liveIds.has(String(r.splose_id)));

      const verdict = assessDeletionSafety({
        source: 'splose',
        fetchComplete,
        liveCount: liveIds.size,
        deletionCandidates: candidates.length,
        localLinkedCount: rows.length,
      });

      if (!verdict.safe) {
        await recordSafetyBlock({ db, storeNotification }, {
          source: 'splose',
          reason: verdict.reason,
          stats: verdict.stats,
          userId: candidates[0]?.user_id || null,
        });
        return { blocked: true, reason: verdict.reason, stats: verdict.stats, cancelled: 0 };
      }

      let cancelled = 0;
      for (const row of candidates) {
        await db.pool.query(
          `UPDATE events
              SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW()
            WHERE id = $1`,
          [row.id]
        );
        console.log(`🚫 [Splose poller] Cancelled: "${row.title}" (Splose #${row.splose_id})`);
        cancelled++;

        // Best-effort Outlook delete so the Outlook calendar converges too
        if (row.outlook_id) {
          try {
            const { rows: userRows } = await db.pool.query(
              'SELECT access_token, token_expires_at, refresh_token FROM users WHERE id = $1',
              [row.user_id]
            );
            if (userRows.length) {
              const accessToken = await getValidTokenForUser(userRows[0]);
              await outlookApi.deleteOutlookEvent(accessToken, row.outlook_id);
              console.log(`   🗑️  Also deleted from Outlook: ${row.outlook_id}`);
            }
          } catch (_) { /* non-fatal */ }
        }

        if (io) {
          io.to(`user:${row.user_id}`).emit('calendarUpdated', { upserted: 0, cancelled: 1, removed: 0 });
        }
      }

      if (cancelled > 0) {
        console.log(`✅ [Splose poller] Synced ${cancelled} cancellation(s) from Splose`);
      }
      syncSafetyState.splose.lastHealthyAt = new Date().toISOString();
      return { blocked: false, cancelled, checked: rows.length, live: liveIds.size };
    } catch (err) {
      console.error('⚠️  Splose poller error:', err.message);
      return { blocked: true, reason: 'unexpected_error', error: err.message, cancelled: 0 };
    } finally {
      running = false;
    }
  }

  return { runSploseSync };
}

module.exports = { createSplosePoller };
