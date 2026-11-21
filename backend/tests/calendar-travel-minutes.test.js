'use strict';

/** The calendar's travel minutes kept for invoicing (billing/calendar-travel-minutes.js, migration 090). */
const C = require('../billing/calendar-travel-minutes');

const NOW = new Date('2026-11-21T02:00:00Z'); // Sat 21 Nov 2026, 10:00 Perth
const EV = '11111111-2222-4333-8444-555555555555';
const leg = (o) => ({ origin: '1 Hay St, Perth WA 6000', destination: '5 Main St, Joondalup WA 6027', minutes: 34, ownerEventId: EV, side: 'before', ...o });

describe('validateDay', () => {
  test('accepts a day of legs; marks a past day', () => {
    const v = C.validateDay({ date: '2026-11-17', legs: [leg()] }, NOW);
    expect(v).toMatchObject({ ok: true, date: '2026-11-17', past: true });
    expect(v.legs[0]).toMatchObject({ minutes: 34, ownerEventId: EV, side: 'before' });
    expect(C.validateDay({ date: '2026-11-21', legs: [leg()] }, NOW).past).toBe(false);
  });
  test('refuses dates out of range, bad minutes, missing events', () => {
    expect(C.validateDay({ date: '2026-08-01', legs: [] }, NOW).ok).toBe(false);
    expect(C.validateDay({ date: '2026-12-31', legs: [] }, NOW).ok).toBe(false);
    expect(C.validateDay({ date: 'x', legs: [] }, NOW).ok).toBe(false);
    expect(C.validateDay({ date: '2026-11-17', legs: [leg({ minutes: 12.5 })] }, NOW).ok).toBe(false);
    expect(C.validateDay({ date: '2026-11-17', legs: [leg({ minutes: 0 })] }, NOW).ok).toBe(false);
    expect(C.validateDay({ date: '2026-11-17', legs: [leg({ ownerEventId: 'nope' })] }, NOW).ok).toBe(false);
    expect(C.validateDay({ date: '2026-11-17', legs: new Array(41).fill(leg()) }, NOW).ok).toBe(false);
  });
  test('the same drive twice keeps the first; a drive to the same place is dropped', () => {
    const v = C.validateDay({ date: '2026-11-17', legs: [leg(), leg({ minutes: 50 }), leg({ destination: '1 Hay St, Perth WA 6000' })] }, NOW);
    expect(v.legs).toHaveLength(1);
    expect(v.legs[0].minutes).toBe(34);
  });
});

test('minutesFor matches addresses canonically and returns null when unknown', () => {
  const v = C.validateDay({ date: '2026-11-17', legs: [leg()] }, NOW);
  const day = new Map([[`${v.legs[0].originCanon}|${v.legs[0].destinationCanon}`, 34]]);
  expect(C.minutesFor(day, '1 HAY ST, PERTH WA 6000', '5 Main St,  Joondalup WA 6027')).toBe(34);
  expect(C.minutesFor(day, '5 Main St, Joondalup WA 6027', '1 Hay St, Perth WA 6000')).toBeNull();
  expect(C.minutesFor(null, 'a', 'b')).toBeNull();
});
