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

// 21 Nov 2026 audit (T-06): a page that drew a day before the work schedule
// loaded sent legs:[] and the plan deleted every Outlook travel event on it.
describe('syncDay — an empty list never wipes a day unless the calendar confirms it', () => {
  const MIRROR = { id: 'row-1', outlook_id: 'ol-1', start_time: '2026-10-06T04:00:00Z', end_time: '2026-10-06T04:20:00Z',
    title: 'Travel · 20 min', location: '', key: A + '|after', local_date: '2026-10-06' };
  const deleteOutlookEvent = jest.fn(async () => {});
  const day = (body) => S.syncDay({
    pool: { query: jest.fn(async (sql) => (/AS drawn/.test(sql) ? { rows: [{ id: A, drawn: true }] }
      : /travelLegKey/.test(sql) && /SELECT id, outlook_id/.test(sql) ? { rows: [MIRROR] } : { rows: [] })) },
    outlook: { deleteOutlookEvent }, getAccessToken: async () => 'tok',
  }, 'user-1', Object.assign({ date: '2026-10-06', seenEventIds: [A], legs: [] }, body), NOW);

  test('legs:[] without confirmEmpty is refused and nothing is deleted', async () => {
    const r = await day({});
    expect([r.status, r.body.code]).toEqual([409, 'empty_day_unconfirmed']);
    expect(deleteOutlookEvent).not.toHaveBeenCalled();
  });

  test('a day beyond today + 14 is never mirrored', () => {
    const v = S.validateRequest({ date: '2026-10-20', seenEventIds: [], legs: [] }, NOW);
    expect(v.beyond).toBe(true);
    expect(S.validateRequest({ date: '2026-10-19', seenEventIds: [], legs: [] }, NOW).beyond).toBe(false);
    expect(S.MIRROR_HORIZON_DAYS).toBe(14);
  });
});

// 21 Nov 2026 audit (T-08): a week's ready days in one request. Batching is
// transport only — each day still goes through syncDay and all its guards.
describe('syncDays — a batch is each day on its own', () => {
  const MIRROR = { id: 'row-1', outlook_id: 'ol-1', start_time: '2026-10-06T04:00:00Z', end_time: '2026-10-06T04:20:00Z',
    title: 'Travel · 20 min', location: '', key: A + '|after', local_date: '2026-10-06' };
  const mk = () => {
    const deleteOutlookEvent = jest.fn(async () => {});
    return {
      deleteOutlookEvent,
      deps: {
        pool: { query: jest.fn(async (sql, params) => (/AS drawn/.test(sql) ? { rows: params[1] === '2026-10-06' ? [{ id: A, drawn: true }] : [] }
          : /travelLegKey/.test(sql) && /SELECT id, outlook_id/.test(sql) ? { rows: params[2] === '2026-10-06' ? [MIRROR] : [] } : { rows: [] })) },
        outlook: { deleteOutlookEvent }, getAccessToken: async () => 'tok',
      },
    };
  };
  const dayBody = (date, extra) => Object.assign({ date, seenEventIds: date === '2026-10-06' ? [A] : [], legs: [] }, extra);

  test('each day gets its own guard answer; one refusal never touches another day', async () => {
    const m = mk();
    const r = await S.syncDays(m.deps, 'user-1', { days: [
      dayBody('2026-10-06'),                                   // empty, unconfirmed → refused
      dayBody('2026-10-07', { seenEventIds: [B] }),            // someone else's event → not_own_day
      dayBody('2026-10-08', { confirmEmpty: true }),           // nothing there → ok
      dayBody('2026-10-01'),                                   // past → skipped
      dayBody('2026-10-25'),                                   // beyond 14 days → skipped
    ] }, NOW);
    expect(r.status).toBe(200);
    expect(r.results.map((x) => [x.date, x.status, x.body.code || x.body.skipped || x.body.ok])).toEqual([
      ['2026-10-06', 409, 'empty_day_unconfirmed'],
      ['2026-10-07', 409, 'not_own_day'],
      ['2026-10-08', 200, true],
      ['2026-10-01', 200, 'past'],
      ['2026-10-25', 200, 'beyond_horizon'],
    ]);
    expect(m.deleteOutlookEvent).not.toHaveBeenCalled();
  });

  test('a stale day in a batch is refused like a single request', async () => {
    const m = mk();
    const r = await S.syncDays(m.deps, 'user-1', { days: [dayBody('2026-10-06', { seenEventIds: [], confirmEmpty: true })] }, NOW);
    expect([r.results[0].status, r.results[0].body.code]).toEqual([409, 'stale_view']);
    expect(m.deleteOutlookEvent).not.toHaveBeenCalled();
  });

  test('a confirmed empty day still clears its own travel, and only its own', async () => {
    const m = mk();
    const r = await S.syncDays(m.deps, 'user-1', { days: [dayBody('2026-10-06', { confirmEmpty: true }), dayBody('2026-10-08', { confirmEmpty: true })] }, NOW);
    expect(r.results.map((x) => x.body.removed)).toEqual([1, 0]);
    expect(m.deleteOutlookEvent).toHaveBeenCalledTimes(1);
  });

  test('every day goes through syncDay, in order', async () => {
    const spy = jest.spyOn(S, 'syncDay').mockResolvedValue({ status: 200, body: { ok: true } });
    try {
      await S.syncDays({}, 'user-1', { days: [dayBody('2026-10-08'), dayBody('2026-10-07')] }, NOW);
      expect(spy.mock.calls.map((c) => [c[1], c[2].date])).toEqual([['user-1', '2026-10-08'], ['user-1', '2026-10-07']]);
    } finally { spy.mockRestore(); }
  });

  test('a thrown error stops the batch: recorded on its day, later days not attempted', async () => {
    const off = Object.assign(new Error('off'), { code: 'FEATURE_DISABLED' });
    const spy = jest.spyOn(S, 'syncDay').mockResolvedValueOnce({ status: 200, body: { ok: true } }).mockRejectedValueOnce(off);
    try {
      const r = await S.syncDays({}, 'user-1', { days: [dayBody('2026-10-06'), dayBody('2026-10-07'), dayBody('2026-10-08')] }, NOW);
      expect(r.results.map((x) => x.date)).toEqual(['2026-10-06', '2026-10-07']);
      expect(r.results[1].error).toBe(off);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally { spy.mockRestore(); }
  });

  test('a malformed batch is refused before any day is touched', async () => {
    const m = mk();
    for (const body of [{}, { days: [] }, { days: 'x' }, { days: Array.from({ length: 8 }, (_, i) => dayBody('2026-10-0' + (i + 1))) },
      { days: [dayBody('2026-10-06'), dayBody('2026-10-06')] }, { days: [null] }]) {
      expect((await S.syncDays(m.deps, 'user-1', body, NOW)).status).toBe(400);
    }
    expect(m.deps.pool.query).not.toHaveBeenCalled();
    expect(S.MAX_BATCH_DAYS).toBe(7);
  });
});

test('Outlook gets Perth wall-clock times', () => {
  expect(S.perthIso(new Date('2026-10-06T04:05:00Z'))).toBe('2026-10-06T12:05:00+08:00');
  expect(S.perthDate(new Date('2026-10-05T17:30:00Z'))).toBe('2026-10-06');
});
