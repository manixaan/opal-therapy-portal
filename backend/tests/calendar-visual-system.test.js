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

describe('calendar tile anatomy (§7.8 — C-14, C-15, C-16, C-18, C-26)', () => {
  test('one .session rule: padding 2px 6px, radius 4, 4 px bar, 11 px; no 11.5 px duplicate', () => {
    expect(HTML).not.toContain('.session { border-radius: 4px; border-width: 1px; box-shadow: none; font-size: 11.5px');
    const r = rule(HTML, '  .session');
    expect(r).toContain('padding: 2px 6px;');
    expect(r).toContain('border-radius: 4px;');
    expect(r).toContain('border-left: 4px solid');
    expect(r).toContain('font-size: 11px;');
    expect(r).toContain('container-type: inline-size;');
    expect(rule(HTML, '  .session.s-compact')).not.toMatch(/10\.5px/);
  });
  test('titles wrap whole words and clamp to whole lines (C-15)', () => {
    const t = rule(HTML, '  .session .s-title');
    expect(t).toContain('overflow-wrap: break-word; word-break: normal; text-wrap: pretty;');
    expect(t).toContain('-webkit-line-clamp: var(--lines, none);');
    expect(t).not.toContain('anywhere');
    const fn = HTML.slice(HTML.indexOf('function applySessionDensity('), HTML.indexOf('function applySessionDensity(') + 1200);
    expect(fn).toContain("el.style.setProperty('--lines'");
  });
  test('one status corner, top-right 2 px, 14 px, hidden on short or narrow tiles (C-16)', () => {
    expect(HTML).toMatch(/\.session \.travel-badge \{ position: absolute; top: 2px; right: 2px; width: 14px; height: 14px;/);
    expect(rule(HTML, '  .session .addr-chip')).toContain('top: 2px; right: 2px;');
    expect(HTML).toContain('.session.s-compact > :is(.addr-chip, .splose-chip, .travel-badge) { display: none; }');
    expect(HTML).toContain('@container (max-width: 99.98px)');
    expect(HTML).toContain('.session.session > :is(.addr-chip, .splose-chip, .travel-badge) { display: none; }');
    expect(HTML).toContain('.session:has(> .addr-chip) > .travel-badge');
  });
  test('conflict is the --danger ring + bar; the text badge never shows on short or narrow tiles (C-14)', () => {
    const c = rule(HTML, '  .session.conflict-tile');
    expect(c).toContain('box-shadow: inset 0 0 0 2px var(--danger) !important;');
    expect(c).not.toMatch(/239,\s*68,\s*68/);
    expect(HTML).toContain('.session.s-compact .conflict-badge { display: none; }');
    expect(HTML).toMatch(/@container \(max-width: 99\.98px\) \{[\s\S]{0,300}\.session \.conflict-badge \{ display: none; \}/);
  });
  test('hover, selected and drag use the shadow/focus tokens (no brightness filter, no white halo)', () => {
    expect(HTML).toContain('.session:hover { box-shadow: var(--shadow-md); z-index: 4; }');
    expect(HTML).toContain('.session.selected { box-shadow: var(--focus-ring); z-index: 5; }');
    expect(HTML).not.toContain('.session:hover { filter: brightness');
  });
  test('overlap lanes are equal width with 3 px insets and a 4 px gap (C-18)', () => {
    const fn = HTML.slice(HTML.indexOf('function reflowDayOverlaps(col) {'), HTML.indexOf('function reflowDayOverlaps(col) {') + 3000);
    expect(fn).toContain('const INSET = 3, GAP = 4;');
    expect(fn).toContain('grp[i].el.style.width = `calc((100% - ${spare}px) / ${totalLanes})`;');
    expect(fn).toContain("grp[0].el.style.left  = '3px';");
  });
});

describe('sheet internals — one spec for the drawer and the booking panel (U-09, U-10, §7.2)', () => {
  test('both sheets: 56 px header, 32 × 32 radius-8 close, 15/700 title', () => {
    expect(rule(HTML, '  .detail-header')).toContain('min-height: 56px;');
    expect(rule(HTML, '.bsp-header')).toContain('min-height: 56px;');
    const dc = rule(HTML, '  .detail-close');
    expect(dc).toContain('width: 32px; height: 32px;');
    expect(dc).toMatch(RADIUS_8);
    const bc = rule(HTML, '.bsp-close');
    expect(bc).toContain('width: 32px; height: 32px;');
    expect(bc).toMatch(RADIUS_8);
    expect(HTML).toContain('.bsp-title { font-size: 15px; font-weight: 700;');
  });
  test('footer buttons are one 36 px size; Close is not the filled primary', () => {
    const f = rule(HTML, '  .detail-footer .btn, .bsp-footer .btn');
    expect(f).toContain('height: 36px;');
    expect(f).toContain('font-size: 13px;');
    expect(HTML).toContain('parts.push(`<button class="btn" onclick="closeBlockDetail()">Close</button>`);');
    expect(HTML).not.toContain('<button class="btn primary" onclick="closeBlockDetail()">Close</button>');
  });
  test('fields are 34 px radius 8 in both sheets; inline actions 24 px', () => {
    expect(rule(HTML, '  .time-edit input[type="time"]')).toMatch(/height: 34px;[^}]*border-radius: 8px;/);
    expect(rule(HTML, '.bsp-time-field input[type="time"]')).toContain('height: 34px;');
    expect(rule(HTML, '.bsp-loc-field input[type="text"]')).toContain('height: 34px;');
    expect(HTML).toContain('#booking-side-panel .search-row input { height: 34px;');
    expect(HTML).toContain('#booking-side-panel select { height: 34px;');
    expect(HTML).toContain('.detail-drawer .btn.btn-xs { height: 24px;');
    expect(HTML).not.toContain('style="font-size:11.5px;padding:2px 8px;"');
    expect(HTML).not.toContain('rgba(111,93,212,0.15)); }\n  .time-edit .sep');
  });
  test('section labels share 11/700 and ink-soft, never info blue', () => {
    expect(rule(HTML, '.bsp-section-title')).toContain('color: var(--ink-soft);');
    expect(rule(HTML, '.bsp-t-label')).toContain('font-size: 11px; font-weight: 700;');
  });
});
