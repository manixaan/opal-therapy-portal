'use strict';

/**
 * EVENT DRAWER ↔ TILE CONSISTENCY (20 Nov 2026).
 *
 * A calendar tile showed an event correctly but its detail drawer did not:
 *   - the drawer built its own heading from the booking leaf or the broad
 *     type, so "Dentist" opened as "Admin / Case noting", a Custom "Car
 *     service" as "Custom", and "Client Appointment - Jane Citizen" lost
 *     the client;
 *   - the Day row used the CURRENT week's dates for any week;
 *   - an overnight event ended at "2:00 PM" (26:00 on the 12-hour clock);
 *   - repeating appointments said "Doesn't repeat" (seriesId was dropped);
 *   - session ids were random per load, so #…!event/<id> links and the
 *     Scheduler (database ids) opened nothing;
 *   - closing the drawer and opening another before history.back() landed
 *     reopened the PREVIOUS event; switching A → B stacked history so
 *     closing B reopened A.
 * The shell functions are lifted out and run here; the routing rule is a
 * pure helper exported by navigation.js.
 */

const fs = require('fs');
const path = require('path');

const FRONT = path.join(__dirname, '..', '..', 'frontend', 'current');
const HTML = fs.readFileSync(path.join(FRONT, 'mockup_v3.html'), 'utf8');
const nav = require('../../frontend/current/navigation.js');

function fnSrc(name) {
  const i = HTML.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  return HTML.slice(i, HTML.indexOf('\n}\n', i) + 2);
}
function declSrc(re) {
  const m = HTML.match(re);
  if (!m) throw new Error('missing ' + re);
  return m[0];
}

const SRC = [
  declSrc(/var BOOKING_LEAVES = \{[\s\S]*?\n\};/),
  declSrc(/const TYPE_LABEL = \{[\s\S]*?\n\};/),
  declSrc(/const EVENT_TYPE_LABEL = .*;/),
  declSrc(/const _ACTIVITY_WORD_RE = .*;/),
  declSrc(/const _PERSON_NAME_RE = .*;/),
  'const DAY_LABEL = { mon: "Mon 16 Nov", tue: "Tue 17 Nov" };',
  'function fmtTime(h, m) { return String(h).padStart(2, "0") + ":" + String(m || 0).padStart(2, "0"); }',
  ...['typeFirstTitle', 'sessionKindLabel', 'sessionTitleText', 'sessionDrawerTitle', 'bdClientNames',
    'fmtClockTime', 'sessionDateLabel', 'isVirtualLocation', 'sessionIdForEvent', 'resolveSessionId'].map(fnSrc),
].join('\n');

const api = new Function('SESSIONS', SRC + '\nreturn { sessionKindLabel, sessionTitleText, sessionDrawerTitle, bdClientNames, fmtClockTime, sessionDateLabel, isVirtualLocation, sessionIdForEvent, resolveSessionId };');
const SESSIONS = {};
const F = api(SESSIONS);

const B = (kind, group, extra) => ({ booking: Object.assign({ kind, group }, extra || {}) });

describe('one title for tile and drawer', () => {
  const CASES = [
    // [what, session, drawer title, session type]
    ['direct service', { title: 'Client Appointment — Jo Bloggs', type: 'therapy', categories: ['Client Appointments'], clientName: 'Jo Bloggs', ...B('telehealth', 'direct', { clientName: 'Jo Bloggs' }) },
      'Client Appointment — Jo Bloggs', 'Telehealth Therapy Session'],
    ['EI direct service', { title: 'Client Appointment — Jo Bloggs', type: 'therapy', clientName: 'Jo Bloggs', ...B('therapy-ei', 'direct') },
      'Client Appointment — Jo Bloggs', 'Therapy Session – Early Intervention Under 9'],
    ['report', { title: 'Progress Report — Ann Lee', type: 'report', categories: ['Report Writing'], ...B('progress-report', 'report', { clientName: 'Ann Lee' }) },
      'Progress Report — Ann Lee', 'Progress Report'],
    ['case management, type report', { title: 'Case Management — Ann Lee', type: 'report', ...B('case-management', 'nf2f', { clients: [{ clientName: 'Ann Lee' }] }) },
      'Case Management — Ann Lee', 'Case Management'],
    ['nf2f, no clients', { title: 'Emails', type: 'admin', categories: ['Admin'], ...B('emails', 'nf2f') }, 'Emails', 'Emails'],
    ['nf2f, three clients', { title: 'Phone Calls — 3 clients', type: 'admin', ...B('phone-calls', 'nf2f', { clients: [{ clientName: 'A' }, { clientName: 'B' }, { clientName: 'C' }] }) },
      'Phone Calls — 3 clients', 'Phone Calls'],
    ['PD with its own name', { title: 'PD — Sensory workshop', type: 'cpd', categories: ['PD'], ...B('pd', 'other') },
      'PD — Sensory workshop', 'Professional development'],
    ['custom', { title: 'Car service', type: 'admin', categories: ['Admin'], ...B('custom', 'other') }, 'Car service', 'Custom'],
    ['travel block', { title: 'Travel — Perth to Mandurah', type: 'travel', categories: ['Travel'], ...B('travel-block', 'travel') },
      'Travel — Perth to Mandurah', 'Travel block'],
    ['flight', { title: 'Flight QF642 PER→SYD', type: 'travel', categories: ['Travel'], ...B('flight', 'flight') }, 'Flight QF642 PER→SYD', 'Flight'],
    ['Outlook, filed as Admin', { title: 'Dentist', type: 'admin', categories: ['Admin'] }, 'Dentist', 'Admin'],
    ['Outlook, name first', { title: 'Stephen Brown - Client Appointment', type: 'therapy', categories: ['Client Appointments'] },
      'Client Appointment - Stephen Brown', 'Client Appointments'],
    ['Outlook, client only in title', { title: 'Client Appointment - Jane Citizen', type: 'therapy', categories: ['Client Appointments'] },
      'Client Appointment - Jane Citizen', 'Client Appointments'],
    ['Splose import', { title: 'Client Appointment (booked in Splose)', type: 'therapy', clientName: 'Paula P' },
      'Client Appointment (booked in Splose) · Paula P', 'Therapy session'],
    ['Teams meeting', { title: 'Weekly huddle', type: 'teams_meeting', categories: [] }, 'Weekly huddle', 'Teams meeting'],
    ['all-day leave', { title: 'Annual leave', type: 'leave', categories: [] }, 'Annual leave', 'Leave'],
    ['no subject, category', { title: null, type: 'outlook', categories: ['Client Appointments'] }, 'Client Appointments', 'Client Appointments'],
    ['no subject at all', { title: '', type: 'outlook', categories: [] }, 'Untitled event', 'Outlook calendar event'],
    ['booking disagrees with category', { title: 'Progress Report — Cat P', type: 'lunch', categories: ['Lunch'], ...B('progress-report', 'report', { clientName: 'Cat P' }) },
      'Progress Report — Cat P', 'Progress Report'],
    ['reviewed block, Outlook title "Admin"', { title: 'Admin', type: 'report', categories: ['Admin'], ...B('case-management', 'nf2f', { clients: [{ clientName: 'Rev P' }] }) },
      'Admin · Rev P', 'Case Management'],
  ];
  test.each(CASES)('%s', (_what, s, title, kind) => {
    expect(F.sessionDrawerTitle(s)).toBe(title);
    expect(F.sessionKindLabel(s)).toBe(kind);
  });

  test('every Smart Booking leaf is named by its own label', () => {
    const leaves = new Function(declSrc(/var BOOKING_LEAVES = \{[\s\S]*?\n\};/) + '\nreturn BOOKING_LEAVES;')();
    for (const [kind, leaf] of Object.entries(leaves)) {
      expect(F.sessionKindLabel({ type: 'admin', categories: ['Admin'], booking: { kind } })).toBe(leaf.label);
    }
  });

  test('the tile and the drawer both read sessionTitleText', () => {
    const add = fnSrc('addSession');
    expect(add).toContain('sessionTitleText(opts)');
    expect(add).toContain(': typeFirstTitle(opts.title);');
    const open = HTML.slice(HTML.indexOf('function openBlockDetail(id)'), HTML.indexOf('function bdClientNames(s)'));
    expect(open).toContain("document.getElementById('bd-title').textContent = sessionDrawerTitle(s);");
    expect(open).not.toContain('_titleWho');
  });
});

describe('clients', () => {
  test('a nf2f block lists its own clients even when the row names one', () => {
    expect(F.bdClientNames({ clientName: 'X', booking: { group: 'nf2f', clients: [{ clientName: 'A' }, { clientName: 'B' }] } })).toEqual(['A', 'B']);
    expect(F.bdClientNames({ clientName: 'Bo B' })).toEqual(['Bo B']);
    expect(F.bdClientNames({ booking: { clientName: 'Cy C' } })).toEqual(['Cy C']);
  });
});

describe('time and day', () => {
  test('an end past midnight reads as the next morning', () => {
    expect(F.fmtClockTime(26, 0)).toBe('02:00 (next day)');
    expect(F.fmtClockTime(24, 0)).toBe('00:00 (next day)');
    expect(F.fmtClockTime(17, 30)).toBe('17:30');
  });
  test('the date is the event\'s own, not this week\'s', () => {
    expect(F.sessionDateLabel({ day: 'mon', startTimeIso: '2026-11-23T01:00:00.000Z' })).toMatch(/23 Nov/);
    expect(F.sessionDateLabel({ day: 'mon', startTimeIso: '2026-11-08T17:00:00.000Z' })).toMatch(/9 Nov/); // Perth is +8
    expect(F.sessionDateLabel({ day: 'tue' })).toBe('Tue 17 Nov');
    const open = HTML.slice(HTML.indexOf('function openBlockDetail(id)'), HTML.indexOf('function bdClientNames(s)'));
    expect(open).toContain("sessionDateLabel(s)");
    expect(open).not.toContain('DAY_LABEL[s.day]');
  });
});

describe('location', () => {
  test('a meeting link is not an address', () => {
    expect(F.isVirtualLocation('Microsoft Teams Meeting')).toBe(true);
    expect(F.isVirtualLocation('https://zoom.us/j/1')).toBe(true);
    expect(F.isVirtualLocation('12 Smith Street, Willetton WA 6155')).toBe(false);
    expect(F.isVirtualLocation('')).toBe(false);
  });
});

describe('stable session ids', () => {
  test('a stored event keeps one id across loads; dbId and E-key both resolve', () => {
    const id = F.sessionIdForEvent('01f017d4-2dac-4331-9b53-d83f18f8cbc4');
    expect(id).toBe('E-01f017d4-2dac-4331-9b53-d83f18f8cbc4');
    expect(F.sessionIdForEvent("x'); alert(1); ('")).toBe('E-xalert1');
    expect(F.sessionIdForEvent(null)).toBeNull();
    SESSIONS[id] = { dbId: '01f017d4-2dac-4331-9b53-d83f18f8cbc4' };
    SESSIONS['S-MON-abcde'] = { dbId: 'other-row' };
    expect(F.resolveSessionId(id)).toBe(id);
    expect(F.resolveSessionId('01f017d4-2dac-4331-9b53-d83f18f8cbc4')).toBe(id);
    expect(F.resolveSessionId('other-row')).toBe('S-MON-abcde');
    expect(F.resolveSessionId('nope')).toBeNull();
  });

  test('loaded tiles use it, and carry the series and notes the drawer reads', () => {
    const merge = fnSrc('mergeEventsIntoDayData');
    expect((merge.match(/id: sessionIdForEvent\(session\.dbId\)/g) || []).length).toBe(2); // timed + all-day
    expect(merge).toContain('seriesId: session.seriesId || null');
    expect(merge).toContain("notesHtml: session.notesHtml || ''");
    expect(merge).toContain('session.sessionId = id;');
  });

  test('an unknown id is parked for after the load, then opened once', () => {
    const open = fnSrc('openBlockDetail');
    expect(open).toContain('resolveSessionId(id)');
    expect(open).toContain('window.__pendingEventDetailId = String(id)');
    expect(fnSrc('renderCurrentWeek')).toContain('__openPendingEventDetail();');
  });

  test('the Today agenda opens its tile by id, not by a serialised row', () => {
    const row = fnSrc('dayRowHTML');
    expect(row).not.toContain('openBlockDetail(${JSON.stringify(r)');
    expect(row).toContain('r.sessionId');
    expect(row).toContain('escapeHtml(sessionTitleText(r))');
  });
});

describe('drawer history (navigation.js)', () => {
  const d = nav.decodeRoute;
  test('switching the drawer to another event REPLACES, so close goes back to the calendar', () => {
    expect(nav.overlayWriteMode(d('#calendar/week!event/E-a'), d('#calendar/week!event/E-b'))).toBe('replace');
    expect(nav.overlayWriteMode(d('#calendar/week'), d('#calendar/week!event/E-b'))).toBe('push');
    expect(nav.overlayWriteMode(d('#calendar/week!event/E-a'), d('#calendar/week!event/E-a'))).toBe('replace');
    expect(nav.overlayWriteMode(d('#calendar/week!booking'), d('#calendar/week!event/E-a'))).toBe('push');
    expect(nav.overlayWriteMode(null, d('#calendar/week!event/E-a'))).toBe('replace');
  });

  test('an overlay opened while a close is in flight is written after the pop, not under it', () => {
    const src = fs.readFileSync(path.join(FRONT, 'navigation.js'), 'utf8');
    const open = src.slice(src.indexOf('function openOverlay('), src.indexOf('function closeOverlay('));
    expect(open).toContain('if (backPending()) { NAV.deferredOverlay = next; return; }');
    const close = src.slice(src.indexOf('function closeOverlay('), src.indexOf('function supportPopOpen('));
    expect(close).toContain('NAV.pendingBackAt = now;');
    expect(close).toMatch(/backPending\(\) && NAV\.deferredOverlay[\s\S]*NAV\.deferredOverlay = null;\s*return;/);
    const pop = src.slice(src.indexOf("addEventListener('popstate'"), src.indexOf("addEventListener('hashchange'"));
    expect(pop).toMatch(/if \(backPending\(\)\) \{[\s\S]*if \(deferred\) \{[\s\S]*writeRoute\(deferred[\s\S]*return;/);
  });
});

// 19 Nov 2026 — the side panel can move an event to another date: same start, same duration.
describe('side panel: change the day', () => {
  const fs2 = require('fs');
  const SHELL2 = fs2.readFileSync(require('path').join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');
  const day = SHELL2.slice(SHELL2.indexOf('function bdPerthDate(iso) {'), SHELL2.indexOf('/* ---------- Editable-time flow inside detail drawer ---------- */'));
  test('the Day row offers Change for a movable, saved, timed event', () => {
    expect(SHELL2).toContain("const _canMoveDay = MOVABLE_TYPES.has(s.type) && !s.cancelled && !s.allDay && s.endH < 24 && !!s.dbId && !!s.startTimeIso;");
    expect(SHELL2).toContain(`onclick="bdDayEdit('\${id}', true)">Change</button>`);
  });
  test('this week: the drag path (evaluateMove → commitMove / openMoveImpact) at the same start and duration', () => {
    expect(day).toMatch(/const startMin = s\.startH \* 60 \+ \(s\.startM \|\| 0\), dur = durMin\(s\);/);
    expect(day).toMatch(/const impact = evaluateMove\(id, key, startMin, dur\);[\s\S]*pendingMove = \{ id, day: key, startMin, duration: dur, impact \}; commitMove\(\);[\s\S]*openMoveImpact\(id, key, startMin, dur, impact\)/);
  });
  test('another week: the same PATCH a move uses, Perth times, then a reload', () => {
    expect(day).toContain("fetch('/api/outlook/events/' + encodeURIComponent(s.dbId), {");
    expect(day).toContain('const startIso = `${ymd}T${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}:00+08:00`;');
    expect(day).toContain("loadOutlookEventsToCalendar()");
  });
  test('bdPerthDate reads the Perth calendar day', () => {
    const fn = new Function(day.slice(0, day.indexOf('function bdDayEdit')) + '; return bdPerthDate;')();
    expect(fn('2026-11-16T17:30:00Z')).toBe('2026-11-17');   // 1:30 am Perth next day
    expect(fn('2026-11-17T01:00:00Z')).toBe('2026-11-17');
  });
});
