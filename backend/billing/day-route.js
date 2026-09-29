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
 * Differences, deliberate for billing: only billable in-person sessions form
 * the route (a telehealth or DNA session is not a stop), and a between leg is
 * kept whenever the two addresses differ even if the gap is tight — the drive
 * happened. Minutes and km come from route-facts.js, never estimated.
 */

const { canonAddr } = require('./route-facts');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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
 * @param {object} p
 * @param {object} p.user      users row (work_location_schedule, default_work_location)
 * @param {string} p.date      YYYY-MM-DD (local)
 * @param {Array}  p.sessions  events rows sorted by start_time (in-person billable only)
 * @returns {{legs:Array, base:object|null, baseUnset:boolean}}
 */
function buildDayLegs({ user, date, sessions }) {
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
    if (!from || !to || canonAddr(from) === canonAddr(to)) continue;
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

module.exports = { weekKeyForDate, dayKeyForDate, dayBase, resolveSpec, eventAddress, buildDayLegs };
