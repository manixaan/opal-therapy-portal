'use strict';

/**
 * A travel block never runs past the end of the day (29 Sep 2026): a late
 * session's drive home used to overhang midnight, stretch the day column and
 * leave a white band under the week grid. travel.js runs in a vm.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../../frontend/current/travel.js'), 'utf8');
const HOUR_PX = 72;

function load() {
  const noop = () => {};
  const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [] });
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Map, Set, Date, Math, JSON,
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el() },
    START_H: 0, END_H: 24, HOUR_PX,
    tToY: (h, m = 0) => (h + m / 60) * HOUR_PX,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

function render(c, seg) {
  const added = [];
  c.renderSegmentOverlay({ appendChild: (e) => added.push(e) }, Object.assign({
    day: 'mon', travelMin: 0, freeMin: 0, fromLoc: { suburb: 'Derby' }, toLoc: { suburb: 'Broome' },
  }, seg));
  return added;
}

describe('travel overlay stays inside the day', () => {
  test('a drive home that runs past midnight stops at the bottom of the day', () => {
    const [el] = render(load(), { kind: 'end', startMin: 23 * 60, endMin: 23 * 60 + 150, travelMin: 150 });
    expect(el).toBeDefined();
    const bottom = parseFloat(el.style.top) + parseFloat(el.style.height);
    expect(bottom).toBeLessThanOrEqual(24 * HOUR_PX);
    expect(el.innerHTML).toContain('150 min'); // the label keeps the real drive time
  });

  test('a block wholly after midnight is not drawn at all', () => {
    expect(render(load(), { kind: 'end', startMin: 24 * 60 + 10, endMin: 24 * 60 + 90, travelMin: 80 })).toHaveLength(0);
  });

  test('an ordinary daytime block is unchanged', () => {
    const [el] = render(load(), { kind: 'start', startMin: 8 * 60, endMin: 8 * 60 + 30, travelMin: 30 });
    expect(parseFloat(el.style.top)).toBe(8 * HOUR_PX);
    expect(parseFloat(el.style.height)).toBe(30 / 60 * HOUR_PX - 4);
  });
});
