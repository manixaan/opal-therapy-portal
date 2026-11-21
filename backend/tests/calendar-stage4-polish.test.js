/**
 * Stage 4 sweep (CONSOLIDATED C-07, C-22, C-24, C-25, U-14, P-10): the small
 * remaining calendar items. Each was reproduced and re-checked in the stubbed
 * harness (fix/stage4/probe-open.js, menu.js, u14.js); these pin the code.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FE = path.join(__dirname, '../../frontend/current');
const HTML = fs.readFileSync(path.join(FE, 'mockup_v3.html'), 'utf8');
const BR = fs.readFileSync(path.join(FE, 'booking-route.js'), 'utf8');

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

describe('C-07 Day view titles its day and keeps it across a Week round trip', () => {
  test('__applyDayFocus records the shown day as the selected day and labels it', () => {
    const label = { textContent: '' };
    const ctx = {
      window: { __currentWeekMonday: new Date(Date.UTC(2026, 10, 23)) },
      document: { querySelectorAll: () => [], getElementById: () => label },
      __ALL_DAYS: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      Date,
    };
    vm.createContext(ctx);
    vm.runInContext(fnSrc('function __applyDayFocus(offset) {') + '; __applyDayFocus(3);', ctx);
    expect(ctx.window.__selectedDate.toISOString().slice(0, 10)).toBe('2026-11-26');
    expect(label.textContent).toMatch(/26 Nov 2026/);
  });
  test('setCalendarMode(day) focuses through __applyDayFocus (title + selected day)', () => {
    expect(fnSrc('function setCalendarMode(mode) {')).toContain('__applyDayFocus(focusIdx);');
  });
});

describe('C-24 / C-25 Scheduler and Month chrome', () => {
  test('Scheduler view hides the toolbar date, arrows and Today (it has its own)', () => {
    expect(HTML).toContain('.cal-topbar:has(.view-tab[data-view="master"].active) :is(.toolbar-divider, .btn-today, .nav-arrow, #week-label) { display: none; }');
  });
  test('every month date sits in one 24 px box; the selected day is teal, not blue', () => {
    const at = HTML.indexOf('  .month-cell .month-date {');
    const rule = HTML.slice(at, HTML.indexOf('}', at));
    expect(rule).toContain('height: 24px; display: flex; align-items: center;');
    const today = HTML.slice(HTML.indexOf('  .month-cell.today .month-date {'), HTML.indexOf('}', HTML.indexOf('  .month-cell.today .month-date {')));
    expect(today).not.toMatch(/inline-flex/);
    expect(HTML).toContain('.month-cell.selected-day { background: var(--accent-soft);');
  });
});

describe('U-14 a slow create does not pull the user back', () => {
  test('confirmBooking snapshots tab + week at submit and navigates only if unchanged', () => {
    const src = fnSrc('async function confirmBooking() {');
    expect(src).toContain('const _navAtSubmit = __bookingNavSnapshot();');
    expect((src.match(/const _stay = __bookingUserMoved\(_navAtSubmit\);/g) || []).length).toBe(2);
    expect((src.match(/if \(!_stay && typeof switchTab === 'function'\)/g) || []).length).toBe(2);
    // the optimistic tile is drawn only on its own week
    expect(src).toContain("(!t.dateStr || __isVisibleWeekDate(t.dateStr)) ? document.getElementById('day-' + t.day) : null");
    expect(src).toContain('(_bookedFor || __bookingUserMoved(_navAtSubmit)) ? null');
  });
  test('__bookingUserMoved compares tab and week', () => {
    const ctx = { window: { __currentWeekMonday: new Date(Date.UTC(2026, 10, 23)) }, active: 'calendar',
      __ymd: (d) => d.toISOString().slice(0, 10) };
    ctx.document = { querySelector: () => ({ dataset: { tab: ctx.active } }) };
    vm.createContext(ctx);
    vm.runInContext(fnSrc('function __bookingNavSnapshot() {') + fnSrc('function __bookingUserMoved(snap) {'), ctx);
    const snap = vm.runInContext('__bookingNavSnapshot()', ctx);
    expect(vm.runInContext('__bookingUserMoved', ctx)(snap)).toBe(false);
    ctx.active = 'settings';
    expect(vm.runInContext('__bookingUserMoved', ctx)(snap)).toBe(true);
    ctx.active = 'calendar'; ctx.window.__currentWeekMonday = new Date(Date.UTC(2026, 10, 30));
    expect(vm.runInContext('__bookingUserMoved', ctx)(snap)).toBe(true);
  });
});

describe('C-22 context menus work from the keyboard', () => {
  test('role=menu, focus first item, arrows/Home/End, Enter, Tab closes, focus returns', () => {
    const src = fnSrc('(function calContextMenuKeys() {');
    expect(src).toContain("menu.setAttribute('role', 'menu')");
    expect(src).toContain("it.setAttribute('role', 'menuitem')");
    expect(src).toMatch(/items\[0\]\.focus/);
    for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab']) expect(src).toContain(`'${k}'`);
    expect(src).toMatch(/back\.focus\(/);
    expect(src).toContain(".observe(document.body, { childList: true })");
  });
});

describe('P-10 idle work', () => {
  test('the booking-route 600 ms tick runs only while the booking panel is open', () => {
    const at = BR.indexOf('setInterval(function () {');
    expect(BR.slice(at, at + 200)).toMatch(/classList\.contains\('bsp-open'\)\) return;/);
  });
});
