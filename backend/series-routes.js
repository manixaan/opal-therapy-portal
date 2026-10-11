'use strict';

/**
 * RECURRING APPOINTMENTS — Outlook's "Repeat every…" for the portal calendar.
 *
 *   POST /api/recurrence/preview        { rule, start: 'YYYY-MM-DD' } → dates + "Occurs every…"
 *   POST /api/events/:dbId/series       { rule } → the event becomes the first of a series
 *   GET  /api/events/:dbId/series       the series an event belongs to, and its appointments
 *
 * A series is ordinary dated events (migration 075). Each repeat is booked by
 * createBookingCore — the same path as Create appointment — so it gets its
 * client link, MMM zone, Splose draft-queue entry (nothing is written to
 * Splose until "Write to Splose") and the owner's Outlook mirror, exactly like
 * a single booking. Deleting "this and following" / "all" is the calendar's
 * ordinary delete, one appointment at a time, so Outlook and Splose follow.
 *
 * Guard: signed in; the event's own calendar, or an owner/admin of the same
 * organisation. Read-only and pre-employee accounts cannot book.
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { requireAuth } = require('./permissions');
const R = require('./recurrence');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = 'Australia/Perth';

router.use('/api/recurrence', requireAuth);

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  console.error('Series error:', err.message);
  res.status(500).json({ error: 'Could not update the repeating appointments' });
});

/** Perth wall-clock parts of an instant: { ymd, hms }. */
function perthParts(ts) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ts));
  const g = t => parts.find(p => p.type === t).value;
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, hms: `${g('hour')}:${g('minute')}:${g('second')}` };
}

async function loadEvent(req, dbId) {
  if (!UUID_RE.test(String(dbId))) return null;
  const { rows: [ev] } = await db.pool.query(
    `SELECT e.*, u.organisation_id AS owner_org FROM events e JOIN users u ON u.id = e.user_id
      WHERE e.id = $1 AND COALESCE(e.is_deleted, FALSE) = FALSE`, [dbId]);
  if (!ev) return null;
  const own = String(ev.user_id) === String(req.session.userId);
  const manager = ['owner', 'admin'].includes(req.user && req.user.role)
    && req.user.organisation_id && String(req.user.organisation_id) === String(ev.owner_org);
  return own || manager ? ev : null;
}

/** What Create appointment sent for the first one, rebuilt from the saved event. */
async function bookingTemplate(ev) {
  const meta = ev.custom_metadata || {};
  const manual = ev.manual_location;
  const location = (manual && typeof manual === 'object' && manual.address) ? String(manual.address) : (ev.location || '');
  const body = {
    title: ev.title, location, categories: Array.isArray(ev.categories) ? ev.categories : [],
    targetTherapistUserId: ev.user_id,
  };
  if (meta.booking && meta.booking.kind) {
    body.booking = { kind: meta.booking.kind, clientId: meta.booking.clientId || null, clientName: meta.booking.clientName || null };
  }
  // The Splose details the first one was queued with (service, case, note…).
  const { rows: [q] } = await db.pool.query(
    `SELECT payload FROM splose_sync_queue WHERE event_id = $1 AND action = 'create' ORDER BY created_at DESC LIMIT 1`, [ev.id]);
  if (q && q.payload && q.payload.patientId) {
    const p = q.payload;
    body.splose = { patientId: p.patientId, patientName: ev.client_name || null, serviceId: p.serviceId || null,
      locationId: p.locationId || null, practitionerId: p.practitionerId || null, caseId: p.caseId || null,
      note: p.note || '', sessionType: p.sessionType || null };
  } else if (ev.client_id && meta.booking && meta.booking.group === 'direct') {
    body.splose = { patientId: ev.client_id, patientName: ev.client_name || null };
  }
  const { rows: [z] } = await db.pool.query(`SELECT mmm_zone FROM calendar_event_mmm WHERE event_id = $1`, [ev.id]);
  if (z) body.mmmZone = z.mmm_zone;
  return body;
}

router.post('/api/recurrence/preview', safe(async (req, res) => {
  const { rule, start } = req.body || {};
  const n = R.normaliseRule(rule, start);
  if (!n.ok) return res.status(400).json({ error: n.error });
  const { dates, capped } = R.expand(n.rule, start);
  res.json({ ok: true, rule: n.rule, dates, count: dates.length, capped, summary: R.describe(n.rule, start),
    last: R.fmtDate(dates[dates.length - 1]) });
}));

router.post('/api/events/:dbId/series', requireAuth, safe(async (req, res) => {
  if (req.user && ['read_only', 'pre_employee'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Your account cannot create bookings' });
  }
  const ev = await loadEvent(req, req.params.dbId);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  if (ev.series_id) return res.status(409).json({ error: 'This appointment already repeats' });
  if ((ev.custom_metadata || {}).travelLegKey || ev.event_type === 'travel') {
    return res.status(400).json({ error: 'Travel legs follow the appointments; they do not repeat on their own' });
  }
  const anchor = perthParts(ev.start_time);
  const n = R.normaliseRule((req.body || {}).rule, anchor.ymd);
  if (!n.ok) return res.status(400).json({ error: n.error });
  const { dates, capped } = R.expand(n.rule, anchor.ymd);
  if (dates.length < 2) return res.status(400).json({ error: 'That rule gives no repeats after this appointment' });

  const template = await bookingTemplate(ev);
  const durationMs = new Date(ev.end_time) - new Date(ev.start_time);
  const { rows: [series] } = await db.pool.query(
    `INSERT INTO event_series (user_id, organisation_id, anchor_event_id, rule, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [ev.user_id, ev.organisation_id || ev.owner_org || null, ev.id, JSON.stringify(n.rule), req.session.userId]);
  await db.pool.query(`UPDATE events SET series_id = $2, series_index = 0 WHERE id = $1`, [ev.id, series.id]);

  // Booked one at a time, like clicking Create for each: Outlook and the
  // Splose queue see ordinary single bookings, in date order.
  const { createBookingCore } = require('./routes');
  const created = [], failed = [];
  for (let i = 1; i < dates.length; i++) {
    const start = new Date(`${dates[i]}T${anchor.hms}+08:00`);
    const end = new Date(start.getTime() + durationMs);
    try {
      const r = await createBookingCore(req, { ...template, startTime: start.toISOString(), endTime: end.toISOString() });
      if (r.status === 201 && r.body && r.body.dbId) {
        await db.pool.query(`UPDATE events SET series_id = $2, series_index = $3 WHERE id = $1`, [r.body.dbId, series.id, i]);
        created.push({ dbId: r.body.dbId, date: dates[i], outlookStatus: r.body.outlookStatus, sploseQueued: !!r.body.sploseQueued });
      } else {
        failed.push({ date: dates[i], error: (r.body && r.body.error) || 'Not saved' });
      }
    } catch (e) {
      failed.push({ date: dates[i], error: 'Not saved' });
    }
  }
  console.log(`🔁 Series ${series.id}: ${created.length} repeats of ${ev.id} (${failed.length} failed)`);
  res.status(201).json({ ok: true, seriesId: series.id, summary: R.describe(n.rule, anchor.ymd), capped,
    created, failed, count: created.length + 1 });
}));

router.get('/api/events/:dbId/series', requireAuth, safe(async (req, res) => {
  const ev = await loadEvent(req, req.params.dbId);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  if (!ev.series_id) return res.json({ series: null });
  const { rows: [s] } = await db.pool.query(`SELECT id, rule, anchor_event_id FROM event_series WHERE id = $1`, [ev.series_id]);
  const { rows: events } = await db.pool.query(
    `SELECT id, start_time, end_time, series_index FROM events
      WHERE series_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE ORDER BY start_time`, [ev.series_id]);
  const anchorYmd = events.length ? perthParts(events[0].start_time).ymd : perthParts(ev.start_time).ymd;
  const now = Date.now();
  res.json({
    series: { id: s.id, rule: s.rule, summary: s.rule && s.rule.end ? R.describe(s.rule, anchorYmd) : null },
    events: events.map(e => ({ dbId: e.id, start: e.start_time, index: e.series_index, past: new Date(e.end_time).getTime() < now,
      isThis: String(e.id) === String(ev.id) })),
  });
}));

module.exports = router;
module.exports.perthParts = perthParts;
