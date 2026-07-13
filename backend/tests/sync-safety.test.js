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
