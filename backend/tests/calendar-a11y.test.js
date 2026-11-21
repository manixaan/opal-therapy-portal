/**
 * Stage 4 accessibility (CONSOLIDATED §4.3: Q-06, Q-07, Q-08). Verified with
 * real Tab / Enter / Escape in the stubbed harness (fix/stage4/a11y.js):
 * focus lands in the drawer / booking panel, Tab never leaves it (0 of 25),
 * Escape or Close returns to the tile (re-found by id; the next tile after a
 * delete), the mini month is one Tab stop, tiles and the toast have roles.
 * These guards pin the code that produced those results.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');

function fnSrc(sig) {
  const at = HTML.indexOf(sig);
  expect(at).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = HTML.indexOf('{', at); i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}' && --depth === 0) return HTML.slice(at, i + 1);
  }
  throw new Error('unterminated ' + sig);
}

describe('sheets are dialogs that hold and return focus (Q-06)', () => {
  test('drawer and booking panel are labelled modal dialogs with focusable titles', () => {
    expect(HTML).toContain('id="detail-drawer" data-help="detail-panel" role="dialog" aria-modal="true" aria-labelledby="bd-title"');
    expect(HTML).toContain('id="bd-title" tabindex="-1"');
    expect(HTML).toContain('id="booking-side-panel" data-help="booking-panel" role="dialog" aria-modal="true" aria-labelledby="bsp-title"');
    expect(HTML).toContain('id="bsp-title" tabindex="-1"');
  });

  test('one focus manager: inert when closed, focus in on open, Tab trapped, focus back on close', () => {
    const src = fnSrc('window.__sheetFocus = (function () {');
    expect(src).toContain("'detail-drawer':      { cls: 'show', title: 'bd-title' }");
    expect(src).toContain("'booking-side-panel': { cls: 'open', title: 'bsp-title' }");
    expect(src).toMatch(/el\.setAttribute\('inert', ''\)/);
    expect(src).toMatch(/el\.removeAttribute\('inert'\)/);
    expect(src).toMatch(/e\.key !== 'Tab'/);
    // a dialog stacked above the sheet keeps its own focus
    expect(src).toMatch(/closest\('\[role="dialog"\], \[aria-modal="true"\]'\)/);
    // the tile is found again by id (a save may redraw it); a deleted one hands over to the next
    expect(src).toMatch(/querySelector\('\[data-id="' \+ esc \+ '"\]'\)/);
    expect(src).toMatch(/t\.offsetTop >= rec\.top/);
    // never steals focus that already moved somewhere on purpose
    expect(src).toMatch(/if \(!focusWasInside\) return;/);
  });

  test('openBlockDetail tells the manager which tile it shows (switching tiles retargets the return)', () => {
    expect(fnSrc('function openBlockDetail(id) {')).toContain('window.__sheetFocus.showing(s.element)');
  });

  test('hovering the grid no longer pulls focus off a tile or control', () => {
    const at = HTML.indexOf("grid.addEventListener('mouseenter'");
    const block = HTML.slice(at, HTML.indexOf('});', at));
    expect(block).toMatch(/if \(a && a !== document\.body && a !== document\.documentElement\) return;/);
  });

  test('the delete confirm keeps Tab on its two buttons and gives focus back on close', () => {
    expect(fnSrc('function closeDeleteEventModal() {')).toMatch(/opener\.focus\(\)/);
    expect(fnSrc('function __delEventEscape(e) {')).toMatch(/e\.key === 'Tab'/);
    expect(fnSrc('function openDeleteEventModal(')).toContain('__delEventOpener =');
  });
});

describe('mini month is one Tab stop with arrow keys (Q-07)', () => {
  test('roving tabindex and ±1/±7 arrows', () => {
    const src = fnSrc('function renderMiniCal(keepAnchor) {');
    expect(src).toMatch(/c\.tabIndex = c === stop \? 0 : -1/);
    expect(src).toContain('{ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }');
  });
});

describe('tiles and toasts are announced (Q-08)', () => {
  test('a tile is a button named by title, day, time and place', () => {
    const src = fnSrc('function addSession(col, opts) {');
    expect(src).toContain("el.setAttribute('role', 'button')");
    expect(src).toMatch(/el\.setAttribute\('aria-label', \[opts\.title \|\| '\(No subject\)', DAY_FULL\[opts\.day\] \|\| '', timeStr, locTip/);
  });

  test('the toast is a live region before its first message: status for news, alert for failures', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(fnSrc('function showToast('));
    w.showToast();                                   // boot: region exists, nothing shown
    const t = w.document.getElementById('admin-toast');
    expect(t.getAttribute('role')).toBe('status');
    expect(t.getAttribute('aria-live')).toBe('polite');
    expect(t.textContent).toBe('');
    expect(t.style.opacity).toBe('0');
    w.showToast('Saved');
    expect([t.getAttribute('role'), t.getAttribute('aria-live'), t.style.opacity]).toEqual(['status', 'polite', '1']);
    w.showToast('Could not save', true);
    expect([t.getAttribute('role'), t.getAttribute('aria-live')]).toEqual(['alert', 'assertive']);
    w.close();
    expect(HTML).toMatch(/if \(document\.body\) showToast\(\); else document\.addEventListener\('DOMContentLoaded'/);
  });
});
