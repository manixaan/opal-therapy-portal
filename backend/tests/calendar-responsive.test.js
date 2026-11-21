/**
 * Stage 4 responsive chrome (CONSOLIDATED U-03, Report 6 §7.11): below 1080 px
 * the header, nav and calendar toolbar condense instead of running off-screen,
 * and at 390 px the page never scrolls sideways (the 700 px week scrolls inside
 * the calendar). Measured in the stubbed harness (fix/stage4/resp.js:
 * scrollWidth 756 → 390 at 390 px); these pin the rules that produced it.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');

function mediaBlock(maxWidth, marker) {
  // The responsive-chrome blocks follow the U-03 comment.
  const start = HTML.indexOf('Responsive chrome (U-03');
  expect(start).toBeGreaterThan(-1);
  const at = HTML.indexOf(`@media (max-width: ${maxWidth}px) {`, start);
  expect(at).toBeGreaterThan(-1);
  const end = HTML.indexOf('\n  }\n', at);
  const block = HTML.slice(at, end);
  if (marker) expect(block).toContain(marker);
  return block;
}

describe('responsive chrome (U-03)', () => {
  test('≤1080: the date range never wraps; Legend and Sync keep only their icons', () => {
    const b = mediaBlock(1080);
    expect(b).toMatch(/#week-label \{ white-space: nowrap; \}/);
    expect(b).toMatch(/\.cal-legend-btn, #splose-sync-btn \{ font-size: 0;[^}]*width: 32px;/);
    // the pending-count chip stays readable
    expect(b).toMatch(/#splose-sync-btn \.cnt \{ font-size: 11px;/);
  });

  test('≤860: identity once, sync pill as its dot, week scrolls inside the calendar', () => {
    const b = mediaBlock(860, 'prac-badge');
    expect(b).toMatch(/header \.prac-badge \{ display: none; \}/);
    expect(b).toMatch(/#hdr-sync-pill \{ font-size: 0;/);
    expect(b).toMatch(/#inv-cal-btn, \.btn-add-event \{ font-size: 0;[^}]*width: 32px;/);
    expect(b).toMatch(/#cal-view-week > \.cal-shell \{ min-width: 0; overflow-x: auto; \}/);
  });

  test('≤600: nav tabs collapse to icons except the open one; the toolbar wraps', () => {
    const b = mediaBlock(600);
    expect(b).toMatch(/nav\.tabs > \.tab:not\(\.active\) \{ font-size: 0;/);
    expect(b).toMatch(/\.cal-topbar \{ flex-wrap: wrap;/);
    // only duplicates leave the header: the theme lives in the account menu
    expect(b).toMatch(/#theme-toggle \{ display: none; \}|#theme-toggle(,|\s)/);
    expect(HTML).toMatch(/data-theme-set="auto"/);
  });

  test('collapsed labels stay in the DOM (font-size:0, never display:none) so the accessible name survives', () => {
    for (const w of [1080, 860]) {
      const b = mediaBlock(w);
      expect(b).not.toMatch(/(\.cal-legend-btn|#splose-sync-btn|#inv-cal-btn|\.btn-add-event)[^{]*\{[^}]*display: none/);
    }
  });
});
