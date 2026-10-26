'use strict';

/**
 * "Sync now" planning (migration 081) — pure matchers and the decision vet.
 *
 * Pins the no-duplicates rules:
 *   - an event the other side already has is LINKED, never created again
 *   - several candidates → review (the person chooses), never a guess
 *   - two events that would link to one counterpart both drop to review
 *   - anything already linked, cancelled or a series master is left alone
 *   - apply only accepts decisions the fresh plan offers; a link must name
 *     one of the offered candidates; a counterpart can be claimed once
 *   - the plan window starts at the sync-from date (Perth midnight)
 */

const bf = require('../sync-backfill');

const T = (h, m = 0) => `2026-11-10T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const row = (id, h, extra = {}) => ({ id, title: 'Session ' + id, start_time: new Date(T(h)), end_time: new Date(T(h + 1)), ...extra });
const ol = (id, h, extra = {}) => ({ outlookId: id, title: 'OL ' + id, startTime: T(h), endTime: T(h + 1), ...extra });
const sp = (id, h, patientId, extra = {}) => ({ id, start: T(h), end: T(h + 1), practitionerId: '88167', patients: [{ patientId, status: 'Booked' }], ...extra });

describe('planToOutlook()', () => {
  test('link when Outlook already has the same start and end; create when it has nothing', () => {
    const items = bf.planToOutlook({ locals: [row('a', 1), row('b', 3)], remotes: [ol('X', 1)], heldIds: new Set() });
    expect(items.find(i => i.key === 'local:a')).toMatchObject({ action: 'link', remote: { id: 'X' } });
    expect(items.find(i => i.key === 'local:b')).toMatchObject({ action: 'create' });
  });

  test('an Outlook event already held by another portal row is never offered', () => {
    const items = bf.planToOutlook({ locals: [row('a', 1)], remotes: [ol('X', 1)], heldIds: new Set(['X']) });
    expect(items[0].action).toBe('create');
  });

  test('a different end time is not a match', () => {
    const items = bf.planToOutlook({ locals: [row('a', 1)], remotes: [ol('X', 1, { endTime: T(3) })], heldIds: new Set() });
    expect(items[0].action).toBe('create');
  });

  test('two candidates → review', () => {
    const items = bf.planToOutlook({ locals: [row('a', 1)], remotes: [ol('X', 1), ol('Y', 1)], heldIds: new Set() });
    expect(items[0]).toMatchObject({ action: 'review' });
    expect(items[0].candidates.map(c => c.id).sort()).toEqual(['X', 'Y']);
  });

  test('two portal events that would link to one Outlook event both go to review', () => {
    const items = bf.planToOutlook({ locals: [row('a', 1), row('b', 1)], remotes: [ol('X', 1)], heldIds: new Set() });
    expect(items.map(i => i.action)).toEqual(['review', 'review']);
  });

  test('a held portal edit → update; a portal deletion still in Outlook → delete; cancelled and series masters ignored', () => {
    const items = bf.planToOutlook({
      locals: [
        row('u', 1, { outlook_id: 'U', sync_status: 'pending', last_modified_by: 'app' }),
        row('s', 2, { outlook_id: 'S', sync_status: 'synced', last_modified_by: 'app' }),
        row('d', 3, { outlook_id: 'D', is_deleted: true }),
        row('g', 4, { outlook_id: 'GONE', is_deleted: true }),
        row('c', 5),
      ],
      remotes: [ol('U', 1), ol('S', 2), ol('D', 3), ol('C', 5, { isCancelled: true }), ol('M', 5, { type: 'seriesMaster' })],
      heldIds: new Set(['U', 'S', 'D', 'GONE']),
    });
    const by = Object.fromEntries(items.map(i => [i.key, i.action]));
    expect(by).toEqual({ 'local:u': 'update', 'local:d': 'delete', 'local:c': 'create' });
  });
});

describe('planFromOutlook()', () => {
  test('link to a portal event at the same time; create otherwise; skip held', () => {
    const items = bf.planFromOutlook({
      remotes: [ol('X', 1), ol('Y', 3), ol('H', 5)],
      locals: [row('a', 1)],
      heldIds: new Set(['H']),
    });
    expect(items).toHaveLength(2);
    expect(items.find(i => i.key === 'remote:X')).toMatchObject({ action: 'link', local: { id: 'a' } });
    expect(items.find(i => i.key === 'remote:Y')).toMatchObject({ action: 'create' });
  });
});

describe('planToSplose() / planFromSplose()', () => {
  test('same client same start → link; same client 20 min apart → review; other client → create', () => {
    const items = bf.planToSplose({
      locals: [row('a', 1, { client_id: '41' }), row('b', 3, { client_id: '41' }), row('c', 5, { client_id: '42' })],
      appointments: [sp(1001, 1, 41), { ...sp(1002, 3, 41), start: '2026-11-10T03:20:00.000Z' }, sp(1003, 5, 99)],
      heldIds: new Set(),
    });
    const by = Object.fromEntries(items.map(i => [i.key, i.action]));
    expect(by).toEqual({ 'local:a': 'link', 'local:b': 'review', 'local:c': 'create' });
  });

  test('cancelled and already-held Splose appointments are never offered', () => {
    const items = bf.planToSplose({
      locals: [row('a', 1, { client_id: '41' })],
      appointments: [sp(1001, 1, 41, { patients: [{ patientId: 41, status: 'Cancelled' }] }), sp(1002, 1, 41)],
      heldIds: new Set(['1002']),
    });
    expect(items[0].action).toBe('create');
  });

  test('Splose → portal links to the portal booking for the same client and time', () => {
    const items = bf.planFromSplose({
      appointments: [sp(2001, 1, 41), sp(2002, 3, 41)],
      locals: [row('a', 1, { client_id: '41' })],
      heldIds: new Set(),
    });
    expect(items.find(i => i.key === 'remote:2001')).toMatchObject({ action: 'link', local: { id: 'a' } });
    expect(items.find(i => i.key === 'remote:2002')).toMatchObject({ action: 'create' });
  });
});

describe('vetDecisions()', () => {
  const items = bf.planToOutlook({
    locals: [row('a', 1), row('b', 3), row('r', 5), row('d', 7, { outlook_id: 'D', is_deleted: true })],
    remotes: [ol('X', 1), ol('P', 5), ol('Q', 5), ol('D', 7)],
    heldIds: new Set(['D']),
  });

  test('accepts offered actions; a link must name an offered candidate', () => {
    const { accepted, rejected } = bf.vetDecisions(items, [
      { key: 'local:a', action: 'link', counterpartId: 'X' },
      { key: 'local:b', action: 'create' },
      { key: 'local:r', action: 'link', counterpartId: 'Q' },
      { key: 'local:d', action: 'delete' },
    ]);
    expect(accepted.map(a => a.item.key)).toEqual(['local:a', 'local:b', 'local:r', 'local:d']);
    expect(rejected).toEqual([]);
  });

  test('refuses forged keys, non-candidates, wrong actions and duplicates', () => {
    const { accepted, rejected } = bf.vetDecisions(items, [
      { key: 'local:zzz', action: 'create' },
      { key: 'local:a', action: 'link', counterpartId: 'Q' },
      { key: 'local:b', action: 'delete' },
      { key: 'local:r', action: 'create' },
      { key: 'local:r', action: 'create' },
      { key: 'local:d', action: 'update' },
      { key: 'local:a', action: 'explode' },
    ]);
    expect(accepted.map(a => a.item.key)).toEqual(['local:r']);
    expect(rejected.map(r => r.code)).toEqual([
      'no_longer_offered', 'not_a_candidate', 'action_mismatch', 'duplicate_or_missing_key', 'action_mismatch', 'duplicate_or_missing_key',
    ]);
  });

  test('a counterpart claimed by two decisions is refused for both', () => {
    const two = bf.planFromOutlook({ remotes: [ol('X', 1), ol('Y', 1)], locals: [row('a', 1)], heldIds: new Set() });
    const { accepted, rejected } = bf.vetDecisions(two, [
      { key: 'remote:X', action: 'link', counterpartId: 'a' },
      { key: 'remote:Y', action: 'link', counterpartId: 'a' },
    ]);
    expect(accepted).toEqual([]);
    expect(rejected.map(r => r.code)).toEqual(['counterpart_claimed_twice', 'counterpart_claimed_twice']);
  });
});

describe('defaultDecision()', () => {
  test('links, creates and updates are pre-ticked; deletes and reviews are not', () => {
    expect(bf.defaultDecision({ key: 'local:a', action: 'link', remote: { id: 'X' } })).toEqual({ key: 'local:a', action: 'link', counterpartId: 'X' });
    expect(bf.defaultDecision({ key: 'remote:X', action: 'link', local: { id: 'a' } })).toEqual({ key: 'remote:X', action: 'link', counterpartId: 'a' });
    expect(bf.defaultDecision({ key: 'local:a', action: 'create' })).toEqual({ key: 'local:a', action: 'create' });
    expect(bf.defaultDecision({ key: 'local:a', action: 'delete' })).toBeNull();
    expect(bf.defaultDecision({ key: 'local:a', action: 'review' })).toBeNull();
  });
});

describe('planWindow()', () => {
  const now = new Date('2026-11-10T00:00:00.000Z');
  test('starts at Perth midnight of the sync-from date', () => {
    expect(bf.planWindow('2026-11-01', now).from).toBe('2026-10-31T16:00:00.000Z');
  });
  test('no date → 90 days back; very old dates are clamped to three years', () => {
    expect(bf.planWindow(null, now).from).toBe(new Date(now.getTime() - 90 * 86400000).toISOString());
    const w = bf.planWindow('2000-01-01', now);
    expect(new Date(w.to) - new Date(w.from)).toBe(3 * 365 * 86400000);
  });
});

describe('perthIso()', () => {
  test('writes the Perth wall-clock with its offset', () => {
    expect(bf.perthIso('2026-11-10T01:30:00.000Z')).toBe('2026-11-10T09:30:00+08:00');
  });
});
