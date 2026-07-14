'use strict';

/**
 * SYNC DELETION SAFETY
 *
 * Central guard for every code path that can mass-tombstone local events (or
 * cascade deletions to Outlook) based on an upstream API response:
 *
 *   - Splose cancellation poller        (splose-poller.js)
 *   - Outlook window reconciliation     (database.reconcileOutlookWindowSafe)
 *   - Outlook delta @removed batches    (server.js poller, delta route, webhook)
 *   - One-time cleanup route            (/api/sync/cleanup)
 *
 * The rule set answers one question: "does this deletion request look like a
 * legitimate change, or like an empty/truncated/anomalous upstream response?"
 *
 * An unsafe verdict means: delete NOTHING this cycle, write an audit record,
 * notify owners + the affected user, remember the block for diagnostics, and
 * wait for a later healthy synchronisation (or explicit manual cleanup).
 *
 * Thresholds (env-tunable):
 *   SYNC_MAX_AUTO_DELETE    max events one automatic cycle may delete (default 25)
 *   SYNC_MAX_DELETE_PERCENT max % of linked local events one cycle may delete (default 30)
 */

function getSyncSafetyConfig() {
  const maxAutoDelete = parseInt(process.env.SYNC_MAX_AUTO_DELETE || '25', 10);
  const maxDeletePercent = parseFloat(process.env.SYNC_MAX_DELETE_PERCENT || '30');
  return {
    maxAutoDelete: Number.isFinite(maxAutoDelete) && maxAutoDelete >= 0 ? maxAutoDelete : 25,
    maxDeletePercent: Number.isFinite(maxDeletePercent) && maxDeletePercent >= 0 ? maxDeletePercent : 30,
  };
}

/**
 * Assess whether an automatic deletion batch is safe to execute.
 *
 * @param {object} p
 * @param {string}  p.source             'splose' | 'outlook_reconcile' | 'outlook_delta' | 'cleanup'
 * @param {boolean} p.fetchComplete      upstream pagination finished without truncation
 * @param {number}  p.liveCount          records upstream says currently exist
 * @param {number}  p.deletionCandidates local records this cycle wants to delete
 * @param {number}  p.localLinkedCount   local records linked to this upstream (denominator)
 * @param {object} [config]              override thresholds (tests)
 * @returns {{safe: boolean, reason: string, stats: object}}
 */
function assessDeletionSafety(p, config = getSyncSafetyConfig()) {
  const stats = {
    source: p.source,
    fetchComplete: !!p.fetchComplete,
    liveCount: p.liveCount,
    deletionCandidates: p.deletionCandidates,
    localLinkedCount: p.localLinkedCount,
    maxAutoDelete: config.maxAutoDelete,
    maxDeletePercent: config.maxDeletePercent,
  };

  // Nothing to delete is always safe (and the common case).
  if (!p.deletionCandidates || p.deletionCandidates <= 0) {
    return { safe: true, reason: 'no_deletions', stats };
  }

  // Truncated / unfinished upstream fetch — absence of a record proves nothing.
  if (!p.fetchComplete) {
    return { safe: false, reason: 'incomplete_fetch', stats };
  }

  // Upstream returned nothing while we hold linked records: overwhelmingly more
  // likely an API fault / auth-scope change than a real "everything cancelled".
  if (p.liveCount === 0 && p.localLinkedCount > 0) {
    return { safe: false, reason: 'empty_remote_result', stats };
  }

  // Absolute volume ceiling for one automatic cycle.
  if (p.deletionCandidates > config.maxAutoDelete) {
    return { safe: false, reason: 'exceeds_max_auto_delete', stats };
  }

  // Relative drop ceiling.
  if (p.localLinkedCount > 0) {
    const pct = (p.deletionCandidates / p.localLinkedCount) * 100;
    stats.deletePercent = Math.round(pct * 10) / 10;
    if (pct > config.maxDeletePercent) {
      return { safe: false, reason: 'exceeds_delete_percentage', stats };
    }
  }

  return { safe: true, reason: 'within_thresholds', stats };
}

// ── Safety-block bookkeeping ─────────────────────────────────────────────────

// In-memory last-block state per source, surfaced by /api/sync/diagnostics.
const syncSafetyState = {
  splose: { lastBlockAt: null, lastReason: null, lastStats: null, blockCount: 0 },
  outlook_reconcile: { lastBlockAt: null, lastReason: null, lastStats: null, blockCount: 0 },
  outlook_delta: { lastBlockAt: null, lastReason: null, lastStats: null, blockCount: 0 },
  cleanup: { lastBlockAt: null, lastReason: null, lastStats: null, blockCount: 0 },
};

/**
 * Record a safety block: audit row + owner/admin + affected-user notification
 * + in-memory state. Never throws (safety reporting must not break sync).
 *
 * @param {object} deps { db, storeNotification }  — injected for testability
 * @param {object} info { source, reason, stats, userId }
 */
async function recordSafetyBlock(deps, { source, reason, stats, userId }) {
  const state = syncSafetyState[source] || (syncSafetyState[source] = { blockCount: 0 });
  state.lastBlockAt = new Date().toISOString();
  state.lastReason = reason;
  state.lastStats = stats;
  state.blockCount += 1;

  console.warn(
    `🛑 [sync-safety] ${source} deletion blocked (${reason}) — ` +
    `candidates=${stats.deletionCandidates} live=${stats.liveCount} ` +
    `local=${stats.localLinkedCount} complete=${stats.fetchComplete}`
  );

  // Telemetry (no-op unless Application Insights is configured). Counts and
  // reason only — never event content.
  try {
    require('./telemetry').trackEvent('sync.safety_block', { source, reason, ...stats });
  } catch (_) { /* telemetry must never break a sync cycle */ }

  try {
    await deps.db.logAuditEvent({
      actorUserId: null,
      action: 'sync.safety_block',
      targetType: 'sync',
      targetId: source,
      metadata: { reason, ...stats },
    });
  } catch (e) { /* audit best-effort */ }

  if (typeof deps.storeNotification === 'function') {
    try {
      const recipients = new Set();
      if (userId) recipients.add(userId);
      const { rows } = await deps.db.pool.query(
        `SELECT id FROM users WHERE role = 'owner' AND is_active = TRUE`
      );
      rows.forEach(r => recipients.add(r.id));
      for (const rid of recipients) {
        await deps.storeNotification(rid, {
          type: `sync_safety_block_${source}`,
          title: 'Synchronisation deletions paused for safety',
          message:
            `An automatic ${source.replace(/_/g, ' ')} cycle wanted to remove ` +
            `${stats.deletionCandidates} event(s) (${reason.replace(/_/g, ' ')}). ` +
            `Nothing was deleted. Review Settings → Integrations, then re-run sync ` +
            `or use the manual cleanup tool if the change is genuine.`,
          severity: 'error',
          relatedEntity: 'integration',
        });
      }
    } catch (e) { /* notification best-effort */ }
  }
}

module.exports = {
  getSyncSafetyConfig,
  assessDeletionSafety,
  recordSafetyBlock,
  syncSafetyState,
};
