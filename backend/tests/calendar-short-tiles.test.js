/**
 * C-05 / C-17: short tiles. The centre of a sub-15-minute tile is a move
 * target (resize handles are at most a quarter of the tile each, and their
 * grip never takes the pointer); 5- and 10-minute tiles have distinct
 * heights and never overlap the next slot.
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
const sessionTileHeight = new Function('HOUR_PX', fnSrc('sessionTileHeight') + '; return sessionTileHeight;')(HOUR_PX);

describe('tile height', () => {
  test.each([[5, 5], [10, 8], [15, 14], [30, 32], [60, 68]])('%i min → %ipx', (min, px) => {
    expect(sessionTileHeight(min)).toBeCloseTo(px, 5);
  });
  test('every short tile leaves at least 1px before the next slot', () => {
    for (let m = 1; m <= 30; m++) {
      const slot = m / 60 * HOUR_PX;
      expect(sessionTileHeight(m)).toBeLessThanOrEqual(slot - 1 + 1e-9);
      if (m > 1) expect(sessionTileHeight(m)).toBeGreaterThan(sessionTileHeight(m - 1) - 1e-9);
    }
  });
  test('every tile-height path uses the helper, and the CSS floor is gone', () => {
    expect(HTML).not.toMatch(/(durMin\((s|opts)\)|duration|newDur|drag\.durationMin) \/ 60 \* HOUR_PX - 4/);
    expect(HTML).not.toContain('min-height: 8px; /* 15-min slot');
    expect(fnSrc('applySessionDensity')).toContain("'s-tiny'");
  });
});

describe('resize handles on short tiles', () => {
  test('a handle is at most a quarter of the tile, and its grip takes no pointer', () => {
    const css = HTML.slice(HTML.indexOf('.session .resize-handle {'), HTML.indexOf('.resize-tip {'));
    expect(css).toContain('height: min(8px, 25%);');
    expect(css).toContain('pointer-events: none;');
  });
});
