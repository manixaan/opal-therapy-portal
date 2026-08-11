'use strict';

/**
 * MOBILE API — thin, aggregated surface for the Opa Mobile Companion app.
 *
 * The mobile app talks ONLY to this backend. These routes read local
 * Postgres exclusively (events, snapshot_*, voice_notes) — they never call
 * Splose, Outlook, Xero, Maps, or any AI provider, so they stay fast and
 * available on mobile networks and add zero external-write risk.
 *
 * Scoping model — deliberately NARROWER than the portal:
 *   every endpoint returns the CALLER'S OWN day only. Appointments/travel
 *   come from the caller's own therapist_profile_id (owner/admin included —
 *   the mobile Today view is personal, not a practice dashboard; the master
 *   calendar stays a portal feature). Tasks/reminders/voice notes are
 *   user_id-scoped exactly like snapshot-routes.js. Anything not owned by
 *   the caller answers 404, indistinguishable from "does not exist". The
 *   client can never select a therapist/practitioner scope.
 *
 * Timezone: the practice runs on a single business timezone
 * (Australia/Perth, AWST, no DST — same rule as scheduler-routes.js).
 * `date` params are Perth calendar dates; an optional `timezone` param is
 * validated as a real IANA name but day boundaries ALWAYS use Perth so a
 * travelling device cannot shift them. Timestamps in responses are UTC ISO.
 *
 * read_only: GETs allowed; writes blocked by permissions.requireAuth.
 * Audit: voice-note create/update/review/archive/delete with ids-only
 * metadata — never transcript content. camelCase in, camelCase out.
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const { VIRTUAL_RE } = require('./geo');
const log = require('./logger').createLogger('mobile');

router.use('/api/mobile', requireAuth);

// Async-handler guard (same rationale as snapshot-routes: an unhandled
// rejection in an Express 4 async handler would hang the request).
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('mobile route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;

/** Audit helper — metadata carries ids only, never transcript/title content. */
async function audit(req, action, targetId, extraMeta = {}) {
  await db.logAuditEvent({
    action, targetType: 'voice_note', targetId,
    actorUserId: req.user?.id, organisationId: orgOf(req), ipAddress: req.ip,
    metadata: { id: targetId, ...extraMeta },
  }).catch(() => {});
}

// ── Perth day window (same offset rule as scheduler-routes.js) ───────────────

const PERTH_TZ_OFFSET_MIN = 480; // AWST — no DST
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's Perth calendar date as YYYY-MM-DD. */
function perthToday() {
  return new Date(Date.now() + PERTH_TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

/** [start, end) UTC window for a Perth calendar date. */
function perthDayWindow(date, days = 1) {
  const startUtc = new Date(Date.parse(`${date}T00:00:00Z`) - PERTH_TZ_OFFSET_MIN * 60000);
  const endUtc = new Date(startUtc.getTime() + days * 24 * 3600 * 1000);
  return { startUtc, endUtc };
}

/** Validate ?date= (default: today in Perth). Returns null on bad input. */
function parseDateParam(raw) {
  if (raw === undefined) return perthToday();
  const s = String(raw);
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return null;
  return s;
}

/**
 * Optional ?timezone= is accepted for forward compatibility and validated as
 * a real IANA name, but the response and all day boundaries stay on the
 * practice timezone — a device timezone must never shift appointment days.
 */
function timezoneParamInvalid(raw) {
  if (raw === undefined) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: String(raw) });
    return false;
  } catch (_) {
    return true;
  }
}

// ── Event shaping ────────────────────────────────────────────────────────────

/**
 * Same rule as routes.js isRoutableAddress(): street + suburb is enough for
 * Maps; "unknown"/placeholder strings are not. (Kept local — routes.js only
 * exports its router.)
 */
function isRoutableAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const clean = addr.trim();
  if (clean.length < 6) return false;
  if (/^(unknown|n\/a|none|tbc|tbd|-+)$/i.test(clean)) return false;
  return clean.includes(',') || clean.split(/\s+/).length >= 3;
}

const bestAddress = (ev) => ev.manual_location || ev.location || null;

/** Compact appointment shape for mobile lists. No raw sync payloads. */
function formatMobileAppointment(ev) {
  const address = bestAddress(ev);
  const virtual = VIRTUAL_RE.test(String(address || ''));
  return {
    id: ev.id,
    title: ev.title,
    start: ev.start_time,
    end: ev.end_time,
    timezone: 'Australia/Perth',
    eventType: ev.event_type,
    status: ev.status,
    isCancelled: ev.status === 'cancelled',
    location: address,
    isVirtual: virtual,
    hasTravel: ev.travel_time_minutes != null || ev.travel_distance != null,
    needsAddressReview: ev.event_type === 'therapy' && !virtual && !isRoutableAddress(address),
    canOpenInMaps: !virtual && isRoutableAddress(address),
    source: ev.source || 'local',
  };
}

/**
 * Load the caller's own diary for a Perth-date window.
 * Returns { appointments (formatted, non-cancelled kept — the app greys
 * cancelled ones), warnings } — empty diary + warning when the account has
 * no therapist profile, so the rest of an aggregate still renders.
 */
async function loadOwnAppointments(req, date, days = 1) {
  const profileId = req.user.therapist_profile_id;
  if (!profileId) {
    return { appointments: [], rawEvents: [], warnings: ['no_therapist_profile'] };
  }
  const { startUtc, endUtc } = perthDayWindow(date, days);
  const events = await db.getEventsForTherapists([profileId], {
    startDate: startUtc.toISOString(),
    endDate: endUtc.toISOString(),
  });
  const kept = (events || []).filter((e) => !e.is_deleted);
  return { appointments: kept.map(formatMobileAppointment), rawEvents: kept, warnings: [] };
}

// ── Travel derivation (local data only — never recalculated externally) ──────

/**
 * Derive the day's trips from the caller's own in-person therapy
 * appointments, in start order. Trip N arrives at appointment N; its origin
 * is the previous in-person appointment's address (null = start of day).
 * Minutes/km come from the columns the sync layer already stores on events
 * (travel_time_minutes / travel_distance) — nothing is recalculated here and
 * no external service is called. A trip whose destination address is not
 * routable is status 'needs_review' (presentation state; fixing addresses
 * stays a portal feature).
 */
function deriveTrips(rawEvents) {
  const stops = rawEvents
    .filter((e) => e.event_type === 'therapy' && e.status !== 'cancelled')
    .filter((e) => !VIRTUAL_RE.test(String(bestAddress(e) || '')))
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  let prev = null;
  const trips = stops.map((ev) => {
    const toAddress = bestAddress(ev);
    const routable = isRoutableAddress(toAddress);
    const trip = {
      id: `trip-${ev.id}`,
      appointmentId: ev.id,
      fromAddress: prev ? bestAddress(prev) : null,
      toAddress: routable ? toAddress : null,
      departAfter: prev ? prev.end_time : null,
      arriveBy: ev.start_time,
      minutes: ev.travel_time_minutes != null ? Number(ev.travel_time_minutes) : null,
      km: ev.travel_distance != null ? Math.round(Number(ev.travel_distance) * 10) / 10 : null,
      status: routable ? 'ok' : 'needs_review',
      needsReviewReason: routable ? null : 'address_missing',
    };
    prev = ev;
    return trip;
  });

  const summary = {
    tripCount: trips.length,
    totalMinutes: trips.reduce((s, t) => s + (t.minutes || 0), 0),
    totalKm: Math.round(trips.reduce((s, t) => s + (t.km || 0), 0) * 10) / 10,
    needsReviewCount: trips.filter((t) => t.status === 'needs_review').length,
  };
  return { trips, summary };
}

// ── Voice-note shaping/validation ────────────────────────────────────────────

const NOTE_TYPES = ['appointment_note', 'general_note', 'task_candidate', 'reminder_candidate'];
const NOTE_SOURCES = ['mobile_voice', 'typed', 'imported'];
const MAX_TRANSCRIPT_CHARS = 8000;

function formatVoiceNote(row) {
  return {
    id: row.id,
    title: row.title,
    transcript: row.transcript,
    noteType: row.note_type,
    status: row.status,
    source: row.source,
    linkedEventId: row.linked_event_id,
    linkedTaskId: row.linked_task_id,
    linkedReminderId: row.linked_reminder_id,
    capturedAt: row.captured_at,
    reviewedAt: row.reviewed_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateVoiceNoteFields(b, { requireTranscript }) {
  if (requireTranscript && !(typeof b.transcript === 'string' && b.transcript.trim())) {
    return 'transcript is required';
  }
  if (b.transcript !== undefined && !(typeof b.transcript === 'string' && b.transcript.trim())) {
    return 'transcript must be a non-empty string';
  }
  if (typeof b.transcript === 'string' && b.transcript.length > MAX_TRANSCRIPT_CHARS) {
    return `transcript must be ${MAX_TRANSCRIPT_CHARS} characters or fewer`;
  }
  if (b.title !== undefined && b.title !== null
      && !(typeof b.title === 'string' && b.title.trim().length <= 300)) {
    return 'title must be a string of 300 characters or fewer';
  }
  if (b.noteType !== undefined && !NOTE_TYPES.includes(b.noteType)) {
    return `noteType must be one of: ${NOTE_TYPES.join(', ')}`;
  }
  if (b.source !== undefined && !NOTE_SOURCES.includes(b.source)) {
    return `source must be one of: ${NOTE_SOURCES.join(', ')}`;
  }
  if (b.capturedAt !== undefined && Number.isNaN(Date.parse(String(b.capturedAt)))) {
    return 'capturedAt must be a valid ISO timestamp';
  }
  return null;
}

/**
 * Verify a linked record belongs to (or is accessible by) the caller.
 * Fails closed: a non-UUID, missing, or someone-else's id all return the
 * same generic answer so existence is never leaked. Events are accessible
 * when they sit on the caller's own therapist profile (or, for legacy local
 * rows, their own user_id); tasks/reminders when user_id matches.
 */
async function linkTargetOwned(req, kind, id) {
  if (!isUuid(id)) return false;
  if (kind === 'event') {
    const params = [id, req.user.id];
    let where = 'user_id = $2';
    if (req.user.therapist_profile_id) {
      params.push(req.user.therapist_profile_id);
      where = `(user_id = $2 OR therapist_profile_id = $3)`;
    }
    const { rows } = await pool.query(
      `SELECT id FROM events WHERE id = $1 AND ${where} AND (is_deleted IS NULL OR is_deleted = FALSE)`, params);
    return !!rows.length;
  }
  const table = kind === 'task' ? 'snapshot_tasks' : 'snapshot_reminders';
  const { rows } = await pool.query(
    `SELECT id FROM ${table} WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
  return !!rows.length;
}

/** Validate + ownership-check the linked* body fields. Returns error string or null. */
async function checkLinks(req, b) {
  for (const [key, kind] of [
    ['linkedEventId', 'event'], ['linkedTaskId', 'task'], ['linkedReminderId', 'reminder'],
  ]) {
    if (b[key] !== undefined && b[key] !== null) {
      if (!(await linkTargetOwned(req, kind, b[key]))) {
        return `${key} does not reference a record you can access`;
      }
    }
  }
  return null;
}

/** Load the caller's own voice note, or null (→ 404). */
async function loadOwnVoiceNote(req, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    'SELECT * FROM voice_notes WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  return rows[0] || null;
}

// ═══ GET /api/mobile/today — one-round-trip day aggregate ════════════════════

router.get('/api/mobile/today', safe(async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (timezoneParamInvalid(req.query.timezone)) {
    return res.status(400).json({ error: 'timezone must be a valid IANA timezone name' });
  }

  const { startUtc, endUtc } = perthDayWindow(date);
  const [{ appointments, rawEvents, warnings }, remindersQ, tasksQ, notesQ] = await Promise.all([
    loadOwnAppointments(req, date),
    // Due today or overdue, still open.
    pool.query(
      `SELECT * FROM snapshot_reminders
        WHERE user_id = $1 AND state = 'upcoming' AND due_at < $2
        ORDER BY due_at ASC LIMIT 100`, [req.user.id, endUtc.toISOString()]),
    pool.query(
      `SELECT * FROM snapshot_tasks WHERE user_id = $1 AND completed = FALSE
        ORDER BY sort_order ASC, created_at ASC LIMIT 100`, [req.user.id]),
    pool.query(
      `SELECT * FROM voice_notes WHERE user_id = $1 AND status = 'draft'
        ORDER BY created_at DESC LIMIT 5`, [req.user.id]),
  ]);

  const now = new Date();
  const upcoming = appointments.filter((a) => !a.isCancelled);
  const nextAppointment = upcoming.find((a) => new Date(a.start) >= now) || null;
  const { trips, summary: travelSummary } = deriveTrips(rawEvents);
  const nextTrip = trips.find((t) => new Date(t.arriveBy) >= now) || null;

  res.json({
    date,
    timezone: 'Australia/Perth',
    generatedAt: now.toISOString(),
    windowUtc: { start: startUtc.toISOString(), end: endUtc.toISOString() },
    nextAppointment,
    appointments,
    travel: { nextTrip, trips, ...travelSummary },
    tasks: tasksQ.rows,
    reminders: remindersQ.rows,
    voiceNotes: notesQ.rows.map(formatVoiceNote),
    summary: {
      appointmentCount: upcoming.length,
      remainingTaskCount: tasksQ.rows.length,
      dueReminderCount: remindersQ.rows.length,
      travelMinutes: travelSummary.totalMinutes,
      needsReviewCount: travelSummary.needsReviewCount,
    },
    ...(warnings.length ? { warnings } : {}),
  });
}));

// ═══ GET /api/mobile/calendar?date=&range=day|week ═══════════════════════════

router.get('/api/mobile/calendar', safe(async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (timezoneParamInvalid(req.query.timezone)) {
    return res.status(400).json({ error: 'timezone must be a valid IANA timezone name' });
  }
  const range = req.query.range === undefined ? 'day' : String(req.query.range);
  if (!['day', 'week'].includes(range)) {
    return res.status(400).json({ error: "range must be 'day' or 'week'" });
  }
  const dayCount = range === 'week' ? 7 : 1;

  const { appointments, warnings } = await loadOwnAppointments(req, date, dayCount);

  // Group by Perth calendar day so the client renders lists without TZ maths.
  const days = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(Date.parse(`${date}T00:00:00Z`) + i * 24 * 3600 * 1000)
      .toISOString().slice(0, 10);
    days.push({ date: d, appointments: [] });
  }
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const a of appointments) {
    const perthDate = new Date(new Date(a.start).getTime() + PERTH_TZ_OFFSET_MIN * 60000)
      .toISOString().slice(0, 10);
    byDate.get(perthDate)?.appointments.push(a);
  }

  res.json({
    date, range, timezone: 'Australia/Perth', days,
    count: appointments.length,
    ...(warnings.length ? { warnings } : {}),
  });
}));

// ═══ GET /api/mobile/appointments/:id — own-diary detail ═════════════════════

router.get('/api/mobile/appointments/:id', safe(async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) return res.status(404).json({ error: 'Not found' });

  const params = [id, req.user.id];
  let where = 'user_id = $2';
  if (req.user.therapist_profile_id) {
    params.push(req.user.therapist_profile_id);
    where = '(user_id = $2 OR therapist_profile_id = $3)';
  }
  const { rows } = await pool.query(
    `SELECT * FROM events
      WHERE id = $1 AND ${where} AND (is_deleted IS NULL OR is_deleted = FALSE)`, params);
  const ev = rows[0];
  if (!ev) return res.status(404).json({ error: 'Not found' });

  const notes = await pool.query(
    `SELECT * FROM voice_notes WHERE user_id = $1 AND linked_event_id = $2
      ORDER BY created_at DESC LIMIT 50`, [req.user.id, ev.id]);

  const base = formatMobileAppointment(ev);
  res.json({
    appointment: {
      ...base,
      description: ev.description || null,
      clientName: ev.client_name || null,
      travel: {
        minutes: ev.travel_time_minutes != null ? Number(ev.travel_time_minutes) : null,
        km: ev.travel_distance != null ? Math.round(Number(ev.travel_distance) * 10) / 10 : null,
      },
      mapsAddress: base.canOpenInMaps ? bestAddress(ev) : null,
    },
    voiceNotes: notes.rows.map(formatVoiceNote),
    voiceNoteCount: notes.rows.length,
  });
}));

// ═══ GET /api/mobile/travel?date= ════════════════════════════════════════════

router.get('/api/mobile/travel', safe(async (req, res) => {
  const date = parseDateParam(req.query.date);
  if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (timezoneParamInvalid(req.query.timezone)) {
    return res.status(400).json({ error: 'timezone must be a valid IANA timezone name' });
  }

  const { rawEvents, warnings } = await loadOwnAppointments(req, date);
  const { trips, summary } = deriveTrips(rawEvents);
  const nextTrip = trips.find((t) => new Date(t.arriveBy) >= new Date()) || null;

  res.json({
    date, timezone: 'Australia/Perth', nextTrip, trips, summary,
    calculationMethod: 'Stored travel minutes/distance from the practice sync — not recalculated on mobile.',
    ...(warnings.length ? { warnings } : {}),
  });
}));

// ═══ Voice notes ═════════════════════════════════════════════════════════════

// List — own only; optional ?status= and ?date= (Perth day of creation).
router.get('/api/mobile/voice-notes', safe(async (req, res) => {
  const params = [req.user.id];
  let where = 'user_id = $1';
  if (req.query.status !== undefined) {
    const status = String(req.query.status);
    if (!['draft', 'reviewed', 'archived'].includes(status)) {
      return res.status(400).json({ error: "status must be 'draft', 'reviewed', or 'archived'" });
    }
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  if (req.query.date !== undefined) {
    const date = parseDateParam(req.query.date);
    if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const { startUtc, endUtc } = perthDayWindow(date);
    params.push(startUtc.toISOString());
    where += ` AND created_at >= $${params.length}`;
    params.push(endUtc.toISOString());
    where += ` AND created_at < $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM voice_notes WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params);
  res.json({ voiceNotes: rows.map(formatVoiceNote) });
}));

router.get('/api/mobile/voice-notes/:id', safe(async (req, res) => {
  const row = await loadOwnVoiceNote(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ voiceNote: formatVoiceNote(row) });
}));

// Create — always a draft. Link targets are ownership-verified server-side.
router.post('/api/mobile/voice-notes', safe(async (req, res) => {
  const b = req.body || {};
  const invalid = validateVoiceNoteFields(b, { requireTranscript: true });
  if (invalid) return res.status(400).json({ error: invalid });
  const linkErr = await checkLinks(req, b);
  if (linkErr) return res.status(400).json({ error: linkErr, code: 'invalid_link' });

  const { rows } = await pool.query(
    `INSERT INTO voice_notes
       (user_id, organisation_id, title, transcript, note_type, source,
        linked_event_id, linked_task_id, linked_reminder_id, captured_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.user.id, orgOf(req),
     (typeof b.title === 'string' && b.title.trim()) || null,
     b.transcript.trim(),
     b.noteType || 'general_note',
     b.source || 'mobile_voice',
     b.linkedEventId || null, b.linkedTaskId || null, b.linkedReminderId || null,
     b.capturedAt || null]);
  const note = rows[0];
  await audit(req, 'mobile.voice_note_created', note.id, { noteType: note.note_type });
  res.status(201).json({ voiceNote: formatVoiceNote(note) });
}));

// Edit — content/links editable while draft; status may move draft→reviewed
// and draft|reviewed→archived. Reviewed/archived content is frozen.
router.patch('/api/mobile/voice-notes/:id', safe(async (req, res) => {
  const row = await loadOwnVoiceNote(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};

  const wantsContentEdit = ['title', 'transcript', 'noteType', 'linkedEventId', 'linkedTaskId', 'linkedReminderId']
    .some((k) => b[k] !== undefined);
  if (wantsContentEdit && row.status !== 'draft') {
    return res.status(409).json({
      error: `Cannot edit a voice note in status '${row.status}' — content is frozen after review`,
      code: 'invalid_state',
    });
  }
  const invalid = validateVoiceNoteFields(b, { requireTranscript: false });
  if (invalid) return res.status(400).json({ error: invalid });

  let statusChange = null;
  if (b.status !== undefined) {
    const allowed = { draft: ['reviewed', 'archived'], reviewed: ['archived'] };
    if (!(allowed[row.status] || []).includes(b.status)) {
      return res.status(409).json({
        error: `Cannot move a voice note from '${row.status}' to '${String(b.status)}'`,
        code: 'invalid_state',
      });
    }
    statusChange = b.status;
  }
  const linkErr = await checkLinks(req, b);
  if (linkErr) return res.status(400).json({ error: linkErr, code: 'invalid_link' });

  const sets = [];
  const params = [row.id, req.user.id];
  const push = (col, value) => { params.push(value); sets.push(`${col} = $${params.length}`); };
  if (b.title !== undefined) push('title', (typeof b.title === 'string' && b.title.trim()) || null);
  if (b.transcript !== undefined) push('transcript', b.transcript.trim());
  if (b.noteType !== undefined) push('note_type', b.noteType);
  if (b.linkedEventId !== undefined) push('linked_event_id', b.linkedEventId);
  if (b.linkedTaskId !== undefined) push('linked_task_id', b.linkedTaskId);
  if (b.linkedReminderId !== undefined) push('linked_reminder_id', b.linkedReminderId);
  if (statusChange) {
    push('status', statusChange);
    if (statusChange === 'reviewed') push('reviewed_at', new Date());
    if (statusChange === 'archived') push('archived_at', new Date());
  }
  if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' });

  const { rows } = await pool.query(
    `UPDATE voice_notes SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $1 AND user_id = $2 RETURNING *`, params);
  const updated = rows[0];
  const action = statusChange === 'reviewed' ? 'mobile.voice_note_reviewed'
    : statusChange === 'archived' ? 'mobile.voice_note_archived'
      : 'mobile.voice_note_updated';
  await audit(req, action, updated.id);
  res.json({ voiceNote: formatVoiceNote(updated) });
}));

// Delete — hard delete for drafts only (matching snapshot's convention for
// user-owned draft content); reviewed/archived notes must stay (archive is
// the terminal state for anything that was ever reviewed).
router.delete('/api/mobile/voice-notes/:id', safe(async (req, res) => {
  const row = await loadOwnVoiceNote(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'draft') {
    return res.status(409).json({
      error: "Only draft voice notes can be deleted — archive instead (PATCH status: 'archived')",
      code: 'invalid_state',
    });
  }
  await pool.query('DELETE FROM voice_notes WHERE id = $1 AND user_id = $2', [row.id, req.user.id]);
  await audit(req, 'mobile.voice_note_deleted', row.id);
  res.json({ ok: true });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  AI — the Companion app's ONLY route to a model
//
//  The iOS app holds no AWS credential, no Anthropic key and no Bedrock
//  endpoint. It posts a transcript here and this backend does the rest:
//  managed identity → STS → Australian Bedrock profile → guardrail. That is the
//  same path the Portal website uses, because this route calls the same
//  clinical-note-provider the website's case-note route calls rather than
//  reaching for the gateway itself. A second entry point would be a second set
//  of policy decisions to keep in step, and they would not stay in step.
//
//  Everything protective here is deliberately upstream of the model: auth (the
//  router-level requireAuth above), a per-user rate limit, a size cap, and a
//  transcript-only payload. The response is a draft for a therapist to review —
//  never a record, never advice.
// ═══════════════════════════════════════════════════════════════════════════

const noteProvider = require('./clinical-note-provider');
const { CURRENT_STYLE_VERSION, INSTRUCTION_MODIFIERS } = require('./case-note-style');

/**
 * Per-user rate limit, mirroring the website's Opa chat limiter.
 *
 * Keyed on the authenticated user, not the IP: a practice behind one NAT would
 * otherwise share a bucket, and a stolen device would get a fresh one simply by
 * changing network.
 */
const MOBILE_AI_WINDOW_MS = 10 * 60 * 1000;
const MOBILE_AI_MAX = 12;
const _mobileAiAttempts = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _mobileAiAttempts) if (v.resetAt <= now) _mobileAiAttempts.delete(k);
}, 10 * 60 * 1000).unref();

function mobileAiRateLimit(req, res, next) {
  const key = req.user?.id || 'anonymous';
  const now = Date.now();
  let entry = _mobileAiAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + MOBILE_AI_WINDOW_MS };
    _mobileAiAttempts.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > MOBILE_AI_MAX) {
    res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ status: 'rate_limited', error: 'Too many requests. Try again shortly.' });
  }
  return next();
}

router.post('/api/mobile/ai/case-note', mobileAiRateLimit, safe(async (req, res) => {
  // Degrade before anything else, and say nothing about why. "Which of six
  // settings is missing" is useful to an operator reading /ready and useless
  // to a therapist — and it describes the deployment to anyone holding a
  // stolen phone.
  if (!noteProvider.isEnabled()) {
    return res.status(503).json({ status: 'unavailable', error: 'AI drafting is unavailable.' });
  }

  const body = req.body || {};
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) {
    return res.status(400).json({ status: 'invalid', error: 'A transcript is required.' });
  }
  // The same ceiling the voice-note upload already enforces (line ~210). A
  // second, larger limit here would mean a transcript this endpoint accepts
  // could never have been stored by the endpoint that produces one.
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return res.status(413).json({
      status: 'invalid',
      error: `Transcript exceeds ${MAX_TRANSCRIPT_CHARS} characters.`,
    });
  }

  // Whitelisted, not free text: `instruction` selects a canned modifier, so the
  // phone cannot append arbitrary text to the system prompt.
  const instruction = typeof body.instruction === 'string'
    && Object.prototype.hasOwnProperty.call(INSTRUCTION_MODIFIERS, body.instruction)
    ? body.instruction
    : undefined;

  // Minimum context, and no identifiers. The transcript is the only clinical
  // carrier; a date label and a service label are not names.
  const session = {
    dateLabel: typeof body.sessionDateLabel === 'string' ? body.sessionDateLabel.slice(0, 60) : undefined,
    serviceLabel: typeof body.serviceLabel === 'string' ? body.serviceLabel.slice(0, 120) : undefined,
  };

  let raw;
  try {
    raw = await noteProvider.generateCaseNote({
      transcript,
      styleVersion: CURRENT_STYLE_VERSION,
      instruction,
      session,
      // Attribution. Without these the ai_interactions row has a null actor and
      // no call can be traced to a person.
      userId: req.user.id,
      organisationId: orgOf(req),
    });
  } catch (err) {
    // One generic shape for every downstream failure — identity, STS, model,
    // guardrail, transport. The phone learns the draft did not happen and
    // nothing about the cloud path that failed.
    log.warn('mobile ai generation failed', { userId: req.user.id, reason: err && err.message });
    return res.status(502).json({ status: 'failed', error: 'Could not draft a note. Please try again.' });
  }

  await audit(req, 'mobile.ai_case_note_drafted', null);

  res.json({
    status: 'ok',
    // Assistive drafting only. The app must present this for review and must
    // not file it as documentation.
    reviewRequired: true,
    sections: raw.sections,
    warnings: raw.warnings || [],
    // Deliberately NOT providerIdentity(): that carries the resolved Bedrock
    // inference profile id, which is an account internal. The app needs to know
    // a draft was machine-generated and must be reviewed — not which profile
    // produced it. The full identity is recorded server-side in ai_interactions.
    generatedBy: 'ai-assistant',
  });
}));

module.exports = router;
