'use strict';

/**
 * Sync settings resolver (migration 081, simplified 19 Nov 2026) — pure rules, no database.
 *
 * Pins:
 *   - no rows: Outlook automatic both ways, portal → Splose queues, Splose → portal / Outlook retired
 *   - only Portal → Outlook and Outlook → Portal are settings; practice rows and
 *     rows for the fixed directions are ignored
 *   - environment flags win over everything
 *   - allows(): off / manual-only / cutoff; allowsLinked() ignores the cutoff
 *   - a null prefs object (unreadable settings) allows nothing
 *   - the Outlook cutoff keeps old events the portal already holds and cancellations
 *   - validation refuses the fixed directions
 */

const prefs = require('../sync-preferences');

const ALL_ON_ENV = () => {
  const env = {};
  for (const d of prefs.DIRECTIONS) env[d] = { blockedBy: null, autoBlockedBy: null, writeBlockedBy: null };
  return env;
};
const practice = (direction, over) => ({ scope: 'practice', direction, ...over });
const user = (direction, over) => ({ scope: 'user', direction, ...over });

describe('resolve()', () => {
  test('no rows: Outlook automatic both ways, Splose publishing follows its flag, Splose inbound retired', () => {
    const r = prefs.resolve({ userRows: [], env: ALL_ON_ENV() });
    expect(r.portal_to_outlook).toMatchObject({ settable: true, enabled: true, auto: true, syncFrom: null, runsAutomatically: true });
    expect(r.outlook_to_portal).toMatchObject({ settable: true, enabled: true, auto: true, runsAutomatically: true });
    expect(r.portal_to_splose).toMatchObject({ settable: false, enabled: true, auto: true, runs: true, runsAutomatically: true });
    expect(r.splose_to_portal).toMatchObject({ settable: false, enabled: false, runs: false });
    expect(r.splose_to_outlook).toMatchObject({ settable: false, enabled: false, runs: false });
  });

  test('a person may switch a direction off, set a date and turn auto off', () => {
    const r = prefs.resolve({
      userRows: [user('outlook_to_portal', { enabled: false }), user('portal_to_outlook', { auto: false, sync_from: '2026-11-01' })],
      env: ALL_ON_ENV(),
    });
    expect(r.outlook_to_portal.runs).toBe(false);
    expect(r.portal_to_outlook).toMatchObject({ runs: true, runsAutomatically: false, syncFrom: '2026-11-01' });
  });

  test('retired Owner limits and stored rows for fixed directions are ignored', () => {
    const r = prefs.resolve({
      practiceRows: [
        practice('portal_to_outlook', { allowed: false, earliest_from: '2026-10-01' }),
        practice('portal_to_splose', { allowed: false }),
      ],
      userRows: [
        user('portal_to_outlook', { enabled: true, sync_from: '2025-01-01' }),
        user('portal_to_splose', { enabled: false }),
        user('splose_to_portal', { enabled: true, auto: true }),
        user('splose_to_outlook', { enabled: true }),
      ],
      env: ALL_ON_ENV(),
    });
    expect(r.portal_to_outlook).toMatchObject({ enabled: true, syncFrom: '2025-01-01' });
    expect(r.portal_to_splose.enabled).toBe(true);
    expect(r.splose_to_portal.runs).toBe(false);
    expect(r.splose_to_outlook.runs).toBe(false);
  });

  test('pg DATE values (local-midnight Date objects) read back as the same day', () => {
    const r = prefs.resolve({ userRows: [user('outlook_to_portal', { sync_from: new Date(2026, 10, 1) })], env: ALL_ON_ENV() });
    expect(r.outlook_to_portal.syncFrom).toBe('2026-11-01');
  });

  test('environment flags win: a blocked direction never runs', () => {
    const env = ALL_ON_ENV();
    env.portal_to_outlook.blockedBy = 'ENABLE_OUTLOOK_WRITE';
    env.portal_to_splose.autoBlockedBy = 'ENABLE_SPLOSE_AUTO_SYNC';
    const r = prefs.resolve({ userRows: [user('portal_to_splose', { auto: true })], env });
    expect(r.portal_to_outlook).toMatchObject({ enabled: true, runs: false, blockedBy: 'ENABLE_OUTLOOK_WRITE' });
    expect(r.portal_to_splose).toMatchObject({ runs: true, runsAutomatically: false });
  });

  test('a missing environment entry is treated as blocked', () => {
    const r = prefs.resolve({ userRows: [], env: {} });
    for (const d of prefs.DIRECTIONS) expect(r[d].runs).toBe(false);
  });
});

describe('environment()', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test('Outlook write off blocks both Outlook-bound directions; Splose not connected blocks Splose', () => {
    process.env.ENABLE_OUTLOOK_WRITE = 'false';
    process.env.ENABLE_SPLOSE_DRAFT_SYNC = 'true';
    const env = prefs.environment(false);
    expect(env.portal_to_outlook.blockedBy).toBe('ENABLE_OUTLOOK_WRITE');
    expect(env.splose_to_outlook.blockedBy).toBe('ENABLE_OUTLOOK_WRITE');
    expect(env.outlook_to_portal.blockedBy).toBeNull();
    expect(env.splose_to_portal.blockedBy).toBe('SPLOSE_NOT_CONNECTED');
  });

  test('regression: a missing Splose connection never stops portal bookings queueing for Splose', () => {
    process.env.ENABLE_SPLOSE_DRAFT_SYNC = 'true';
    process.env.ENABLE_SPLOSE_WRITE = 'true';
    const env = prefs.environment(false);
    expect(env.portal_to_splose.blockedBy).toBeNull();
    expect(env.portal_to_splose.writeBlockedBy).toBe('SPLOSE_NOT_CONNECTED');
  });
});

describe('allows() / allowsLinked()', () => {
  const base = () => prefs.resolve({ userRows: [user('portal_to_outlook', { sync_from: '2026-11-01' })], env: ALL_ON_ENV() });

  test('cutoff is the practice-local day: 31 Oct 23:30 Perth is before 1 Nov', () => {
    const p = base();
    expect(prefs.allows(p, 'portal_to_outlook', { start: '2026-10-31T15:30:00.000Z' })).toBe(false); // 23:30 Perth 31 Oct
    expect(prefs.allows(p, 'portal_to_outlook', { start: '2026-10-31T16:30:00.000Z' })).toBe(true);  // 00:30 Perth 1 Nov
  });

  test('manual-only needs manual: true', () => {
    const p = prefs.resolve({ userRows: [user('outlook_to_portal', { auto: false })], env: ALL_ON_ENV() });
    expect(prefs.allows(p, 'outlook_to_portal')).toBe(false);
    expect(prefs.allows(p, 'outlook_to_portal', { manual: true })).toBe(true);
  });

  test('retired Splose → portal never runs, even by hand', () => {
    const p = prefs.resolve({ userRows: [], env: ALL_ON_ENV() });
    expect(prefs.allows(p, 'splose_to_portal', { manual: true })).toBe(false);
    expect(prefs.allows(p, 'splose_to_outlook', { manual: true })).toBe(false);
  });

  test('an already-linked event keeps in step whatever the cutoff', () => {
    expect(prefs.allowsLinked(base(), 'portal_to_outlook')).toBe(true);
  });

  test('unreadable settings (null) allow nothing', () => {
    for (const d of prefs.DIRECTIONS) {
      expect(prefs.allows(null, d, { manual: true })).toBe(false);
      expect(prefs.allowsLinked(null, d, { manual: true })).toBe(false);
    }
  });

  test('an unreadable start is never "after the cutoff"', () => {
    expect(prefs.allows(base(), 'portal_to_outlook', { start: 'not a date' })).toBe(false);
  });
});

describe('partitionOldOutlook()', () => {
  test('drops old Outlook events the portal does not hold; keeps held ones, new ones and cancellations', () => {
    const changed = [
      { outlookId: 'old-new', startTime: '2026-09-01T01:00:00Z' },
      { outlookId: 'old-held', startTime: '2026-09-02T01:00:00Z' },
      { outlookId: 'old-cancel', startTime: '2026-09-03T01:00:00Z', isCancelled: true },
      { outlookId: 'recent', startTime: '2026-11-05T01:00:00Z' },
      { outlookId: 'no-start' },
    ];
    const { kept, skippedOld } = prefs.partitionOldOutlook(changed, '2026-11-01', new Set(['old-held']));
    expect(kept.map(e => e.outlookId)).toEqual(['old-held', 'old-cancel', 'recent', 'no-start']);
    expect(skippedOld).toBe(1);
  });

  test('no cutoff keeps everything', () => {
    const changed = [{ outlookId: 'a', startTime: '2020-01-01T00:00:00Z' }];
    expect(prefs.partitionOldOutlook(changed, null, new Set()).kept).toHaveLength(1);
  });
});

describe('validateUserUpdate()', () => {
  const r = () => prefs.resolve({ userRows: [], env: ALL_ON_ENV() });

  test('refuses the fixed directions', () => {
    const { errors, changes } = prefs.validateUserUpdate(r(), {
      portal_to_splose: { enabled: false },
      splose_to_portal: { enabled: true },
      splose_to_outlook: { auto: true },
    });
    expect(errors).toHaveLength(3);
    expect(changes).toEqual({});
  });

  test('accepts on/off, auto, dates and null (back to default) for the Outlook directions', () => {
    const { errors, changes } = prefs.validateUserUpdate(r(), {
      portal_to_outlook: { enabled: false },
      outlook_to_portal: { syncFrom: '2026-10-15', auto: null },
    });
    expect(errors).toEqual([]);
    expect(changes).toEqual({
      portal_to_outlook: { enabled: false },
      outlook_to_portal: { syncFrom: '2026-10-15', auto: null },
    });
  });

  test('rejects unknown directions, bad types and bad dates', () => {
    expect(prefs.validateUserUpdate(r(), { sideways: { enabled: true } }).errors).toHaveLength(1);
    expect(prefs.validateUserUpdate(r(), { portal_to_outlook: { enabled: 'yes' } }).errors).toHaveLength(1);
    expect(prefs.validateUserUpdate(r(), { portal_to_outlook: { syncFrom: '01/11/2026' } }).errors).toHaveLength(1);
    expect(prefs.validateUserUpdate(r(), null).errors).toHaveLength(1);
  });

  test('the practice validator is gone', () => {
    expect(prefs.validatePracticeUpdate).toBeUndefined();
  });
});

describe('alertDecision() — the Splose watcher', () => {
  const r = (userRows) => prefs.resolve({ userRows, env: ALL_ON_ENV() });
  const created = (start) => ({ kind: 'created', details: { start } });

  test('Splose → portal is retired: "new in Splose" alerts are not recorded', () => {
    expect(prefs.alertDecision(r([]), created('2026-11-10T01:00:00Z'))).toBe('drop');
    expect(prefs.alertDecision(r([user('splose_to_portal', { enabled: true, auto: true })]), created('2026-11-10T01:00:00Z'))).toBe('drop');
  });
  test('"not in Splose" alerts still ask — portal → Splose is fixed on', () => {
    expect(prefs.alertDecision(r([user('portal_to_splose', { enabled: false })]), { kind: 'unlinked', details: { start: '2026-11-10T01:00:00Z' } })).toBe('keep');
  });
  test('moves and cancellations always ask; unreadable settings always ask', () => {
    expect(prefs.alertDecision(r([]), { kind: 'moved', details: {} })).toBe('keep');
    expect(prefs.alertDecision(null, created('2026-11-10T01:00:00Z'))).toBe('keep');
  });
});
