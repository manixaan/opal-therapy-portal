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

// ── Candidate matching (find availability) ───────────────────────────────────
//
// Pure classification of computeDayAvailability results against a request.
// therapistResult is the route-level shape: the engine's day output plus
// identity fields ({ therapistProfileId, displayName, roleTitle, colour,
// working, workingHoursSource, availabilityConfidence, capacity, segments }).
// Buffers are already carved into segments upstream — nothing here ever
// re-derives them or re-reads events.

const BLOCKING_TYPES = ['busy', 'buffer', 'leave', 'short_gap'];

/** The segment containing a minute-of-day (startMin <= m < endMin), or null. */
function segmentAt(segments, min) {
  for (const s of segments) {
    if (s && s.startMin <= min && min < s.endMin) return s;
  }
  return null;
}

/**
 * End of the blocking run covering the requested start: walk forward from
 * the segment containing fromMin through contiguous non-available
 * (busy/buffer/leave/short_gap) segments. Reaching 'available' returns
 * that boundary — the next moment the therapist stops being blocked.
 * Reaching 'outside_hours' (or the day end) means blocked to the end of
 * the working window → null.
 */
function busyRunEnd(segments, fromMin) {
  let i = segments.findIndex((s) => s && s.startMin <= fromMin && fromMin < s.endMin);
  if (i === -1) return null;
  while (i < segments.length && BLOCKING_TYPES.indexOf(segments[i].type) !== -1) i++;
  const next = segments[i];
  return next && next.type === 'available' ? next.startMin : null;
}

/**
 * Classify ONE therapist's computed day against an exact-mode request
 * ({ startMin, durationMin }). Returns a candidate that carries identity
 * and provenance alongside the verdict, so Phase 7 can enrich it later
 * (travel, locations) without reshaping:
 *
 *   requestedSlotFits  true ⟺ one 'available' segment fully contains
 *                      [startMin, startMin + durationMin]
 *   status             'available' | 'unavailable'
 *   reason             null when fitting; otherwise, in precedence order:
 *                      'leave' (working:false with a leave segment),
 *                      'not_working' (working:false otherwise),
 *                      'outside_hours' (interval overlaps only
 *                      outside_hours), 'too_short' (start sits in an
 *                      available segment that cannot hold the full
 *                      interval), 'busy' (everything else)
 *   window/windowMin   the FULL available segment holding a fitting
 *                      request (null otherwise)
 *   availableMin       'too_short' only: the overlapping available
 *                      segment's length
 *   busyUntilMin       'busy' only: end of the blocking run at the
 *                      requested start — null if blocked to end of window
 */
function classifyCandidate(therapistResult, request) {
  const t = therapistResult || {};
  const req = request || {};
  const reqStart = req.startMin;
  const reqDur = req.durationMin;
  if (!Number.isFinite(reqStart) || !Number.isFinite(reqDur) || reqDur <= 0) {
    throw new Error('classifyCandidate: request needs numeric startMin and durationMin > 0');
  }
  const reqEnd = reqStart + reqDur;
  const segments = Array.isArray(t.segments) ? t.segments : [];

  const candidate = {
    therapistProfileId: t.therapistProfileId !== undefined ? t.therapistProfileId : null,
    displayName: t.displayName !== undefined ? t.displayName : null,
    roleTitle: t.roleTitle !== undefined ? t.roleTitle : null,
    colour: t.colour !== undefined ? t.colour : null,
    workingHoursSource: t.workingHoursSource !== undefined ? t.workingHoursSource : null,
    availabilityConfidence: t.availabilityConfidence !== undefined ? t.availabilityConfidence : null,
    requestedSlotFits: false,
    status: 'unavailable',
    reason: null,
    window: null,
    windowMin: null,
    availableMin: null,
    busyUntilMin: null,
  };

  const fitSeg = segments.find((s) =>
    s && s.type === 'available' && s.startMin <= reqStart && s.endMin >= reqEnd);
  if (fitSeg) {
    candidate.requestedSlotFits = true;
    candidate.status = 'available';
    candidate.window = { startMin: fitSeg.startMin, endMin: fitSeg.endMin };
    candidate.windowMin = fitSeg.endMin - fitSeg.startMin;
    return candidate;
  }

  // Not fitting — reasons in precedence order.
  if (!t.working) {
    candidate.reason = segments.some((s) => s && s.type === 'leave') ? 'leave' : 'not_working';
    return candidate;
  }
  const overlapping = segments.filter((s) => s && s.startMin < reqEnd && s.endMin > reqStart);
  if (overlapping.every((s) => s.type === 'outside_hours')) {
    candidate.reason = 'outside_hours';
    return candidate;
  }
  const startSeg = segmentAt(segments, reqStart);
  if (startSeg && startSeg.type === 'available') {
    candidate.reason = 'too_short';
    candidate.availableMin = startSeg.endMin - startSeg.startMin;
    return candidate;
  }
  candidate.reason = 'busy';
  candidate.busyUntilMin = busyRunEnd(segments, reqStart);
  return candidate;
}

/**
 * Range mode: the therapist's 'available' segments clipped to
 * [rangeStartMin, rangeEndMin], keeping only clips long enough for the
 * requested duration. Whole windows — NOT sliding start permutations.
 * Returns sorted [{startMin, endMin, durationMin}].
 */
function rangeWindows(therapistResult, rangeStartMin, rangeEndMin, durationMin) {
  const t = therapistResult || {};
  const segments = Array.isArray(t.segments) ? t.segments : [];
  const out = [];
  for (const s of segments) {
    if (!s || s.type !== 'available') continue;
    const startMin = Math.max(s.startMin, rangeStartMin);
    const endMin = Math.min(s.endMin, rangeEndMin);
    if (endMin > startMin && endMin - startMin >= durationMin) {
      out.push({ startMin, endMin, durationMin: endMin - startMin });
    }
  }
  return out;
}

/**
 * Snap a suggested start to 5-minute granularity, preferring the side
 * toward the requested time; falls back to the far side, then the raw
 * minute — whichever stays a valid start within [lo, hi].
 */
function snapStart(s, lo, hi, reqStart) {
  if (s % 5 === 0) return s;
  const down = s - (s % 5);
  const up = down + 5;
  const toward = s > reqStart ? down : up;
  const away = s > reqStart ? up : down;
  if (toward >= lo && toward <= hi) return toward;
  if (away >= lo && away <= hi) return away;
  return s;
}

/**
 * Exact-mode fallback when nobody fits: per therapist, the nearest valid
 * start at/after the requested start and the nearest at/before it (up to
 * maxPerDirection each way). A segment's candidate start is the requested
 * start clamped into [segment.startMin, segment.endMin - durationMin],
 * snapped to 5-minute granularity toward the requested time. Bounded to
 * the given day's segments only. Returns a flat list sorted by |deltaMin|
 * (stable — per therapist, earlier suggestions are inserted before
 * later), capped at 6:
 *   [{therapistProfileId, displayName, colour, startMin, endMin, deltaMin}]
 */
function nearestAlternatives(therapistResults, request, maxPerDirection = 1) {
  const req = request || {};
  const reqStart = req.startMin;
  const reqDur = req.durationMin;
  if (!Number.isFinite(reqStart) || !Number.isFinite(reqDur) || reqDur <= 0) {
    throw new Error('nearestAlternatives: request needs numeric startMin and durationMin > 0');
  }
  const list = Array.isArray(therapistResults) ? therapistResults : [];
  const out = [];
  for (const t of list) {
    if (!t || !Array.isArray(t.segments)) continue;
    const earlier = [];
    const later = [];
    for (const seg of t.segments) {
      if (!seg || seg.type !== 'available') continue;
      const lo = seg.startMin;
      const hi = seg.endMin - reqDur;
      if (hi < lo) continue;                              // segment cannot hold the duration
      const s = snapStart(Math.min(Math.max(reqStart, lo), hi), lo, hi, reqStart);
      const deltaMin = s - reqStart;
      if (deltaMin === 0) continue;                       // the request itself fits here
      (deltaMin > 0 ? later : earlier).push({ startMin: s, deltaMin });
    }
    earlier.sort((a, b) => b.deltaMin - a.deltaMin);      // nearest earlier first
    later.sort((a, b) => a.deltaMin - b.deltaMin);        // nearest later first
    const picks = earlier.slice(0, maxPerDirection).concat(later.slice(0, maxPerDirection));
    for (const p of picks) {
      out.push({
        therapistProfileId: t.therapistProfileId !== undefined ? t.therapistProfileId : null,
        displayName: t.displayName !== undefined ? t.displayName : null,
        colour: t.colour !== undefined ? t.colour : null,
        startMin: p.startMin,
        endMin: p.startMin + reqDur,
        deltaMin: p.deltaMin,
      });
    }
  }
  return out
    .sort((a, b) => Math.abs(a.deltaMin) - Math.abs(b.deltaMin))   // stable → ties keep insertion order
    .slice(0, 6);
}

/**
 * Presentation order for the available list: requested-slot fits first
 * (every candidate here fits today — kept for future mixed lists), then
 * the roomiest window (windowMin desc), then displayName asc. Factual
 * ordering only — no scoring, no recommendation. Never mutates.
 */
function sortCandidates(available) {
  return (Array.isArray(available) ? available : []).slice().sort((a, b) => {
    const fitDiff = (b && b.requestedSlotFits ? 1 : 0) - (a && a.requestedSlotFits ? 1 : 0);
    if (fitDiff !== 0) return fitDiff;
    const winDiff = ((b && b.windowMin) || 0) - ((a && a.windowMin) || 0);
    if (winDiff !== 0) return winDiff;
    const an = a && a.displayName ? String(a.displayName) : '';
    const bn = b && b.displayName ? String(b.displayName) : '';
    return an < bn ? -1 : (an > bn ? 1 : 0);
  });
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
  classifyCandidate,
  rangeWindows,
  nearestAlternatives,
  sortCandidates,
};
