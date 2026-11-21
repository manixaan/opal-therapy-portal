'use strict';

/**
 * NON-FACE-TO-FACE BILLABLE TIME — the block's timer and its allocation.
 *
 *   GET  /api/nf2f/running                   my running timer(s) — the calendar's timer chip
 *   GET  /api/nf2f/blocks?from=&to=          my blocks in a date range — the Case Notes workspace
 *   GET  /api/events/:dbId/nf2f              a block's clients, timer and allocation
 *   POST /api/events/:dbId/nf2f/start        start (or resume); any other running timer of mine stops
 *   POST /api/events/:dbId/nf2f/stop
 *   PUT  /api/events/:dbId/nf2f/allocation   { allocation:[{clientId, percent}], nonBillablePercent }
 *   GET  /api/nf2f/untimed                   my ended blocks with no time entered (must be answered)
 *   POST /api/events/:dbId/nf2f/resolve      { mode: FULL_BLOCK | PER_CLIENT | DID_NOT_HAPPEN, minutes?, reason? }
 *
 * Only a non-face-to-face block that names clients has a timer (with none it
 * is not billable). The timer never runs past the block's length; once a
 * block's time is on a finalised invoice it cannot change. Guard: the
 * block's own calendar, or an owner/admin of its organisation. Every change
 * flags the block's drafts for recalculation like any source change.
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { requireAuth } = require('./permissions');
const T = require('./billing/nf2f-timer');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.use('/api/nf2f', requireAuth);

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  console.error('NF2F timer error:', err.message);
  res.status(500).json({ error: 'Could not update the billable time' });
});

async function loadBlock(req, dbId) {
  if (!UUID_RE.test(String(dbId))) return null;
  const { rows: [ev] } = await db.pool.query(
    `SELECT e.id, e.user_id, e.title, e.start_time, e.end_time, e.custom_metadata, e.organisation_id,
            u.organisation_id AS owner_org
       FROM events e JOIN users u ON u.id = e.user_id
      WHERE e.id = $1 AND COALESCE(e.is_deleted, FALSE) = FALSE`, [dbId]);
  if (!ev) return null;
  const own = String(ev.user_id) === String(req.session.userId);
  const manager = ['owner', 'admin'].includes(req.user && req.user.role)
    && req.user.organisation_id && String(req.user.organisation_id) === String(ev.owner_org);
  return own || manager ? ev : null;
}

async function timerRow(q, eventId) {
  const { rows: [r] } = await q.query(`SELECT * FROM event_billing_timers WHERE event_id = $1`, [eventId]);
  return r ? T.settleRow(q, r) : null;
}

/** Is any of this block's billed time on a finalised (sent, paid…) invoice? */
async function finalised(q, eventId) {
  const { rows } = await q.query(
    `SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE l.calendar_event_id = $1 AND l.component = 'NF2F' AND l.line_status IN ('ACTIVE','REMOVED')
        AND i.status NOT IN ('DRAFT','NEEDS_ATTENTION') LIMIT 1`, [eventId]);
  return rows.length > 0;
}

function view(ev, row) {
  const clients = T.blockClients(ev);
  const now = new Date();
  const alloc = T.allocationFor(row, clients);
  const elapsed = T.elapsedSeconds(row, now);
  return {
    eventId: ev.id, title: ev.title, start: ev.start_time, end: ev.end_time,
    billable: clients.length > 0, clients,
    timer: {
      status: row ? row.status : 'IDLE', elapsedSeconds: elapsed, limitSeconds: row ? Number(row.limit_seconds) : T.blockSeconds(ev),
      runStartedAt: row && row.status === 'RUNNING' ? row.run_started_at : null, autoStopped: !!(row && row.auto_stopped),
      stoppedAt: row ? row.stopped_at : null,
    },
    resolution: row && row.resolution ? { mode: row.resolution, note: row.resolution_note || null, at: row.resolved_at || null } : null,
    allocation: alloc,
    split: T.clientParts(row, clients, elapsed),
  };
}

async function flagDrafts(q, eventId, what) {
  await q.query(`SELECT billing_flag_event_change_for($1, $2)`, [eventId, what]).catch(() => {});
}

router.get('/api/events/:dbId/nf2f', requireAuth, safe(async (req, res) => {
  const ev = await loadBlock(req, req.params.dbId);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  res.json(view(ev, await timerRow(db.pool, ev.id)));
}));

router.post('/api/events/:dbId/nf2f/start', requireAuth, safe(async (req, res) => {
  const ev = await loadBlock(req, req.params.dbId);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  if (!T.blockClients(ev).length) return res.status(400).json({ error: 'This block has no clients, so it is not billable' });
  if (await finalised(db.pool, ev.id)) return res.status(409).json({ error: 'This time is already on a finalised invoice' });
  let row = await timerRow(db.pool, ev.id);
  if (row && row.status === 'RUNNING') return res.json(view(ev, row));
  if (row && row.resolution) return res.status(409).json({ error: 'This block\'s time has already been entered' });
  if (row && T.elapsedSeconds(row) >= Number(row.limit_seconds)) {
    return res.status(409).json({ error: 'The timer has reached this block\'s length. Make the block longer to time more.' });
  }
  // One timer at a time: starting this one stops any other running one of mine.
  const { rows: others } = await db.pool.query(
    `SELECT * FROM event_billing_timers WHERE user_id = $1 AND status = 'RUNNING' AND event_id <> $2`, [ev.user_id, ev.id]);
  for (const o of others) await stopRow(db.pool, await T.settleRow(db.pool, o));
  const { rows: [r] } = await db.pool.query(
    `INSERT INTO event_billing_timers (event_id, organisation_id, user_id, status, run_started_at, limit_seconds)
     VALUES ($1, $2, $3, 'RUNNING', NOW(), $4)
     ON CONFLICT (event_id) DO UPDATE SET status = 'RUNNING', run_started_at = NOW(), auto_stopped = FALSE,
       stopped_at = NULL, limit_seconds = EXCLUDED.limit_seconds, updated_at = NOW()
     RETURNING *`, [ev.id, ev.organisation_id || ev.owner_org || null, ev.user_id, T.blockSeconds(ev)]);
  row = r;
  res.json(view(ev, row));
}));

async function stopRow(q, row) {
  if (!row || row.status !== 'RUNNING') return row;
  const secs = T.elapsedSeconds(row);
  const { rows: [r] } = await q.query(
    `UPDATE event_billing_timers SET status = 'STOPPED', accumulated_seconds = $2, run_started_at = NULL,
            stopped_at = NOW(), updated_at = NOW()
      WHERE event_id = $1 AND status = 'RUNNING' RETURNING *`, [row.event_id, secs]);
  if (r) await flagDrafts(q, row.event_id, 'billable time stopped');
  return r || row;
}

router.post('/api/events/:dbId/nf2f/stop', requireAuth, safe(async (req, res) => {
  const ev = await loadBlock(req, req.params.dbId);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  const row = await stopRow(db.pool, await timerRow(db.pool, ev.id));
  res.json(view(ev, row));
}));

router.put('/api/events/:dbId/nf2f/allocation', requireAuth, safe(async (req, res) => {
  const ev = await loadBlock(req, req.params.dbId);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  const clients = T.blockClients(ev);
  if (!clients.length) return res.status(400).json({ error: 'This block has no clients, so it is not billable' });
  if (await finalised(db.pool, ev.id)) return res.status(409).json({ error: 'This time is already on a finalised invoice' });
  const cur = await timerRow(db.pool, ev.id);
  if (cur && cur.resolution === 'PER_CLIENT') return res.status(409).json({ error: 'Each client\'s minutes were entered for this block; enter them again instead' });
  const v = T.validateAllocation(req.body || {}, clients);
  if (!v.ok) return res.status(400).json({ error: v.error });
  await db.pool.query(
    `INSERT INTO event_billing_timers (event_id, organisation_id, user_id, limit_seconds, allocation, non_billable_percent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (event_id) DO UPDATE SET allocation = EXCLUDED.allocation, non_billable_percent = EXCLUDED.non_billable_percent, updated_at = NOW()`,
    [ev.id, ev.organisation_id || ev.owner_org || null, ev.user_id, T.blockSeconds(ev), JSON.stringify(v.allocation), v.nonBillablePercent]);
  await flagDrafts(db.pool, ev.id, 'billing allocation changed');
  res.json(view(ev, await timerRow(db.pool, ev.id)));
}));

// ── The Case Notes workspace: my case-noting blocks in a date range ─────────
// GET /api/nf2f/blocks?from=YYYY-MM-DD&to=YYYY-MM-DD (Perth days, inclusive,
// at most 31). Each block carries its clients, its timer and which clients
// already have a note written from it (case_note_drafts.nf2f_event_id). Only
// my own blocks: a manager's wider timer access does not extend to listing.
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
router.get('/api/nf2f/blocks', safe(async (req, res) => {
  const { from, to } = req.query;
  if (!YMD_RE.test(String(from)) || !YMD_RE.test(String(to))) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
  const fromMs = Date.parse(`${from}T00:00:00+08:00`);
  const toMs = Date.parse(`${to}T00:00:00+08:00`) + 86400000;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > 31 * 86400000) {
    return res.status(400).json({ error: 'Choose a range of up to 31 days' });
  }
  const { rows } = await db.pool.query(
    `SELECT e.id, e.user_id, e.title, e.start_time, e.end_time, e.custom_metadata, e.organisation_id
       FROM events e
      WHERE e.user_id = $1 AND COALESCE(e.is_deleted, FALSE) = FALSE
        AND e.custom_metadata->'booking'->>'group' = 'nf2f'
        AND e.start_time >= $2 AND e.start_time < $3
      ORDER BY e.start_time`, [req.session.userId, new Date(fromMs), new Date(toMs)]);
  const ids = rows.map((r) => r.id);
  const notes = {};
  if (ids.length) {
    const { rows: drafts } = await db.pool.query(
      `SELECT nf2f_event_id, splose_patient_id, id, review_status FROM case_note_drafts
        WHERE user_id = $1 AND status = 'draft' AND nf2f_event_id = ANY($2::uuid[])
        ORDER BY created_at`, [req.session.userId, ids]);
    for (const d of drafts) {
      const k = String(d.nf2f_event_id);
      (notes[k] = notes[k] || {})[String(d.splose_patient_id)] = { draftId: d.id, reviewStatus: d.review_status };
    }
  }
  const blocks = [];
  for (const ev of rows) {
    const v = view(ev, await timerRow(db.pool, ev.id));
    const booking = (ev.custom_metadata && ev.custom_metadata.booking) || {};
    blocks.push({
      eventId: v.eventId, title: v.title, kind: booking.kind || null, start: v.start, end: v.end,
      clients: v.clients, timer: v.timer, notes: notes[String(ev.id)] || {},
    });
  }
  res.json({ blocks });
}));

// ── Blocks that ended with no time entered (migration 089) ──────────────────
// The calendar asks about each one and cannot be dismissed without an answer.
// Mine only, from the last 31 days; older ones surface in Invoicing › Needs attention.
router.get('/api/nf2f/untimed', safe(async (req, res) => {
  const { rows } = await db.pool.query(
    `SELECT e.id, e.user_id, e.title, e.start_time, e.end_time, e.custom_metadata, e.organisation_id
       FROM events e
       LEFT JOIN calendar_event_billing ceb ON ceb.event_id = e.id
      WHERE e.user_id = $1 AND COALESCE(e.is_deleted, FALSE) = FALSE
        AND LOWER(COALESCE(e.status, '')) <> 'cancelled'
        AND COALESCE(ceb.attendance, '') NOT IN ('CANCELLED', 'NOT_BILLABLE', 'DID_NOT_ATTEND')
        AND e.custom_metadata->'booking'->>'group' = 'nf2f'
        AND e.end_time <= NOW() AND e.end_time > NOW() - INTERVAL '31 days'
      ORDER BY e.start_time`, [req.session.userId]);
  const blocks = [];
  for (const ev of rows) {
    const clients = T.blockClients(ev);
    const row = await timerRow(db.pool, ev.id);
    if (!T.needsResolution(row, clients, ev.end_time)) continue;
    if (await finalised(db.pool, ev.id)) continue;
    const booking = (ev.custom_metadata && ev.custom_metadata.booking) || {};
    blocks.push({ eventId: ev.id, title: ev.title, kind: booking.kind || null, start: ev.start_time, end: ev.end_time,
      blockMinutes: Math.round(T.blockSeconds(ev) / 60), clients });
  }
  res.json({ blocks });
}));

async function notifyOwnersNotDone(q, ev, actorId, note) {
  const orgId = ev.organisation_id || ev.owner_org;
  if (!orgId) return;
  const { rows: owners } = await q.query(
    `SELECT id FROM users WHERE organisation_id = $1 AND role = 'owner' AND COALESCE(is_active, TRUE) = TRUE AND id <> $2`, [orgId, actorId]);
  const { rows: [who] } = await q.query(`SELECT name FROM users WHERE id = $1`, [ev.user_id]);
  const when = new Date(ev.start_time).toLocaleDateString('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short' });
  const clients = T.blockClients(ev).map(c => c.clientName || 'a client').join(', ');
  for (const o of owners) {
    await q.query(
      `INSERT INTO user_notifications (user_id, type, title, message, severity, related_entity, action_payload)
       VALUES ($1, 'nf2f_not_done', $2, $3, 'warning', $4, $5::jsonb)`,
      [o.id, 'Billable work marked as not done',
       `${(who && who.name) || 'A clinician'} marked "${ev.title || 'Non-face-to-face'}" (${when}, ${clients}) as not done, so it will not be billed. Reason: ${note}`,
       `event:${ev.id}`, JSON.stringify({ kind: 'event', eventId: ev.id, date: ev.start_time })]);
  }
}

router.post('/api/events/:dbId/nf2f/resolve', requireAuth, safe(async (req, res) => {
  const ev = await loadBlock(req, req.params.dbId);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  const clients = T.blockClients(ev);
  if (!clients.length) return res.status(400).json({ error: 'This block has no clients, so it is not billable' });
  if (new Date(ev.end_time) > new Date()) return res.status(409).json({ error: 'This block has not finished yet' });
  if (await finalised(db.pool, ev.id)) return res.status(409).json({ error: 'This time is already on a finalised invoice' });
  const existing = await timerRow(db.pool, ev.id);
  if (existing && existing.status === 'RUNNING') return res.status(409).json({ error: 'Stop the timer first' });
  if (existing && Number(existing.accumulated_seconds) > 0 && !existing.resolution) {
    return res.status(409).json({ error: 'This block already has timed work' });
  }
  const v = T.validateResolution(req.body || {}, clients, T.blockSeconds(ev));
  if (!v.ok) return res.status(400).json({ error: v.error });
  const { rows: [row] } = await db.pool.query(
    `INSERT INTO event_billing_timers (event_id, organisation_id, user_id, status, accumulated_seconds, limit_seconds, stopped_at,
                                       allocation, non_billable_percent, resolution, client_seconds, resolution_note, resolved_by_user_id, resolved_at)
     VALUES ($1, $2, $3, 'STOPPED', $4, $5, NOW(), $6::jsonb, 0, $7, $8::jsonb, $9, $10, NOW())
     ON CONFLICT (event_id) DO UPDATE SET status = 'STOPPED', run_started_at = NULL, accumulated_seconds = EXCLUDED.accumulated_seconds,
       limit_seconds = EXCLUDED.limit_seconds, stopped_at = NOW(), allocation = EXCLUDED.allocation, non_billable_percent = 0,
       resolution = EXCLUDED.resolution, client_seconds = EXCLUDED.client_seconds, resolution_note = EXCLUDED.resolution_note,
       resolved_by_user_id = EXCLUDED.resolved_by_user_id, resolved_at = NOW(), updated_at = NOW()
     RETURNING *`,
    [ev.id, ev.organisation_id || ev.owner_org || null, ev.user_id, v.seconds, T.blockSeconds(ev),
     v.allocation ? JSON.stringify(v.allocation) : null, v.resolution,
     v.clientSeconds ? JSON.stringify(v.clientSeconds) : null, v.note, req.session.userId]);
  if (v.resolution === 'DID_NOT_HAPPEN') await notifyOwnersNotDone(db.pool, ev, req.session.userId, v.note);
  await flagDrafts(db.pool, ev.id, v.resolution === 'DID_NOT_HAPPEN' ? 'block marked as not done' : 'block time entered');
  res.json(view(ev, row));
}));

router.get('/api/nf2f/running', safe(async (req, res) => {
  const { rows } = await db.pool.query(
    `SELECT t.*, e.title, e.start_time, e.end_time, e.custom_metadata, e.user_id AS ev_user
       FROM event_billing_timers t JOIN events e ON e.id = t.event_id
      WHERE t.user_id = $1 AND t.status = 'RUNNING' AND COALESCE(e.is_deleted, FALSE) = FALSE`, [req.session.userId]);
  const out = [];
  for (const r of rows) {
    const s = await T.settleRow(db.pool, r);
    if (s.status !== 'RUNNING') continue;
    out.push(view({ id: r.event_id, title: r.title, start_time: r.start_time, end_time: r.end_time, custom_metadata: r.custom_metadata }, s));
  }
  res.json({ running: out });
}));

module.exports = router;
