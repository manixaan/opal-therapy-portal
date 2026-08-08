/**
 * MASTER SCHEDULER — Phase 2 availability endpoints.
 *
 *   GET  /api/scheduler/availability         — whole-org day availability (owner/admin)
 *   POST /api/scheduler/common-availability  — intersection across selected therapists
 *
 * Both are thin aggregation wrappers over the PURE availability engine
 * (availability-engine.js): fetch therapists + events + schedules + leave in
 * a fixed number of queries, compute in memory, return structured segments.
 * No per-therapist queries, no schema changes, no external calls.
 *
 * Privacy: responses carry ONLY segment times/types and event ids — never
 * event titles, subjects or client names. Private Outlook events block
 * availability without their content leaving the server.
 */

'use strict';

const express = require('express');
const router = express.Router();

const db = require('./database');
const { requireAuth } = require('./permissions');
const { requireMasterCalendarAccess } = require('./calendar-permissions');
const engine = require('./availability-engine');

const PERTH_TZ_OFFSET_MIN = 480; // AWST — no DST; parameterised in the engine

// Org-level scheduling defaults. Read from org_settings.settings.schedulingDefaults
// when present; these in-code values are the documented fallback. No silent
// operational assumptions beyond a standard 08:00–17:00 practice day.
const DEFAULTS = {
  workStartMin: 8 * 60,
  workEndMin: 17 * 60,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  minDurationMin: 30,
};

function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

// ISO-8601 week key matching the frontend's work-location planner ('2026-W12').
function isoWeekKey(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = (date.getUTCDay() + 6) % 7;          // 0 = Monday
  date.setUTCDate(date.getUTCDate() - day + 3);     // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const ftDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function orgSchedulingDefaults(organisationId) {
  try {
    const r = await db.pool.query('SELECT settings FROM org_settings WHERE org_id = $1', [organisationId]);
    const cfg = (r.rows[0] && r.rows[0].settings && r.rows[0].settings.schedulingDefaults) || {};
    return {
      workStartMin: Number.isFinite(cfg.workStartMin) ? cfg.workStartMin : DEFAULTS.workStartMin,
      workEndMin: Number.isFinite(cfg.workEndMin) ? cfg.workEndMin : DEFAULTS.workEndMin,
      bufferBeforeMin: Number.isFinite(cfg.bufferBeforeMin) ? cfg.bufferBeforeMin : DEFAULTS.bufferBeforeMin,
      bufferAfterMin: Number.isFinite(cfg.bufferAfterMin) ? cfg.bufferAfterMin : DEFAULTS.bufferAfterMin,
      minDurationMin: Number.isFinite(cfg.minDurationMin) ? cfg.minDurationMin : DEFAULTS.minDurationMin,
    };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

/**
 * Shared pipeline: compute availability for the given profiles on one Perth day.
 * profileFilter: null = all org therapists; Set = restrict to those ids.
 */
async function computeOrgAvailability(req, date, profileFilter, minDurationOverride) {
  const orgId = req.user.organisation_id;
  const cfg = await orgSchedulingDefaults(orgId);
  const minDuration = Number.isFinite(minDurationOverride) ? minDurationOverride : cfg.minDurationMin;

  const profiles = (await db.getAllTherapistProfiles(orgId))
    .filter((p) => p.is_active !== false)
    .filter((p) => !profileFilter || profileFilter.has(p.id));

  if (!profiles.length) return { cfg, therapists: [] };

  const profileIds = profiles.map((p) => p.id);
  const userIds = profiles.map((p) => p.user_id).filter(Boolean);

  // Perth day window in UTC for the event query (day ± the offset).
  const dayStartUtc = new Date(Date.parse(`${date}T00:00:00Z`) - PERTH_TZ_OFFSET_MIN * 60000);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 3600 * 1000);

  const [events, schedules, leave] = await Promise.all([
    db.getEventsForTherapists(profileIds, {
      startDate: dayStartUtc.toISOString(),
      endDate: dayEndUtc.toISOString(),
    }),
    db.pool.query(
      'SELECT id, work_location_schedule FROM users WHERE id = ANY($1::uuid[])', [userIds]),
    db.pool.query(
      `SELECT user_id,
              to_char(start_date, 'YYYY-MM-DD') AS start_date,
              to_char(end_date,   'YYYY-MM-DD') AS end_date
         FROM leave_requests
        WHERE organisation_id = $1 AND status = 'approved'
          AND start_date <= $2::date AND end_date >= $2::date`, [orgId, date]),
  ]);

  const scheduleByUser = new Map(schedules.rows.map((r) => [r.id, r.work_location_schedule]));
  const leaveByUser = new Map();
  leave.rows.forEach((r) => {
    if (!leaveByUser.has(r.user_id)) leaveByUser.set(r.user_id, []);
    leaveByUser.get(r.user_id).push({ startDate: String(r.start_date).slice(0, 10), endDate: String(r.end_date).slice(0, 10) });
  });
  const eventsByProfile = new Map();
  events.forEach((ev) => {
    const pid = ev.therapist_profile_id;
    if (!eventsByProfile.has(pid)) eventsByProfile.set(pid, []);
    eventsByProfile.get(pid).push(ev);
  });

  const weekKey = isoWeekKey(date);
  const therapists = profiles.map((p) => {
    const fullSchedule = scheduleByUser.get(p.user_id) || null;
    const weekSchedule = (fullSchedule && fullSchedule[weekKey]) || null;
    const scheduleKnown = !!(weekSchedule && Object.keys(weekSchedule).length);

    const result = engine.computeDayAvailability({
      date,
      tzOffsetMin: PERTH_TZ_OFFSET_MIN,
      events: eventsByProfile.get(p.id) || [],
      weekSchedule,
      scheduleKnown,
      workingHours: { startMin: cfg.workStartMin, endMin: cfg.workEndMin },
      leaveRanges: leaveByUser.get(p.user_id) || [],
      buffers: { beforeMin: cfg.bufferBeforeMin, afterMin: cfg.bufferAfterMin },
      minDurationMin: minDuration,
    });

    return {
      therapistProfileId: p.id,
      displayName: p.display_name,
      roleTitle: p.role_title || null,
      colour: p.colour,
      working: result.working,
      workingHoursSource: result.workingHoursSource,
      availabilityConfidence: result.availabilityConfidence,
      capacity: result.capacity,
      // times/types/ids only — no titles, no client data
      segments: result.segments.map((s) => ({
        startMin: s.startMin, endMin: s.endMin, type: s.type,
        prevEventId: s.prevEventId || null, nextEventId: s.nextEventId || null,
      })),
    };
  });

  return { cfg, therapists };
}

/**
 * GET /api/scheduler/availability?date=YYYY-MM-DD[&therapistIds=a,b]
 * Owner/Admin only (same policy as the master calendar). One aggregated
 * response for every visible therapist.
 */
router.get('/api/scheduler/availability', requireAuth, requireMasterCalendarAccess, async (req, res) => {
  try {
    const { date } = req.query;
    if (!isYmd(date)) return res.status(400).json({ error: 'date=YYYY-MM-DD is required' });
    let filter = null;
    if (req.query.therapistIds) {
      filter = new Set(String(req.query.therapistIds).split(',').map((s) => s.trim()).filter(Boolean));
    }
    const { cfg, therapists } = await computeOrgAvailability(req, date, filter);
    res.json({
      date,
      workingHours: { startMin: cfg.workStartMin, endMin: cfg.workEndMin },
      buffers: { beforeMin: cfg.bufferBeforeMin, afterMin: cfg.bufferAfterMin },
      minDurationMin: cfg.minDurationMin,
      therapists,
    });
  } catch (err) {
    console.error('GET /api/scheduler/availability error:', err.message);
    res.status(500).json({ error: 'Failed to compute availability' });
  }
});

/**
 * POST /api/scheduler/common-availability
 * Body: { date: 'YYYY-MM-DD', therapistIds: [..] (>=2), minDurationMin? }
 * Intersection of the selected therapists' TRUE available segments.
 */
router.post('/api/scheduler/common-availability', requireAuth, requireMasterCalendarAccess, async (req, res) => {
  try {
    const { date, therapistIds, minDurationMin } = req.body || {};
    if (!isYmd(date)) return res.status(400).json({ error: 'date=YYYY-MM-DD is required' });
    if (!Array.isArray(therapistIds) || therapistIds.length < 2) {
      return res.status(400).json({ error: 'therapistIds must list at least two therapists' });
    }
    const minDur = Number.isFinite(minDurationMin) ? Math.max(5, Math.min(480, minDurationMin)) : undefined;
    const { cfg, therapists } = await computeOrgAvailability(req, date, new Set(therapistIds), minDur);
    if (therapists.length < 2) {
      return res.status(400).json({ error: 'Fewer than two of the requested therapists exist in this practice' });
    }
    const slots = engine.intersectAvailability(
      therapists.map((t) => t.segments),
      minDur != null ? minDur : cfg.minDurationMin);
    res.json({
      date,
      minDurationMin: minDur != null ? minDur : cfg.minDurationMin,
      therapistCount: therapists.length,
      therapists: therapists.map((t) => ({
        therapistProfileId: t.therapistProfileId, displayName: t.displayName,
        working: t.working, availabilityConfidence: t.availabilityConfidence,
      })),
      slots,
    });
  } catch (err) {
    console.error('POST /api/scheduler/common-availability error:', err.message);
    res.status(500).json({ error: 'Failed to compute common availability' });
  }
});

/**
 * POST /api/scheduler/find-availability
 * "Who can actually take this appointment?" — consumes the canonical Phase 2
 * engine; one aggregated evaluation for the whole eligible therapist set.
 *
 * Body: {
 *   date: 'YYYY-MM-DD',
 *   mode?: 'exact' | 'range'        (default exact)
 *   startMin?: minutes-of-day       (exact mode)
 *   durationMin: number,
 *   rangeStartMin?, rangeEndMin?,   (range mode)
 *   discipline?: string,            (normalised match on role_title)
 *   therapistIds?: string[]         (empty/omitted = everyone)
 * }
 */
const normDiscipline = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

router.post('/api/scheduler/find-availability', requireAuth, requireMasterCalendarAccess, async (req, res) => {
  try {
    const b = req.body || {};
    if (!isYmd(b.date)) return res.status(400).json({ error: 'date=YYYY-MM-DD is required' });
    const durationMin = Number(b.durationMin);
    if (!Number.isFinite(durationMin) || durationMin < 5 || durationMin > 480) {
      return res.status(400).json({ error: 'durationMin must be between 5 and 480' });
    }
    const mode = b.mode === 'range' ? 'range' : 'exact';
    let startMin = null, rangeStart = null, rangeEnd = null;
    if (mode === 'exact') {
      startMin = Number(b.startMin);
      if (!Number.isFinite(startMin) || startMin < 0 || startMin + durationMin > 1440) {
        return res.status(400).json({ error: 'startMin must leave room for the duration within the day' });
      }
    } else {
      rangeStart = Number(b.rangeStartMin); rangeEnd = Number(b.rangeEndMin);
      if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd - rangeStart < durationMin) {
        return res.status(400).json({ error: 'range must be at least as long as the duration' });
      }
    }

    const filter = Array.isArray(b.therapistIds) && b.therapistIds.length
      ? new Set(b.therapistIds) : null;
    const { therapists } = await computeOrgAvailability(req, b.date, filter);

    const wanted = normDiscipline(b.discipline);
    const eligible = wanted
      ? therapists.filter((t) => normDiscipline(t.roleTitle) === wanted)
      : therapists;

    const REASON_LABEL = {
      busy: 'Busy', leave: 'On leave', not_working: 'Not working',
      outside_hours: 'Outside working hours', too_short: 'Not enough free time',
    };

    if (mode === 'exact') {
      const request = { startMin, durationMin };
      const candidates = eligible.map((t) => engine.classifyCandidate(t, request));
      const available = engine.sortCandidates(candidates.filter((c) => c.status === 'available'));
      const unavailable = candidates.filter((c) => c.status !== 'available')
        .map((c) => ({
          therapistProfileId: c.therapistProfileId, displayName: c.displayName,
          roleTitle: c.roleTitle, colour: c.colour,
          reason: c.reason, reasonLabel: REASON_LABEL[c.reason] || 'Unavailable',
          busyUntilMin: c.busyUntilMin, availableMin: c.availableMin,
          availabilityConfidence: c.availabilityConfidence,
        }))
        .sort((a, z) => String(a.displayName).localeCompare(String(z.displayName)));

      const suggestions = available.length === 0
        ? engine.nearestAlternatives(eligible, request)
        : [];

      return res.json({
        requested: { date: b.date, mode, startMin, endMin: startMin + durationMin, durationMin },
        counts: { available: available.length, unavailable: unavailable.length },
        available, unavailable, suggestions,
      });
    }

    // range mode: availability WINDOWS (never sliding permutations)
    const rows = eligible.map((t) => {
      const windows = engine.rangeWindows(t, rangeStart, rangeEnd, durationMin);
      const probe = engine.classifyCandidate(t, { startMin: rangeStart, durationMin });
      return { t, windows, probe };
    });
    const available = rows.filter((r) => r.windows.length)
      .map((r) => ({
        therapistProfileId: r.t.therapistProfileId, displayName: r.t.displayName,
        roleTitle: r.t.roleTitle, colour: r.t.colour,
        workingHoursSource: r.t.workingHoursSource,
        availabilityConfidence: r.t.availabilityConfidence,
        windows: r.windows,
        totalWindowMin: r.windows.reduce((a, w) => a + w.durationMin, 0),
      }))
      .sort((a, z) => z.totalWindowMin - a.totalWindowMin ||
        String(a.displayName).localeCompare(String(z.displayName)));
    const unavailable = rows.filter((r) => !r.windows.length)
      .map((r) => ({
        therapistProfileId: r.t.therapistProfileId, displayName: r.t.displayName,
        roleTitle: r.t.roleTitle, colour: r.t.colour,
        reason: r.probe.reason || 'busy',
        reasonLabel: REASON_LABEL[r.probe.reason] || 'No window long enough',
        availabilityConfidence: r.t.availabilityConfidence,
      }))
      .sort((a, z) => String(a.displayName).localeCompare(String(z.displayName)));

    res.json({
      requested: { date: b.date, mode, rangeStartMin: rangeStart, rangeEndMin: rangeEnd, durationMin },
      counts: { available: available.length, unavailable: unavailable.length },
      available, unavailable, suggestions: [],
    });
  } catch (err) {
    console.error('POST /api/scheduler/find-availability error:', err.message);
    res.status(500).json({ error: 'Availability search failed' });
  }
});

module.exports = router;
