'use strict';

/**
 * TRAVEL-BLOCK DELETE CASCADE — pure selection rules (travel-cascade.js).
 *
 * Deleting a calendar event must take its travel blocks with it:
 *   - blocks explicitly linked via related_event_id ALWAYS cascade
 *   - legacy unlinked blocks cascade only under the conservative adjacency
 *     rule: one end touches the deleted event (exact or <=5 min gap) AND the
 *     other end does not touch any other surviving non-travel event
 *   - a block sandwiched between two surviving appointments is NEVER deleted
 *   - a block linked to a DIFFERENT event is NEVER deleted here
 */

const { collectCascadeTravelBlocks, touches, minutesApart } = require('../travel-cascade');

// Times on one demo day (UTC keeps the arithmetic obvious)
const T = (h, m = 0) => `2026-08-10T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;

const APPT = { id: 'appt-1', event_type: 'therapy', start_time: T(10), end_time: T(11) };

const travel = (id, start, end, related = null) => ({
  id, event_type: 'travel', start_time: start, end_time: end, related_event_id: related,
});
const appt = (id, start, end) => ({ id, event_type: 'therapy', start_time: start, end_time: end });

describe('helpers', () => {
  test('minutesApart and touches honour the 5-minute tolerance', () => {
    expect(minutesApart(T(10), T(10, 5))).toBe(5);
    expect(touches(T(10), T(10))).toBe(true);       // exact
    expect(touches(T(10), T(10, 5))).toBe(true);    // 5-min gap
    expect(touches(T(10), T(10, 6))).toBe(false);   // 6 min — outside tolerance
    expect(touches('not-a-date', T(10))).toBe(false);
  });
});

describe('explicit linkage', () => {
  test('a block linked to the deleted event always cascades — even when not adjacent', () => {
    const linked = travel('tb-linked', T(14), T(14, 15), 'appt-1');
    const out = collectCascadeTravelBlocks(APPT, [linked]);
    expect(out.map((b) => b.id)).toEqual(['tb-linked']);
  });

  test('a block linked to a DIFFERENT event never cascades, even when adjacent', () => {
    const other = travel('tb-other', T(9, 45), T(10), 'appt-999'); // touches APPT start exactly
    expect(collectCascadeTravelBlocks(APPT, [other])).toEqual([]);
  });
});

describe('adjacency fallback (legacy unlinked blocks)', () => {
  test('exact touch BEFORE the event (travel ends at event start) cascades', () => {
    const tb = travel('tb-before', T(9, 45), T(10));
    expect(collectCascadeTravelBlocks(APPT, [tb]).map((b) => b.id)).toEqual(['tb-before']);
  });

  test('exact touch AFTER the event (travel starts at event end) cascades', () => {
    const tb = travel('tb-after', T(11), T(11, 15));
    expect(collectCascadeTravelBlocks(APPT, [tb]).map((b) => b.id)).toEqual(['tb-after']);
  });

  test('a 5-minute gap still counts as touching', () => {
    const tb = travel('tb-gap5', T(9, 40), T(9, 55)); // ends 5 min before APPT starts
    expect(collectCascadeTravelBlocks(APPT, [tb]).map((b) => b.id)).toEqual(['tb-gap5']);
  });

  test('a gap beyond 5 minutes does NOT cascade', () => {
    const tb = travel('tb-gap6', T(9, 39), T(9, 54)); // 6-min gap
    expect(collectCascadeTravelBlocks(APPT, [tb])).toEqual([]);
  });

  test('sandwiched between two surviving events is NEVER deleted', () => {
    // Travel 9:45-10:00 sits between an earlier appointment ending 9:45 and
    // the deleted event starting 10:00 — its other end is claimed.
    const tb    = travel('tb-sandwich', T(9, 45), T(10));
    const early = appt('appt-early', T(8, 45), T(9, 45));
    expect(collectCascadeTravelBlocks(APPT, [tb, early])).toEqual([]);
  });

  test('other side touching another appointment (within tolerance) blocks the cascade', () => {
    // Trailing travel 11:00-11:15; the next appointment starts 11:18 (3-min
    // gap from the block's other end) — the block feeds that appointment too.
    const tb   = travel('tb-next', T(11), T(11, 15));
    const next = appt('appt-next', T(11, 18), T(12, 18));
    expect(collectCascadeTravelBlocks(APPT, [tb, next])).toEqual([]);
  });

  test('other side near only ANOTHER TRAVEL block does not block the cascade', () => {
    const tb  = travel('tb-a', T(11), T(11, 15));
    const tb2 = travel('tb-b', T(11, 15), T(11, 30), 'someone-else'); // travel, not an appointment
    expect(collectCascadeTravelBlocks(APPT, [tb, tb2]).map((b) => b.id)).toEqual(['tb-a']);
  });

  test('unrelated travel elsewhere in the day is untouched', () => {
    const far = travel('tb-far', T(15), T(15, 20));
    expect(collectCascadeTravelBlocks(APPT, [far])).toEqual([]);
  });

  test('non-travel events never cascade, whatever their adjacency', () => {
    const lunch = { id: 'lunch-1', event_type: 'lunch', start_time: T(11), end_time: T(11, 30), related_event_id: null };
    expect(collectCascadeTravelBlocks(APPT, [lunch])).toEqual([]);
  });

  test('soft-deleted travel rows are ignored', () => {
    const tb = { ...travel('tb-dead', T(9, 45), T(10)), is_deleted: true };
    expect(collectCascadeTravelBlocks(APPT, [tb])).toEqual([]);
  });

  test('missing timestamps on the deleted event disable the adjacency fallback (linked still works)', () => {
    const noTimes = { id: 'appt-1' };
    const adjacent = travel('tb-adj', T(9, 45), T(10));
    const linked   = travel('tb-linked', T(9, 45), T(10), 'appt-1');
    expect(collectCascadeTravelBlocks(noTimes, [adjacent, linked]).map((b) => b.id)).toEqual(['tb-linked']);
  });

  test('defensive: bad inputs return an empty cascade', () => {
    expect(collectCascadeTravelBlocks(null, [])).toEqual([]);
    expect(collectCascadeTravelBlocks(APPT, null)).toEqual([]);
    expect(collectCascadeTravelBlocks({}, [travel('x', T(9, 45), T(10))])).toEqual([]);
  });
});
