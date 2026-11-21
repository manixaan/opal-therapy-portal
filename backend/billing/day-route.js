'use strict';

/**
 * DAY ROUTE — the server-side twin of the calendar's travel segmentation
 * (frontend/current/travel.js `computeDayTravelSegments`). Pure.
 *
 * The calendar computes legs in the browser only; billing needs the same legs
 * on the server. This module reproduces the calendar's rules so an invoice
 * bills the route the practitioner saw:
 *   • start leg: the first session's `travel.before` point, else the day's
 *     work base (users.work_location_schedule → default_work_location).
 *     The office and unset/leave days never anchor travel (commit 394f35b);
 *     a remote base means no start/end leg.
 *   • between legs: consecutive sessions in time order.
 *   • end leg (RETURN): to the last session's `travel.after` point, else base.
 *   • a gap long enough to drive back to the base, stay TRAVEL_HOME_MIN_STAY
 *     minutes and drive out again is a trip home (Return + Start legs), not a
 *     drive between clients — travel.js `betweenTravelPlan`, same rule. The
 *     session's choice on the calendar (travel.next 'direct' | 'home') wins.
 *   • somewhere else in between: a session whose `travel.after` is a place
 *     with purpose 'elsewhere' and no Direct/Home choice goes there before the
 *     next session (travel.js betweenTravelPlan, mode 'elsewhere'). Billed
 *     like a trip home: the drive to the place is a midday RETURN, the drive
 *     on to the next client an OUTBOUND leg.
 * Differences, deliberate for billing: only billable in-person sessions form
 * the route (a telehealth or DNA session is not a stop), and a between leg is
 * kept whenever the two addresses differ even if the gap is tight — the drive
 * happened. Minutes and km come from route-facts.js, never estimated.
 */

const { canonAddr } = require('./route-facts');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TRAVEL_HOME_MIN_STAY = 30; // mirrors travel.js

function parseYmd(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return { y, m, d, utc: Date.UTC(y, m - 1, d) };
}

/** Mirrors mockup_v3.html `weekKeyFor(monday)` — NOT an ISO week. */
function weekKeyForDate(ymd) {
  const { utc } = parseYmd(ymd);
  const dow = new Date(utc).getUTCDay();
  const mondayUtc = utc - ((dow + 6) % 7) * 86400000;
  const monday = new Date(mondayUtc);
  const year = monday.getUTCFullYear();
  const diff = (mondayUtc - Date.UTC(year, 0, 1)) / 86400000;
  const week = Math.floor(diff / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function dayKeyForDate(ymd) {
  return DAY_KEYS[new Date(parseYmd(ymd).utc).getUTCDay()];
}

function baseById(bases, id) {
  if (!id || !bases) return null;
  if (id === 'office') return null; // "coming soon" — never anchors travel
  return (bases.homes || []).find(h => h.id === id) || null;
}

function pointFromBase(b) {
  if (!b) return null;
  if (b.kind === 'remote') return { remote: true, label: b.label || 'Remote base' };
  const address = b.addr || b.suburb || null;
  if (!address) return null;
  return { remote: false, address, label: b.label || 'Base', baseId: b.id };
}

/** The practitioner's anchor for a date, or null (unset / leave / office). */
function dayBase(user, ymd) {
  const schedule = (user && user.work_location_schedule) || {};
  const week = schedule[weekKeyForDate(ymd)] || {};
  const key = week[dayKeyForDate(ymd)];
  if (!key || key === 'leave' || key === 'unset' || key === 'office') return null;
  return pointFromBase(baseById(user.default_work_location, key));
}

function resolveSpec(spec, user) {
  if (!spec || typeof spec !== 'object') return null;
  if (spec.kind === 'base') return pointFromBase(baseById(user && user.default_work_location, spec.id));
  if (spec.kind === 'address') {
    const address = String(spec.address || '').trim();
    return address ? { remote: false, address, label: spec.label || address } : null;
  }
  return null;
}

/** Where the event physically happened (manual pin beats the Outlook text). */
function eventAddress(ev) {
  const m = ev.manual_location;
  if (m && typeof m === 'object' && m.address) return String(m.address);
  if (typeof m === 'string' && m.trim()) return m.trim();
  return ev.location ? String(ev.location).trim() : null;
}

/**
 * Pairs whose route facts buildDayLegs may need (so the caller can fetch them
 * all first): the direct drive between consecutive sessions and, when the day
 * has a base, each side of a possible trip home.
 */
function candidatePairs({ user, date, sessions }) {
  const pairs = [];
  const base = dayBase(user, date);
  for (let i = 0; i < sessions.length - 1; i++) {
    const a = eventAddress(sessions[i]), b = eventAddress(sessions[i + 1]);
    if (!a || !b) continue;
    pairs.push({ origin: a, destination: b });
    if (base && !base.remote && base.address) {
      pairs.push({ origin: a, destination: base.address }, { origin: base.address, destination: b });
    }
  }
  return pairs;
}

/**
 * { toBase, fromBase } when the session goes home before the next one; null
 * for a direct drive. The session's own choice wins (custom_metadata.travel.
 * next — 'direct' | 'home', set on the calendar), else the gap decides.
 */
function viaBase(base, from, to, gapMin, minutesFor, choice) {
  if (choice === 'direct') return null;
  if (!base || base.remote || !base.address) return null;
  if (canonAddr(base.address) === canonAddr(from) || canonAddr(base.address) === canonAddr(to)) return null;
  if (choice === 'home') {
    return { toBase: minutesFor ? minutesFor(from, base.address) : null, fromBase: minutesFor ? minutesFor(base.address, to) : null };
  }
  // No choice → a direct drive (19 Nov 2026): a trip home in between is billed
  // only when the therapist chose it, as the calendar draws it (travel.js).
  void gapMin;
  return null;
}

/**
 * Before/after answered in "Blocks to review" (source 'block_review', 19 Nov
 * 2026) also hold between two stops — the twin of travel.js
 * reviewTravelBetween: "after: Home" on the earlier stop or "before: Home" on
 * the later one is a trip home; an address on either is the place gone to.
 * Smart Booking's own answers keep their day-ends-only meaning.
 */
function reviewBetween(aTravel, bTravel) {
  const pick = (t, side) => { const v = t && t[side]; return v && v.kind && v.source === 'block_review' ? v : null; };
  const a = pick(aTravel, 'after'), b = pick(bTravel, 'before');
  const place = (a && a.purpose === 'elsewhere' && a) || (b && b.purpose === 'elsewhere' && b) || null;
  const home = !place && ((a && a.purpose === 'home') || (b && b.purpose === 'home'));
  return { home: !!home, place };
}

/**
 * The place a session goes to before the next one ("Go somewhere else in
 * between"), or null. A Direct / Home choice made since wins, as on the calendar.
 */
function viaPlace(travel, user, nextTravel) {
  if (travel && (travel.next === 'direct' || travel.next === 'home')) return null;
  const own = travel && travel.after && travel.after.purpose === 'elsewhere' ? travel.after : null;
  const spec = own || reviewBetween(travel, nextTravel).place;
  if (!spec) return null;
  const pt = resolveSpec(spec, user);
  return pt && !pt.remote && pt.address ? pt : null;
}

/** Is there desk work chosen "at home" in the gap between two sessions? */
function deskHomeBetween(deskHome, a, b) {
  if (!deskHome || !deskHome.length) return false;
  const lo = new Date(a.end_time).getTime(), hi = new Date(b.start_time).getTime();
  return deskHome.some(d => new Date(d.start_time).getTime() >= lo && new Date(d.end_time).getTime() <= hi);
}

/**
 * @param {object} p
 * @param {object} p.user      users row (work_location_schedule, default_work_location)
 * @param {string} p.date      YYYY-MM-DD (local)
 * @param {Array}  p.sessions  events rows sorted by start_time (in-person billable only)
 * @param {Function} [p.minutesFor]  (origin, destination) → minutes|null; enables the trip-home rule
 * @param {boolean}  [p.clientToClient]  billing: a mid-day detour (home, elsewhere) becomes one BETWEEN leg
 *                                      carrying `detour` — billed at the lesser of direct and detour
 * @param {Array}    [p.deskHome]  [{start_time, end_time}] desk work chosen "at home" (travel.desk = 'home')
 * @returns {{legs:Array, base:object|null, baseUnset:boolean}}
 */
function buildDayLegs({ user, date, sessions, minutesFor, clientToClient = false, deskHome = [] }) {
  const legs = [];
  const detours = [];
  const base = dayBase(user, date);
  if (!sessions.length) return { legs, base, baseUnset: !base };
  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  const meta = ev => (ev.custom_metadata && ev.custom_metadata.travel) || {};

  // "Home" as where the day starts is the day's home, whichever it is now — as
  // the calendar resolves it (travel.js resolveTravelPoint), like Return Home.
  const firstBefore = meta(first).before;
  const startPt = (firstBefore && firstBefore.purpose === 'home' && base) ? base : (resolveSpec(firstBefore, user) || base);
  if (startPt && !startPt.remote && startPt.address) {
    const to = eventAddress(first);
    if (to && canonAddr(to) !== canonAddr(startPt.address)) {
      legs.push({ id: `start:${first.id}`, kind: 'OUTBOUND', fromEventId: null, toEventId: first.id,
        origin: startPt.address, destination: to, originLabel: startPt.label });
    }
  }
  for (let i = 0; i < sessions.length - 1; i++) {
    const a = sessions[i], b = sessions[i + 1];
    const from = eventAddress(a), to = eventAddress(b);
    if (!from || !to) continue;
    const gapMin = Math.round((new Date(b.start_time) - new Date(a.end_time)) / 60000);
    const place = viaPlace(meta(a), user, meta(b));
    const choice = meta(a).next || (reviewBetween(meta(a), meta(b)).home ? 'home' : null)
      || (deskHomeBetween(deskHome, a, b) ? 'home' : null);
    const home = place ? null : viaBase(base, from, to, gapMin, minutesFor, choice);
    if (clientToClient && (place || home)) {
      // Billing (owner rule book + 21 Nov 2026 answer): a mid-day detour — home,
      // somewhere else, desk work at home — is billed as whichever is LESS: the
      // direct client-to-client drive or the detour actually driven. The caller
      // prices both (route facts / calendar minutes) and keeps a reviewer note.
      const via = place || base;
      const detour = { fromEventId: a.id, toEventId: b.id, via: place ? 'elsewhere' : 'home', viaLabel: via.label || null,
        viaAddress: via.address, legs: [{ origin: from, destination: via.address }, { origin: via.address, destination: to }]
          .filter(l => canonAddr(l.origin) !== canonAddr(l.destination)) };
      detours.push(detour);
      if (canonAddr(from) === canonAddr(to)) continue;           // direct is 0 minutes: the lesser, nothing to bill
      legs.push({ id: `between:${a.id}:${b.id}`, kind: 'BETWEEN', fromEventId: a.id, toEventId: b.id, origin: from, destination: to, detour });
      continue;
    }
    if (place) {
      if (canonAddr(from) !== canonAddr(place.address)) {
        legs.push({ id: `return:${a.id}`, kind: 'RETURN', fromEventId: a.id, toEventId: null, midday: true,
          origin: from, destination: place.address, destinationLabel: place.label });
      }
      if (canonAddr(place.address) !== canonAddr(to)) {
        legs.push({ id: `start:${b.id}`, kind: 'OUTBOUND', fromEventId: null, toEventId: b.id, midday: true,
          origin: place.address, destination: to, originLabel: place.label });
      }
      continue;
    }
    if (home) {
      legs.push({ id: `return:${a.id}`, kind: 'RETURN', fromEventId: a.id, toEventId: null, midday: true,
        origin: from, destination: base.address, destinationLabel: base.label });
      legs.push({ id: `start:${b.id}`, kind: 'OUTBOUND', fromEventId: null, toEventId: b.id, midday: true,
        origin: base.address, destination: to, originLabel: base.label });
      continue;
    }
    if (canonAddr(from) === canonAddr(to)) continue;
    legs.push({ id: `between:${a.id}:${b.id}`, kind: 'BETWEEN', fromEventId: a.id, toEventId: b.id, origin: from, destination: to });
  }
  // "Return Home" (purpose 'home') is the day's home, whichever it is now — travel.js resolveTravelPoint.
  const lastAfter = meta(last).after;
  const endPt = (lastAfter && lastAfter.purpose === 'home' && base) ? base : (resolveSpec(lastAfter, user) || base);
  if (endPt && !endPt.remote && endPt.address) {
    const from = eventAddress(last);
    if (from && canonAddr(from) !== canonAddr(endPt.address)) {
      legs.push({ id: `return:${last.id}`, kind: 'RETURN', fromEventId: last.id, toEventId: null,
        origin: from, destination: endPt.address, destinationLabel: endPt.label });
    }
  }
  const explicitStart = !!resolveSpec(meta(first).before, user);
  // "Not driving this" (travel.noDriveBefore / noDriveAfter, set on the
  // calendar): the leg belongs to an appointment's side, exactly as travel.js
  // owns it — a drive INTO an appointment (start or between) is its 'before',
  // a drive AWAY to an end point is its 'after'. Never billed (rule 2).
  const byId = new Map(sessions.map(ev => [String(ev.id), ev]));
  const notDriven = l => {
    if (l.kind === 'RETURN') return !!(l.fromEventId && meta(byId.get(String(l.fromEventId)) || {}).noDriveAfter === true);
    return !!(l.toEventId && meta(byId.get(String(l.toEventId)) || {}).noDriveBefore === true);
  };
  return { legs: legs.filter(l => !notDriven(l)), notDriven: legs.filter(notDriven).map(l => l.id), detours, base, baseUnset: !base && !explicitStart };
}

module.exports = { TRAVEL_HOME_MIN_STAY, weekKeyForDate, dayKeyForDate, dayBase, resolveSpec, eventAddress, candidatePairs, viaPlace, reviewBetween, buildDayLegs };
