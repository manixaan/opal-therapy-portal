/**
 * U-11 (21 Nov 2026): one display formatter for a time of day.
 *
 * The audit found five formats on one calendar screen ("4 PM", "08:30 – 09:30
 * AWST", "4:00 PM – 5:00 PM", "4:00pm–5:00pm", "4:00p"). The shell's fmtTime
 * is now the one formatter: Settings → Time format '24' → "14:30", anything
 * else (the server default '12', or unset before settings load) → "2:30 PM".
 * Harness fix/tech/u11.js: tile, drawer, booking banner, proposed block and
 * its tooltip agree with the hour axis under both settings.
 */
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '../../frontend/current');
const HTML = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const TRAVEL = fs.readFileSync(path.join(FRONTEND, 'travel.js'), 'utf8');
const REPORTS = fs.readFileSync(path.join(FRONTEND, 'reports.js'), 'utf8');

function fnSrc(src, head) {
  const at = src.indexOf(head);
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\n}\n', at) + 2);
}

function load(settings) {
  const code = fnSrc(HTML, 'function fmtTime(h, m) {') + fnSrc(HTML, 'function fmtMin(min) {') +
    fnSrc(TRAVEL, 'function _tpFmtTime(h, m) {') + fnSrc(REPORTS, 'function _rptFmtTime(h, m) {') +
    '; return { fmtTime, fmtMin, _tpFmtTime, _rptFmtTime };';
  return new Function('window', code)({ APP_SETTINGS: settings });
}

describe('one time formatter (U-11)', () => {
  test('12-hour is "2:30 PM" for the default, an unset value and any non-24 value', () => {
    for (const s of [{ timeFormat: '12' }, {}, { timeFormat: '12h' }]) {
      const f = load(s);
      expect(f.fmtTime(14, 30)).toBe('2:30 PM');
      expect(f.fmtTime(0, 5)).toBe('12:05 AM');
      expect(f.fmtMin(9 * 60)).toBe('9:00 AM');
      expect(f._tpFmtTime(16, 0)).toBe('4:00 PM');
      expect(f._rptFmtTime(16)).toBe('4:00 PM');
    }
  });

  test('24-hour is "14:30" everywhere', () => {
    const f = load({ timeFormat: '24' });
    expect(f.fmtTime(14, 30)).toBe('14:30');
    expect(f.fmtMin(8 * 60 + 5)).toBe('08:05');
    expect(f._tpFmtTime(7, 45)).toBe('07:45');
    expect(f._rptFmtTime(16, 0)).toBe('16:00');
  });

  test('the calendar, booking and travel surfaces route through fmtTime instead of their own am/pm', () => {
    expect(fnSrc(HTML, 'function calProposedLabel(')).toContain('const f = (m) => fmtTime(Math.floor(m / 60) % 24, m % 60);');
    expect(HTML).toContain('function minToDisplay(min) { return fmtTime(Math.floor(min/60) % 24, min % 60); }');
    expect(HTML).toContain('const fmtT = (h, m) => fmtTime(h % 24, m);');
    expect(HTML).toContain('const fmtT    = (h, m) => fmtTime(h % 24, m);');
    expect(HTML).not.toMatch(/\$\{h<12\?'a':'p'\}/);
    expect(TRAVEL).toContain("function _tpFmtTime(h, m) {\n  if (typeof fmtTime === 'function') return fmtTime(h, m);");
  });
});
