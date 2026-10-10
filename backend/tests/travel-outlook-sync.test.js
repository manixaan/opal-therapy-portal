'use strict';

/**
 * Travel → Outlook mirror — the pure parts: request validation and the
 * create / move / remove plan. The database + Outlook path is in
 * integration/travel-outlook-sync.itest.js.
 */

const S = require('../travel-outlook-sync');

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-05T01:00:00Z'); // Mon 5 Oct, 9 am Perth
const leg = (key, s, e, extra) => Object.assign({ key, start: s, end: e, title: 'Travel · 20 min · Osborne Park → Joondalup', location: 'Joondalup' }, extra);

describe('validateRequest', () => {
  test('a well-formed day', () => {
    const v = S.validateRequest({ date: '2026-10-06', seenEventIds: [A, B], legs: [leg(A + '|after', '2026-10-06T12:00:00+08:00', '2026-10-06T12:20:00+08:00')] }, NOW);
    expect(v.ok).toBe(true);
    expect(v.legs[0]).toMatchObject({ ownerEventId: A, title: expect.stringContaining('Travel') });
    expect(v.past).toBe(false);
  });

  test('refuses bad keys, duplicates, inverted times, legs outside the day, and missing seen ids', () => {
    const base = { date: '2026-10-06', seenEventIds: [A] };
    const bad = (legs, extra) => S.validateRequest(Object.assign({}, base, { legs }, extra), NOW).ok;
    expect(bad([leg('nope', '2026-10-06T12:00:00+08:00', '2026-10-06T12:20:00+08:00')])).toBe(false);
    expect(bad([leg(A + '|sideways', '2026-10-06T12:00:00+08:00', '2026-10-06T12:20:00+08:00')])).toBe(false);
    const l = leg(A + '|after', '2026-10-06T12:00:00+08:00', '2026-10-06T12:20:00+08:00');
    expect(bad([l, l])).toBe(false);
    expect(bad([leg(A + '|after', '2026-10-06T12:20:00+08:00', '2026-10-06T12:00:00+08:00')])).toBe(false);
    expect(bad([leg(A + '|after', '2026-10-07T12:00:00+08:00', '2026-10-07T12:20:00+08:00')])).toBe(false);
    expect(bad([], { seenEventIds: undefined })).toBe(false);
    expect(bad([], { date: '6/10/2026' })).toBe(false);
  });

  test('a past day is flagged (left alone by the sync)', () => {
    expect(S.validateRequest({ date: '2026-10-04', seenEventIds: [], legs: [] }, NOW).past).toBe(true);
  });

  test('titles lose control characters and are capped', () => {
    const v = S.validateRequest({ date: '2026-10-06', seenEventIds: [A], legs: [leg(A + '|after', '2026-10-06T12:00:00+08:00', '2026-10-06T12:20:00+08:00', { title: 'Travel\n' + 'x'.repeat(300) })] }, NOW);
    expect(v.legs[0].title).not.toMatch(/\n/);
    expect(v.legs[0].title.length).toBeLessThanOrEqual(120);
  });
});

describe('planSync', () => {
  const at = (iso) => new Date(iso);
  const row = (key, s, e, extra) => Object.assign({ id: 'row-' + key, key, outlookId: 'out-' + key, start: at(s), end: at(e), title: 'Travel · 20 min · Osborne Park → Joondalup', location: 'Joondalup', date: '2026-10-06' }, extra);
  const want = (key, s, e, extra) => Object.assign({ key, start: at(s), end: at(e), title: 'Travel · 20 min · Osborne Park → Joondalup', location: 'Joondalup' }, extra);

  test('new legs are created, unchanged ones left, moved ones updated, dropped ones removed', () => {
    const existing = [
      row(A + '|after', '2026-10-06T04:00:00Z', '2026-10-06T04:20:00Z'),
      row(B + '|before', '2026-10-06T05:00:00Z', '2026-10-06T05:20:00Z'),
      row('cccccccc-3333-4333-8333-333333333333|after', '2026-10-06T07:00:00Z', '2026-10-06T07:20:00Z'),
    ];
    const legs = [
      want(A + '|after', '2026-10-06T04:00:00Z', '2026-10-06T04:20:00Z'),                 // unchanged
      want(B + '|before', '2026-10-06T05:30:00Z', '2026-10-06T05:50:00Z'),                // moved
      want('dddddddd-4444-4444-8444-444444444444|before', '2026-10-06T08:00:00Z', '2026-10-06T08:20:00Z'), // new
    ];
    const p = S.planSync(existing, legs, '2026-10-06');
    expect(p.create.map((l) => l.key)).toEqual(['dddddddd-4444-4444-8444-444444444444|before']);
    expect(p.update.map((u) => u.leg.key)).toEqual([B + '|before']);
    expect(p.remove.map((r) => r.key)).toEqual(['cccccccc-3333-4333-8333-333333333333|after']);
  });

  test('a leg whose appointment moved to another day is moved, not duplicated', () => {
    const existing = [row(A + '|after', '2026-10-05T04:00:00Z', '2026-10-05T04:20:00Z', { date: '2026-10-05' })];
    const p = S.planSync(existing, [want(A + '|after', '2026-10-06T04:00:00Z', '2026-10-06T04:20:00Z')], '2026-10-06');
    expect([p.create.length, p.update.length, p.remove.length]).toEqual([0, 1, 0]);
  });

  test('a mirror row that never reached Outlook is retried', () => {
    const existing = [row(A + '|after', '2026-10-06T04:00:00Z', '2026-10-06T04:20:00Z', { outlookId: null })];
    const p = S.planSync(existing, [want(A + '|after', '2026-10-06T04:00:00Z', '2026-10-06T04:20:00Z')], '2026-10-06');
    expect(p.update).toHaveLength(1);
  });
});

// 10 Oct 2026: the calendar's view of a day also holds the user's own all-day
// chips (and any cancelled row); those used to make every such day 409
// not_own_day, so its legs never reached Outlook. They may be seen now, but
// they never own a leg, and anyone else's event is still refused.
describe('syncDay — which events the calendar view may hold', () => {
  const ALLDAY = 'cccccccc-3333-4333-8333-333333333333';
  const CANCELLED = 'dddddddd-4444-4444-8444-444444444444';
  const THEIRS = 'eeeeeeee-5555-4555-8555-555555555555';
  const day = (seenEventIds, legs = []) => S.syncDay({
    // The day query: A and B are drawn tiles; the all-day and cancelled rows
    // are the user's own but not drawn. No mirror rows exist yet.
    pool: { query: jest.fn(async (sql) => (/AS drawn/.test(sql)
      ? { rows: [{ id: A, drawn: true }, { id: B, drawn: true }, { id: ALLDAY, drawn: false }, { id: CANCELLED, drawn: false }] }
      : { rows: [] })) },
    outlook: {}, getAccessToken: async () => 'tok',
  }, 'user-1', { date: '2026-10-06', seenEventIds, legs }, NOW);

  test("the user's own all-day and cancelled rows in the view are accepted, not required", async () => {
    expect((await day([A, B, ALLDAY, CANCELLED])).status).toBe(200);
    expect((await day([A, B])).status).toBe(200);
  });

  test('a drawn event missing from the view is still stale; a foreign id is still refused', async () => {
    expect((await day([A, ALLDAY])).body.code).toBe('stale_view');
    expect((await day([A, B, ALLDAY, THEIRS])).body.code).toBe('not_own_day');
  });

  test('an all-day event cannot own a travel leg', async () => {
    const r = await day([A, B, ALLDAY], [leg(ALLDAY + '|after', '2026-10-06T12:00:00+08:00', '2026-10-06T12:20:00+08:00')]);
    expect([r.status, r.body.code]).toEqual([409, 'not_own_leg']);
  });
});

test('Outlook gets Perth wall-clock times', () => {
  expect(S.perthIso(new Date('2026-10-06T04:05:00Z'))).toBe('2026-10-06T12:05:00+08:00');
  expect(S.perthDate(new Date('2026-10-05T17:30:00Z'))).toBe('2026-10-06');
});
