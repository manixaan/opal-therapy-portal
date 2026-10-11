'use strict';

/** Outlook-style repeat rules → dates (recurrence.js, 11 Oct 2026). */
const R = require('../recurrence');

const run = (raw, anchor) => {
  const n = R.normaliseRule(raw, anchor);
  if (!n.ok) throw new Error(n.error);
  return R.expand(n.rule, anchor);
};

describe('normaliseRule', () => {
  test.each([
    [null, 'A repeat rule is required'],
    [{ freq: 'hour', end: { type: 'count', count: 3 } }, /daily, weekly/],
    [{ freq: 'week', interval: 0, end: { type: 'count', count: 3 } }, /1–99/],
    [{ freq: 'week' }, /when the series ends/],
    [{ freq: 'week', end: { type: 'date', until: '2026-10-01' } }, /before the first/],
    [{ freq: 'week', end: { type: 'count', count: 1 } }, /at least 2/],
    [{ freq: 'week', end: { type: 'date', until: '2026-02-30' } }, /not a valid date/],
  ])('%j is refused', (raw, msg) => {
    const r = R.normaliseRule(raw, '2026-10-12');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(msg);
  });
  test('week with no days repeats on the anchor\'s weekday; days come back in calendar order', () => {
    expect(R.normaliseRule({ freq: 'week', end: { type: 'count', count: 2 } }, '2026-10-12').rule.days).toEqual(['mon']);
    expect(R.normaliseRule({ freq: 'week', days: ['fri', 'mon', 'fri', 'xyz'], end: { type: 'count', count: 2 } }, '2026-10-12').rule.days).toEqual(['mon', 'fri']);
  });
});

describe('expand', () => {
  test('weekly on Monday until 11 Dec (Outlook\'s example)', () => {
    const { dates, capped } = run({ freq: 'week', interval: 1, days: ['mon'], end: { type: 'date', until: '2026-12-11' } }, '2026-10-12');
    expect(dates[0]).toBe('2026-10-12');
    expect(dates[dates.length - 1]).toBe('2026-12-07');
    expect(dates).toHaveLength(9);
    expect(capped).toBe(false);
  });
  test('fortnightly', () => {
    expect(run({ freq: 'week', interval: 2, days: ['wed'], end: { type: 'count', count: 4 } }, '2026-10-07').dates)
      .toEqual(['2026-10-07', '2026-10-21', '2026-11-04', '2026-11-18']);
  });
  test('several weekdays: the anchor week\'s later days count, earlier ones do not', () => {
    expect(run({ freq: 'week', days: ['mon', 'wed'], end: { type: 'count', count: 4 } }, '2026-10-07').dates)
      .toEqual(['2026-10-07', '2026-10-12', '2026-10-14', '2026-10-19']);
  });
  test('monthly on day 31 lands on the last day of shorter months', () => {
    expect(run({ freq: 'month', monthly: 'date', end: { type: 'count', count: 4 } }, '2026-10-31').dates)
      .toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
  });
  test('monthly on the second Monday; the fifth weekday means the last', () => {
    expect(run({ freq: 'month', monthly: 'weekday', end: { type: 'count', count: 3 } }, '2026-10-12').dates)
      .toEqual(['2026-10-12', '2026-11-09', '2026-12-14']);
    expect(run({ freq: 'month', monthly: 'weekday', end: { type: 'count', count: 3 } }, '2026-10-29').dates)
      .toEqual(['2026-10-29', '2026-11-26', '2026-12-31']);
  });
  test('daily every 3 days; yearly', () => {
    expect(run({ freq: 'day', interval: 3, end: { type: 'count', count: 3 } }, '2026-10-30').dates).toEqual(['2026-10-30', '2026-11-02', '2026-11-05']);
    expect(run({ freq: 'year', end: { type: 'count', count: 2 } }, '2026-10-12').dates).toEqual(['2026-10-12', '2027-10-12']);
  });
  test('capped at 52 appointments and at 12 months, and says so', () => {
    const daily = run({ freq: 'day', end: { type: 'date', until: '2027-06-01' } }, '2026-10-12');
    expect(daily.dates).toHaveLength(52);
    expect(daily.capped).toBe(true);
    const monthly = run({ freq: 'month', end: { type: 'date', until: '2029-01-01' } }, '2026-10-12');
    expect(monthly.dates[monthly.dates.length - 1]).toBe('2027-10-12');
    expect(monthly.capped).toBe(true);
    expect(run({ freq: 'week', end: { type: 'count', count: 99 } }, '2026-10-12').dates).toHaveLength(52);
    expect(run({ freq: 'week', end: { type: 'count', count: 5 } }, '2026-10-12').capped).toBe(false);
  });
});

test('describe reads like Outlook', () => {
  const d = (raw, a) => R.describe(R.normaliseRule(raw, a).rule, a);
  expect(d({ freq: 'week', days: ['mon'], end: { type: 'date', until: '2026-12-11' } }, '2026-10-12')).toBe('Occurs every week on Monday until 11 Dec 2026');
  expect(d({ freq: 'week', interval: 2, days: ['mon', 'thu'], end: { type: 'count', count: 6 } }, '2026-10-12')).toBe('Occurs every 2 weeks (fortnightly) on Monday and Thursday for 6 appointments');
  expect(d({ freq: 'month', monthly: 'weekday', end: { type: 'count', count: 3 } }, '2026-10-12')).toBe('Occurs every month on the second Monday for 3 appointments');
  expect(d({ freq: 'month', end: { type: 'count', count: 3 } }, '2026-10-12')).toBe('Occurs every month on day 12 for 3 appointments');
});
