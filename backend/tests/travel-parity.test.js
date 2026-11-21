'use strict';

/**
 * Browser ↔ server travel parity (audit T-04, 21 Nov 2026).
 *
 * The calendar draws a day's legs in the browser (frontend/current/travel.js
 * `computeDayTravelSegments`) and billing rebuilds them on the server
 * (backend/billing/day-route.js `buildDayLegs`, priced from route-facts.js).
 * Nothing used to run both on the same day, so a rule change on one side could
 * silently invoice a route the therapist never saw.
 *
 * Each case below is ONE synthetic day, fed to both sides:
 *   • browser: travel.js in a vm (as travel-physical-route.test.js does);
 *   • server:  buildDayLegs over the sessions the billing pipeline would hand
 *     it — in-person, located, client therapy sessions only (invoice-generation
 *     step 4 + session-billing evaluateEvent; telehealth and all-day are not
 *     route stops there).
 * Both sides price legs from the same minute table, keyed by canonAddr, so the
 * comparison is: which legs, in which order, from where to where, belonging to
 * which appointment, and how many minutes.
 *
 * This file pins the rules; it changes neither. Where the two genuinely
 * disagree the case is a `test.failing` under "known divergences" — the owner
 * decides which side is right. When one is resolved, its test starts passing,
 * jest reports the `test.failing` as a failure, and it moves up into the
 * parity block.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const DR = require('../billing/day-route');
const { canonAddr } = require('../billing/route-facts');

const SRC = fs.readFileSync(path.join(__dirname, '../../frontend/current/travel.js'), 'utf8');

const DATE = '2026-11-23';                 // a Monday
const HOME = { id: 'home-1', label: 'Home', addr: '1 Example St, Willetton WA 6155', suburb: 'Willetton', kind: 'local' };
const HOME2 = { id: 'home-2', label: 'Unit', addr: '9 Sample Way, Como WA 6152', suburb: 'Como', kind: 'local' };
const REMOTE = { id: 'remote-1', label: 'Remote', kind: 'remote' };
const OSBORNE = '10 Example Rd, Osborne Park WA 6017';
const JOONDALUP = '20 Example Ave, Joondalup WA 6027';
const SCHOOL = '5 Example Cres, Scarborough WA 6019';
const CAFE = '3 Example Lane, Leederville WA 6007';

/* One minute table for both sides, by suburb, either direction. */
const TABLE = {
  'willetton|osborne park': 25, 'osborne park|joondalup': 30, 'joondalup|willetton': 40,
  'osborne park|scarborough': 15, 'scarborough|joondalup': 20, 'willetton|scarborough': 35,
  'como|osborne park': 18, 'como|joondalup': 33, 'leederville|osborne park': 8,
  'leederville|joondalup': 24, 'como|willetton': 12,
};
const SUBURB_OF = [[/willetton/, 'willetton'], [/osborne park/, 'osborne park'], [/joondalup/, 'joondalup'],
  [/scarborough/, 'scarborough'], [/como/, 'como'], [/leederville/, 'leederville']];
function suburbKey(addr) {
  const c = canonAddr(addr);
  const hit = SUBURB_OF.find(([re]) => re.test(c));
  return hit ? hit[1] : c;
}
function minutes(a, b) {
  if (!a || !b || canonAddr(a) === canonAddr(b)) return 0;
  const sa = suburbKey(a), sb = suburbKey(b);
  if (sa === sb) return 0;
  return TABLE[sa + '|' + sb] || TABLE[sb + '|' + sa] || 22;
}

/* ---------- browser side ---------- */
function loadBrowser(dayBaseId) {
  const noop = () => {};
  const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [], setAttribute: noop });
  const bases = { 'home-1': HOME, 'home-2': HOME2, 'remote-1': REMOTE };
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Map, Set, Date, Math, JSON,
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), activeElement: null },
    START_H: 0, END_H: 24, HOUR_PX: 72, WORK_S: 8, WORK_E: 18,
    tToY: (h, m = 0) => (h + m / 60) * 72,
    WORK_BASES: { office: {}, homes: [HOME, HOME2, REMOTE] }, LOCATIONS: {},
    getBase: (id) => bases[id] || null,
    sessionStartMin: (s) => s.startH * 60 + (s.startM || 0),
    sessionEndMin: (s) => s.endH * 60 + (s.endM || 0),
    showToast: jest.fn(),
    fetch: jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
    SESSIONS: {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.__dayBaseId = dayBaseId;
  vm.runInContext('calendarWeekLocations = function () { return __dayBaseId ? { mon: __dayBaseId } : {}; };', ctx);
  ctx.travelMinutes = minutes;    // the engine never routes here; travelAt reads this
  return ctx;
}

const hm = (t) => t.split(':').map(Number);
function toBrowserSession(f) {
  const [sh, sm] = hm(f.at), [eh, em] = hm(f.to);
  const s = { id: f.id, dbId: 'db-' + f.id, day: 'mon', type: f.type || 'therapy', startH: sh, startM: sm, endH: eh, endM: em };
  if (f.client) s.patient = 'Client ' + f.id;
  if (f.address) s.address = f.address;
  if (f.telehealth) s.address = 'Microsoft Teams Meeting';
  if (f.allDay) s.allDay = true;
  if (f.title) s.title = f.title;
  if (f.travel) s.travel = JSON.parse(JSON.stringify(f.travel));
  return s;
}

const BROWSER_KIND = { start: 'OUTBOUND', end: 'RETURN' };
const VIA_KIND = { 'home-return': 'RETURN', 'place-in': 'RETURN', 'home-out': 'OUTBOUND', 'place-out': 'OUTBOUND' };
function browserLegs(day) {
  const c = loadBrowser(day.base === undefined ? 'home-1' : day.base);
  for (const f of day.events) c.SESSIONS[f.id] = toBrowserSession(f);
  return c.computeDayTravelSegments('mon')
    .filter((s) => s.kind !== 'gap' && !s.skipped && s.travelMin > 0)
    .map((s) => {
      const kind = BROWSER_KIND[s.kind] || (s.via ? VIA_KIND[s.via] : 'BETWEEN');
      const from = s.fromLoc.addr || s.fromLoc.suburb, to = s.toLoc.addr || s.toLoc.suburb;
      // Which appointment a leg is billed against: the session it leaves
      // (RETURN) or the one it reaches (OUTBOUND); a BETWEEN leg has both.
      const ev = kind === 'BETWEEN' ? `${s.fromSessionId}>${s.toSessionId}` : kind === 'RETURN' ? `${s.fromSessionId}>` : `>${s.toSessionId}`;
      return `${kind} ${ev} ${canonAddr(from)} -> ${canonAddr(to)} ${s.travelMin}`;
    });
}

/* ---------- server side ---------- */
function serverUser(baseId) {
  const user = { default_work_location: { homes: [HOME, HOME2, REMOTE] }, work_location_schedule: {} };
  if (baseId) user.work_location_schedule[DR.weekKeyForDate(DATE)] = { mon: baseId };
  return user;
}
const iso = (t) => new Date(`${DATE}T${t}:00+08:00`).toISOString();
/* What invoice-generation hands buildDayLegs: billable, in-person client sessions. */
function billingSessions(events) {
  return events
    .filter((f) => f.client && !f.telehealth && !f.allDay && f.address && (f.type || 'therapy') === 'therapy')
    .map((f) => ({ id: f.id, user_id: 'u1', client_id: 'c-' + f.id, event_type: 'therapy', start_time: iso(f.at), end_time: iso(f.to),
      location: f.address, custom_metadata: f.travel ? { travel: JSON.parse(JSON.stringify(f.travel)) } : {} }))
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
}
function serverLegs(day) {
  const user = serverUser(day.base === undefined ? 'home-1' : day.base);
  const { legs } = DR.buildDayLegs({ user, date: DATE, sessions: billingSessions(day.events), minutesFor: minutes });
  return legs.map((l) => {
    const ev = l.kind === 'BETWEEN' ? `${l.fromEventId}>${l.toEventId}` : l.kind === 'RETURN' ? `${l.fromEventId}>` : `>${l.toEventId}`;
    return `${l.kind} ${ev} ${canonAddr(l.origin)} -> ${canonAddr(l.destination)} ${minutes(l.origin, l.destination)}`;
  }).filter((l) => !/ 0$/.test(l));
}

const A = (o) => Object.assign({ client: true }, o);
const reviewHome = (side) => ({ [side]: { kind: 'base', id: 'home-1', purpose: 'home', source: 'block_review' } });

/* ---------- the shared days ---------- */
const PARITY = [
  ['one appointment: base → client → base',
    { events: [A({ id: 'a', at: '10:00', to: '11:00', address: OSBORNE })] }],
  ['consecutive different addresses chain in time order',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), A({ id: 'b', at: '10:30', to: '11:30', address: SCHOOL }),
      A({ id: 'c', at: '12:00', to: '13:00', address: JOONDALUP })] }],
  ['events listed out of time order are routed in time order',
    { events: [A({ id: 'c', at: '12:00', to: '13:00', address: JOONDALUP }), A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE })] }],
  ['same address back to back: no drive between (spelling differences included)',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), A({ id: 'b', at: '10:00', to: '11:00', address: '10 Example Rd, Osborne Park, WA, 6017, Australia' }),
      A({ id: 'c', at: '11:30', to: '12:30', address: JOONDALUP })] }],
  ['first client at the base address: no start leg',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: HOME.addr }), A({ id: 'b', at: '11:00', to: '12:00', address: OSBORNE })] }],
  ['a telehealth session between two visits is not a stop',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), A({ id: 't', at: '10:15', to: '10:45', telehealth: true }),
      A({ id: 'b', at: '11:30', to: '12:30', address: JOONDALUP })] }],
  ['an address-less admin block between two visits is not a stop',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), { id: 'x', at: '10:00', to: '10:30', type: 'admin', title: 'Emails' },
      A({ id: 'b', at: '11:00', to: '12:00', address: JOONDALUP })] }],
  ['long gap, no choice: Direct (19 Nov 2026 rule — no automatic trip home)',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), A({ id: 'b', at: '15:00', to: '16:00', address: JOONDALUP })] }],
  ['desk work in a long gap with no choice stays put, the gap stays Direct',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), { id: 'd', at: '11:00', to: '13:00', type: 'report', title: 'Report writing' },
      A({ id: 'b', at: '15:00', to: '16:00', address: JOONDALUP })] }],
  ['therapist chose "Via home" for the gap (travel.next = home)',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: { next: 'home' } }), A({ id: 'b', at: '15:00', to: '16:00', address: JOONDALUP })] }],
  ['therapist chose Direct for the gap (travel.next = direct)',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: { next: 'direct' } }), A({ id: 'b', at: '15:00', to: '16:00', address: JOONDALUP })] }],
  ['an all-day item is not a stop',
    { events: [A({ id: 'h', at: '00:00', to: '23:59', address: SCHOOL, allDay: true, title: 'Conference' }),
      A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), A({ id: 'b', at: '11:00', to: '12:00', address: JOONDALUP })] }],
  ['a persisted travel block is not a stop',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), { id: 'tb', at: '10:00', to: '10:30', type: 'travel', title: 'Travel to Joondalup', address: JOONDALUP },
      A({ id: 'b', at: '10:30', to: '11:30', address: JOONDALUP })] }],
  ['dragged legs (before/after offsets) move time, not the billed legs',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: { beforeOffsetMin: -60, afterOffsetMin: 20 } }),
      A({ id: 'b', at: '11:00', to: '12:00', address: JOONDALUP, travel: { beforeOffsetMin: -45, afterOffsetMin: 0 } })] }],
  ['the day starts somewhere else (first.before = an address)',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: { before: { kind: 'address', address: CAFE, label: 'Café' } } }),
      A({ id: 'b', at: '11:00', to: '12:00', address: JOONDALUP })] }],
  ['the day starts at another base (first.before = base)',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: { before: { kind: 'base', id: 'home-2' } } })] }],
  ['the day ends somewhere else (last.after = an address)',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }),
      A({ id: 'b', at: '11:00', to: '12:00', address: JOONDALUP, travel: { after: { kind: 'address', address: CAFE, label: 'Café' } } })] }],
  ['"Return Home" on the last stop follows the day\'s base, not the saved one',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: { after: { kind: 'base', id: 'home-2', purpose: 'home' } } })] }],
  ['"Go somewhere else" between two stops (own after, purpose elsewhere)',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: { after: { kind: 'address', address: CAFE, label: 'Café', purpose: 'elsewhere' } } }),
      A({ id: 'b', at: '13:00', to: '14:00', address: JOONDALUP })] }],
  ['"Go somewhere else", then Direct chosen since: Direct wins',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: { next: 'direct', after: { kind: 'address', address: CAFE, purpose: 'elsewhere' } } }),
      A({ id: 'b', at: '13:00', to: '14:00', address: JOONDALUP })] }],
  ['block review: "after: Home" on the earlier stop is a trip home',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: reviewHome('after') }), A({ id: 'b', at: '14:00', to: '15:00', address: JOONDALUP })] }],
  ['block review: "before: Home" on the later stop is a trip home',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), A({ id: 'b', at: '14:00', to: '15:00', address: JOONDALUP, travel: reviewHome('before') })] }],
  ['block review: an address answered between two stops is the place gone to',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: { after: { kind: 'address', address: CAFE, purpose: 'elsewhere', source: 'block_review' } } }),
      A({ id: 'b', at: '14:00', to: '15:00', address: JOONDALUP })] }],
  ['block review: "Home" after the earlier stop, but Direct chosen on it — Direct wins',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: Object.assign({ next: 'direct' }, reviewHome('after')) }),
      A({ id: 'b', at: '14:00', to: '15:00', address: JOONDALUP })] }],
  ['no base for the day: no start or end leg, between legs only',
    { base: null, events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), A({ id: 'b', at: '11:00', to: '12:00', address: JOONDALUP })] }],
  ['a remote base: no start or end leg',
    { base: 'remote-1', events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), A({ id: 'b', at: '11:00', to: '12:00', address: JOONDALUP })] }],
  ['a tight gap still bills the drive (both keep the leg, flagged tight on the calendar)',
    { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), A({ id: 'b', at: '10:05', to: '11:00', address: JOONDALUP })] }],
];

describe('browser and billing build the same legs for the same day (T-04)', () => {
  test.each(PARITY)('%s', (_name, day) => {
    const server = serverLegs(day);
    expect(server.length).toBeGreaterThan(0);
    expect(browserLegs(day)).toEqual(server);
  });

  test('the trip-home stay rule constant is the same number on both sides', () => {
    const c = loadBrowser('home-1');
    expect(vm.runInContext('TRAVEL_HOME_MIN_STAY', c)).toBe(DR.TRAVEL_HOME_MIN_STAY);
  });

  test('a sanity check: the comparison does see a different leg', () => {
    const day = { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }), A({ id: 'b', at: '11:00', to: '12:00', address: JOONDALUP })] };
    const tweaked = { events: [day.events[0], A({ id: 'b', at: '11:00', to: '12:00', address: SCHOOL })] };
    expect(browserLegs(day)).not.toEqual(serverLegs(tweaked));
  });
});

/* Genuine disagreements found when this file was written (21 Nov 2026).
   Neither rule is changed here — the owner decides which side is right. */
describe('known divergences — owner to decide (each is expected to fail)', () => {
  // The calendar's right-click "Not driving this" (travel.noDriveBefore /
  // noDriveAfter) drops the leg from the calendar and the Outlook mirror;
  // day-route.js never reads those flags, so billing still charges the drive.
  test.failing('"Not driving this" on a leg: the calendar drops it, billing still bills it', () => {
    const day = { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: { noDriveBefore: true } }),
      A({ id: 'b', at: '11:00', to: '12:00', address: JOONDALUP, travel: { noDriveAfter: true } })] };
    expect(browserLegs(day)).toEqual(serverLegs(day));
  });

  // Desk work the therapist chose to do "at home" (travel.desk = 'home') puts
  // them at the base on the calendar — the drive home and back out are drawn.
  // Billing only routes client sessions, so it bills a direct drive.
  test.failing('desk work chosen "at home" between two visits: calendar goes via home, billing bills Direct', () => {
    const day = { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }),
      { id: 'd', at: '11:00', to: '13:00', type: 'report', title: 'Report writing', travel: { desk: 'home' } },
      A({ id: 'b', at: '15:00', to: '16:00', address: JOONDALUP })] };
    expect(browserLegs(day)).toEqual(serverLegs(day));
  });

  // "Return Home" saved on the FIRST stop's before (purpose 'home') follows the
  // day's base on the calendar (resolveTravelPoint); day-route.js applies that
  // only to the last stop's after, so billing starts from the saved base.
  test.failing('"Home" as where the day starts follows the day\'s base on the calendar only', () => {
    const day = { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE, travel: { before: { kind: 'base', id: 'home-2', purpose: 'home' } } })] };
    expect(browserLegs(day)).toEqual(serverLegs(day));
  });
});

/* Documented on purpose in day-route.js ("Differences, deliberate for billing"):
   only billable in-person client sessions form the billed route. A
   non-client stop with an address (a school meeting) is a stop on the
   calendar, but billing drives straight from client to client. Pinned so a
   change on either side is noticed. */
describe('deliberate difference (documented in day-route.js)', () => {
  test('a non-client stop with an address: the calendar visits it, billing bills client to client', () => {
    const day = { events: [A({ id: 'a', at: '09:00', to: '10:00', address: OSBORNE }),
      { id: 'm', at: '10:30', to: '11:30', type: 'meeting', title: 'School meeting', address: SCHOOL },
      A({ id: 'b', at: '12:00', to: '13:00', address: JOONDALUP })] };
    const b = browserLegs(day), s = serverLegs(day);
    expect(b.filter((l) => l.startsWith('BETWEEN'))).toEqual([
      `BETWEEN a>m ${canonAddr(OSBORNE)} -> ${canonAddr(SCHOOL)} 15`,
      `BETWEEN m>b ${canonAddr(SCHOOL)} -> ${canonAddr(JOONDALUP)} 20`]);
    expect(s.filter((l) => l.startsWith('BETWEEN'))).toEqual([`BETWEEN a>b ${canonAddr(OSBORNE)} -> ${canonAddr(JOONDALUP)} 30`]);
    // The day's ends agree.
    expect(b.filter((l) => !l.startsWith('BETWEEN'))).toEqual(s.filter((l) => !l.startsWith('BETWEEN')));
  });
});
