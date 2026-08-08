'use strict';

/**
 * AVAILABILITY ENGINE — exhaustive unit tests for the pure day-availability
 * computation in backend/availability-engine.js. No DB, no network: every
 * case feeds plain inputs and asserts the full segment model.
 */

const A = require('../availability-engine');

// Build an ISO instant from wall-clock time at an arbitrary UTC offset.
const zoneIso = (ymd, hh, mm, offsetMin) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) - offsetMin * 60000 + (hh * 60 + mm) * 60000).toISOString();

// Perth = UTC+8 (same helper shape as tests/scheduler-helpers.test.js).
const perthIso = (ymd, hh, mm = 0) => zoneIso(ymd, hh, mm, 480);

const MON = '2026-08-10';   // Monday
const TUE = '2026-08-11';
const SAT = '2026-08-15';
const SUN = '2026-08-16';

// camelCase event
const ev = (over = {}) => Object.assign({
  id: 'e1',
  start: perthIso(MON, 9),
  end: perthIso(MON, 10),
  eventType: 'therapy',
  isDeleted: false,
  isCancelled: false,
}, over);

// snake_case event
const snakeEv = (over = {}) => Object.assign({
  id: 'e1',
  start_time: perthIso(MON, 9),
  end_time: perthIso(MON, 10),
  event_type: 'therapy',
  is_deleted: false,
  status: 'confirmed',
}, over);

// A private Outlook event whose title/subject THROW if ever read.
const privateOutlookEv = () => {
  const e = {
    id: 'priv1',
    start_time: perthIso(MON, 9),
    end_time: perthIso(MON, 10),
    event_type: 'outlook',
    is_deleted: false,
    status: 'busy',
  };
  Object.defineProperty(e, 'title', { get() { throw new Error('title must never be read'); } });
  Object.defineProperty(e, 'subject', { get() { throw new Error('subject must never be read'); } });
  return e;
};

const baseOpts = (over = {}) => Object.assign({
  date: MON,
  events: [],
  weekSchedule: { mon: 'office', tue: 'office', wed: 'home-1', thu: 'office', fri: 'office' },
  workingHours: { startMin: 480, endMin: 1020 },   // 08:00–17:00, workingMin 540
  leaveRanges: [],
  buffers: {},
  minDurationMin: 30,
  scheduleKnown: true,
}, over);

// Every case must tile the full day: sorted, contiguous, no overlaps.
function assertTiling(segments) {
  expect(segments.length).toBeGreaterThan(0);
  expect(segments[0].startMin).toBe(0);
  expect(segments[segments.length - 1].endMin).toBe(1440);
  segments.forEach((s) => expect(s.endMin).toBeGreaterThan(s.startMin));
  for (let i = 1; i < segments.length; i++) {
    expect(segments[i].startMin).toBe(segments[i - 1].endMin);
  }
  const total = segments.reduce((acc, s) => acc + (s.endMin - s.startMin), 0);
  expect(total).toBe(1440);
}

// Wrapper used by (almost) every test so the tiling invariant is asserted
// on every computed day.
function compute(over) {
  const res = A.computeDayAvailability(baseOpts(over));
  assertTiling(res.segments);
  return res;
}

const segs = (res, type) => res.segments.filter((s) => s.type === type);
const spans = (res, type) => segs(res, type).map((s) => [s.startMin, s.endMin]);
const availSegs = (...ranges) => ranges.map(([s, e]) => ({ startMin: s, endMin: e, type: 'available' }));

// ═══ isEventBlockingAvailability ═════════════════════════════════════════════

describe('isEventBlockingAvailability', () => {
  test.each([
    'therapy', 'travel', 'meeting', 'teams_meeting', 'lunch',
    'cpd', 'admin', 'report', 'outlook', 'leave', null, 'mystery_type',
  ])('event type %p blocks availability (camelCase)', (eventType) => {
    expect(A.isEventBlockingAvailability(ev({ eventType }))).toBe(true);
  });

  test.each([
    'therapy', 'travel', 'outlook', null,
  ])('event type %p blocks availability (snake_case)', (event_type) => {
    expect(A.isEventBlockingAvailability(snakeEv({ event_type }))).toBe(true);
  });

  test.each([
    ['status cancelled (snake)', snakeEv({ status: 'cancelled' })],
    ['status Cancelled (case-insensitive)', snakeEv({ status: 'Cancelled' })],
    ['isCancelled (camel)', ev({ isCancelled: true })],
    ['is_deleted (snake)', snakeEv({ is_deleted: true })],
    ['isDeleted (camel)', ev({ isDeleted: true })],
  ])('%s never blocks', (_name, event) => {
    expect(A.isEventBlockingAvailability(event)).toBe(false);
  });

  test('a private Outlook event with NO title blocks — title is never read', () => {
    expect(A.isEventBlockingAvailability(privateOutlookEv())).toBe(true);
  });

  test('null/undefined events do not block', () => {
    expect(A.isEventBlockingAvailability(null)).toBe(false);
    expect(A.isEventBlockingAvailability(undefined)).toBe(false);
  });
});

// ═══ Small helpers ═══════════════════════════════════════════════════════════

describe('time helpers', () => {
  test('toMinutesOfDayPerth converts UTC instants to Perth minutes-of-day', () => {
    expect(A.toMinutesOfDayPerth(perthIso(MON, 0, 0))).toBe(0);
    expect(A.toMinutesOfDayPerth(perthIso(MON, 9, 30))).toBe(570);
    expect(A.toMinutesOfDayPerth(perthIso(MON, 23, 59))).toBe(1439);
  });

  test('toMinutesOfDayPerth honours a non-Perth offset (no DST hardcoding)', () => {
    // Adelaide-style +9:30 = 570 minutes east of UTC.
    expect(A.toMinutesOfDayPerth(zoneIso(MON, 9, 30, 570), 570)).toBe(570);
    expect(A.toMinutesOfDayPerth(zoneIso(MON, 0, 0, 570), 570)).toBe(0);
  });

  test('toMinutesOfDayPerth returns null for garbage', () => {
    expect(A.toMinutesOfDayPerth('not-a-date')).toBeNull();
    expect(A.toMinutesOfDayPerth(undefined)).toBeNull();
  });

  test('localDayStartUtcMs finds local midnight in UTC', () => {
    expect(A.localDayStartUtcMs(MON, 480)).toBe(Date.parse('2026-08-09T16:00:00Z'));
    expect(A.localDayStartUtcMs(MON, 570)).toBe(Date.parse('2026-08-09T14:30:00Z'));
  });

  test('fmtMin renders 12-hour labels', () => {
    expect(A.fmtMin(0)).toBe('12:00am');
    expect(A.fmtMin(545)).toBe('9:05am');
    expect(A.fmtMin(720)).toBe('12:00pm');
    expect(A.fmtMin(810)).toBe('1:30pm');
    expect(A.fmtMin(1440)).toBe('12:00am');
  });
});

describe('mergeIntervals', () => {
  test('disjoint intervals stay separate and come back sorted', () => {
    const out = A.mergeIntervals([
      { startMin: 700, endMin: 760, id: 'b' },
      { startMin: 540, endMin: 600, id: 'a' },
    ]);
    expect(out.map((iv) => [iv.startMin, iv.endMin])).toEqual([[540, 600], [700, 760]]);
  });

  test('overlapping intervals merge, tracking start/end event ids', () => {
    const out = A.mergeIntervals([
      { startMin: 540, endMin: 600, id: 'a' },
      { startMin: 570, endMin: 660, id: 'b' },
    ]);
    expect(out).toEqual([{ startMin: 540, endMin: 660, startId: 'a', endId: 'b' }]);
  });

  test('adjacent intervals merge (touching counts)', () => {
    const out = A.mergeIntervals([
      { startMin: 540, endMin: 600, id: 'a' },
      { startMin: 600, endMin: 660, id: 'b' },
    ]);
    expect(out).toEqual([{ startMin: 540, endMin: 660, startId: 'a', endId: 'b' }]);
  });

  test('a contained interval keeps the container ids', () => {
    const out = A.mergeIntervals([
      { startMin: 540, endMin: 660, id: 'a' },
      { startMin: 570, endMin: 600, id: 'b' },
    ]);
    expect(out).toEqual([{ startMin: 540, endMin: 660, startId: 'a', endId: 'a' }]);
  });

  test('empty and degenerate intervals are dropped', () => {
    expect(A.mergeIntervals([])).toEqual([]);
    expect(A.mergeIntervals([{ startMin: 600, endMin: 600 }])).toEqual([]);
    expect(A.mergeIntervals(null)).toEqual([]);
  });
});

// ═══ Basic day computation ═══════════════════════════════════════════════════

describe('basic day computation', () => {
  test('no events → outside / available / outside, full window free', () => {
    const res = compute({});
    expect(res.working).toBe(true);
    expect(res.date).toBe(MON);
    expect(res.workingHoursSource).toBe('organisation_default');
    expect(res.segments).toEqual([
      { startMin: 0, endMin: 480, type: 'outside_hours' },
      { startMin: 480, endMin: 1020, type: 'available', prevEventId: null, nextEventId: null },
      { startMin: 1020, endMin: 1440, type: 'outside_hours' },
    ]);
    expect(res.capacity).toEqual({ workingMin: 540, busyMin: 0, availableMin: 540 });
  });

  test('one event splits the window; gaps carry flanking event ids', () => {
    const res = compute({ events: [ev()] });                       // 9–10
    expect(res.segments).toEqual([
      { startMin: 0, endMin: 480, type: 'outside_hours' },
      { startMin: 480, endMin: 540, type: 'available', prevEventId: null, nextEventId: 'e1' },
      { startMin: 540, endMin: 600, type: 'busy' },
      { startMin: 600, endMin: 1020, type: 'available', prevEventId: 'e1', nextEventId: null },
      { startMin: 1020, endMin: 1440, type: 'outside_hours' },
    ]);
    expect(res.capacity).toEqual({ workingMin: 540, busyMin: 60, availableMin: 480 });
  });

  test('multiple events → alternating busy/available with correct ids', () => {
    const res = compute({
      events: [
        ev(),                                                                       // 9–10
        ev({ id: 'e2', start: perthIso(MON, 13), end: perthIso(MON, 14) }),         // 13–14
      ],
    });
    expect(spans(res, 'busy')).toEqual([[540, 600], [780, 840]]);
    const avail = segs(res, 'available');
    expect(avail).toEqual([
      { startMin: 480, endMin: 540, type: 'available', prevEventId: null, nextEventId: 'e1' },
      { startMin: 600, endMin: 780, type: 'available', prevEventId: 'e1', nextEventId: 'e2' },
      { startMin: 840, endMin: 1020, type: 'available', prevEventId: 'e2', nextEventId: null },
    ]);
    expect(res.capacity).toEqual({ workingMin: 540, busyMin: 120, availableMin: 420 });
  });

  test('full-day busy: an event covering the whole window leaves nothing', () => {
    const res = compute({ events: [ev({ start: perthIso(MON, 7), end: perthIso(MON, 18) })] });
    expect(spans(res, 'busy')).toEqual([[480, 1020]]);   // clipped to the window
    expect(segs(res, 'available')).toEqual([]);
    expect(res.capacity).toEqual({ workingMin: 540, busyMin: 540, availableMin: 0 });
  });

  test('mixed snake_case and camelCase events in one day both count', () => {
    const res = compute({
      events: [
        snakeEv(),                                                                              // 9–10
        ev({ id: 'e2', start: perthIso(MON, 11), end: perthIso(MON, 12) }),                     // 11–12
      ],
    });
    expect(spans(res, 'busy')).toEqual([[540, 600], [660, 720]]);
  });

  test('invalid date throws', () => {
    expect(() => A.computeDayAvailability({ date: 'nope' })).toThrow(/YYYY-MM-DD/);
    expect(() => A.computeDayAvailability({})).toThrow(/YYYY-MM-DD/);
  });
});

// ═══ Working hours and schedule ══════════════════════════════════════════════

describe('working hours and schedule', () => {
  test('an event entirely before the window does not reduce availability', () => {
    const res = compute({ events: [ev({ start: perthIso(MON, 6), end: perthIso(MON, 7) })] });
    expect(segs(res, 'busy')).toEqual([]);
    expect(spans(res, 'available')).toEqual([[480, 1020]]);
    expect(res.capacity).toEqual({ workingMin: 540, busyMin: 0, availableMin: 540 });
  });

  test('an event entirely after the window does not reduce availability', () => {
    const res = compute({ events: [ev({ start: perthIso(MON, 17, 30), end: perthIso(MON, 18, 30) })] });
    expect(segs(res, 'busy')).toEqual([]);
    expect(res.capacity.availableMin).toBe(540);
  });

  test('an event straddling the window start is clipped to it', () => {
    const res = compute({ events: [ev({ start: perthIso(MON, 7, 30), end: perthIso(MON, 8, 30) })] });
    expect(spans(res, 'busy')).toEqual([[480, 510]]);
    const avail = segs(res, 'available');
    expect(avail).toEqual([
      { startMin: 510, endMin: 1020, type: 'available', prevEventId: 'e1', nextEventId: null },
    ]);
  });

  test('weekSchedule missing the weekday → not_working full day', () => {
    const res = compute({ weekSchedule: { tue: 'office', wed: 'office' } });   // no mon
    expect(res.working).toBe(false);
    expect(res.segments).toEqual([{ startMin: 0, endMin: 1440, type: 'not_working' }]);
    expect(res.capacity).toEqual({ workingMin: 0, busyMin: 0, availableMin: 0 });
  });

  test('a weekend key present in weekSchedule means working that weekend day', () => {
    const res = compute({ date: SAT, weekSchedule: { sat: 'office' } });
    expect(res.working).toBe(true);
    expect(spans(res, 'available')).toEqual([[480, 1020]]);
  });

  test('scheduleKnown=false → assumed Mon–Fri and confidence default', () => {
    const monday = compute({ weekSchedule: null, scheduleKnown: false });
    expect(monday.working).toBe(true);
    expect(monday.availabilityConfidence).toBe('default');

    const saturday = compute({ date: SAT, weekSchedule: null, scheduleKnown: false });
    expect(saturday.working).toBe(false);
    expect(saturday.availabilityConfidence).toBe('default');

    const sunday = compute({ date: SUN, weekSchedule: null, scheduleKnown: false });
    expect(sunday.working).toBe(false);
  });

  test('scheduleKnown=true → confidence configured', () => {
    const res = compute({});
    expect(res.availabilityConfidence).toBe('configured');
  });

  test('empty weekSchedule falls back to Mon–Fri regardless of scheduleKnown', () => {
    const res = compute({ weekSchedule: {}, scheduleKnown: true });
    expect(res.working).toBe(true);
    expect(res.availabilityConfidence).toBe('configured');
  });
});

// ═══ Gap classification ══════════════════════════════════════════════════════

describe('gap classification', () => {
  // Two events: 9:00–10:00 and (10:00 + gap)–(11:00 + gap).
  const gapEvents = (gapMin) => [
    ev(),
    ev({ id: 'e2', start: perthIso(MON, 10, gapMin), end: perthIso(MON, 11, gapMin) }),
  ];

  test.each([
    [15, 'short_gap'],
    [30, 'available'],
    [60, 'available'],
  ])('a %i-minute gap is %s at the default 30-minute threshold', (gapMin, expected) => {
    const res = compute({ events: gapEvents(gapMin) });
    const between = res.segments.find((s) => s.startMin === 600);
    expect(between.type).toBe(expected);
    expect(between.endMin).toBe(600 + gapMin);
  });

  test('custom minDurationMin=45 demotes a 30-minute gap to short_gap', () => {
    const res = compute({ events: gapEvents(30), minDurationMin: 45 });
    expect(res.segments.find((s) => s.startMin === 600).type).toBe('short_gap');
  });

  test('custom minDurationMin=15 promotes a 15-minute gap to available', () => {
    const res = compute({ events: gapEvents(15), minDurationMin: 15 });
    const between = res.segments.find((s) => s.startMin === 600);
    expect(between.type).toBe('available');
    expect(between.prevEventId).toBe('e1');
    expect(between.nextEventId).toBe('e2');
  });

  test('short_gap minutes count toward neither busyMin nor availableMin', () => {
    const res = compute({ events: gapEvents(15) });
    expect(res.capacity.busyMin).toBe(120);
    expect(res.capacity.availableMin).toBe(540 - 120 - 15);
  });
});

// ═══ Overlap merging ═════════════════════════════════════════════════════════

describe('overlap merging', () => {
  test('spec example: 9:00–10:00 client + 9:30–10:30 meeting = one 9:00–10:30 block', () => {
    const res = compute({
      events: [ev(), ev({ id: 'e2', eventType: 'meeting', start: perthIso(MON, 9, 30), end: perthIso(MON, 10, 30) })],
    });
    expect(spans(res, 'busy')).toEqual([[540, 630]]);
    expect(res.capacity.busyMin).toBe(90);
    // The gap after the block flanks the event whose END closes it.
    expect(res.segments.find((s) => s.startMin === 630).prevEventId).toBe('e2');
  });

  test('a contained event disappears into its container', () => {
    const res = compute({
      events: [
        ev({ start: perthIso(MON, 9), end: perthIso(MON, 11) }),
        ev({ id: 'e2', start: perthIso(MON, 9, 30), end: perthIso(MON, 10) }),
      ],
    });
    expect(spans(res, 'busy')).toEqual([[540, 660]]);
    expect(res.segments.find((s) => s.startMin === 660).prevEventId).toBe('e1');
  });

  test('back-to-back events merge into a single busy segment', () => {
    const res = compute({
      events: [ev(), ev({ id: 'e2', start: perthIso(MON, 10), end: perthIso(MON, 11) })],
    });
    expect(segs(res, 'busy')).toHaveLength(1);
    expect(spans(res, 'busy')).toEqual([[540, 660]]);
  });
});

// ═══ Buffers ═════════════════════════════════════════════════════════════════

describe('buffers', () => {
  test('beforeMin carves a buffer ahead of the busy block', () => {
    const res = compute({ events: [ev()], buffers: { beforeMin: 15 } });
    expect(spans(res, 'buffer')).toEqual([[525, 540]]);
    expect(spans(res, 'available')).toEqual([[480, 525], [600, 1020]]);
    expect(res.capacity.availableMin).toBe(465);
  });

  test('afterMin carves a buffer behind the busy block', () => {
    const res = compute({ events: [ev()], buffers: { afterMin: 15 } });
    expect(spans(res, 'buffer')).toEqual([[600, 615]]);
    expect(res.capacity.availableMin).toBe(465);
  });

  test('both buffers apply; busyMin is unchanged by buffers', () => {
    const res = compute({ events: [ev()], buffers: { beforeMin: 15, afterMin: 15 } });
    expect(spans(res, 'buffer')).toEqual([[525, 540], [600, 615]]);
    expect(res.capacity).toEqual({ workingMin: 540, busyMin: 60, availableMin: 450 });
  });

  test('overlapping buffers between two events merge and consume the whole gap', () => {
    const res = compute({
      events: [ev(), ev({ id: 'e2', start: perthIso(MON, 10, 30), end: perthIso(MON, 11, 30) })],
      buffers: { beforeMin: 30, afterMin: 30 },
    });
    // after-buffer of e1 (600–630) and before-buffer of e2 (600–630) = ONE run.
    expect(res.segments.filter((s) => s.startMin >= 600 && s.endMin <= 630)).toEqual([
      { startMin: 600, endMin: 630, type: 'buffer' },
    ]);
    // No availability survives inside the 10:00–10:30 gap.
    expect(spans(res, 'available')).toEqual([[480, 510], [720, 1020]]);
  });

  test('buffers never extend outside the working window', () => {
    const early = compute({
      events: [ev({ start: perthIso(MON, 8), end: perthIso(MON, 9) })],
      buffers: { beforeMin: 30 },
    });
    expect(segs(early, 'buffer')).toEqual([]);              // 7:30–8:00 is outside_hours
    expect(early.segments.find((s) => s.startMin === 480).type).toBe('busy');

    const late = compute({
      events: [ev({ start: perthIso(MON, 16), end: perthIso(MON, 17) })],
      buffers: { afterMin: 30 },
    });
    expect(segs(late, 'buffer')).toEqual([]);               // 17:00–17:30 is outside_hours
    expect(late.segments.find((s) => s.endMin === 1020).type).toBe('busy');
  });

  test('buffers never overlap into other busy blocks (adjacent events)', () => {
    const res = compute({
      events: [ev(), ev({ id: 'e2', start: perthIso(MON, 10), end: perthIso(MON, 11) })],
      buffers: { beforeMin: 15, afterMin: 15 },
    });
    // One merged block 9–11 → buffers only at its outer edges.
    expect(spans(res, 'busy')).toEqual([[540, 660]]);
    expect(spans(res, 'buffer')).toEqual([[525, 540], [660, 675]]);
  });
});

// ═══ Leave ═══════════════════════════════════════════════════════════════════

describe('leave', () => {
  test('a full-day approved leave range makes the whole day leave, working:false', () => {
    const res = compute({ leaveRanges: [{ startDate: '2026-08-09', endDate: '2026-08-11' }] });
    expect(res.working).toBe(false);
    expect(res.segments).toEqual([{ startMin: 0, endMin: 1440, type: 'leave' }]);
    expect(res.capacity).toEqual({ workingMin: 0, busyMin: 0, availableMin: 0 });
  });

  test('leave range boundaries are inclusive', () => {
    const range = [{ startDate: MON, endDate: MON }];
    expect(compute({ leaveRanges: range }).working).toBe(false);
    expect(compute({ date: TUE, leaveRanges: range }).working).toBe(true);
  });

  test('a part-day leave event carves a leave segment, not busy', () => {
    const res = compute({
      events: [ev({ eventType: 'leave', start: perthIso(MON, 9), end: perthIso(MON, 12) })],
    });
    expect(res.working).toBe(true);
    expect(spans(res, 'leave')).toEqual([[540, 720]]);
    expect(segs(res, 'busy')).toEqual([]);
    expect(res.capacity).toEqual({ workingMin: 540, busyMin: 0, availableMin: 360 });
  });

  test('a leave event on a day already covered by a leave range is not double-counted', () => {
    const res = compute({
      events: [ev({ eventType: 'leave', start: perthIso(MON, 9), end: perthIso(MON, 12) })],
      leaveRanges: [{ startDate: MON, endDate: MON }],
    });
    // One full-day leave state — the same leave in both sources unions.
    expect(res.working).toBe(false);
    expect(res.segments).toEqual([{ startMin: 0, endMin: 1440, type: 'leave' }]);
  });

  test('overlapping leave events union into one leave segment', () => {
    const res = compute({
      events: [
        ev({ id: 'l1', eventType: 'leave', start: perthIso(MON, 9), end: perthIso(MON, 11) }),
        ev({ id: 'l2', eventType: 'leave', start: perthIso(MON, 10), end: perthIso(MON, 12) }),
      ],
    });
    expect(spans(res, 'leave')).toEqual([[540, 720]]);
  });

  test('busy wins where an appointment overlaps part-day leave (visible conflict)', () => {
    const res = compute({
      events: [
        ev({ id: 'l1', eventType: 'leave', start: perthIso(MON, 9), end: perthIso(MON, 12) }),
        ev({ id: 'e2', start: perthIso(MON, 11), end: perthIso(MON, 13) }),
      ],
    });
    expect(spans(res, 'leave')).toEqual([[540, 660]]);
    expect(spans(res, 'busy')).toEqual([[660, 780]]);
    expect(res.capacity.busyMin).toBe(120);
  });

  test('a weekend inside a leave range still reports not_working', () => {
    const res = compute({
      date: SAT,
      weekSchedule: null,
      scheduleKnown: false,
      leaveRanges: [{ startDate: '2026-08-10', endDate: '2026-08-21' }],
    });
    expect(res.working).toBe(false);
    expect(res.segments).toEqual([{ startMin: 0, endMin: 1440, type: 'not_working' }]);
  });
});

// ═══ Event states ════════════════════════════════════════════════════════════

describe('event states in day computation', () => {
  test('cancelled events (snake status) leave the day free', () => {
    const res = compute({ events: [snakeEv({ status: 'cancelled' })] });
    expect(spans(res, 'available')).toEqual([[480, 1020]]);
  });

  test('cancelled events (camel isCancelled) leave the day free', () => {
    const res = compute({ events: [ev({ isCancelled: true })] });
    expect(spans(res, 'available')).toEqual([[480, 1020]]);
  });

  test('deleted events (either casing) leave the day free', () => {
    const res = compute({ events: [snakeEv({ is_deleted: true }), ev({ isDeleted: true })] });
    expect(spans(res, 'available')).toEqual([[480, 1020]]);
  });

  test('a private Outlook event with NO title blocks the day without reading it', () => {
    const res = compute({ events: [privateOutlookEv()] });
    expect(spans(res, 'busy')).toEqual([[540, 600]]);
  });

  test.each([
    'travel', 'meeting', 'teams_meeting', 'lunch', 'cpd', 'admin', 'report', 'outlook', null,
  ])('event type %p produces a busy segment', (eventType) => {
    const res = compute({ events: [ev({ eventType })] });
    expect(spans(res, 'busy')).toEqual([[540, 600]]);
  });
});

// ═══ Intersection ════════════════════════════════════════════════════════════

describe('intersectAvailability', () => {
  test('two therapists → the common sub-windows, sorted, with durations', () => {
    const a = availSegs([540, 720], [780, 900]);
    const b = availSegs([600, 660], [840, 960]);
    expect(A.intersectAvailability([a, b], 30)).toEqual([
      { startMin: 600, endMin: 660, durationMin: 60 },
      { startMin: 840, endMin: 900, durationMin: 60 },
    ]);
  });

  test('three therapists narrow the windows further', () => {
    const a = availSegs([540, 720], [780, 900]);
    const b = availSegs([600, 660], [840, 960]);
    const c = availSegs([630, 870]);
    expect(A.intersectAvailability([a, b, c], 30)).toEqual([
      { startMin: 630, endMin: 660, durationMin: 30 },
      { startMin: 840, endMin: 870, durationMin: 30 },
    ]);
  });

  test('no overlap → empty', () => {
    expect(A.intersectAvailability([availSegs([540, 600]), availSegs([700, 760])], 30)).toEqual([]);
  });

  test('exact boundary touching is NOT an overlap', () => {
    expect(A.intersectAvailability([availSegs([540, 600]), availSegs([600, 660])], 30)).toEqual([]);
  });

  test('overlaps shorter than minDurationMin are filtered', () => {
    const arrays = [availSegs([540, 600]), availSegs([580, 640])];   // 20-minute overlap
    expect(A.intersectAvailability(arrays, 30)).toEqual([]);
    expect(A.intersectAvailability(arrays, 15)).toEqual([
      { startMin: 580, endMin: 600, durationMin: 20 },
    ]);
  });

  test('multiple common windows all come back, in order', () => {
    const a = availSegs([480, 540], [600, 720], [780, 1020]);
    const b = availSegs([480, 660], [750, 900]);
    expect(A.intersectAvailability([a, b], 30)).toEqual([
      { startMin: 480, endMin: 540, durationMin: 60 },
      { startMin: 600, endMin: 660, durationMin: 60 },
      { startMin: 780, endMin: 900, durationMin: 120 },
    ]);
  });

  test('non-available segments never participate', () => {
    const a = [
      { startMin: 0, endMin: 480, type: 'outside_hours' },
      { startMin: 480, endMin: 600, type: 'busy' },
      { startMin: 600, endMin: 700, type: 'available' },
    ];
    const b = [{ startMin: 480, endMin: 700, type: 'available' }];
    expect(A.intersectAvailability([a, b], 30)).toEqual([
      { startMin: 600, endMin: 700, durationMin: 100 },
    ]);
  });

  test('degenerate inputs: empty list → [], single therapist → own windows', () => {
    expect(A.intersectAvailability([], 30)).toEqual([]);
    expect(A.intersectAvailability([availSegs([540, 700], [800, 820])], 30)).toEqual([
      { startMin: 540, endMin: 700, durationMin: 160 },
    ]);
  });

  test('end-to-end: intersect two real computeDayAvailability outputs', () => {
    const tA = compute({ events: [ev({ id: 'a1' })] });                                        // busy 9–10
    const tB = compute({ events: [ev({ id: 'b1', start: perthIso(MON, 10, 30), end: perthIso(MON, 11, 30) })] });
    expect(A.intersectAvailability([tA.segments, tB.segments], 30)).toEqual([
      { startMin: 480, endMin: 540, durationMin: 60 },
      { startMin: 600, endMin: 630, durationMin: 30 },
      { startMin: 690, endMin: 1020, durationMin: 330 },
    ]);
  });
});

// ═══ Date / time handling ════════════════════════════════════════════════════

describe('date and time handling', () => {
  test('an event spanning midnight clamps to the start of the day', () => {
    const res = compute({
      workingHours: { startMin: 0, endMin: 1440 },
      events: [ev({ start: perthIso('2026-08-09', 22), end: perthIso(MON, 2) })],
    });
    expect(spans(res, 'busy')).toEqual([[0, 120]]);
  });

  test('an event running past midnight clamps to the end of the day', () => {
    const res = compute({
      workingHours: { startMin: 0, endMin: 1440 },
      events: [ev({ start: perthIso(MON, 23), end: perthIso(TUE, 1) })],
    });
    expect(spans(res, 'busy')).toEqual([[1380, 1440]]);
  });

  test('an overnight event still blocks the in-window morning portion', () => {
    const res = compute({ events: [ev({ start: perthIso('2026-08-09', 20), end: perthIso(MON, 9) })] });
    expect(spans(res, 'busy')).toEqual([[480, 540]]);
    expect(spans(res, 'available')).toEqual([[540, 1020]]);
  });

  test('an event entirely on another day is excluded', () => {
    const res = compute({ events: [ev({ start: perthIso(TUE, 9), end: perthIso(TUE, 10) })] });
    expect(segs(res, 'busy')).toEqual([]);
    expect(res.capacity.availableMin).toBe(540);
  });

  test('tzOffsetMin drives the conversion — Adelaide wall clock at +9:30', () => {
    const res = compute({
      tzOffsetMin: 570,
      events: [ev({ start: zoneIso(MON, 9, 0, 570), end: zoneIso(MON, 10, 0, 570) })],
    });
    expect(spans(res, 'busy')).toEqual([[540, 600]]);
  });

  test('the same UTC instant lands differently under a different offset', () => {
    const iso = perthIso(MON, 9);                       // 09:00 Perth = 01:00 UTC
    const perth = compute({ events: [ev({ start: iso, end: perthIso(MON, 10) })] });
    expect(spans(perth, 'busy')).toEqual([[540, 600]]); // 9:00–10:00 local
    const adelaide = compute({
      tzOffsetMin: 570,
      events: [ev({ start: iso, end: perthIso(MON, 10) })],
    });
    expect(spans(adelaide, 'busy')).toEqual([[630, 690]]);   // 10:30–11:30 local
  });
});

// ═══ Capacity + tiling ═══════════════════════════════════════════════════════

describe('capacity accounting', () => {
  test('a mixed day sums exactly: busy + buffer + short_gap + available = window', () => {
    const res = compute({
      events: [
        ev(),                                                                       // 9:00–10:00
        ev({ id: 'e2', start: perthIso(MON, 10, 30), end: perthIso(MON, 11) }),     // 10:30–11:00
      ],
      buffers: { afterMin: 15 },
    });
    expect(res.segments).toEqual([
      { startMin: 0, endMin: 480, type: 'outside_hours' },
      { startMin: 480, endMin: 540, type: 'available', prevEventId: null, nextEventId: 'e1' },
      { startMin: 540, endMin: 600, type: 'busy' },
      { startMin: 600, endMin: 615, type: 'buffer' },
      { startMin: 615, endMin: 630, type: 'short_gap' },
      { startMin: 630, endMin: 660, type: 'busy' },
      { startMin: 660, endMin: 675, type: 'buffer' },
      { startMin: 675, endMin: 1020, type: 'available', prevEventId: 'e2', nextEventId: null },
      { startMin: 1020, endMin: 1440, type: 'outside_hours' },
    ]);
    expect(res.capacity).toEqual({ workingMin: 540, busyMin: 90, availableMin: 405 });
  });

  test('capacity is zero on non-working and full-day-leave days', () => {
    expect(compute({ weekSchedule: { tue: 'office' } }).capacity)
      .toEqual({ workingMin: 0, busyMin: 0, availableMin: 0 });
    expect(compute({ leaveRanges: [{ startDate: MON, endDate: MON }] }).capacity)
      .toEqual({ workingMin: 0, busyMin: 0, availableMin: 0 });
  });

  test('workingMin reflects custom working hours', () => {
    const res = compute({ workingHours: { startMin: 540, endMin: 900 } });   // 9:00–15:00
    expect(res.capacity).toEqual({ workingMin: 360, busyMin: 0, availableMin: 360 });
    expect(spans(res, 'available')).toEqual([[540, 900]]);
  });

  test('segments always tile 0–1440 even on a dense, messy day', () => {
    // The compute() wrapper asserts tiling on every case in this file;
    // this one just piles everything on at once.
    compute({
      events: [
        snakeEv(),
        ev({ id: 'e2', start: perthIso(MON, 9, 45), end: perthIso(MON, 10, 15) }),
        ev({ id: 'e3', eventType: 'leave', start: perthIso(MON, 12), end: perthIso(MON, 13) }),
        ev({ id: 'e4', eventType: 'travel', start: perthIso(MON, 14), end: perthIso(MON, 14, 20) }),
        ev({ id: 'e5', isCancelled: true, start: perthIso(MON, 15), end: perthIso(MON, 16) }),
        ev({ id: 'e6', start: perthIso('2026-08-09', 23), end: perthIso(MON, 1) }),
      ],
      buffers: { beforeMin: 10, afterMin: 10 },
    });
  });
});
