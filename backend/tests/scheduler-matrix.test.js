/**
 * Master Scheduler free/busy MATRIX logic (Scheduling-Assistant pivot).
 *
 * The horizontal matrix derives everything from canonical availability
 * segments; these pure helpers decide what a row paints and what a proposed
 * slot means for each therapist. No DOM, no network.
 */

'use strict';

const H = require('../../frontend/current/scheduler.js');

// Segment factory: tile a day from typed runs.
function segs(runs) {
  return runs.map(([startMin, endMin, type]) => ({ startMin, endMin, type }));
}

const WORK_DAY = segs([
  [0, 480, 'outside_hours'],
  [480, 600, 'busy'],          // 8:00–10:00 booked
  [600, 615, 'buffer'],
  [615, 720, 'available'],     // 10:15–12:00 open
  [720, 750, 'short_gap'],
  [750, 870, 'busy'],          // 12:30–14:30 booked
  [870, 1020, 'available'],    // 14:30–17:00 open
  [1020, 1440, 'outside_hours'],
]);

describe('matrix window (zoom / working-day bounds)', () => {
  test('working-day zoom hugs org bounds with an hour of context', () => {
    const w = H.matrixWindow('work', { startMin: 480, endMin: 1020 });
    expect(w).toEqual({ startMin: 420, endMin: 1080 }); // 7am–6pm
  });
  test('full-day zoom shows midnight to midnight', () => {
    expect(H.matrixWindow('full', { startMin: 480, endMin: 1020 })).toEqual({ startMin: 0, endMin: 1440 });
  });
  test('missing org config falls back to a sane window', () => {
    const w = H.matrixWindow('work', null);
    expect(w.startMin).toBeLessThanOrEqual(480);
    expect(w.endMin).toBeGreaterThanOrEqual(1020);
  });
});

describe('track paint (simplified availability visual language)', () => {
  test('available time gets NO paint — clean background communicates it', () => {
    const runs = H.trackPaint({ segments: WORK_DAY });
    expect(runs.every((r) => r.cls !== 'available')).toBe(true);
  });
  test('outside hours and not_working wash muted', () => {
    const runs = H.trackPaint({ segments: WORK_DAY });
    expect(runs[0]).toMatchObject({ startMin: 0, endMin: 480, cls: 'off' });
    expect(runs[runs.length - 1]).toMatchObject({ startMin: 1020, endMin: 1440, cls: 'off' });
  });
  test('leave paints its own distinct run', () => {
    const runs = H.trackPaint({ segments: segs([[0, 480, 'outside_hours'], [480, 1020, 'leave'], [1020, 1440, 'outside_hours']]) });
    expect(runs.find((r) => r.cls === 'leave')).toMatchObject({ startMin: 480, endMin: 1020 });
  });
  test('adjacent same-class segments merge into one run', () => {
    const runs = H.trackPaint({ segments: segs([[0, 240, 'outside_hours'], [240, 480, 'not_working'], [480, 1440, 'available']]) });
    expect(runs).toEqual([{ startMin: 0, endMin: 480, cls: 'off' }]);
  });
  test('busy paints nothing — the event block carries it', () => {
    const runs = H.trackPaint({ segments: WORK_DAY });
    expect(runs.some((r) => r.startMin === 480 && r.endMin === 600)).toBe(false);
  });
  test('no availability data paints nothing', () => {
    expect(H.trackPaint(null)).toEqual([]);
    expect(H.trackPaint({ segments: [] })).toEqual([]);
  });
});

describe('slot verdict (proposed band vs one therapist)', () => {
  test('fully inside an available window: available', () => {
    expect(H.slotVerdict({ segments: WORK_DAY }, 615, 60)).toEqual({ state: 'available', label: 'Available' });
  });
  test('overlapping a busy block: conflict', () => {
    expect(H.slotVerdict({ segments: WORK_DAY }, 570, 60).state).toBe('conflict');
  });
  test('exact boundary — slot ending where busy starts is available', () => {
    expect(H.slotVerdict({ segments: WORK_DAY }, 690, 30).state).toBe('available'); // 11:30–12:00
  });
  test('exact boundary — slot starting where busy ends conflicts only via buffer', () => {
    const v = H.slotVerdict({ segments: WORK_DAY }, 600, 15); // exactly the buffer
    expect(v).toEqual({ state: 'conflict', label: 'Buffer time' });
  });
  test('leave day reads as On leave, not generic busy', () => {
    const leaveDay = { segments: segs([[0, 1440, 'leave']]) };
    expect(H.slotVerdict(leaveDay, 600, 60)).toEqual({ state: 'conflict', label: 'On leave' });
  });
  test('not scheduled to work: outside state with Not working label', () => {
    const off = { segments: segs([[0, 1440, 'not_working']]) };
    expect(H.slotVerdict(off, 600, 60)).toEqual({ state: 'outside', label: 'Not working' });
  });
  test('outside configured hours: outside state', () => {
    expect(H.slotVerdict({ segments: WORK_DAY }, 300, 60)).toEqual({ state: 'outside', label: 'Outside working hours' });
  });
  test('busy outranks outside hours when the slot spans both', () => {
    expect(H.slotVerdict({ segments: WORK_DAY }, 450, 60).label).toBe('Busy');
  });
  test('short gap alone is an honest conflict (not enough free time)', () => {
    expect(H.slotVerdict({ segments: WORK_DAY }, 720, 30)).toEqual({ state: 'conflict', label: 'Not enough free time' });
  });
  test('no data: unknown, never silently available', () => {
    expect(H.slotVerdict(null, 600, 60).state).toBe('unknown');
    expect(H.slotVerdict({ segments: [] }, 600, 60).state).toBe('unknown');
  });
});

describe('common-free windows (client-side mirror of the engine)', () => {
  const A = { segments: WORK_DAY };                                       // 10:15–12:00, 14:30–17:00
  const B = { segments: segs([[0, 480, 'outside_hours'], [480, 660, 'available'], [660, 900, 'busy'], [900, 1020, 'available'], [1020, 1440, 'outside_hours']]) }; // 8–11, 15–17

  test('two therapists: strict intersection', () => {
    expect(H.commonFreeWindows([A, B], 30)).toEqual([
      { startMin: 615, endMin: 660 },   // 10:15–11:00
      { startMin: 900, endMin: 1020 },  // 15:00–17:00
    ]);
  });
  test('minimum duration filters slivers', () => {
    expect(H.commonFreeWindows([A, B], 60)).toEqual([{ startMin: 900, endMin: 1020 }]);
  });
  test('one therapist: their own available windows', () => {
    expect(H.commonFreeWindows([A], 30).length).toBe(2);
  });
  test('a fully-booked participant empties the intersection', () => {
    const booked = { segments: segs([[0, 1440, 'busy']]) };
    expect(H.commonFreeWindows([A, B, booked], 15)).toEqual([]);
  });
  test('touching windows do not count as overlap', () => {
    const X = { segments: segs([[0, 600, 'available'], [600, 1440, 'busy']]) };
    const Y = { segments: segs([[0, 600, 'busy'], [600, 1440, 'available']]) };
    expect(H.commonFreeWindows([X, Y], 15)).toEqual([]);
  });
  test('empty input: no windows', () => {
    expect(H.commonFreeWindows([], 30)).toEqual([]);
  });
});

describe('therapist search filter', () => {
  const list = [
    { displayName: 'Maya Chen', roleTitle: 'Occupational Therapist' },
    { displayName: 'Tom Rivera', roleTitle: 'Speech Pathologist' },
  ];
  test('matches name fragments case-insensitively', () => {
    expect(H.searchTherapists(list, 'maya').length).toBe(1);
  });
  test('matches discipline text too', () => {
    expect(H.searchTherapists(list, 'speech')[0].displayName).toBe('Tom Rivera');
  });
  test('empty query returns everyone', () => {
    expect(H.searchTherapists(list, '  ').length).toBe(2);
  });
});
