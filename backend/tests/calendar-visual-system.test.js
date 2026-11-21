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
