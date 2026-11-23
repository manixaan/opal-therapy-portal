'use strict';

/**
 * mobile-calendar.js — the pure rules behind the phone's drag-to-move and its
 * travel legs. No DB; `now` is always passed in.
 */

const { canMoveEvent, checkMove, buildTravelLegs, MOVABLE_TYPES, perthDate } = require('../mobile-calendar');

const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const NOW = new Date('2027-03-01T00:00:00.000Z');          // 08:00 Perth, 1 Mar 2027
const VIRTUAL_RE = /telehealth|zoom|teams|phone/i;

const ev = (over = {}) => ({
  id: 'e1', user_id: USER, title: 'OT session', event_type: 'therapy', status: 'confirmed',
  start_time: '2027-03-02T01:00:00.000Z', end_time: '2027-03-02T02:00:00.000Z',   // 09:00–10:00 Perth
  location: '12 Smith Street, Willetton WA', is_deleted: false, custom_metadata: {},
  ...over,
});
const body = (startIso, endIso, from = ev()) => ({
  start: startIso, end: endIso, expectedStart: from.start_time, expectedEnd: from.end_time,
});

describe('canMoveEvent', () => {
  test('own, live, future, movable type → ok', () => {
    expect(canMoveEvent(ev(), USER, NOW)).toEqual({ ok: true });
  });
  test.each([
    ['someone else’s', { user_id: 'other' }, 'not_owner'],
    ['deleted', { is_deleted: true }, 'not_found'],
    ['cancelled', { status: 'cancelled' }, 'cancelled'],
    ['all-day', { start_time: '2027-03-02T00:00:00.000Z', end_time: '2027-03-03T00:00:00.000Z' }, 'all_day'],
    ['a travel mirror', { custom_metadata: { travelLegKey: 'x|before' } }, 'travel_mirror'],
    ['a non-movable type', { event_type: 'leave' }, 'type'],
    ['already started', { start_time: '2027-02-28T23:00:00.000Z', end_time: '2027-03-01T01:00:00.000Z' }, 'started'],
  ])('%s → refused', (_l, over, reason) => {
    expect(canMoveEvent(ev(over), USER, NOW)).toEqual({ ok: false, reason });
  });
  test('the portal’s movable set', () => {
    expect([...MOVABLE_TYPES].sort()).toEqual(['admin', 'assessment', 'cpd', 'initial', 'lunch', 'mdt', 'report', 'therapy', 'travel']);
  });
});

describe('checkMove', () => {
  const base = { userId: USER, now: NOW, virtualRe: VIRTUAL_RE };

  test('a clean move returns the delta and the moved rows', () => {
    const r = checkMove({ ...base, ev: ev(), body: body('2027-03-02T10:30:00+08:00', '2027-03-02T11:30:00+08:00') });
    expect(r.ok).toBe(true);
    expect(r.delta).toBe(90 * 60000);
    expect(r.moved[0].start_time).toBe('2027-03-02T02:30:00.000Z');
    expect(r.warnings).toEqual([]);
  });

  test('times without an offset are refused (no device-timezone guessing)', () => {
    const r = checkMove({ ...base, ev: ev(), body: body('2027-03-02T10:30:00', '2027-03-02T11:30:00') });
    expect(r).toMatchObject({ ok: false, status: 400, code: 'invalid' });
  });

  test('a changed duration is refused', () => {
    const r = checkMove({ ...base, ev: ev(), body: body('2027-03-02T10:30:00+08:00', '2027-03-02T12:30:00+08:00') });
    expect(r).toMatchObject({ ok: false, status: 400, code: 'invalid' });
  });

  test('changed under you → 409 changed', () => {
    const b = { ...body('2027-03-02T10:30:00+08:00', '2027-03-02T11:30:00+08:00'), expectedStart: '2027-03-02T00:00:00.000Z' };
    expect(checkMove({ ...base, ev: ev(), body: b })).toMatchObject({ ok: false, status: 409, code: 'changed' });
  });

  test('into the past → refused', () => {
    const r = checkMove({ ...base, ev: ev(), body: body('2027-03-01T07:00:00+08:00', '2027-03-01T08:00:00+08:00') });
    expect(r).toMatchObject({ ok: false, code: 'past' });
  });

  test('someone else’s event → 404, not a hint that it exists', () => {
    const r = checkMove({ ...base, ev: ev({ user_id: 'other' }), body: body('2027-03-02T10:30:00+08:00', '2027-03-02T11:30:00+08:00') });
    expect(r).toMatchObject({ ok: false, status: 404, code: 'not_found' });
  });

  test('cancelled → 403 not_movable with a reason', () => {
    const r = checkMove({ ...base, ev: ev({ status: 'cancelled' }), body: body('2027-03-02T10:30:00+08:00', '2027-03-02T11:30:00+08:00') });
    expect(r).toMatchObject({ ok: false, status: 403, code: 'not_movable', reason: 'cancelled' });
  });

  test('overlap with another live booking → 409 overlap naming it', () => {
    const other = ev({ id: 'e2', title: 'Team meeting', event_type: 'admin', location: null,
      start_time: '2027-03-02T03:00:00.000Z', end_time: '2027-03-02T04:00:00.000Z' });
    const r = checkMove({ ...base, ev: ev(), dayEvents: [ev(), other], body: body('2027-03-02T11:30:00+08:00', '2027-03-02T12:30:00+08:00') });
    expect(r).toMatchObject({ ok: false, status: 409, code: 'overlap', conflict: { id: 'e2', title: 'Team meeting' } });
  });

  test('cancelled and all-day rows never block', () => {
    const cancelled = ev({ id: 'e2', status: 'cancelled', start_time: '2027-03-02T03:00:00.000Z', end_time: '2027-03-02T04:00:00.000Z' });
    const allDay = ev({ id: 'e3', start_time: '2027-03-01T16:00:00.000Z', end_time: '2027-03-02T16:00:00.000Z' });
    const r = checkMove({ ...base, ev: ev(), dayEvents: [cancelled, allDay], body: body('2027-03-02T11:30:00+08:00', '2027-03-02T12:30:00+08:00') });
    expect(r.ok).toBe(true);
  });

  test('linked travel blocks move by the same delta and are checked too', () => {
    const block = ev({ id: 't1', event_type: 'travel', related_event_id: 'e1', location: null,
      start_time: '2027-03-02T00:30:00.000Z', end_time: '2027-03-02T01:00:00.000Z' });
    const ok = checkMove({ ...base, ev: ev(), linked: [block], dayEvents: [ev(), block], body: body('2027-03-02T10:00:00+08:00', '2027-03-02T11:00:00+08:00') });
    expect(ok.ok).toBe(true);
    expect(ok.moved.map((m) => [m.id, m.start_time])).toEqual([
      ['e1', '2027-03-02T02:00:00.000Z'], ['t1', '2027-03-02T01:30:00.000Z']]);

    // The block itself would land on a meeting → refused, even though the session fits.
    const meeting = ev({ id: 'm1', event_type: 'admin', location: null,
      start_time: '2027-03-02T01:15:00.000Z', end_time: '2027-03-02T01:45:00.000Z' });
    const bad = checkMove({ ...base, ev: ev(), linked: [block], dayEvents: [ev(), block, meeting], body: body('2027-03-02T10:00:00+08:00', '2027-03-02T11:00:00+08:00') });
    expect(bad).toMatchObject({ ok: false, code: 'overlap', conflict: { id: 'm1' } });
  });

  test('a priced drive that no longer fits before the next client → travel_conflict', () => {
    const next = ev({ id: 'e2', location: '5 Jones Road, Rossmoyne WA',
      start_time: '2027-03-02T04:00:00.000Z', end_time: '2027-03-02T05:00:00.000Z' });     // 12:00 Perth
    const legsAfter = (moved) => [{ id: 'between', kind: 'BETWEEN', ownerEventId: 'e2', side: 'before',
      fromEventId: 'e1', toEventId: 'e2', minutes: 25,
      start: '2027-03-02T03:35:00.000Z', end: '2027-03-02T04:00:00.000Z', _moved: moved }];
    // Moved to 11:00–12:00: the 25-min drive into 12:00 overlaps the moved session itself.
    const r = checkMove({ ...base, ev: ev(), dayEvents: [ev(), next], legsAfter, body: body('2027-03-02T10:50:00+08:00', '2027-03-02T11:50:00+08:00') });
    expect(r).toMatchObject({ ok: false, status: 409, code: 'travel_conflict' });
  });

  test('a drive over desk work (no address) is a warning, an unpriced drive is a warning', () => {
    const desk = ev({ id: 'd1', event_type: 'admin', location: null,
      start_time: '2027-03-02T02:00:00.000Z', end_time: '2027-03-02T02:30:00.000Z' });
    const legsAfter = () => [
      { id: 'a', ownerEventId: 'e1', side: 'before', fromEventId: null, toEventId: 'e1', minutes: 40,
        start: '2027-03-02T02:20:00.000Z', end: '2027-03-02T03:00:00.000Z' },
      { id: 'b', ownerEventId: 'e1', side: 'after', fromEventId: 'e1', toEventId: null, minutes: null, start: null, end: null },
    ];
    const r = checkMove({ ...base, ev: ev(), dayEvents: [ev(), desk], legsAfter, body: body('2027-03-02T11:00:00+08:00', '2027-03-02T12:00:00+08:00') });
    expect(r.ok).toBe(true);
    expect(r.warnings.sort()).toEqual(['travel_tight', 'travel_unpriced']);
  });
});

describe('buildTravelLegs', () => {
  const { weekKeyForDate, dayKeyForDate } = require('../billing/day-route');
  const user = { id: USER, default_work_location: { homes: [{ id: 'home', label: 'Home', addr: '1 Base Street, Bull Creek WA' }] },
    work_location_schedule: { [weekKeyForDate('2027-03-02')]: { [dayKeyForDate('2027-03-02')]: 'home' } } };
  const A = ev({ id: 'A', location: '12 Smith Street, Willetton WA',
    start_time: '2027-03-02T01:00:00.000Z', end_time: '2027-03-02T02:00:00.000Z' });
  const B = ev({ id: 'B', location: '5 Jones Road, Rossmoyne WA',
    start_time: '2027-03-02T03:00:00.000Z', end_time: '2027-03-02T04:00:00.000Z',
    custom_metadata: { travel: { beforeOffsetMin: -50 } } });
  const minutes = { '12 Smith Street, Willetton WA|5 Jones Road, Rossmoyne WA': 20 };
  const minutesFor = (o, d) => minutes[`${o}|${d}`] ?? null;

  test('a direct drive is owned by the appointment it drives into and honours a dragged offset', () => {
    const legs = buildTravelLegs({ user, date: '2027-03-02', events: [B, A], minutesFor, virtualRe: VIRTUAL_RE });
    const between = legs.find((l) => l.kind === 'BETWEEN');
    expect(between).toMatchObject({ ownerEventId: 'B', side: 'before', minutes: 20, moved: true,
      start: '2027-03-02T02:10:00.000Z', end: '2027-03-02T02:30:00.000Z' });
  });

  test('moving the owner moves its leg with it (offsets, no write)', () => {
    const B2 = { ...B, start_time: '2027-03-02T05:00:00.000Z', end_time: '2027-03-02T06:00:00.000Z' };
    const legs = buildTravelLegs({ user, date: '2027-03-02', events: [A, B2], minutesFor, virtualRe: VIRTUAL_RE });
    expect(legs.find((l) => l.kind === 'BETWEEN').start).toBe('2027-03-02T04:10:00.000Z');
  });

  test('an undragged leg ends at its owner’s start; an unpriced one has no time', () => {
    const B0 = { ...B, custom_metadata: {} };
    const legs = buildTravelLegs({ user, date: '2027-03-02', events: [A, B0], minutesFor, virtualRe: VIRTUAL_RE });
    expect(legs.find((l) => l.kind === 'BETWEEN')).toMatchObject({ start: '2027-03-02T02:40:00.000Z', end: '2027-03-02T03:00:00.000Z', moved: false });
    const ends = legs.filter((x) => x.kind !== 'BETWEEN');
    expect(ends.map((l) => [l.kind, l.side, l.ownerEventId])).toEqual([['OUTBOUND', 'before', 'A'], ['RETURN', 'after', 'B']]);
    for (const l of ends) expect(l).toMatchObject({ minutes: null, start: null, end: null });
  });

  test('a priced return leg starts when its owner ends', () => {
    const priced = (o, d) => (d === '1 Base Street, Bull Creek WA' ? 15 : minutesFor(o, d));
    const legs = buildTravelLegs({ user, date: '2027-03-02', events: [A, { ...B, custom_metadata: {} }], minutesFor: priced, virtualRe: VIRTUAL_RE });
    expect(legs.find((l) => l.kind === 'RETURN')).toMatchObject({ toLabel: 'Home', minutes: 15,
      start: '2027-03-02T04:00:00.000Z', end: '2027-03-02T04:15:00.000Z' });
  });

  test('telehealth, cancelled and travel blocks are not stops', () => {
    const tele = ev({ id: 'T', location: 'Telehealth', start_time: '2027-03-02T02:15:00.000Z', end_time: '2027-03-02T02:45:00.000Z' });
    const legs = buildTravelLegs({ user, date: '2027-03-02', events: [A, tele, B], minutesFor, virtualRe: VIRTUAL_RE });
    expect(legs.some((l) => l.ownerEventId === 'T' || l.fromEventId === 'T' || l.toEventId === 'T')).toBe(false);
  });

  test('perthDate uses Perth, not the server clock', () => {
    expect(perthDate('2027-03-01T17:00:00.000Z')).toBe('2027-03-02');
  });
});
