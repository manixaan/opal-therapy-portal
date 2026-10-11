'use strict';

/**
 * NON-FACE-TO-FACE BILLABLE TIME — the block's timer and its allocation.
 *
 *   GET  /api/nf2f/running                   my running timer(s) — the calendar's timer chip
 *   GET  /api/events/:dbId/nf2f              a block's clients, timer and allocation
 *   POST /api/events/:dbId/nf2f/start        start (or resume); any other running timer of mine stops
 *   POST /api/events/:dbId/nf2f/stop
 *   PUT  /api/events/:dbId/nf2f/allocation   { allocation:[{clientId, percent}], nonBillablePercent }
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
    allocation: alloc,
    split: T.splitSeconds(elapsed, alloc),
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
