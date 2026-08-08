'use strict';

/**
 * FIND AVAILABILITY — Phase 3 candidate-matching tests for the pure
 * classification layer in backend/availability-engine.js
 * (classifyCandidate / rangeWindows / nearestAlternatives /
 * sortCandidates). Every therapistResult fixture is built by calling the
 * REAL computeDayAvailability with synthetic events — no hand-rolled
 * segment arrays — so the matcher is always tested against genuine engine
 * output.
 */

const A = require('../availability-engine');

// Build an ISO instant from wall-clock time at an arbitrary UTC offset.
const zoneIso = (ymd, hh, mm, offsetMin) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) - offsetMin * 60000 + (hh * 60 + mm) * 60000).toISOString();

// Perth = UTC+8 (same helper shape as tests/availability-engine.test.js).
const perthIso = (ymd, hh, mm = 0) => zoneIso(ymd, hh, mm, 480);

const MON = '2026-08-10';   // Monday
const SAT = '2026-08-15';

const ev = (over = {}) => Object.assign({
  id: 'e1',
  start: perthIso(MON, 9),
  end: perthIso(MON, 10),
  eventType: 'therapy',
  isDeleted: false,
  isCancelled: false,
}, over);

const baseOpts = (over = {}) => Object.assign({
  date: MON,
  events: [],
  weekSchedule: { mon: 'office', tue: 'office', wed: 'home-1', thu: 'office', fri: 'office' },
  workingHours: { startMin: 480, endMin: 1020 },   // 08:00–17:00
  leaveRanges: [],
  buffers: {},
  minDurationMin: 30,
  scheduleKnown: true,
}, over);

// Wrap a REAL engine result into the route-level therapistResult shape.
const asTherapist = (res, over = {}) => Object.assign({
  therapistProfileId: 'tp1',
  displayName: 'Alice Chen',
  roleTitle: 'Occupational Therapist',
  colour: '#7c5cff',
  working: res.working,
  workingHoursSource: res.workingHoursSource,
  availabilityConfidence: res.availabilityConfidence,
  capacity: res.capacity,
  segments: res.segments,
}, over);

const day = (computeOver = {}, therapistOver = {}) =>
  asTherapist(A.computeDayAvailability(baseOpts(computeOver)), therapistOver);

// ═══ classifyCandidate — exact-mode fits ═════════════════════════════════════

describe('classifyCandidate: fits', () => {
  test('exact fit on a free day returns the FULL containing window', () => {
    const c = A.classifyCandidate(day(), { startMin: 600, durationMin: 60 });
    expect(c).toEqual({
      therapistProfileId: 'tp1',
      displayName: 'Alice Chen',
      roleTitle: 'Occupational Therapist',
      colour: '#7c5cff',
      workingHoursSource: 'organisation_default',
      availabilityConfidence: 'configured',
      requestedSlotFits: true,
      status: 'available',
      reason: null,
      window: { startMin: 480, endMin: 1020 },
      windowMin: 540,
      availableMin: null,
      busyUntilMin: null,
    });
  });

  test('full-day free: the whole working window fits as one request', () => {
    const c = A.classifyCandidate(day(), { startMin: 480, durationMin: 540 });
    expect(c.requestedSlotFits).toBe(true);
    expect(c.window).toEqual({ startMin: 480, endMin: 1020 });
    expect(c.windowMin).toBe(540);
  });

  test('partial-day: afternoon request fits the post-event window', () => {
    // 8:00–12:00 busy → available 12:00–17:00.
    const t = day({ events: [ev({ start: perthIso(MON, 8), end: perthIso(MON, 12) })] });
    const c = A.classifyCandidate(t, { startMin: 780, durationMin: 60 });   // 13:00–14:00
    expect(c.status).toBe('available');
    expect(c.window).toEqual({ startMin: 720, endMin: 1020 });
    expect(c.windowMin).toBe(300);
  });

  test('boundary touch: request 10:00–11:00 fits when available is exactly 10:00–11:00', () => {
    // Events 9–10 and 11–12 leave exactly [600, 660] available.
    const t = day({
      events: [ev(), ev({ id: 'e2', start: perthIso(MON, 11), end: perthIso(MON, 12) })],
    });
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 60 });
    expect(c.requestedSlotFits).toBe(true);
    expect(c.window).toEqual({ startMin: 600, endMin: 660 });
    expect(c.windowMin).toBe(60);
  });

  test.each([30, 45, 60, 90, 120])(
    'a %i-minute request starting 10:00 fits a 10:00–12:00 window',
    (durationMin) => {
      // Events 9–10 and 12–13 leave [600, 720] available.
      const t = day({
        events: [ev(), ev({ id: 'e2', start: perthIso(MON, 12), end: perthIso(MON, 13) })],
      });
      const c = A.classifyCandidate(t, { startMin: 600, durationMin });
      expect(c.requestedSlotFits).toBe(true);
      expect(c.status).toBe('available');
      expect(c.window).toEqual({ startMin: 600, endMin: 720 });
      expect(c.windowMin).toBe(120);
    });
});

// ═══ classifyCandidate — too_short ═══════════════════════════════════════════

describe('classifyCandidate: too_short', () => {
  test('boundary miss: available 10:00–10:59 cannot hold 10:00–11:00', () => {
    // Events 9–10 and 10:59–12 leave [600, 659] available (59 >= minDuration 30).
    const t = day({
      events: [ev(), ev({ id: 'e2', start: perthIso(MON, 10, 59), end: perthIso(MON, 12) })],
    });
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 60 });
    expect(c.requestedSlotFits).toBe(false);
    expect(c.status).toBe('unavailable');
    expect(c.reason).toBe('too_short');
    expect(c.availableMin).toBe(59);
    expect(c.window).toBeNull();
    expect(c.windowMin).toBeNull();
    expect(c.busyUntilMin).toBeNull();
  });

  test('duration exceeds the segment: 90 minutes into a 60-minute window', () => {
    // Events 9–10 and 11–12 leave exactly [600, 660] available.
    const t = day({
      events: [ev(), ev({ id: 'e2', start: perthIso(MON, 11), end: perthIso(MON, 12) })],
    });
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 90 });
    expect(c.reason).toBe('too_short');
    expect(c.availableMin).toBe(60);
  });

  test('150 minutes into a 120-minute window is too_short with availableMin 120', () => {
    const t = day({
      events: [ev(), ev({ id: 'e2', start: perthIso(MON, 12), end: perthIso(MON, 13) })],
    });
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 150 });
    expect(c.reason).toBe('too_short');
    expect(c.availableMin).toBe(120);
  });

  test('free but ending earlier: start is in available time that runs out', () => {
    // Busy 10:30–17:00 → available [480, 630]; request 10:00–11:00 starts free
    // but the segment cannot hold the full hour.
    const t = day({ events: [ev({ start: perthIso(MON, 10, 30), end: perthIso(MON, 17) })] });
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 60 });
    expect(c.reason).toBe('too_short');
    expect(c.availableMin).toBe(150);        // the overlapping available segment's full length
    expect(c.busyUntilMin).toBeNull();
  });
});

// ═══ classifyCandidate — busy / busyUntilMin ═════════════════════════════════

describe('classifyCandidate: busy and busyUntilMin', () => {
  test('free but starting later: busy at the requested start, free from 10:30', () => {
    const t = day({ events: [ev({ start: perthIso(MON, 9), end: perthIso(MON, 10, 30) })] });
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 60 });
    expect(c.requestedSlotFits).toBe(false);
    expect(c.reason).toBe('busy');
    expect(c.busyUntilMin).toBe(630);        // 10:30 — next moment they stop being blocked
    expect(c.availableMin).toBeNull();
    expect(c.window).toBeNull();
  });

  test('buffers inherited: afterMin 15 makes a 10:00 start busy until 10:15', () => {
    // 9–10 event + 15-minute after-buffer → buffer [600, 615]; the request
    // start lands in the buffer the ENGINE carved — never re-derived here.
    const t = day({ events: [ev()], buffers: { afterMin: 15 } });
    expect(t.segments).toContainEqual({ startMin: 600, endMin: 615, type: 'buffer' });
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 60 });
    expect(c.reason).toBe('busy');
    expect(c.busyUntilMin).toBe(615);        // 10:15
    // Sanity: 10:15 itself fits.
    const ok = A.classifyCandidate(t, { startMin: 615, durationMin: 60 });
    expect(ok.requestedSlotFits).toBe(true);
    expect(ok.window).toEqual({ startMin: 615, endMin: 1020 });
  });

  test('the walk crosses a busy → short_gap → busy run to the next available boundary', () => {
    // 9–10 and 10:15–11 leave a 15-minute short_gap between two busy blocks.
    const t = day({
      events: [ev(), ev({ id: 'e2', start: perthIso(MON, 10, 15), end: perthIso(MON, 11) })],
    });
    expect(t.segments).toContainEqual({ startMin: 600, endMin: 615, type: 'short_gap' });
    const c = A.classifyCandidate(t, { startMin: 570, durationMin: 60 });   // 9:30–10:30
    expect(c.reason).toBe('busy');
    expect(c.busyUntilMin).toBe(660);        // 11:00 — through busy, short_gap, busy
  });

  test('part-day leave at the start is busy (working day) and the walk crosses it', () => {
    const t = day({
      events: [ev({ eventType: 'leave', start: perthIso(MON, 9), end: perthIso(MON, 12) })],
    });
    expect(t.working).toBe(true);
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 60 });
    expect(c.reason).toBe('busy');
    expect(c.busyUntilMin).toBe(720);        // 12:00 — leave segments block the walk too
  });

  test('blocked to the end of the window → busyUntilMin null', () => {
    // Busy 15:00–17:00 runs to the window edge; a 15:30 request never unblocks.
    const t = day({ events: [ev({ start: perthIso(MON, 15), end: perthIso(MON, 17) })] });
    const c = A.classifyCandidate(t, { startMin: 930, durationMin: 60 });
    expect(c.reason).toBe('busy');
    expect(c.busyUntilMin).toBeNull();
  });
});

// ═══ classifyCandidate — day-level reasons ═══════════════════════════════════

describe('classifyCandidate: leave / not_working / outside_hours', () => {
  test('a full-day approved leave range → reason leave', () => {
    const t = day({ leaveRanges: [{ startDate: MON, endDate: MON }] });
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 60 });
    expect(c).toMatchObject({
      requestedSlotFits: false,
      status: 'unavailable',
      reason: 'leave',
      window: null,
      windowMin: null,
      availableMin: null,
      busyUntilMin: null,
    });
  });

  test('weekSchedule without the weekday → reason not_working', () => {
    const t = day({ weekSchedule: { tue: 'office', wed: 'office' } });   // no mon
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 60 });
    expect(c.reason).toBe('not_working');
    expect(c.status).toBe('unavailable');
  });

  test('a request entirely before the window → outside_hours', () => {
    const c = A.classifyCandidate(day(), { startMin: 420, durationMin: 30 });   // 7:00–7:30
    expect(c.reason).toBe('outside_hours');
  });

  test('a request entirely after the window → outside_hours', () => {
    const c = A.classifyCandidate(day(), { startMin: 1050, durationMin: 30 });  // 17:30–18:00
    expect(c.reason).toBe('outside_hours');
  });

  test('a request ending exactly at window start is still outside_hours', () => {
    const c = A.classifyCandidate(day(), { startMin: 420, durationMin: 60 });   // 7:00–8:00
    expect(c.reason).toBe('outside_hours');
  });
});

// ═══ classifyCandidate — passthrough + guards ════════════════════════════════

describe('classifyCandidate: provenance passthrough', () => {
  test('identity fields pass through untouched', () => {
    const t = day({}, {
      therapistProfileId: 'tp-42',
      displayName: 'Ben Ojo',
      roleTitle: 'Speech Pathologist',
      colour: '#00a884',
    });
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 60 });
    expect(c.therapistProfileId).toBe('tp-42');
    expect(c.displayName).toBe('Ben Ojo');
    expect(c.roleTitle).toBe('Speech Pathologist');
    expect(c.colour).toBe('#00a884');
  });

  test('confidence flags pass through: configured (known schedule)', () => {
    const c = A.classifyCandidate(day(), { startMin: 600, durationMin: 60 });
    expect(c.availabilityConfidence).toBe('configured');
    expect(c.workingHoursSource).toBe('organisation_default');
  });

  test('confidence flags pass through: default (assumed Mon–Fri), fitting', () => {
    const t = day({ weekSchedule: null, scheduleKnown: false });
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 60 });
    expect(c.requestedSlotFits).toBe(true);
    expect(c.availabilityConfidence).toBe('default');
  });

  test('confidence flags pass through on an unavailable day too', () => {
    const t = day({ date: SAT, weekSchedule: null, scheduleKnown: false });
    const c = A.classifyCandidate(t, { startMin: 600, durationMin: 60 });
    expect(c.reason).toBe('not_working');
    expect(c.availabilityConfidence).toBe('default');
    expect(c.workingHoursSource).toBe('organisation_default');
  });

  test('an invalid request throws', () => {
    expect(() => A.classifyCandidate(day(), {})).toThrow(/startMin/);
    expect(() => A.classifyCandidate(day(), { startMin: 600, durationMin: 0 })).toThrow(/durationMin/);
  });
});

// ═══ rangeWindows ════════════════════════════════════════════════════════════

describe('rangeWindows', () => {
  // 9–10 event → available [480, 540] and [600, 1020].
  const oneEventDay = () => day({ events: [ev()] });

  test('clips available segments to the range at both ends', () => {
    expect(A.rangeWindows(oneEventDay(), 510, 900, 30)).toEqual([
      { startMin: 510, endMin: 540, durationMin: 30 },
      { startMin: 600, endMin: 900, durationMin: 300 },
    ]);
  });

  test('drops clips shorter than the requested duration', () => {
    expect(A.rangeWindows(oneEventDay(), 510, 900, 45)).toEqual([
      { startMin: 600, endMin: 900, durationMin: 300 },
    ]);
  });

  test('a full-day range returns the available segments as-is', () => {
    expect(A.rangeWindows(oneEventDay(), 0, 1440, 30)).toEqual([
      { startMin: 480, endMin: 540, durationMin: 60 },
      { startMin: 600, endMin: 1020, durationMin: 420 },
    ]);
  });

  test('windows, not permutations: one long window comes back as ONE entry', () => {
    // A 540-minute window with durationMin 60 is one window — not 480/1020
    // sliding starts.
    expect(A.rangeWindows(day(), 480, 1020, 60)).toEqual([
      { startMin: 480, endMin: 1020, durationMin: 540 },
    ]);
  });

  test('a range inside one segment clips to the range itself', () => {
    expect(A.rangeWindows(day(), 600, 700, 60)).toEqual([
      { startMin: 600, endMin: 700, durationMin: 100 },
    ]);
    expect(A.rangeWindows(day(), 600, 700, 120)).toEqual([]);   // clip too short
  });

  test('a range covering only busy time → empty', () => {
    expect(A.rangeWindows(oneEventDay(), 540, 600, 30)).toEqual([]);
  });

  test('non-working and leave days have no windows', () => {
    expect(A.rangeWindows(day({ weekSchedule: { tue: 'office' } }), 0, 1440, 30)).toEqual([]);
    expect(A.rangeWindows(day({ leaveRanges: [{ startDate: MON, endDate: MON }] }), 0, 1440, 30)).toEqual([]);
  });
});

// ═══ nearestAlternatives ═════════════════════════════════════════════════════

describe('nearestAlternatives', () => {
  const request = { startMin: 600, durationMin: 60 };   // 10:00–11:00

  test('finds the nearest earlier AND later starts, sorted by |delta|', () => {
    // Busy 9:30–11:00 → available [480, 570] and [660, 1020].
    const t = day({ events: [ev({ start: perthIso(MON, 9, 30), end: perthIso(MON, 11) })] });
    expect(A.nearestAlternatives([t], request)).toEqual([
      { therapistProfileId: 'tp1', displayName: 'Alice Chen', colour: '#7c5cff', startMin: 660, endMin: 720, deltaMin: 60 },
      { therapistProfileId: 'tp1', displayName: 'Alice Chen', colour: '#7c5cff', startMin: 510, endMin: 570, deltaMin: -90 },
    ]);
  });

  test('equidistant earlier/later → both listed, stable order (earlier first)', () => {
    // Busy 9:30–11:30 → earlier start 8:30 (-90) and later start 11:30 (+90).
    const t = day({ events: [ev({ start: perthIso(MON, 9, 30), end: perthIso(MON, 11, 30) })] });
    const alts = A.nearestAlternatives([t], request);
    expect(alts.map((a) => [a.startMin, a.deltaMin])).toEqual([[510, -90], [690, 90]]);
  });

  test('a later start on an odd minute snaps to 5-minute granularity', () => {
    // Busy 9:00–10:07 → free from 10:07; 10:05 is inside the busy block so
    // the suggestion snaps to 10:10.
    const t = day({ events: [ev({ start: perthIso(MON, 9), end: perthIso(MON, 10, 7) })] });
    const alts = A.nearestAlternatives([t], request);
    expect(alts[0]).toMatchObject({ startMin: 610, endMin: 670, deltaMin: 10 });
  });

  test('an earlier start on an odd minute snaps to 5-minute granularity', () => {
    // Busy 10:58–17:00 → latest valid hour starts 9:58; 10:00 would overrun,
    // so the suggestion snaps to 9:55.
    const t = day({ events: [ev({ start: perthIso(MON, 10, 58), end: perthIso(MON, 17) })] });
    expect(A.nearestAlternatives([t], { startMin: 660, durationMin: 60 })).toEqual([
      { therapistProfileId: 'tp1', displayName: 'Alice Chen', colour: '#7c5cff', startMin: 595, endMin: 655, deltaMin: -65 },
    ]);
  });

  test('maxPerDirection bounds suggestions per therapist per direction', () => {
    // Busy 8–10 and 11–12 → later windows [600, 660] and [720, 1020]; no
    // earlier availability at all for a 9:10 request.
    const t = day({
      events: [
        ev({ start: perthIso(MON, 8), end: perthIso(MON, 10) }),
        ev({ id: 'e2', start: perthIso(MON, 11), end: perthIso(MON, 12) }),
      ],
    });
    const req = { startMin: 550, durationMin: 60 };
    expect(A.nearestAlternatives([t], req)).toEqual([
      { therapistProfileId: 'tp1', displayName: 'Alice Chen', colour: '#7c5cff', startMin: 600, endMin: 660, deltaMin: 50 },
    ]);
    expect(A.nearestAlternatives([t], req, 2).map((a) => a.startMin)).toEqual([600, 720]);
  });

  test('the flat list is capped at 6 across therapists, still sorted by |delta|', () => {
    // Four therapists, each contributing +60 and -90 → 8 candidates, cap 6.
    const therapists = ['t1', 't2', 't3', 't4'].map((id) =>
      day(
        { events: [ev({ start: perthIso(MON, 9, 30), end: perthIso(MON, 11) })] },
        { therapistProfileId: id, displayName: `Therapist ${id}` },
      ));
    const alts = A.nearestAlternatives(therapists, request);
    expect(alts).toHaveLength(6);
    expect(alts.map((a) => a.deltaMin)).toEqual([60, 60, 60, 60, -90, -90]);
    expect(alts.map((a) => a.therapistProfileId)).toEqual(['t1', 't2', 't3', 't4', 't1', 't2']);
  });

  test('empty when nothing fits anywhere', () => {
    // Fully-busy day: no available segments at all.
    const busyDay = day({ events: [ev({ start: perthIso(MON, 8), end: perthIso(MON, 17) })] });
    expect(A.nearestAlternatives([busyDay], request)).toEqual([]);
    // Free day, but the duration exceeds every segment.
    expect(A.nearestAlternatives([day()], { startMin: 600, durationMin: 600 })).toEqual([]);
    // Non-working therapists contribute nothing.
    expect(A.nearestAlternatives([day({ weekSchedule: { tue: 'office' } })], request)).toEqual([]);
  });
});

// ═══ sortCandidates ══════════════════════════════════════════════════════════

describe('sortCandidates', () => {
  test('orders by fits first, then windowMin desc, then displayName asc', () => {
    const request = { startMin: 780, durationMin: 60 };   // 13:00–14:00
    const eightToNoon = [ev({ start: perthIso(MON, 8), end: perthIso(MON, 12) })];
    const cara = A.classifyCandidate(day({}, { displayName: 'Cara' }), request);              // windowMin 540
    const bea = A.classifyCandidate(day({ events: eightToNoon }, { displayName: 'Bea' }), request);    // 300
    const alice = A.classifyCandidate(day({ events: eightToNoon }, { displayName: 'Alice' }), request); // 300
    // A future mixed list may hold non-fitting rows: they sort last even
    // with a huge window.
    const nonFit = { requestedSlotFits: false, windowMin: 900, displayName: 'Aaron' };

    const sorted = A.sortCandidates([nonFit, bea, cara, alice]);
    expect(sorted.map((c) => c.displayName)).toEqual(['Cara', 'Alice', 'Bea', 'Aaron']);
  });

  test('does not mutate the input array', () => {
    const request = { startMin: 600, durationMin: 30 };
    const a = A.classifyCandidate(day({}, { displayName: 'Zed' }), request);
    const b = A.classifyCandidate(day({ events: [ev()] }, { displayName: 'Amy' }), request);
    const input = [b, a];
    const sorted = A.sortCandidates(input);
    expect(input.map((c) => c.displayName)).toEqual(['Amy', 'Zed']);
    expect(sorted).not.toBe(input);
    expect(sorted.map((c) => c.displayName)).toEqual(['Zed', 'Amy']);
  });
});
