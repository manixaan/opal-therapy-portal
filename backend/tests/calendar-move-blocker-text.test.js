/**
 * C-23: the move review never prints "undefined" or a negative gap. An
 * overlap is already its own blocker, and places are named from the session's
 * location (s.region / s.suburb are retired fields).
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
const src = fnSrc('evaluateMove');

test('no travel check against a neighbour the move overlaps', () => {
  expect(src).toContain('if (prevTravel > 0 && prevGap >= 0) {');
  expect(src).toContain('if (nextTravel > 0 && nextGap >= 0) {');
});
test('places are named from sessionLocation, with plain fallbacks', () => {
  expect(src).toContain('return (loc && (loc.suburb || loc.address)) || x.suburb || fallback;');
  expect(src).not.toMatch(/labelRegion\((prev|next|s)\.region\)/);
  expect(src).not.toContain('${s.suburb}');
});
