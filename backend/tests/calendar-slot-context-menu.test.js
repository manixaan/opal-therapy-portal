'use strict';

/**
 * Right-click on empty calendar time opens the portal's own menu, never the
 * browser's (22 Nov 2026): "Book at <time>" (same as a plain click) and, in
 * Week view, "Open <day> in Day view".
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SHELL = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');
const src = SHELL.slice(SHELL.indexOf('function _calColContextMenu(e) {'), SHELL.indexOf('function handleCalendarSlotClick() {}'));

function makeEnv({ mode = 'week' } = {}) {
  const dom = new JSDOM('<!doctype html><body><div class="cal-col" data-day="wed"></div></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(`
    var calls = [];
    window.__calendarMode = ${JSON.stringify(mode)};
    var DAY_DATES = { wed: '2026-11-25' };
    var _bspOpen = false;
    function calYToMinutes() { return 12 * 60 + 30; }
    function fmtTime(h, m) { return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); }
    function opIcon() { return ''; }
    function escapeHtml(s) { return String(s); }
    function closeCalContextMenu() { var m = document.getElementById('cal-ctx-menu-active'); if (m) m.remove(); }
    function openBookingPanel(o) { calls.push(['book', o]); }
    function switchToCalDay(d) { calls.push(['day', d.toISOString()]); }
    ${src}
    document.querySelector('.cal-col').addEventListener('contextmenu', _calColContextMenu);
  `);
  const col = win.document.querySelector('.cal-col');
  const ev = new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
  col.dispatchEvent(ev);
  const items = () => Array.from(win.document.querySelectorAll('#cal-ctx-menu-active .cal-ctx-menu-item'));
  return { win, ev, items };
}

test('empty-slot right-click suppresses the browser menu and shows the portal menu', () => {
  const { ev, items } = makeEnv();
  expect(ev.defaultPrevented).toBe(true);
  const labels = items().map(i => i.textContent.trim());
  expect(labels[0]).toBe('Book at 12:30 PM');
  expect(labels[1]).toMatch(/^Open Wed,? 25 Nov in Day view$/);   // ICU builds differ on the comma
  expect(labels).toHaveLength(2);
});

test('"Book at" opens the booking sheet at that slot, an hour long', () => {
  const { win, items } = makeEnv();
  expect(items()[0].getAttribute('onclick')).toBe('_calSlotMenuBook()');
  win.eval('_calSlotMenuBook()');
  expect(win.eval('calls')).toEqual([['book', { day: 'wed', date: '2026-11-25', startH: 12, startM: 30, endH: 13, endM: 30, keepState: false }]]);
  expect(win.document.getElementById('cal-ctx-menu-active')).toBeNull();
});

test('"Open in Day view" goes to that date; Day view itself does not offer it', () => {
  const { win, items } = makeEnv();
  expect(items()[1].getAttribute('onclick')).toBe('_calSlotMenuDay()');
  win.eval('_calSlotMenuDay()');
  expect(win.eval('calls')).toEqual([['day', '2026-11-25T00:00:00.000Z']]);
  expect(makeEnv({ mode: 'day' }).items().map(i => i.textContent.trim())).toEqual(['Book at 12:30 PM']);
  expect(win.document.getElementById('cal-ctx-menu-active')).toBeNull();
});
