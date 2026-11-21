/**
 * One appointment's time range (owner rule, 21 Nov 2026): same day, end after
 * start, at most 12 hours — in the booking panel (create) and the event drawer
 * (edit). What is saved is exactly what the Start/End fields show (C-11, C-12).
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

const helpers = HTML.slice(HTML.indexOf('const MAX_APPT_MIN'), HTML.indexOf('function _getBspTiming()'));
const lib = new Function(helpers + fnSrc('_getBspTiming') + '; return { MAX_APPT_MIN, validateTimeRange, _hhmmToMin, _getBspTiming };');

function timing(start, end, extra = {}) {
  const field = Object.assign({ 'bsp-start': { value: start }, 'bsp-end': { value: end }, 'bsp-location': { value: '' } }, extra);
  global.document = { querySelector: () => ({ dataset: { day: 'wed' } }), getElementById: (id) => field[id] };
  global.DAY_DATES = { wed: '2026-11-25' };
  try { return lib()._getBspTiming(); } finally { delete global.document; delete global.DAY_DATES; }
}

describe('validateTimeRange', () => {
  const { validateTimeRange, MAX_APPT_MIN } = lib();
  test('the cap is 12 hours', () => expect(MAX_APPT_MIN).toBe(720));
  test.each([
    [840, 780, false], [840, 840, false], [360, 1170, false], [1320, 60, false],
    [360, 1080, true], [480, 1020, true], [840, 885, true], [0, 720, true], [1380, 1439, true],
  ])('%i → %i ok=%s', (s, e, ok) => expect(validateTimeRange(s, e) === '').toBe(ok));
  test('a missing field is invalid', () => expect(validateTimeRange(600, NaN)).not.toBe(''));
});

describe('booking panel saves the visible Start/End', () => {
  test('the End field wins over a disagreeing slider', () => {
    const t = timing('14:00', '14:45', { 'bsp-dur-slider': { value: '30' } });
    expect(t.invalid).toBe('');
    expect([t.startISO, t.endISO, t.durationMin]).toEqual(['2026-11-25T14:00:00+08:00', '2026-11-25T14:45:00+08:00', 45]);
  });
  test.each([['14:00', '13:00'], ['14:00', '14:00'], ['22:00', '01:00'], ['06:00', '19:30']])('%s → %s is refused, no end ISO', (s, e) => {
    const t = timing(s, e);
    expect(t.invalid).not.toBe('');
    expect(t.endISO).toBeNull();
  });
  test('createBookingNow refuses an invalid range and the client path never books one', () => {
    expect(fnSrc('createBookingNow')).toContain('if (timing.invalid) { _bspValidateTiming(); return; }');
    expect(HTML).toContain('const slot    = (_t && _t.day && !_t.invalid) ?');
  });
  test('an end at or before the start is not wrapped into the next day', () => {
    const src = fnSrc('bspOnEndChange');
    expect(src).not.toContain('dur += 1440');
    expect(src).toContain('dur <= MAX_APPT_MIN');
  });
  test('invalid state: aria-invalid on End, inline message, Create disabled', () => {
    const src = fnSrc('_bspValidateTiming');
    expect(src).toContain("endEl.setAttribute('aria-invalid', 'true')");
    expect(src).toContain('btn.disabled = !!msg');
    expect(HTML).toContain('<div class="bsp-time-error" id="bsp-time-error" role="alert" hidden></div>');
    expect(fnSrc('_bspUpdateLivePreview')).toContain('_bspValidateTiming()');
  });
});

describe('event drawer uses the same rule', () => {
  test('bdRecalc and bdApplyEdit use validateTimeRange, not the old 8-hour cap', () => {
    const recalc = fnSrc('bdRecalc'), apply = fnSrc('bdApplyEdit');
    expect(recalc).toContain('validateTimeRange(startMin, endMin)');
    expect(recalc).toContain("endEl.setAttribute('aria-invalid', 'true')");
    expect(apply).toContain('validateTimeRange(startMin, endMin)');
    expect(recalc + apply).not.toMatch(/\b480\b/);
  });
  test('drag-to-create caps at 12 hours too', () => {
    expect(HTML).not.toContain('if (selEnd - selStart > 480)');
    expect(HTML).toContain('if (selEnd - selStart > MAX_APPT_MIN)');
  });
});

describe('slot click near midnight (C-08)', () => {
  test('the default hour stops at the end of the day', () => {
    expect(HTML).toContain('const endMin = Math.min(pending.startMinutes + 60, 24 * 60 - 1);');
    expect(HTML).not.toContain('endH: startH + 1, endM: startM, keepState: _bspOpen');
  });
  test('the prefill strip never reads an hour past 23 as PM of the same day', () => {
    const src = fnSrc('_applyPanelPrefill');
    // U-11: fmtT now hands the wrapped hour to the shell's one formatter.
    const fmtTimeSrc = HTML.slice(HTML.indexOf('function fmtTime(h, m) {'), HTML.indexOf('\n}\n', HTML.indexOf('function fmtTime(h, m) {')) + 2);
    const mk = (settings) => new Function('window', fmtTimeSrc + src.slice(src.indexOf('const pad'), src.indexOf('let timeStr')) + '; return fmtT;')({ APP_SETTINGS: settings });
    expect(mk({})(23, 59)).toBe('11:59 PM');
    expect(mk({})(24, 45)).toBe('12:45 AM');
    expect(mk({ timeFormat: '24' })(24, 45)).toBe('00:45');
  });
});
