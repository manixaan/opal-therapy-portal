'use strict';

/**
 * AVAILABILITY ENGINE — pure, deterministic day-availability computation.
 *
 * No DB, no network, no clock: everything the engine knows arrives through
 * its arguments, so identical inputs always produce identical outputs and
 * the whole surface is unit-testable (tests/availability-engine.test.js).
 *
 * Model: one call computes ONE therapist's ONE local day as segments that
 * tile the full 00:00–24:00 range (minutes 0..1440) with no gaps and no
 * overlaps. Segment types:
 *   outside_hours  before/after the working window
 *   busy           merged blocking events (overlapping AND adjacent merge)
 *   leave          leave-type events; a full-day approved leaveRange makes
 *                  the entire day one leave state with working:false
 *   buffer         before/after extensions of busy blocks, config-driven;
 *                  carved out of would-be-available time only
 *   available      in-window free gap >= minDurationMin (carries the
 *                  flanking busy events' ids — the Phase-8 seam where
 *                  location-dependent travel logic will plug in)
 *   short_gap      in-window free gap < minDurationMin
 *
 * Privacy: blocking decisions NEVER read an event's title/subject — a
 * private Outlook event with no title still blocks. Deleted and cancelled
 * events never block.
 *
 * Timezone: tzOffsetMin (minutes east of UTC, default 480 = AWST) is a
 * parameter — no DST hardcoding, ready for future interstate use.
 * workingHoursSource is the constant 'organisation_default' today because
 * per-therapist hours don't exist yet.
 */

const DAY_MIN = 1440;
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_WORKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Event normalisation ──────────────────────────────────────────────────────

/** Parse an instant that may be an ISO string or a Date. NaN when invalid. */
function parseMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

/**
 * Accept snake_case rows (start_time, end_time, event_type, is_deleted,
 * status) or camelCase objects (start, end, eventType, isDeleted,
 * isCancelled) — any mix. Reads ONLY those fields plus id; never title.
 */
function normalizeEvent(event) {
  const e = event || {};
  const status = typeof e.status === 'string' ? e.status.toLowerCase() : null;
  return {
    id: e.id !== undefined ? e.id : null,
    start: e.start_time !== undefined ? e.start_time : (e.start !== undefined ? e.start : null),
    end: e.end_time !== undefined ? e.end_time : (e.end !== undefined ? e.end : null),
    eventType: e.event_type !== undefined ? e.event_type : (e.eventType !== undefined ? e.eventType : null),
    isDeleted: Boolean(e.is_deleted !== undefined ? e.is_deleted : e.isDeleted),
    isCancelled: status === 'cancelled' || e.isCancelled === true,
  };
}

/**
 * Does this event block availability? Deleted and cancelled events never
 * block. EVERY other event type blocks — therapy, travel, meeting,
 * teams_meeting, lunch, cpd, admin, report, outlook, leave, unknown/null.
 * An Outlook busy/private event blocks WITHOUT a title: this predicate
 * never reads title/subject. ('leave' events also block — the day engine
 * just classifies their time as leave segments rather than busy.)
 */
function isEventBlockingAvailability(event) {
  if (!event) return false;
  const e = normalizeEvent(event);
  return !e.isDeleted && !e.isCancelled;
}

// ── Time helpers ─────────────────────────────────────────────────────────────

/** UTC ms of local midnight for a YYYY-MM-DD day at the given offset. */
function localDayStartUtcMs(ymd, tzOffsetMin = 480) {
  return Date.parse(`${ymd}T00:00:00Z`) - tzOffsetMin * 60000;
}

/** Local wall-clock minutes-of-day (0..1439) for a UTC instant. */
function toMinutesOfDayPerth(iso, tzOffsetMin = 480) {
  const ms = parseMs(iso);
  if (Number.isNaN(ms)) return null;
  const m = Math.floor((ms + tzOffsetMin * 60000) / 60000) % DAY_MIN;
  return m < 0 ? m + DAY_MIN : m;
}

/** '9:05am' / '1:30pm' label for a minutes-of-day value. */
function fmtMin(min) {
  const h24 = Math.floor(min / 60) % 24;
  const mm = String(min % 60).padStart(2, '0');
  const h12 = h24 % 12 || 12;
  return `${h12}:${mm}${h24 < 12 ? 'am' : 'pm'}`;
}

// ── Interval algebra ─────────────────────────────────────────────────────────

/**
 * Merge overlapping AND adjacent intervals ({startMin, endMin}). Carries
 * event ids through the merge: startId is the event whose start opens the
 * block, endId the event whose end closes it — exactly the events that
 * flank neighbouring gaps. Inputs may carry `id` or already-merged
 * startId/endId. Returns new sorted, disjoint intervals; never mutates.
 */
function mergeIntervals(intervals) {
  const list = (Array.isArray(intervals) ? intervals : [])
    .filter((iv) => iv && iv.endMin > iv.startMin)
    .map((iv) => ({
      startMin: iv.startMin,
      endMin: iv.endMin,
      startId: iv.startId !== undefined ? iv.startId : (iv.id !== undefined ? iv.id : null),
      endId: iv.endId !== undefined ? iv.endId : (iv.id !== undefined ? iv.id : null),
    }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out = [];
  for (const iv of list) {
    const last = out[out.length - 1];
    if (last && iv.startMin <= last.endMin) {           // overlap or touch
      if (iv.endMin > last.endMin) { last.endMin = iv.endMin; last.endId = iv.endId; }
    } else {
      out.push(iv);
    }
  }
  return out;
}

/**
 * Clamp one normalised event to the local day. Start floors and end ceils
 * to the minute (busy time never shrinks). Returns null when the event
 * misses the day entirely; events spanning midnight clamp to 0/1440.
 */
function eventDayInterval(normalized, dayStartMs) {
  const startMs = parseMs(normalized.start);
  const endMs = parseMs(normalized.end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  let startMin = Math.floor((startMs - dayStartMs) / 60000);
  let endMin = Math.ceil((endMs - dayStartMs) / 60000);
  if (startMin >= DAY_MIN || endMin <= 0) return null;
  startMin = Math.max(0, startMin);
  endMin = Math.min(DAY_MIN, endMin);
  return endMin > startMin ? { startMin, endMin } : null;
}

// ── Day computation ──────────────────────────────────────────────────────────

// Minute-paint codes. Painting with explicit precedence guarantees the
// compressed segments tile 0..1440 exactly once, by construction.
const PAINT_OUTSIDE = 0;
const PAINT_FREE = 1;
const PAINT_LEAVE = 2;
const PAINT_BUSY = 3;
const PAINT_BUFFER = 4;

function paintRange(paint, startMin, endMin, code, overCodes) {
  const s = Math.max(0, startMin);
  const e = Math.min(DAY_MIN, endMin);
  for (let m = s; m < e; m++) {
    if (overCodes.indexOf(paint[m]) !== -1) paint[m] = code;
  }
}

function makeSegment(code, startMin, endMin, windowBusy, minDurationMin) {
  if (code === PAINT_FREE) {
    if (endMin - startMin < minDurationMin) {
      return { startMin, endMin, type: 'short_gap' };
    }
    // Flanking busy events (null at window edges). windowBusy is sorted.
    let prev = null;
    let next = null;
    for (const b of windowBusy) {
      if (b.endMin <= startMin) prev = b;
      if (next === null && b.startMin >= endMin) next = b;
    }
    return {
      startMin, endMin, type: 'available',
      prevEventId: prev ? prev.endId : null,
      nextEventId: next ? next.startId : null,
    };
  }
  const type = code === PAINT_OUTSIDE ? 'outside_hours'
    : code === PAINT_LEAVE ? 'leave'
      : code === PAINT_BUSY ? 'busy' : 'buffer';
  return { startMin, endMin, type };
}

/**
 * Compute one therapist's availability for one local day. See module
 * header for the segment model; see the spec of each option below.
 *
 * opts:
 *   date           'YYYY-MM-DD' local day (required)
 *   tzOffsetMin    minutes east of UTC (default 480 = AWST)
 *   events         one therapist's events; start/end are UTC ISO strings;
 *                  snake_case or camelCase fields, any mix
 *   weekSchedule   {mon:'office', tue:'home-1', ...} — a weekday key
 *                  present (with a truthy value) means working that day;
 *                  null/undefined/{} → assume Mon–Fri
 *   workingHours   {startMin, endMin} minutes-of-day (default 480→1020)
 *   leaveRanges    [{startDate, endDate}] APPROVED full-day leave,
 *                  inclusive of both end dates
 *   buffers        {beforeMin, afterMin} scheduling buffers (default 0/0)
 *   minDurationMin gaps shorter than this are short_gap (default 30)
 *   scheduleKnown  true when weekSchedule came from real therapist data
 */
function computeDayAvailability(opts) {
  const o = opts || {};
  if (typeof o.date !== 'string' || !YMD_RE.test(o.date)) {
    throw new Error('computeDayAvailability: opts.date must be YYYY-MM-DD');
  }
  const date = o.date;
  const tzOffsetMin = o.tzOffsetMin === undefined ? 480 : o.tzOffsetMin;
  const events = Array.isArray(o.events) ? o.events : [];
  const weekSchedule = (o.weekSchedule && typeof o.weekSchedule === 'object') ? o.weekSchedule : null;
  const workingHours = o.workingHours || { startMin: 480, endMin: 1020 };
  const leaveRanges = Array.isArray(o.leaveRanges) ? o.leaveRanges : [];
  const buffers = o.buffers || {};
  const beforeMin = Math.max(0, buffers.beforeMin || 0);
  const afterMin = Math.max(0, buffers.afterMin || 0);
  const minDurationMin = o.minDurationMin === undefined ? 30 : o.minDurationMin;
  const scheduleKnown = Boolean(o.scheduleKnown);

  const availabilityConfidence = scheduleKnown ? 'configured' : 'default';
  const fullDay = (type) => ({
    date,
    working: false,
    workingHoursSource: 'organisation_default',
    availabilityConfidence,
    segments: [{ startMin: 0, endMin: DAY_MIN, type }],
    capacity: { workingMin: 0, busyMin: 0, availableMin: 0 },
  });

  // 1) Working weekday? A filled-in weekSchedule lists working weekdays by
  //    key presence; without one we assume Mon–Fri (the 'default'
  //    confidence flags that assumption when scheduleKnown is false).
  //    Non-working wins over leave: a weekend inside a leave range is
  //    still reported as not_working.
  const dayKey = WEEKDAY_KEYS[new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay()];
  const hasSchedule = weekSchedule !== null && Object.keys(weekSchedule).length > 0;
  const working = hasSchedule
    ? Boolean(weekSchedule[dayKey])
    : DEFAULT_WORKDAYS.indexOf(dayKey) !== -1;
  if (!working) return fullDay('not_working');

  // 2) Approved full-day leave → the whole day is one leave state. A
  //    same-day leave EVENT unions into this (never double-counted): the
  //    day is simply leave.
  const onFullDayLeave = leaveRanges.some((r) =>
    r && typeof r.startDate === 'string' && typeof r.endDate === 'string' &&
    r.startDate <= date && date <= r.endDate);
  if (onFullDayLeave) return fullDay('leave');

  // 3) Window + per-day event intervals (clamped to 0..1440).
  const whStart = Math.max(0, Math.min(DAY_MIN, workingHours.startMin));
  const whEnd = Math.max(0, Math.min(DAY_MIN, workingHours.endMin));
  const dayStartMs = localDayStartUtcMs(date, tzOffsetMin);

  const busyRaw = [];
  const leaveRaw = [];
  for (const raw of events) {
    if (!isEventBlockingAvailability(raw)) continue;
    const e = normalizeEvent(raw);
    const iv = eventDayInterval(e, dayStartMs);
    if (!iv) continue;
    if (e.eventType === 'leave') leaveRaw.push(iv);
    else busyRaw.push({ startMin: iv.startMin, endMin: iv.endMin, id: e.id });
  }
  // Merge overlapping AND adjacent blocks BEFORE any gap computation
  // (9:00–10:00 + 9:30–10:30 = one 9:00–10:30 block).
  const busyBlocks = mergeIntervals(busyRaw);
  const leaveBlocks = mergeIntervals(leaveRaw);

  // 4) Paint the day. Precedence: busy wins over leave (an appointment
  //    scheduled during leave stays visible as busy — a real conflict);
  //    buffers paint over free time ONLY, so they never leave the working
  //    window, never overlap busy/leave, and overlapping buffers merge
  //    into one run naturally.
  const paint = new Array(DAY_MIN).fill(PAINT_OUTSIDE);
  paintRange(paint, whStart, whEnd, PAINT_FREE, [PAINT_OUTSIDE]);
  for (const b of leaveBlocks) {
    paintRange(paint, b.startMin, b.endMin, PAINT_LEAVE, [PAINT_FREE]);
  }
  for (const b of busyBlocks) {
    paintRange(paint, b.startMin, b.endMin, PAINT_BUSY, [PAINT_FREE, PAINT_LEAVE]);
  }
  for (const b of busyBlocks) {
    if (beforeMin > 0) paintRange(paint, b.startMin - beforeMin, b.startMin, PAINT_BUFFER, [PAINT_FREE]);
    if (afterMin > 0) paintRange(paint, b.endMin, b.endMin + afterMin, PAINT_BUFFER, [PAINT_FREE]);
  }

  // 5) In-window busy blocks give available gaps their flanking event ids.
  const windowBusy = busyBlocks
    .map((b) => ({
      startMin: Math.max(b.startMin, whStart),
      endMin: Math.min(b.endMin, whEnd),
      startId: b.startId,
      endId: b.endId,
    }))
    .filter((b) => b.endMin > b.startMin);

  // 6) Compress paint runs into segments (full 0..1440 coverage).
  const segments = [];
  let runStart = 0;
  for (let m = 1; m <= DAY_MIN; m++) {
    if (m < DAY_MIN && paint[m] === paint[runStart]) continue;
    segments.push(makeSegment(paint[runStart], runStart, m, windowBusy, minDurationMin));
    runStart = m;
  }

  const sumOf = (type) => segments.reduce(
    (acc, s) => acc + (s.type === type ? s.endMin - s.startMin : 0), 0);
  return {
    date,
    working: true,
    workingHoursSource: 'organisation_default',
    availabilityConfidence,
    segments,
    capacity: {
      workingMin: Math.max(0, whEnd - whStart),
      busyMin: sumOf('busy'),
      availableMin: sumOf('available'),
    },
  };
}

// ── Multi-therapist intersection ─────────────────────────────────────────────

function availableIntervals(segments) {
  return (Array.isArray(segments) ? segments : [])
    .filter((s) => s && s.type === 'available')
    .map((s) => ({ startMin: s.startMin, endMin: s.endMin }))
    .sort((a, b) => a.startMin - b.startMin);
}

function intersectTwo(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i].startMin, b[j].startMin);
    const e = Math.min(a[i].endMin, b[j].endMin);
    if (e > s) out.push({ startMin: s, endMin: e });   // strict: touching ≠ overlap
    if (a[i].endMin <= b[j].endMin) i++; else j++;
  }
  return out;
}

/**
 * Intersect N therapists' day segments (computeDayAvailability outputs).
 * Only 'available' segments participate. Exact boundary touching (one
 * ends 11:00, another starts 11:00) is NOT an overlap. Returns sorted
 * [{startMin, endMin, durationMin}] with durationMin >= minDurationMin.
 */
function intersectAvailability(segmentArrays, minDurationMin) {
  const min = minDurationMin === undefined ? 30 : minDurationMin;
  if (!Array.isArray(segmentArrays) || segmentArrays.length === 0) return [];
  let common = availableIntervals(segmentArrays[0]);
  for (let i = 1; i < segmentArrays.length && common.length > 0; i++) {
    common = intersectTwo(common, availableIntervals(segmentArrays[i]));
  }
  return common
    .filter((iv) => iv.endMin - iv.startMin >= min)
    .map((iv) => ({
      startMin: iv.startMin,
      endMin: iv.endMin,
      durationMin: iv.endMin - iv.startMin,
    }));
}

module.exports = {
  DAY_MIN,
  normalizeEvent,
  isEventBlockingAvailability,
  localDayStartUtcMs,
  toMinutesOfDayPerth,
  fmtMin,
  mergeIntervals,
  eventDayInterval,
  computeDayAvailability,
  intersectAvailability,
};
