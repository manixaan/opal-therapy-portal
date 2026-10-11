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
  if (!minutesFor || !(gapMin > 0)) return null;
  const toBase = minutesFor(from, base.address);
  const fromBase = minutesFor(base.address, to);
  if (toBase == null || fromBase == null) return null; // cannot decide → chain, as without facts
  return gapMin >= toBase + fromBase + TRAVEL_HOME_MIN_STAY ? { toBase, fromBase } : null;
}

/**
 * The place a session goes to before the next one ("Go somewhere else in
 * between"), or null. A Direct / Home choice made since wins, as on the calendar.
 */
function viaPlace(travel, user) {
  if (!travel || travel.next === 'direct' || travel.next === 'home') return null;
  const spec = travel.after;
  if (!spec || spec.purpose !== 'elsewhere') return null;
  const pt = resolveSpec(spec, user);
  return pt && !pt.remote && pt.address ? pt : null;
}

/**
 * @param {object} p
 * @param {object} p.user      users row (work_location_schedule, default_work_location)
 * @param {string} p.date      YYYY-MM-DD (local)
 * @param {Array}  p.sessions  events rows sorted by start_time (in-person billable only)
 * @param {Function} [p.minutesFor]  (origin, destination) → minutes|null; enables the trip-home rule
 * @returns {{legs:Array, base:object|null, baseUnset:boolean}}
 */
function buildDayLegs({ user, date, sessions, minutesFor }) {
  const legs = [];
  const base = dayBase(user, date);
  if (!sessions.length) return { legs, base, baseUnset: !base };
  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  const meta = ev => (ev.custom_metadata && ev.custom_metadata.travel) || {};

  const startPt = resolveSpec(meta(first).before, user) || base;
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
    const place = viaPlace(meta(a), user);
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
    const home = viaBase(base, from, to, gapMin, minutesFor, meta(a).next);
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
  const endPt = resolveSpec(meta(last).after, user) || base;
  if (endPt && !endPt.remote && endPt.address) {
    const from = eventAddress(last);
    if (from && canonAddr(from) !== canonAddr(endPt.address)) {
      legs.push({ id: `return:${last.id}`, kind: 'RETURN', fromEventId: last.id, toEventId: null,
        origin: from, destination: endPt.address, destinationLabel: endPt.label });
    }
  }
  const explicitStart = !!resolveSpec(meta(first).before, user);
  return { legs, base, baseUnset: !base && !explicitStart };
}

module.exports = { TRAVEL_HOME_MIN_STAY, weekKeyForDate, dayKeyForDate, dayBase, resolveSpec, eventAddress, candidatePairs, viaPlace, buildDayLegs };
