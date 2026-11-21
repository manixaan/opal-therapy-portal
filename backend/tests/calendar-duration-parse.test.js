/**
 * C-03: an event whose times carry seconds (16:30:00–17:00:30) must keep its
 * length — the old "30.5m" string was re-parsed by /(\d+)m/ as 5 minutes, and
 * a later move saved a 5-minute appointment.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');
function fnSrc(name) {
  const at = HTML.indexOf('function ' + name + '(');
  expect(at).toBeGreaterThan(-1);
  const rest = HTML.slice(at);
  return rest.slice(0, rest.indexOf('\n}\n') + 2);
}
const lib = new Function(fnSrc('eventDurationMinutes') + fnSrc('calculateDuration') + '; return { eventDurationMinutes, calculateDuration };')();

describe('event duration from ISO', () => {
  test.each([
    ['2026-11-28T16:30:00+08:00', '2026-11-28T17:00:30+08:00', 31],
    ['2026-11-28T16:30:00+08:00', '2026-11-28T17:00:20+08:00', 30],
    ['2026-11-28T09:00:00+08:00', '2026-11-28T10:30:00+08:00', 90],
    ['2026-11-28T09:00:00Z', '2026-11-28T09:05:00Z', 5],
  ])('%s → %s = %i min', (a, b, want) => expect(lib.eventDurationMinutes(a, b)).toBe(want));

  test('the display string has whole minutes only', () => {
    expect(lib.calculateDuration('2026-11-28T16:30:00+08:00', '2026-11-28T17:00:30+08:00')).toBe('31m');
    expect(lib.calculateDuration('2026-11-28T09:00:00+08:00', '2026-11-28T10:30:30+08:00')).toBe('1h 31m');
  });

  test('tiles take their end from durMin, not by re-parsing the string', () => {
    expect(HTML).toContain('durMin: eventDurationMinutes(event.start_time, event.end_time),');
    const merge = fnSrc('mergeEventsIntoDayData');
    const at = merge.indexOf('if (Number.isFinite(session.durMin))');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(merge.indexOf("durStr.includes('h') && durStr.includes('m')"));
  });
});
