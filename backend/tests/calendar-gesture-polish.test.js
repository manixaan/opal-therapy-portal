/**
 * IA-08: the tile / travel-leg context menus close on Escape (and Escape does
 * nothing else), on any scroll outside the menu, and on resize.
 * IA-15: idle animations are compositor-only (no left/top, no box-shadow).
 * C-21: edge auto-scroll during a tile drag, a resize or a drag-to-create.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');
function block(head) {
  const at = HTML.indexOf(head);
  expect(at).toBeGreaterThan(-1);
  return HTML.slice(at, HTML.indexOf('\n}\n', at) + 2);
}

describe('IA-08 context menus', () => {
  function shell() {
    const dom = new JSDOM('<!doctype html><body><div id="cal-grid"></div></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(block('function closeCalContextMenu() {'));
    const iife = HTML.slice(HTML.indexOf('(function calContextMenuDismiss() {'));
    w.eval(iife.slice(0, iife.indexOf('})();') + 5));
    w.eval(`window.otherEsc = 0; window.addEventListener('keydown', e => { if (e.key === 'Escape') otherEsc++; });
      window.openMenu = () => { const m = document.createElement('div'); m.id = 'cal-ctx-menu-active'; m.innerHTML = '<div class="inner"></div>'; document.body.appendChild(m); };`);
    return w;
  }
  const isOpen = (w) => !!w.document.getElementById('cal-ctx-menu-active');
  test('Escape closes an open menu and stops there; with no menu it passes through', () => {
    const w = shell();
    w.eval('openMenu(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));');
    expect(isOpen(w)).toBe(false);
    expect(w.otherEsc).toBe(0);
    w.eval('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));');
    expect(w.otherEsc).toBe(1);
  });
  test('a grid scroll or a resize closes it; a scroll inside the menu does not', () => {
    const w = shell();
    w.eval('openMenu(); document.querySelector("#cal-ctx-menu-active .inner").dispatchEvent(new Event("scroll"));');
    expect(isOpen(w)).toBe(true);
    w.eval('document.getElementById("cal-grid").dispatchEvent(new Event("scroll"));');
    expect(isOpen(w)).toBe(false);
    w.eval('openMenu(); window.dispatchEvent(new Event("resize"));');
    expect(isOpen(w)).toBe(false);
  });
  test('the travel-leg menu uses the same id, so the same dismissal covers it', () => {
    const travel = fs.readFileSync(path.join(__dirname, '../../frontend/current/travel.js'), 'utf8');
    const leg = travel.slice(travel.indexOf('function showTravelLegMenu('), travel.indexOf('function showTravelLegMenu(') + 400);
    expect(leg).toContain("menu.id = 'cal-ctx-menu-active';");
  });
});

describe('IA-15 idle animations', () => {
  const kf = (name) => { const at = HTML.indexOf('@keyframes ' + name + ' {'); expect(at).toBeGreaterThan(-1); return HTML.slice(at, HTML.indexOf('\n  }', at)); };
  test('the pebble nucleus drifts by transform, not left/top', () => {
    const d = kf('pebbleDrift');
    expect(d).toContain('transform: translate(');
    expect(d).not.toMatch(/\b(left|top):/);
  });
  test('the sync dot breathes by a transform/opacity ::after, not box-shadow', () => {
    expect(HTML).not.toContain('animation: pulse 2s infinite;');
    const p = kf('syncPulse');
    expect(p).toContain('transform: scale(');
    expect(p).not.toContain('box-shadow');
    expect(HTML).toContain('animation: syncPulse 2s ease-in-out infinite;');
  });
  test('the pebble holds still behind an open sheet', () => {
    expect(HTML).toContain('body.dd-open .brand-pebble, body.dd-open .brand-pebble::after { animation-play-state: paused; }');
  });
});

describe('C-21 edge auto-scroll', () => {
  test('one rAF loop, driven by the active gesture and its own move handler', () => {
    const g = block('function _calGestureMove() {');
    expect(g).toContain('if (drag && drag.live && drag.moved) return onBlockPointerMove;');
    expect(g).toContain('if (resize && resize.moved) return onBlockResizeMove;');
    expect(g).toContain('if (_calDragPending && _calDragPending.dragging) return _calColPointerMove;');
    const t = block('function _calEdgeTick() {');
    expect(t).toContain('if (move === onBlockResizeMove) resize.startY -= moved;');
    expect(t).toContain('_edgeRaf = requestAnimationFrame(_calEdgeTick);');
    expect(t).toContain('if (!moved) return;');
  });
  test('speed: zero mid-grid, faster nearer the edge, capped, up at the top under the sticky headers', () => {
    const dom = new JSDOM('<!doctype html><body><div id="cal-grid"><div class="cal-head" data-day="mon"></div></div></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval('const CAL_EDGE_PX = 40, CAL_EDGE_MAX = 16;' + block('function _calEdgeSpeed(grid, y) {'));
    w.eval(`var g = document.getElementById('cal-grid'), h = g.querySelector('.cal-head');
      g.getBoundingClientRect = () => ({ top: 100, bottom: 700 });
      h.getBoundingClientRect = () => ({ bottom: 150 });
      Object.defineProperty(h, 'offsetParent', { get: () => g });`);
    const v = (y) => w.eval(`_calEdgeSpeed(g, ${y})`);
    expect(v(400)).toBe(0);
    expect(v(665)).toBe(4);            // just inside the band: the minimum step
    expect(v(699)).toBeGreaterThan(v(670));
    expect(v(760)).toBe(16);           // below the grid: full speed, capped
    expect(v(170)).toBeLessThan(0);    // under the sticky header
    expect(v(120)).toBe(-16);
    expect(v(200)).toBe(0);
  });
});
