'use strict';

/**
 * Unit tests for the sync deletion-safety layer (Phase 3 data-loss controls).
 */

const { assessDeletionSafety, getSyncSafetyConfig, recordSafetyBlock, syncSafetyState } =
  require('../sync-safety');

const CFG = { maxAutoDelete: 25, maxDeletePercent: 30 };

describe('assessDeletionSafety', () => {
  test('no deletions is always safe (the common healthy cycle)', () => {
    const v = assessDeletionSafety({
      source: 'splose', fetchComplete: true, liveCount: 700,
      deletionCandidates: 0, localLinkedCount: 650,
    }, CFG);
    expect(v).toMatchObject({ safe: true, reason: 'no_deletions' });
  });

  test('EMPTY remote result with local records blocks everything', () => {
    const v = assessDeletionSafety({
      source: 'splose', fetchComplete: true, liveCount: 0,
      deletionCandidates: 650, localLinkedCount: 650,
    }, CFG);
    expect(v).toMatchObject({ safe: false, reason: 'empty_remote_result' });
  });

  test('incomplete/truncated pagination blocks even a single deletion', () => {
    const v = assessDeletionSafety({
      source: 'outlook_reconcile', fetchComplete: false, liveCount: 5000,
      deletionCandidates: 1, localLinkedCount: 5200,
    }, CFG);
    expect(v).toMatchObject({ safe: false, reason: 'incomplete_fetch' });
  });

  test('batch above the absolute ceiling blocks', () => {
    const v = assessDeletionSafety({
      source: 'outlook_delta', fetchComplete: true, liveCount: 5000,
      deletionCandidates: 26, localLinkedCount: 5200,
    }, CFG);
    expect(v).toMatchObject({ safe: false, reason: 'exceeds_max_auto_delete' });
  });

  test('batch at exactly the ceiling passes (boundary)', () => {
    const v = assessDeletionSafety({
      source: 'outlook_delta', fetchComplete: true, liveCount: 5000,
      deletionCandidates: 25, localLinkedCount: 5200,
    }, CFG);
    expect(v.safe).toBe(true);
  });

  test('abnormal percentage drop blocks even under the absolute ceiling', () => {
    // 10 of 20 linked events = 50% > 30%
    const v = assessDeletionSafety({
      source: 'splose', fetchComplete: true, liveCount: 10,
      deletionCandidates: 10, localLinkedCount: 20,
    }, CFG);
    expect(v).toMatchObject({ safe: false, reason: 'exceeds_delete_percentage' });
    expect(v.stats.deletePercent).toBe(50);
  });

  test('normal legitimate cancellation volume passes', () => {
    // 3 of 650 linked events, complete fetch — a real-world healthy cycle
    const v = assessDeletionSafety({
      source: 'splose', fetchComplete: true, liveCount: 700,
      deletionCandidates: 3, localLinkedCount: 650,
    }, CFG);
    expect(v).toMatchObject({ safe: true, reason: 'within_thresholds' });
  });

  test('config falls back to sane defaults on garbage env values', () => {
    process.env.SYNC_MAX_AUTO_DELETE = 'banana';
    process.env.SYNC_MAX_DELETE_PERCENT = '';
    const cfg = getSyncSafetyConfig();
    expect(cfg.maxAutoDelete).toBe(25);
    expect(cfg.maxDeletePercent).toBe(30);
    delete process.env.SYNC_MAX_AUTO_DELETE;
    delete process.env.SYNC_MAX_DELETE_PERCENT;
  });
});

describe('explicit removals (Graph delta @removed)', () => {
  const { assessDeletionSafety } = require('../sync-safety');
  const cfg = { maxAutoDelete: 10, maxDeletePercent: 30 };
  test('a complete, named, small batch passes even when it empties the mirror', () => {
    const v = assessDeletionSafety({ source: 'outlook_delta', fetchComplete: true, liveCount: 0, deletionCandidates: 3, localLinkedCount: 3, explicitRemovals: true }, cfg);
    expect(v).toMatchObject({ safe: true, reason: 'explicit_small_batch' });
  });
  test('still blocked when paging was incomplete or the batch is above the ceiling', () => {
    expect(assessDeletionSafety({ source: 'outlook_delta', fetchComplete: false, liveCount: 0, deletionCandidates: 3, localLinkedCount: 3, explicitRemovals: true }, cfg).safe).toBe(false);
    expect(assessDeletionSafety({ source: 'outlook_delta', fetchComplete: true, liveCount: 0, deletionCandidates: 11, localLinkedCount: 11, explicitRemovals: true }, cfg).safe).toBe(false);
  });
  test('a full-list reconcile (not explicit) keeps the empty-remote rule', () => {
    expect(assessDeletionSafety({ source: 'outlook_reconcile', fetchComplete: true, liveCount: 0, deletionCandidates: 3, localLinkedCount: 3 }, cfg)).toMatchObject({ safe: false, reason: 'empty_remote_result' });
  });
});

describe('partitionDeltaRemovals — the portal\'s own deletions are not an anomaly', () => {
  const { partitionDeltaRemovals } = require('../sync-safety');
  test('ids already tombstoned locally, or unknown, are acknowledged rather than judged', () => {
    const r = partitionDeltaRemovals(['a', 'b', 'c', 'd'], [
      { outlook_id: 'a', is_deleted: true },   // cancelled from the portal earlier
      { outlook_id: 'b', is_deleted: false },  // a real Outlook-side deletion
      { outlook_id: 'c', is_deleted: null },   // live (NULL = not deleted)
      // 'd' never existed locally
    ]);
    expect(r.toDelete).toEqual(['b', 'c']);
    expect(r.alreadyGone).toEqual(['a', 'd']);
  });
  test('THE REGRESSION: cancelling every appointment from the portal leaves nothing to judge', () => {
    const r = partitionDeltaRemovals(['x', 'y', 'z'], [
      { outlook_id: 'x', is_deleted: true }, { outlook_id: 'y', is_deleted: true }, { outlook_id: 'z', is_deleted: true },
    ]);
    expect(r.toDelete).toEqual([]);
    // With no candidates the guard is never consulted and the delta token is saved.
    const { assessDeletionSafety } = require('../sync-safety');
    expect(assessDeletionSafety({ source: 'outlook_delta', fetchComplete: true, liveCount: 0, deletionCandidates: r.toDelete.length, localLinkedCount: 0 }).safe).toBe(true);
  });
});

describe('recordSafetyBlock', () => {
  test('writes an audit row, notifies owners + affected user, updates state', async () => {
    const audits = [];
    const notifications = [];
    const deps = {
      db: {
        logAuditEvent: async (rec) => audits.push(rec),
        pool: { query: async () => ({ rows: [{ id: 'owner-1' }, { id: 'owner-2' }] }) },
      },
      storeNotification: async (userId, payload) => notifications.push({ userId, payload }),
    };
    const before = syncSafetyState.splose.blockCount;

    await recordSafetyBlock(deps, {
      source: 'splose', reason: 'empty_remote_result',
      stats: { deletionCandidates: 650, liveCount: 0, localLinkedCount: 650, fetchComplete: true },
      userId: 'user-affected',
    });

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'sync.safety_block', targetId: 'splose', actorUserId: null });

    const recipients = notifications.map(n => n.userId).sort();
    expect(recipients).toEqual(['owner-1', 'owner-2', 'user-affected'].sort());
    expect(notifications[0].payload.severity).toBe('error');

    expect(syncSafetyState.splose.blockCount).toBe(before + 1);
    expect(syncSafetyState.splose.lastReason).toBe('empty_remote_result');
  });

  test('never throws when audit/notification dependencies fail', async () => {
    const deps = {
      db: {
        logAuditEvent: async () => { throw new Error('audit down'); },
        pool: { query: async () => { throw new Error('db down'); } },
      },
      storeNotification: async () => { throw new Error('notify down'); },
    };
    await expect(recordSafetyBlock(deps, {
      source: 'cleanup', reason: 'incomplete_fetch',
      stats: { deletionCandidates: 1, liveCount: 9, localLinkedCount: 10, fetchComplete: false },
    })).resolves.toBeUndefined();
  });
});
