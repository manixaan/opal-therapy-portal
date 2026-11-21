/**
 * C-04 / C-20: the now-line is drawn only on today's column of the visible
 * week, in Perth time, and moves every minute; Today brings "now" into view.
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

function makeDom() {
  const cols = {};
  const lines = [];
  const mk = (id) => ({ id, appendChild(n) { n.parentId = id; lines.push(n); } });
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach((k) => { cols['day-' + k] = mk('day-' + k); });
  return {
    lines,
    document: {
      getElementById: (id) => cols[id] || null,
      querySelectorAll: () => lines.splice(0).map((n) => ({ remove() {} })),
      createElement: () => ({ style: {}, setAttribute() {} }),
    },
  };
}

function run(nowIso, mondayYmd) {
  const dom = makeDom();
  const perthFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const RealDate = Date;
  const FakeDate = class extends RealDate { constructor(...a) { super(...(a.length ? a : [nowIso])); } };
  const f = new Function('document', 'window', 'Date', '__perthParts', '__ymd', 'tToY',
    fnSrc('updateNowLine') + '; updateNowLine();');
  f(dom.document, { __currentWeekMonday: new RealDate(mondayYmd + 'T00:00:00Z') }, FakeDate,
    (d) => Object.fromEntries(perthFmt.formatToParts(d).map((p) => [p.type, p.value])),
    (d) => d.toISOString().slice(0, 10),
    (h, m = 0) => (h + m / 60) * 72);
  return dom.lines;
}

describe('now-line', () => {
  test('drawn on today\'s column at Perth time', () => {
    const l = run('2026-11-25T02:15:00Z', '2026-11-23'); // 10:15 Perth, Wed
    expect(l.map((n) => [n.parentId, n.style.top])).toEqual([['day-wed', '738px']]);
  });
  test('not drawn on another week', () => {
    expect(run('2026-11-25T02:15:00Z', '2026-11-30')).toEqual([]);
    expect(run('2026-11-25T02:15:00Z', '2026-11-16')).toEqual([]);
  });
  test('Perth date, not the browser\'s: 23:30 UTC Tue is Wed 07:30 in Perth', () => {
    const l = run('2026-11-24T23:30:00Z', '2026-11-23');
    expect(l.map((n) => [n.parentId, n.style.top])).toEqual([['day-wed', '540px']]);
  });
  test('moves every minute and is redrawn with the week', () => {
    expect(HTML).toContain('setInterval(updateNowLine, 60 * 1000);');
    expect(fnSrc('renderCurrentWeek')).toContain('updateNowLine();');
    expect(HTML).not.toContain('nl.style.top = tToY(now.getHours(), now.getMinutes())');
  });
  test('Today scrolls to now − 2 h and does not re-render the week it is already on', () => {
    expect(fnSrc('scrollGridToNow')).toContain('- 2 * HOUR_PX');
    const g = fnSrc('gotoThisWeek');
    expect(g).toContain('if (same) updateNowLine(); else renderCurrentWeek();');
    expect(g).toContain('scrollGridToNow();');
  });
});
