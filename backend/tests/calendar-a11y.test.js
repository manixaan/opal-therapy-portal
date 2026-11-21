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

describe('Skip to calendar (Q-07, 21 Nov 2026)', () => {
  test('first in the shell, hidden until focused, Calendar tab only, teal focus ring', () => {
    const body = HTML.slice(HTML.indexOf('<body>'), HTML.indexOf('<header data-help="app-header">'));
    expect(body).toContain('<a class="skip-link" id="skip-to-calendar" href="#cal-grid">Skip to calendar</a>');
    const css = HTML.slice(HTML.indexOf('.skip-link:not(:focus) {'), HTML.indexOf('body:not(:has(#view-calendar.active)) .skip-link { display: none; }') + 80);
    expect(css).toMatch(/clip-path: inset\(50%\)/);
    expect(css).toMatch(/\.skip-link:focus \{[\s\S]*box-shadow: var\(--shadow-md\), var\(--focus-ring\);/);
    expect(css).toContain('body:not(:has(#view-calendar.active)) .skip-link { display: none; }');
  });

  function env(cols) {
    const dom = new JSDOM('<section id="view-calendar" class="view active"><div class="cal-view" id="cal-view-week"><div id="cal-grid">' +
      cols.map(([day, tops]) => '<div class="cal-col" id="day-' + day + '" data-day="' + day + '">' +
        tops.map((t, i) => '<div class="session" tabindex="0" data-id="' + day + i + '" data-top="' + t + '"></div>').join('') + '</div>').join('') +
      '</div></div></section>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.Element.prototype.getClientRects = function () { return [1]; };
    w.Element.prototype.getBoundingClientRect = function () { const t = Number(this.dataset.top || 0); return { top: t, bottom: t + 20 }; };
    w.eval(fnSrc('function focusCalendarStart('));
    return w;
  }

  test('Enter lands on the earliest tile of the first day that has one', () => {
    const w = env([['mon', []], ['tue', [600, 300, 450]], ['wed', [100]]]);
    w.eval('focusCalendarStart()');
    expect(w.document.activeElement.dataset.id).toBe('tue1');
  });

  test('an empty week lands on today\'s column, else the first visible one', () => {
    const w = env([['mon', []], ['tue', []]]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date());
    w.eval('var DAY_DATES = { mon: "2001-01-01", tue: "' + today + '" };');
    w.eval('focusCalendarStart()');
    expect(w.document.activeElement.id).toBe('day-tue');
    expect(w.document.activeElement.getAttribute('tabindex')).toBe('-1');
    const w2 = env([['mon', []], ['tue', []]]);
    w2.eval('focusCalendarStart()');
    expect(w2.document.activeElement.id).toBe('day-mon');
  });

  test('the link is wired to it and does not jump the page', () => {
    expect(HTML).toContain("link.addEventListener('click', (e) => { e.preventDefault(); focusCalendarStart(); });");
  });
});
