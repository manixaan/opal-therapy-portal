/**
 * C-06: an event that runs past midnight is drawn only to 24:00 — it never
 * overflows the grid (mirrors travel-overlay-clamp.test.js for legs). Only the
 * drawing is clamped; the event's stored times are not changed.
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
const HOUR_PX = 72;
const h = new Function('HOUR_PX', fnSrc('sessionTileHeight') + '; return sessionTileHeight;')(HOUR_PX);
const tToY = (hh, m = 0) => (hh + m / 60) * HOUR_PX;

describe('tiles are clamped at the end of the day', () => {
  test.each([
    [23 * 60 + 30, 90], [23 * 60, 120], [22 * 60, 60], [23 * 60 + 55, 30], [0, 1500],
  ])('start %i + %i min ends inside the column', (start, dur) => {
    const top = tToY(Math.floor(start / 60), start % 60);
    expect(top + h(dur, start)).toBeLessThanOrEqual(tToY(24));
  });
  test('a same-day tile is not affected by the clamp', () => {
    expect(h(60, 9 * 60)).toBe(h(60));
  });
  test('every positioned tile path passes its start minute', () => {
    expect(HTML).toContain("el.style.height = sessionTileHeight(durMin(opts), sessionStartMin(opts)) + 'px';");
    expect(HTML).toContain("resize.el.style.height = sessionTileHeight(newDur, newStart) + 'px';");
    expect(HTML).toContain("s.element.style.height = sessionTileHeight(duration, sh * 60 + sm) + 'px';");
    expect(HTML).not.toMatch(/sessionTileHeight\(durMin\(s\)\)/);
  });
  test('a tile that continues past midnight is marked', () => {
    expect(HTML).toContain("el.classList.toggle('s-continues', sessionEndMin(opts) > 24 * 60);");
  });
});
