'use strict';

/**
 * The booking sheet docks left for late-week days (22 Nov 2026): a time
 * picked on a day the right-hand sheet would cover (Fri/Sat/Sun in a week
 * view) opens the sheet from the left so the picked day stays visible.
 * Measured from the column, not a list of days.
 */
const fs = require('fs');
const path = require('path');
const SHELL = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');

const src = SHELL.slice(SHELL.indexOf('function _bspSideFor(day) {'), SHELL.indexOf('function _bspPlacePanel(opts) {'));

// Week view at 1440 px as the portal lays it out (sidebar + time gutter,
// then seven ~164 px columns starting at 275 px).
function sideFor(day, { vw = 1440, panelW = 440, cols } = {}) {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const layout = cols || Object.fromEntries(days.map((d, i) => [d, [275 + i * 164.5, 275 + (i + 1) * 164.5]]));
  const document = {
    querySelector(sel) {
      const d = (sel.match(/data-day="(\w+)"/) || [])[1];
      if (!layout[d]) return null;
      const [left, right] = layout[d];
      return { getBoundingClientRect: () => ({ left, right, width: right - left }) };
    },
    getElementById: () => ({ offsetWidth: panelW }),
  };
  const window = { innerWidth: vw };
  return new Function('document', 'window', `${src}; return _bspSideFor(${JSON.stringify(day)});`)(document, window);
}

test('Fri, Sat and Sun dock the sheet left; Mon–Thu keep it on the right', () => {
  expect(['mon', 'tue', 'wed', 'thu'].map(d => sideFor(d))).toEqual(['right', 'right', 'right', 'right']);
  expect(['fri', 'sat', 'sun'].map(d => sideFor(d))).toEqual(['left', 'left', 'left']);
});

test('Fri, Sat and Sun dock left on a wide monitor too, where the sheet stops short of them', () => {
  // 2560 px: seven ~326 px columns; the 440 px sheet only reaches Sunday.
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const cols = Object.fromEntries(days.map((d, i) => [d, [275 + i * 326, 275 + (i + 1) * 326]]));
  expect(days.map(d => sideFor(d, { vw: 2560, cols }))).toEqual(['right', 'right', 'right', 'right', 'left', 'left', 'left']);
});

test('a narrow window also docks left for a weekday the sheet would mostly cover', () => {
  // 1024 px: Thursday (469–605) loses ~20 px — stays right; at 900 px it loses most.
  expect(sideFor('thu', { vw: 1024, cols: { thu: [469, 605] } })).toBe('right');
  expect(sideFor('thu', { vw: 900, cols: { thu: [420, 540] } })).toBe('left');
});

test('a sliver clipped off a column does not move the sheet', () => {
  // 1024 px: the sheet clips only ~20 px off Thursday.
  const cols = { thu: [469, 605], sat: [740, 876] };
  expect(sideFor('thu', { vw: 1024, cols })).toBe('right');
  expect(sideFor('sat', { vw: 1024, cols })).toBe('left');
});

test('day view, a narrow window, or no day leave the sheet where it is', () => {
  expect(sideFor('sat', { cols: { sat: [63, 1440] } })).toBe('right');
  expect(sideFor('sat', { vw: 480, panelW: 440, cols: { sat: [300, 480] } })).toBe('right');
  expect(sideFor(undefined)).toBe(null);
});

test('the open path places the sheet, and a left-docked sheet slides in from the left', () => {
  const open = SHELL.slice(SHELL.indexOf('function openBookingPanel('), SHELL.indexOf('function closeBookingPanel('));
  expect(open).toMatch(/_bspPlacePanel\(opts\);\s+document\.getElementById\('booking-side-panel'\)\.classList\.add\('open'\);/);
  expect(SHELL).toMatch(/#booking-side-panel\.dock-left \{[^}]*left: 0;[^}]*translateX\(-102%\)/);
  expect(SHELL).toContain('#booking-side-panel.dock-left.open { transform: none; }');
});
