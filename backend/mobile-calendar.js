'use strict';

/**
 * MOBILE CALENDAR — pure rules behind the phone's day grid and its drag-to-
 * move (23 Nov 2026). No DB, no clock (callers pass `now`), so every rule is
 * unit-testable and the route stays a thin shell.
 *
 *   canMoveEvent(ev, userId, now)        → { ok } | { ok:false, reason }
 *   checkMove({...})                     → { ok, delta, warnings } | { ok:false, status, code, ... }
 *   buildTravelLegs({...})               → [{ id, kind, ownerEventId, side, start, end, minutes, ... }]
 *
 * The portal is the reference: MOVABLE_TYPES mirrors mockup_v3.html; a leg is
 * owned by the appointment it drives INTO ('before') or AWAY from ('after'),
 * and a dragged leg keeps its time as an offset from that owner
 * (custom_metadata.travel.beforeOffsetMin / afterOffsetMin, travel.js
 * placeTravelLeg) — so a moved session's legs follow it with no write.
 *
 * Fail-closed differences from the portal (which checks overlaps only in the
 * browser): the server refuses an overlap, a priced leg that no longer fits,
 * a changed-under-you event, a past time, and a changed duration.
 */

const dayRoute = require('./billing/day-route');

/** Same set as the portal shell's MOVABLE_TYPES (mockup_v3.html). */
const MOVABLE_TYPES = new Set(['therapy', 'assessment', 'initial', 'mdt', 'travel', 'report', 'admin', 'cpd', 'lunch']);
const ALL_DAY_MS = 23 * 3600 * 1000;
const MAX_SHIFT_MS = 60 * 24 * 3600 * 1000;      // a phone move stays within ±60 days
const PERTH_OFFSET_MS = 480 * 60000;

const ms = (v) => new Date(v).getTime();
const isTravelMirror = (ev) => !!(ev && ev.custom_metadata && ev.custom_metadata.travelLegKey);
const isCancelled = (ev) => ev.status === 'cancelled';
const isAllDay = (ev) => ms(ev.end_time) - ms(ev.start_time) >= ALL_DAY_MS;
const travelMeta = (ev) => (ev && ev.custom_metadata && ev.custom_metadata.travel) || {};

/** Perth calendar date (YYYY-MM-DD) of an instant. */
function perthDate(v) {
  return new Date(ms(v) + PERTH_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Can this caller move this event from the phone? Only their OWN rows
 * (user_id — the same owner check as the portal's PATCH), live, timed,
 * a movable type, not a travel mirror, and not already started.
 */
function canMoveEvent(ev, userId, now = new Date()) {
  if (!ev || ev.is_deleted) return { ok: false, reason: 'not_found' };
  if (String(ev.user_id) !== String(userId)) return { ok: false, reason: 'not_owner' };
  if (isTravelMirror(ev)) return { ok: false, reason: 'travel_mirror' };
  if (isCancelled(ev)) return { ok: false, reason: 'cancelled' };
  if (isAllDay(ev)) return { ok: false, reason: 'all_day' };
  if (!MOVABLE_TYPES.has(ev.event_type)) return { ok: false, reason: 'type' };
  if (ms(ev.start_time) <= now.getTime()) return { ok: false, reason: 'started' };
  return { ok: true };
}

/** A physical stop on the travel route (the portal's isPhysicalStop). */
function isPhysicalStop(ev, virtualRe) {
  if (isCancelled(ev) || isAllDay(ev) || isTravelMirror(ev) || ev.event_type === 'travel') return false;
  const addr = dayRoute.eventAddress(ev);
  return !!addr && !(virtualRe && virtualRe.test(addr));
}

/**
 * The day's travel legs, timed the way the portal draws them: a leg INTO an
 * appointment ends at its start (or sits at start + beforeOffsetMin when the
 * therapist dragged it); a leg AWAY starts at its end (or end + afterOffsetMin).
 * The portal additionally steps an undragged leg around other blocks — the
 * phone shows the simple placement and the portal stays authoritative.
 *
 * @param {object} p
 * @param {object} p.user       users row (work_location_schedule, default_work_location)
 * @param {string} p.date       Perth YYYY-MM-DD
 * @param {Array}  p.events     the caller's rows for the day (any order)
 * @param {Function} p.minutesFor (origin, destination) → whole minutes | null (the calendar's priced minutes)
 * @param {RegExp} [p.virtualRe]
 * @returns {Array<{id, kind, ownerEventId, side, start, end, minutes, fromLabel, toLabel}>}
 */
function buildTravelLegs({ user, date, events, minutesFor, virtualRe }) {
  const sessions = events.filter((e) => isPhysicalStop(e, virtualRe))
    .sort((a, b) => ms(a.start_time) - ms(b.start_time));
  if (!sessions.length) return [];
  const route = dayRoute.buildDayLegs({ user, date, sessions, minutesFor });
  const byId = new Map(sessions.map((e) => [String(e.id), e]));
  const out = [];
  for (const l of route.legs) {
    const minutes = minutesFor ? minutesFor(l.origin, l.destination) : null;
    const into = l.kind !== 'RETURN';
    const owner = byId.get(String(into ? l.toEventId : l.fromEventId));
    if (!owner) continue;
    const side = into ? 'before' : 'after';
    const offset = travelMeta(owner)[into ? 'beforeOffsetMin' : 'afterOffsetMin'];
    const manual = typeof offset === 'number' && Number.isFinite(offset);
    let start = null, end = null;
    if (minutes != null) {
      const startMs = into
        ? (manual ? ms(owner.start_time) + offset * 60000 : ms(owner.start_time) - minutes * 60000)
        : (manual ? ms(owner.end_time) + offset * 60000 : ms(owner.end_time));
      start = new Date(startMs).toISOString();
      end = new Date(startMs + minutes * 60000).toISOString();
    }
    out.push({
      id: l.id, kind: l.kind, ownerEventId: owner.id, side,
      fromEventId: l.fromEventId || null, toEventId: l.toEventId || null,
      start, end, minutes, moved: manual,
      fromLabel: l.originLabel || null, toLabel: l.destinationLabel || null,
    });
  }
  return out;
}

const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;

/**
 * Validate a requested move. Everything the phone sends is checked here.
 *
 * @param {object} p
 * @param {object} p.ev            the event row (already scoped to the caller)
 * @param {string} p.userId
 * @param {object} p.body          { start, end, expectedStart, expectedEnd }
 * @param {Array}  p.linked        travel blocks with related_event_id = ev.id (move with it)
 * @param {Array}  p.dayEvents     the caller's other rows on the TARGET day(s), any order
 * @param {Function} p.legsAfter   (movedRows) → legs for the target day after the move
 * @param {Date}   p.now
 * @param {RegExp} [p.virtualRe]
 */
function checkMove({ ev, userId, body, linked = [], dayEvents = [], legsAfter, now = new Date(), virtualRe }) {
  const b = body || {};
  const req = ['start', 'end', 'expectedStart', 'expectedEnd'];
  for (const k of req) {
    if (typeof b[k] !== 'string' || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(b[k]) || Number.isNaN(ms(b[k]))) {
      return { ok: false, status: 400, code: 'invalid', error: `${k} must be an ISO time with an offset` };
    }
  }
  const can = canMoveEvent(ev, userId, now);
  if (!can.ok) {
    if (can.reason === 'not_found' || can.reason === 'not_owner') return { ok: false, status: 404, code: 'not_found', error: 'Not found' };
    return { ok: false, status: 403, code: 'not_movable', reason: can.reason, error: 'This one can’t be moved from the phone.' };
  }
  if (ms(b.expectedStart) !== ms(ev.start_time) || ms(b.expectedEnd) !== ms(ev.end_time)) {
    return { ok: false, status: 409, code: 'changed', error: 'This appointment changed since you loaded it.' };
  }
  const newS = ms(b.start), newE = ms(b.end);
  if (!(newS < newE)) return { ok: false, status: 400, code: 'invalid', error: 'start must be before end' };
  if (newE - newS !== ms(ev.end_time) - ms(ev.start_time)) {
    return { ok: false, status: 400, code: 'invalid', error: 'A move keeps the same length' };
  }
  const delta = newS - ms(ev.start_time);
  if (delta === 0) return { ok: false, status: 400, code: 'invalid', error: 'Nothing to move' };
  if (Math.abs(delta) > MAX_SHIFT_MS) return { ok: false, status: 400, code: 'invalid', error: 'Too far to move from the phone' };
  if (newS <= now.getTime()) return { ok: false, status: 400, code: 'past', error: 'Can’t move into the past' };

  // The rows that move together: the session and its linked travel blocks.
  const moving = [ev, ...linked.filter((l) => !l.is_deleted && !isCancelled(l))];
  const movingIds = new Set(moving.map((r) => String(r.id)));
  const moved = moving.map((r) => ({ ...r,
    start_time: new Date(ms(r.start_time) + delta).toISOString(),
    end_time: new Date(ms(r.end_time) + delta).toISOString() }));
  for (const m of moved.slice(1)) {
    if (ms(m.start_time) <= now.getTime()) {
      return { ok: false, status: 409, code: 'travel_conflict', error: 'Its travel block would land in the past.' };
    }
  }

  const others = dayEvents.filter((o) => !movingIds.has(String(o.id)) && !o.is_deleted
    && !isCancelled(o) && !isAllDay(o) && !isTravelMirror(o));
  for (const m of moved) {
    const clash = others.find((o) => overlaps(ms(m.start_time), ms(m.end_time), ms(o.start_time), ms(o.end_time)));
    if (clash) {
      return { ok: false, status: 409, code: 'overlap', error: 'That time overlaps another booking.',
        conflict: { id: clash.id, title: clash.title || null, start: new Date(ms(clash.start_time)).toISOString(), end: new Date(ms(clash.end_time)).toISOString() } };
    }
  }

  // Travel: legs into / out of the moved session must still fit.
  const warnings = [];
  if (typeof legsAfter === 'function') {
    const legs = legsAfter(moved) || [];
    const sid = String(ev.id);
    const mine = legs.filter((l) => [l.ownerEventId, l.fromEventId, l.toEventId].map(String).includes(sid));
    // A drive that runs into another CLIENT stop is impossible → refused. One
    // that runs over desk work / a call (no address) is what the portal
    // draws as a tight leg → a warning the phone shows before confirming.
    const timed = others.filter((o) => o.event_type !== 'travel');
    const sessionsAfter = [...timed, moved[0]];
    const warn = (w) => { if (!warnings.includes(w)) warnings.push(w); };
    for (const l of mine) {
      if (l.minutes == null) { warn('travel_unpriced'); continue; }
      const lS = ms(l.start), lE = ms(l.end);
      const hits = sessionsAfter.filter((o) => String(o.id) !== String(l.ownerEventId)
        && overlaps(lS, lE, ms(o.start_time), ms(o.end_time)));
      const hit = hits.find((o) => isPhysicalStop(o, virtualRe));
      if (!hit && hits.length) warn('travel_tight');
      if (hit) {
        return { ok: false, status: 409, code: 'travel_conflict', error: `The ${l.minutes}-minute drive no longer fits.`,
          conflict: { id: hit.id, title: hit.title || null, start: new Date(ms(hit.start_time)).toISOString(), end: new Date(ms(hit.end_time)).toISOString() } };
      }
      if (lS <= now.getTime() && l.side === 'before') {
        return { ok: false, status: 409, code: 'travel_conflict', error: 'You’d need to leave in the past to make it.' };
      }
    }
  }
  return { ok: true, delta, moved, warnings };
}

module.exports = { MOVABLE_TYPES, canMoveEvent, checkMove, buildTravelLegs, isPhysicalStop, perthDate };
