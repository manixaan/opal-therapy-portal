'use strict';

/**
 * SPLOSE DRAFT-AND-PUBLISH SYNC (migration 058)
 *
 * The portal is the only door for client appointments. Every create, move or
 * cancel made in the calendar is queued here as a pending change; the user
 * reviews the week and presses "Sync Splose", and the publisher walks the
 * queue one call at a time under Splose's 60-calls-a-minute limit.
 *
 * A watcher runs the other way: it reads Splose every couple of minutes and
 * records any appointment that was cancelled, moved, deleted or created
 * inside Splose without coming through the portal, so the user can be told
 * and asked whether the change was valid.
 *
 * Everything that decides something is a pure function at the top of this
 * file (coalesceChange, planPublish, detectExternalChanges,
 * summariseError) and is unit-tested without a database or network. The
 * factories below take their collaborators as arguments.
 */

// ── Pure rules ───────────────────────────────────────────────────────────────

/**
 * Merge a new change into whatever is already pending for the same event.
 *   returns { action, payload }   → write/replace the pending row
 *   returns 'discard'             → nothing to publish any more; drop the row
 */
function coalesceChange(existing, incoming) {
  if (!incoming || !incoming.action) return null;
  const inc = { action: incoming.action, payload: incoming.payload || {} };
  if (!existing) return inc;
  const ex = { action: existing.action, payload: existing.payload || {} };

  if (ex.action === 'create') {
    if (inc.action === 'cancel') return 'discard';     // never reached Splose
    return { action: 'create', payload: { ...ex.payload, ...inc.payload } };
  }
  if (ex.action === 'update') {
    if (inc.action === 'cancel') return { action: 'cancel', payload: { ...ex.payload, ...inc.payload } };
    return { action: 'update', payload: { ...ex.payload, ...inc.payload } };
  }
  // A pending cancel wins over anything that follows it.
  return { action: 'cancel', payload: { ...ex.payload, ...inc.payload } };
}

const ACTION_ORDER = { cancel: 0, update: 1, create: 2 };

/** Cancels first (free the slots), then moves, then creates; each by start. */
function planPublish(rows) {
  return [...rows].sort((a, b) => {
    const oa = ACTION_ORDER[a.action] ?? 9, ob = ACTION_ORDER[b.action] ?? 9;
    if (oa !== ob) return oa - ob;
    const sa = (a.payload && a.payload.start) || '', sb = (b.payload && b.payload.start) || '';
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

/** Never leak Splose payloads or stack traces into a stored error. */
function summariseError(err) {
  if (!err) return 'Unknown error';
  if (err.code === 'FEATURE_DISABLED') return 'Splose writing is switched off in this environment';
  if (err.code === 'CANCELLATION_REASON_REQUIRED') return 'Choose a cancellation reason';
  const status = err.response && err.response.status;
  if (status === 429) return 'Splose asked us to slow down (rate limit)';
  if (status === 401 || status === 403) return 'Splose rejected the practice API key';
  if (status === 404) return 'Splose no longer has this appointment';
  if (status === 400 || status === 422) {
    const d = err.response.data;
    const msg = d && (d.message || d.error || (Array.isArray(d.errors) && d.errors.map(e => e.message || e).join('; ')));
    return 'Splose rejected the appointment' + (msg ? ': ' + String(msg).slice(0, 160) : '');
  }
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return 'Splose did not answer in time';
  return String(err.message || 'Failed').slice(0, 200);
}

function isCancelledAppointment(appt) {
  const ps = appt.patients || appt.appointmentPatients || [];
  if (!ps.length) return false;
  return ps.every(p => /cancel/i.test(String(p.status || '')));
}

function minutesApart(aIso, bIso) {
  const a = new Date(aIso).getTime(), b = new Date(bIso).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.abs(a - b) / 60000;
}

/**
 * Compare Splose against the portal for one window.
 *
 *   localEvents        rows: { id, user_id, splose_id, start_time, end_time, title }
 *                      (non-deleted events that carry a Splose id)
 *   sploseAppointments normalised appointments in the same window
 *   pendingEventIds    Set of event ids with a live queue row — their local
 *                      times are ahead of Splose on purpose, so no 'moved'
 *   now                Date, injected for tests
 *   recentHours        how young a Splose appointment must be to count as
 *                      'created' in Splose (history is not an alert)
 *
 * Returns [{ kind, sploseAppointmentId, eventId, userId, practitionerId,
 *            fingerprint, details }]
 */
function detectExternalChanges({ localEvents, sploseAppointments, pendingEventIds, now, recentHours = 24 }) {
  const pending = pendingEventIds || new Set();
  const nowMs = (now || new Date()).getTime();
  const bySplose = new Map();
  for (const a of sploseAppointments || []) bySplose.set(String(a.id), a);
  const known = new Set();
  const alerts = [];

  for (const ev of localEvents || []) {
    if (!ev.splose_id) continue;
    known.add(String(ev.splose_id));
    const appt = bySplose.get(String(ev.splose_id));
    const base = { eventId: ev.id, userId: ev.user_id, sploseAppointmentId: String(ev.splose_id) };
    if (!appt) {
      alerts.push({ ...base, kind: 'deleted', fingerprint: 'deleted',
        details: { title: ev.title, start: ev.start_time, end: ev.end_time } });
      continue;
    }
    if (isCancelledAppointment(appt)) {
      const p = (appt.patients || [])[0] || {};
      alerts.push({ ...base, kind: 'cancelled', practitionerId: appt.practitionerId,
        fingerprint: 'cancelled:' + (p.cancellationReason || ''),
        details: { title: ev.title, start: ev.start_time, end: ev.end_time,
          reason: p.cancellationReason || null, note: p.cancellationNote || null } });
      continue;
    }
    if (pending.has(ev.id)) continue;
    if (minutesApart(ev.start_time, appt.start) >= 1 || minutesApart(ev.end_time, appt.end) >= 1) {
      alerts.push({ ...base, kind: 'moved', practitionerId: appt.practitionerId,
        fingerprint: 'moved:' + appt.start + '/' + appt.end,
        details: { title: ev.title, from: { start: ev.start_time, end: ev.end_time },
          to: { start: appt.start, end: appt.end } } });
    }
  }

  for (const a of sploseAppointments || []) {
    if (known.has(String(a.id))) continue;
    if (isCancelledAppointment(a)) continue;
    const created = a.createdAt ? new Date(a.createdAt).getTime() : NaN;
    if (isNaN(created) || nowMs - created > recentHours * 3600000) continue;
    alerts.push({ kind: 'created', sploseAppointmentId: String(a.id), eventId: null, userId: null,
      practitionerId: a.practitionerId, fingerprint: 'created:' + a.start + '/' + a.end,
      details: { start: a.start, end: a.end, serviceId: a.serviceId, locationId: a.locationId,
        patientId: ((a.patients || [])[0] || {}).patientId || null } });
  }
  return alerts;
}

// ── Queue ────────────────────────────────────────────────────────────────────

/**
 * Record a draft change for an event, merging into any live pending row.
 * Returns the resulting row, or null when the change cancelled itself out.
 */
async function enqueueChange(db, { userId, createdBy, eventId, action, payload }) {
  const { rows } = await db.pool.query(
    `SELECT id, action, payload FROM splose_sync_queue
      WHERE event_id = $1 AND status IN ('pending', 'failed') LIMIT 1`,
    [eventId]
  );
  const existing = rows[0] || null;
  const merged = coalesceChange(existing, { action, payload });
  if (merged === 'discard') {
    if (existing) {
      await db.pool.query(
        `UPDATE splose_sync_queue SET status = 'discarded', updated_at = NOW() WHERE id = $1`,
        [existing.id]
      );
    }
    return null;
  }
  if (!merged) return null;
  if (existing) {
    const r = await db.pool.query(
      `UPDATE splose_sync_queue
          SET action = $2, payload = $3::jsonb, status = 'pending', error = NULL, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [existing.id, merged.action, JSON.stringify(merged.payload)]
    );
    return r.rows[0];
  }
  const r = await db.pool.query(
    `INSERT INTO splose_sync_queue (user_id, created_by, event_id, action, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
    [userId, createdBy || userId, eventId, merged.action, JSON.stringify(merged.payload)]
  );
  return r.rows[0];
}

/** Live queue rows for a user (pending, publishing, failed), oldest first. */
async function listPending(db, userId) {
  const { rows } = await db.pool.query(
    `SELECT q.*, e.title AS event_title, e.start_time, e.end_time, e.splose_id, e.client_name
       FROM splose_sync_queue q
       JOIN events e ON e.id = q.event_id
      WHERE q.user_id = $1 AND q.status IN ('pending', 'publishing', 'failed')
      ORDER BY q.created_at`,
    [userId]
  );
  return rows;
}

// ── Publisher ────────────────────────────────────────────────────────────────

const DEFAULT_GAP_MS = 1500;   // ~40 calls/min, leaving headroom for the pollers
const RETRY_429_MS   = 5000;
const MAX_ATTEMPTS   = 3;

function createPublisher(deps) {
  const {
    db, sploseApi, io = null,
    gapMs = DEFAULT_GAP_MS,
    sleep = (ms) => new Promise(r => setTimeout(r, ms)),
    log = () => {},
  } = deps;

  const running = new Map();   // userId → { batchId, total, done, startedAt }

  function status(userId) {
    return running.get(String(userId)) || null;
  }

  function emit(userId, payload) {
    try { if (io) io.to(`user:${userId}`).emit('sploseSyncProgress', payload); } catch (_) { /* best effort */ }
  }

  async function practitionerFor(userId) {
    const { rows } = await db.pool.query(
      'SELECT splose_practitioner_id FROM therapist_profiles WHERE user_id = $1 LIMIT 1', [userId]
    );
    return rows[0] && rows[0].splose_practitioner_id ? rows[0].splose_practitioner_id : null;
  }

  let _reasonCache = null;
  async function defaultReasonId() {
    if (_reasonCache === null) _reasonCache = await sploseApi.getCancellationReasons();
    const other = _reasonCache.find(r => /^other$/i.test(r.reason || '')) || _reasonCache[0];
    return other ? other.id : null;
  }

  let _locationCache = null;
  async function defaultLocationId() {
    if (_locationCache === null) _locationCache = await sploseApi.getLocations();
    const live = _locationCache.filter(l => !l.archived);
    return live.length === 1 ? live[0].id : null;
  }

  async function activeCaseFor(patientId) {
    const all = await sploseApi.fetchAllCases();
    const mine = all.filter(c => String(c.patientId) === String(patientId) && !c.archived && !c.deletedAt);
    const active = mine.filter(c => c.status === 'Active' || c.isActive);
    const pick = active.length ? active : mine;
    if (pick.length === 1) return pick[0].id;
    if (pick.length > 1) { const e = new Error('This client has more than one case — choose one in the review list'); e.code = 'CASE_AMBIGUOUS'; throw e; }
    const e = new Error('This client has no active case in Splose'); e.code = 'CASE_MISSING'; throw e;
  }

  /** One queue row → one Splose call (with 429 retries). Returns { sploseId }. */
  async function publishRow(row, event) {
    const p = row.payload || {};
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (row.action === 'create') {
          if (!p.patientId)  { const e = new Error('No Splose client on this appointment'); e.code = 'PATIENT_MISSING'; throw e; }
          if (!p.serviceId)  { const e = new Error('Choose a Splose service for this appointment'); e.code = 'SERVICE_MISSING'; throw e; }
          const practitionerId = p.practitionerId || await practitionerFor(row.user_id);
          if (!practitionerId) { const e = new Error('This therapist is not linked to a Splose practitioner'); e.code = 'PRACTITIONER_MISSING'; throw e; }
          const locationId = p.locationId || await defaultLocationId();
          if (!locationId) { const e = new Error('Choose a Splose location for this appointment'); e.code = 'LOCATION_MISSING'; throw e; }
          const caseId = p.caseId || await activeCaseFor(p.patientId);
          const appt = await sploseApi.createAppointment({
            start: p.start || event.start_time, end: p.end || event.end_time,
            serviceId: p.serviceId, locationId, practitionerId, patientId: p.patientId, caseId,
            note: p.note || '',
          });
          return { sploseId: String(appt.id) };
        }
        const sploseId = event.splose_id || row.splose_appointment_id;
        if (!sploseId) { const e = new Error('This appointment has not been created in Splose yet'); e.code = 'NOT_IN_SPLOSE'; throw e; }
        if (row.action === 'update') {
          await sploseApi.updateAppointment(sploseId, {
            start: p.start || event.start_time, end: p.end || event.end_time,
            ...(p.note !== undefined ? { note: p.note } : {}),
            ...(p.serviceId ? { serviceId: p.serviceId } : {}),
          });
          return { sploseId: String(sploseId) };
        }
        if (row.action === 'cancel') {
          const reasonId = p.reasonId || await defaultReasonId();
          await sploseApi.cancelAppointment(sploseId, reasonId, p.cancelNote || 'Cancelled from the Opal portal');
          return { sploseId: String(sploseId) };
        }
        throw new Error('Unknown action ' + row.action);
      } catch (err) {
        const status = err.response && err.response.status;
        if (status === 429 && attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_429_MS * attempt);
          continue;
        }
        throw err;
      }
    }
    throw new Error('Gave up after retries');
  }

  /**
   * Publish this user's live queue (or a chosen subset). Runs to completion;
   * callers normally fire-and-forget and poll status(). Never throws for a
   * single row's failure — that row is marked failed and the run continues.
   */
  async function publish(userId, { queueIds = null, batchId = null, overrides = {} } = {}) {
    const key = String(userId);
    if (running.has(key)) return { alreadyRunning: true, ...running.get(key) };
    // Claim the slot before the first await so a status() call made straight
    // after the request returns sees the run as started.
    const state = { batchId: batchId || null, total: 0, done: 0, failed: 0, startedAt: new Date().toISOString(), current: null, results: [] };
    running.set(key, state);

    const params = [userId];
    let idFilter = '';
    if (Array.isArray(queueIds) && queueIds.length) { params.push(queueIds); idFilter = ' AND q.id = ANY($2::uuid[])'; }
    let rows;
    try {
      ({ rows } = await db.pool.query(
        `SELECT q.*, e.start_time, e.end_time, e.splose_id, e.title
           FROM splose_sync_queue q JOIN events e ON e.id = q.event_id
          WHERE q.user_id = $1 AND q.status IN ('pending', 'failed')${idFilter}`,
        params
      ));
    } catch (err) { running.delete(key); throw err; }
    const plan = planPublish(rows);
    state.total = plan.length;
    emit(userId, { phase: 'start', ...state });

    try {
      for (let i = 0; i < plan.length; i++) {
        const row = plan[i];
        // Row-level overrides from the review list (service, case, reason…)
        const o = overrides[row.id] || {};
        row.payload = { ...(row.payload || {}), ...o };
        state.current = { id: row.id, action: row.action, title: row.title };
        await db.pool.query(
          `UPDATE splose_sync_queue SET status = 'publishing', payload = $2::jsonb, batch_id = $3, attempts = attempts + 1, updated_at = NOW() WHERE id = $1`,
          [row.id, JSON.stringify(row.payload), state.batchId]
        );
        const event = { start_time: row.start_time, end_time: row.end_time, splose_id: row.splose_id };
        try {
          const { sploseId } = await publishRow(row, event);
          await db.pool.query(
            `UPDATE splose_sync_queue SET status = 'done', splose_appointment_id = $2, error = NULL, published_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [row.id, sploseId]
          );
          if (row.action === 'create') {
            await db.pool.query(
              `UPDATE events SET splose_id = $2, client_id = COALESCE(client_id, $3), last_synced_to_splose = NOW(), updated_at = NOW() WHERE id = $1`,
              [row.event_id, sploseId, row.payload.patientId ? String(row.payload.patientId) : null]
            );
          } else {
            await db.pool.query(`UPDATE events SET last_synced_to_splose = NOW(), updated_at = NOW() WHERE id = $1`, [row.event_id]);
          }
          await db.pool.query(
            `INSERT INTO sync_log (event_id, action, source, target, status) VALUES ($1, $2, 'app', 'splose', 'success')`,
            [row.event_id, row.action === 'create' ? 'created' : row.action === 'cancel' ? 'deleted' : 'updated']
          ).catch(() => {});
          state.results.push({ id: row.id, ok: true, action: row.action, sploseId });
        } catch (err) {
          const msg = summariseError(err);
          await db.pool.query(
            `UPDATE splose_sync_queue SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`,
            [row.id, msg]
          );
          await db.pool.query(
            `INSERT INTO sync_log (event_id, action, source, target, status, error_message) VALUES ($1, $2, 'app', 'splose', 'failed', $3)`,
            [row.event_id, row.action === 'create' ? 'created' : row.action === 'cancel' ? 'deleted' : 'updated', msg]
          ).catch(() => {});
          state.failed++;
          state.results.push({ id: row.id, ok: false, action: row.action, error: msg });
          log(`Splose publish: row ${row.id} (${row.action}) failed — ${msg}`);
        }
        state.done++;
        emit(userId, { phase: 'progress', ...state });
        if (i < plan.length - 1 && gapMs > 0) await sleep(gapMs);
      }
    } finally {
      state.current = null;
      state.finishedAt = new Date().toISOString();
      running.delete(key);
      lastRun.set(key, state);
      emit(userId, { phase: 'done', ...state });
    }
    return state;
  }

  const lastRun = new Map();
  function lastResult(userId) { return lastRun.get(String(userId)) || null; }

  return { publish, status, lastResult };
}

// ── Watcher (changes made inside Splose) ─────────────────────────────────────

function createWatcher(deps) {
  const {
    db, sploseApi, io = null,
    windowDays = 14,
    recentHours = 24,
    now = () => new Date(),
    log = () => {},
  } = deps;

  let running = false;
  const state = { lastRunAt: null, lastOk: null, lastError: null, lastAlerts: 0 };

  async function userForPractitioner(practitionerId) {
    if (!practitionerId) return null;
    const { rows } = await db.pool.query(
      'SELECT user_id FROM therapist_profiles WHERE splose_practitioner_id = $1 LIMIT 1', [String(practitionerId)]
    );
    return rows[0] ? rows[0].user_id : null;
  }

  async function run() {
    if (running) return { skipped: true };
    running = true;
    const t0 = now();
    try {
      const startDate = new Date(t0.getTime() - 1 * 86400000).toISOString().slice(0, 10);
      const endDate   = new Date(t0.getTime() + windowDays * 86400000).toISOString().slice(0, 10);
      const appts = await sploseApi.getAppointments(startDate, endDate);
      if (appts && appts._fetchComplete === false) {
        state.lastError = 'Splose page fetch incomplete — skipped';
        return { skipped: true, reason: 'incomplete' };
      }
      const { rows: local } = await db.pool.query(
        `SELECT id, user_id, splose_id, start_time, end_time, title FROM events
          WHERE splose_id IS NOT NULL AND (is_deleted IS NULL OR is_deleted = FALSE)
            AND start_time >= $1::timestamptz AND start_time <= $2::timestamptz`,
        [new Date(t0.getTime() - 1 * 86400000).toISOString(), new Date(t0.getTime() + windowDays * 86400000).toISOString()]
      );
      const { rows: pendingRows } = await db.pool.query(
        `SELECT event_id FROM splose_sync_queue WHERE status IN ('pending', 'publishing', 'failed')`
      );
      const pendingEventIds = new Set(pendingRows.map(r => r.event_id));
      const alerts = detectExternalChanges({ localEvents: local, sploseAppointments: appts, pendingEventIds, now: t0, recentHours });

      let inserted = 0;
      const notify = new Map();
      for (const a of alerts) {
        const userId = a.userId || await userForPractitioner(a.practitionerId);
        const r = await db.pool.query(
          `INSERT INTO splose_change_alerts (user_id, event_id, splose_appointment_id, kind, fingerprint, details)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (splose_appointment_id, kind, fingerprint) DO NOTHING
           RETURNING id`,
          [userId, a.eventId, a.sploseAppointmentId, a.kind, a.fingerprint.slice(0, 120), JSON.stringify(a.details || {})]
        );
        if (r.rows.length) {
          inserted++;
          if (userId) notify.set(userId, (notify.get(userId) || 0) + 1);
        }
      }
      for (const [userId, count] of notify) {
        try { if (io) io.to(`user:${userId}`).emit('sploseExternalChange', { count }); } catch (_) { /* best effort */ }
      }
      state.lastRunAt = t0.toISOString(); state.lastOk = t0.toISOString(); state.lastError = null; state.lastAlerts = inserted;
      if (inserted) log(`Splose watcher: ${inserted} new change alert(s)`);
      return { alerts: inserted };
    } catch (err) {
      state.lastRunAt = t0.toISOString(); state.lastError = summariseError(err);
      log('Splose watcher failed: ' + state.lastError);
      return { error: state.lastError };
    } finally {
      running = false;
    }
  }

  return { run, state };
}

module.exports = {
  coalesceChange,
  planPublish,
  summariseError,
  detectExternalChanges,
  enqueueChange,
  listPending,
  createPublisher,
  createWatcher,
  DEFAULT_GAP_MS,
};
