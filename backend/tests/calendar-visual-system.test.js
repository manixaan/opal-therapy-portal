/**
 * Stage 3 visual system (CONSOLIDATED Report 6 §7.1–7.8): the calendar and
 * its chrome read as one product. These static guards pin the spec values
 * on the rules that carry them, so a later edit cannot quietly reintroduce
 * a second control height, a radius-changing focus rule, or a blue "selected".
 * Measured in the stubbed harness (fix/stage3/measure.js); these only pin
 * the CSS that produced the measurements.
 */
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '../../frontend/current');
const HTML = fs.readFileSync(path.join(FE, 'mockup_v3.html'), 'utf8');
const SYNC_CSS = fs.readFileSync(path.join(FE, 'splose-sync.css'), 'utf8');
const INV_CSS = fs.readFileSync(path.join(FE, 'invoicing.css'), 'utf8');

function rule(src, sel) {
  const at = src.indexOf(sel + ' {');
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('}', at) + 1);
}
const RADIUS_8 = /border-radius: (8px|var\(--radius-sm\));/;

describe('calendar toolbar — one control height, radius and hover (U-04, U-12, U-17)', () => {
  test.each([
    ['.btn-today', HTML], ['.cal-legend-btn', HTML], ['.btn-add-event', HTML],
    ['.btn-cal-sidebar', HTML], ['.view-tabs', HTML],
    ['.inv-cal-btn', INV_CSS], ['.splose-sync-btn', SYNC_CSS],
  ])('%s is a 32 px, radius-8 control', (sel, src) => {
    const r = rule(src, sel);
    expect(r).toContain('height: 32px;');
    expect(r).toContain('box-sizing: border-box;');
    expect(r).toMatch(RADIUS_8);
    expect(r).not.toMatch(/12\.5px|11\.5px/);
  });
  test('nav arrows are 32 × 32 and the segments fill the 32 px track', () => {
    const a = rule(HTML, '  .nav-arrow');
    expect(a).toContain('width: 32px; height: 32px;');
    expect(a).toMatch(RADIUS_8);
    const t = rule(HTML, '  .view-tab');
    expect(t).toContain('height: 26px;');
    expect(t).toContain('font-size: 13px;');
  });
  test('labels are 13 px; primaries 600, secondaries 500', () => {
    for (const sel of ['.btn-today', '.cal-legend-btn']) {
      expect(rule(HTML, sel)).toMatch(/font-size: 13px; font-weight: 500;/);
    }
    expect(rule(HTML, '.btn-add-event')).toMatch(/font-size: 13px; font-weight: 600;/);
    expect(rule(INV_CSS, '.inv-cal-btn')).toMatch(/font-size: 13px; font-weight: 600;/);
    expect(rule(SYNC_CSS, '.splose-sync-btn')).toMatch(/font-size: 13px; font-weight: 500;/);
  });
  test('the Sync button never uses the invalid `font: … inherit` shorthand (VD-19)', () => {
    expect(SYNC_CSS).not.toMatch(/font:\s*\d[^;]*\binherit\s*;/);
  });
  test('secondary controls share one hover: --panel-sunk on --border', () => {
    for (const sel of ['.btn-today:hover', '.nav-arrow:hover', '.cal-legend-btn:hover']) {
      expect(rule(HTML, '  ' + sel)).toMatch(/background: var\(--panel-sunk\); border-color: var\(--border\);/);
    }
    expect(rule(SYNC_CSS, '.splose-sync-btn:hover')).toMatch(/background: var\(--panel-sunk\); border-color: var\(--border\);/);
    expect(HTML).not.toContain('border-color: #c7c0b5');
  });
});

describe('focus — one ring that follows the control’s shape (U-05)', () => {
  const FLIGHTS_CSS = fs.readFileSync(path.join(FE, 'flights.css'), 'utf8');
  test('the shell focus rule never rewrites border-radius', () => {
    const r = rule(HTML, '[tabindex]:focus-visible');
    expect(r).toContain('box-shadow: var(--focus-ring);');
    expect(r).not.toMatch(/border-radius\s*:/);
  });
  test('the active segment and selected chips restate the ring over their own shadow', () => {
    expect(HTML).toContain('.view-tab.active:focus-visible { box-shadow: var(--focus-ring); }');
    expect(HTML).toContain('.bsp-day-chip.active:focus-visible, .booking-cat-chip.active:focus-visible { box-shadow: var(--focus-ring); }');
  });
  test.each([
    ['.cl-row-btn:focus-visible', HTML], ['.cl-swatch:focus-visible', HTML], ['.mm-cell:focus-visible', HTML],
    ['.travel-overlay.movable:focus-visible', HTML], ['.travel-overlay .t-switch:focus-visible', HTML],
    ['.cal-flight-btn:focus-visible', FLIGHTS_CSS],
  ])('%s uses the ring, not a second outline', (sel, src) => {
    const r = rule(src, sel);
    expect(r).toContain('outline: none; box-shadow: var(--focus-ring);');
  });
});

describe('teal is the only "selected" colour; travel matches its legend (U-06, VD-10, VD-11)', () => {
  const ROUTE_CSS = fs.readFileSync(path.join(FE, 'booking-route.css'), 'utf8');
  const REC_CSS = fs.readFileSync(path.join(FE, 'recurrence.css'), 'utf8');
  const THEME = fs.readFileSync(path.join(FE, 'theme.css'), 'utf8');
  test.each([
    ['.bsp-day-chip.active', HTML], ['.bsp-dur-preset.active', HTML], ['.booking-cat-chip.active', HTML],
    ['.bsp-t-chip.selected', HTML], ['.bsp-loc-chip.on', ROUTE_CSS], ['.rec-day.on', REC_CSS],
  ])('%s uses the accent, never info blue', (sel, src) => {
    const r = rule(src, sel);
    expect(r).toContain('var(--accent');
    expect(r).not.toMatch(/--info|#3d6cae|#2563eb|74,\s*127,\s*193/);
  });
  test('booking time inputs, slider and proposal are teal; the prefill note stays informational blue', () => {
    expect(rule(HTML, '.bsp-time-field input[type="time"]')).toContain('background: var(--accent-soft);');
    expect(rule(HTML, '.bsp-dur-slider')).toContain('var(--accent) var(--pct, 25%)');
    expect(rule(HTML, '.cal-proposed')).toContain('border-left: 3px solid var(--accent);');
    expect(rule(HTML, '.bsp-prefill-strip')).toContain('background: var(--info-soft);');
    expect(HTML).not.toContain('.cal-head.today .day-num { background:#3d6cae');
  });
  test('travel legs are drawn from --c-travel, one hue for start/between/end', () => {
    const base = rule(HTML, '  .travel-overlay');
    expect(base).toContain('border-left: 3px solid var(--c-travel);');
    expect(base).toContain('color: var(--c-travel-ink);');
    expect(HTML).not.toMatch(/\.travel-overlay\.(start|end)\s*\{[^}]*border-left-color/);
    expect(HTML).toContain('.travel-overlay.start:not(.estimate), .travel-overlay.end:not(.estimate) { border-left-style: double;');
    expect(THEME).toContain('--c-travel-ink: #e0d9ff;');
  });
});
