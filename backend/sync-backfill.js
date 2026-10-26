'use strict';

/**
 * SYNC NOW — plan, preview, apply (migration 081).
 *
 * The everyday sync only carries what changes. This module brings across
 * what is already there — the events on one side that the other side does
 * not have — from the person's "sync events from" date onwards, without
 * writing a single duplicate:
 *
 *   plan(direction, userId)   reads both sides, writes NOTHING, and returns
 *                             one item per event: link (the other side already
 *                             has it — adopt it, no copy), create (copy it),
 *                             update (a portal edit waiting to go to Outlook),
 *                             delete (a portal deletion still showing in
 *                             Outlook) or review (several candidates — the
 *                             person chooses).
 *   apply(direction, userId, decisions)
 *                             RE-PLANS from fresh reads, then carries out only
 *                             the decisions that still match an item in that
 *                             fresh plan. A link may only name a candidate the
 *                             plan offered. Nothing the browser sends is
 *                             trusted beyond "which of these items, which way".
 *
 * Matching: Outlook pairs by the same start AND end (under a minute apart);
 * Splose pairs by the same client on the same practice-local day, starting
 * within 30 minutes ('exact' when under a minute). Exactly one exact
 * candidate links by default; anything else is for the person to decide.
 *
 * Every write goes through the existing gated functions (createOutlookEvent,
 * the Splose queue, ...), so the environment flags still have the last word.
 * Splose itself is never written here: a Splose "create" is QUEUED, and the
 * existing publisher writes it when Sync Splose runs.
 */

const prefsMod = require('./sync-preferences');
const { isCancelledAppointment } = require('./splose-draft-sync');
const { classifyEventType } = require('./sync-utils');

const DAY_MS = 86400000;
const DEFAULT_BACK_DAYS = 90;      // no sync-from date: look this far back
const FORWARD_DAYS = 180;          // and this far ahead (the delta bootstrap's window)
const MAX_SPAN_DAYS = 3 * 365;     // a sync-from date further back is clamped
const OUTLOOK_TOLERANCE_MIN = 1;
const SPLOSE_WINDOW_MIN = 30;
const SPLOSE_TITLE = 'Client Appointment (booked in Splose)';

const OUTLOOK_TARGETS = { portal_to_outlook: 'app', splose_to_outlook: 'splose' };

function iso(v) { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }
function minutesApart(a, b) {
  const x = new Date(a).getTime(), y = new Date(b).getTime();
  if (isNaN(x) || isNaN(y)) return Infinity;
  return Math.abs(x - y) / 60000;
}
function perthIso(v) {
  const d = v instanceof Date ? v : new Date(v);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

/** The window a plan reads: [sync-from (or 90 days back), 180 days ahead]. */
function planWindow(syncFrom, nowDate) {
  const now = (nowDate || new Date()).getTime();
  let from = syncFrom ? new Date(syncFrom + 'T00:00:00+08:00').getTime() : now - DEFAULT_BACK_DAYS * DAY_MS;
  const to = now + FORWARD_DAYS * DAY_MS;
  if (to - from > MAX_SPAN_DAYS * DAY_MS) from = to - MAX_SPAN_DAYS * DAY_MS;
  if (from > to) from = to;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

// ── Pure matchers ────────────────────────────────────────────────────────────

function localView(r) {
  return { id: r.id, title: r.title || '', start: iso(r.start_time), end: iso(r.end_time), clientName: r.client_name || null };
}
function outlookView(o) {
  return { id: String(o.outlookId || o.id), title: o.title || '', start: o.startTime, end: o.endTime };
}

/**
 * Portal → Outlook (or Splose-sourced → Outlook).
 *   locals     the person's portal rows of this origin in the window
 *   remotes    Outlook events in the window (getOutlookCalendarEvents shape)
 *   heldIds    Set of outlook ids already held by ANY portal row of this person
 */
function planToOutlook({ locals, remotes, heldIds }) {
  const held = heldIds || new Set();
  const live = (remotes || []).filter(o => o && !o.isCancelled && o.type !== 'seriesMaster');
  const remoteIds = new Set(live.map(o => String(o.outlookId || o.id)));
  const free = live.filter(o => !held.has(String(o.outlookId || o.id)));
  const items = [];
  for (const r of locals || []) {
    if (r.is_deleted) {
      if (r.outlook_id && remoteIds.has(String(r.outlook_id))) {
        items.push({ key: 'local:' + r.id, action: 'delete', local: localView(r), remote: { id: String(r.outlook_id) } });
      }
      continue;
    }
    if (r.outlook_id) {
      if (r.sync_status === 'pending' && r.last_modified_by === 'app') {
        items.push({ key: 'local:' + r.id, action: 'update', local: localView(r), remote: { id: String(r.outlook_id) } });
      }
      continue;
    }
    const cands = free.filter(o => minutesApart(o.startTime, r.start_time) < OUTLOOK_TOLERANCE_MIN
      && minutesApart(o.endTime, r.end_time) < OUTLOOK_TOLERANCE_MIN).map(outlookView);
    if (cands.length === 1) items.push({ key: 'local:' + r.id, action: 'link', local: localView(r), remote: cands[0], candidates: cands });
    else if (cands.length > 1) items.push({ key: 'local:' + r.id, action: 'review', local: localView(r), remote: null, candidates: cands });
    else items.push({ key: 'local:' + r.id, action: 'create', local: localView(r), remote: null, candidates: [] });
  }
  return claimOnce(items);
}

/**
 * Outlook → portal.
 *   remotes    Outlook events in the window
 *   locals     the person's live portal rows in the window WITHOUT an outlook id
 *   heldIds    Set of outlook ids held by any portal row of this person (live or deleted)
 */
function planFromOutlook({ remotes, locals, heldIds }) {
  const held = heldIds || new Set();
  const items = [];
  for (const o of remotes || []) {
    if (!o || o.isCancelled || o.type === 'seriesMaster') continue;
    const id = String(o.outlookId || o.id);
    if (held.has(id)) continue;
    const cands = (locals || []).filter(r => !r.is_deleted && !r.outlook_id
      && minutesApart(o.startTime, r.start_time) < OUTLOOK_TOLERANCE_MIN
      && minutesApart(o.endTime, r.end_time) < OUTLOOK_TOLERANCE_MIN).map(localView);
    const remote = outlookView(o);
    if (cands.length === 1) items.push({ key: 'remote:' + id, action: 'link', local: cands[0], remote, candidates: cands });
    else if (cands.length > 1) items.push({ key: 'remote:' + id, action: 'review', local: null, remote, candidates: cands });
    else items.push({ key: 'remote:' + id, action: 'create', local: null, remote, candidates: [] });
  }
  return claimOnce(items);
}

function patientIdsOf(a) { return (a.patients || []).map(p => String(p.patientId)); }
function sploseView(a, names) {
  const pid = patientIdsOf(a)[0] || null;
  const n = names || {};
  return {
    id: String(a.id), start: a.start, end: a.end || null, patientId: pid,
    patientName: (n.patients && pid && n.patients.get(pid)) || null,
    serviceName: (n.services && a.serviceId != null && n.services.get(String(a.serviceId))) || null,
  };
}
function sameDayWithin(a, b, minutes) {
  return prefsMod.localDay(a) === prefsMod.localDay(b) && minutesApart(a, b) <= minutes;
}

/**
 * Portal → Splose.
 *   locals        client bookings (client_id set, no splose_id, not queued, not ignored)
 *   appointments  Splose appointments in the window (practitioner's)
 *   heldIds       Set of Splose ids held by any portal row
 */
function planToSplose({ locals, appointments, heldIds, names }) {
  const held = heldIds || new Set();
  const free = (appointments || []).filter(a => a && !held.has(String(a.id)) && !isCancelledAppointment(a));
  const items = [];
  for (const r of locals || []) {
    if (!r.client_id) continue;
    const cands = free
      .filter(a => patientIdsOf(a).includes(String(r.client_id)) && sameDayWithin(a.start, r.start_time, SPLOSE_WINDOW_MIN))
      .map(a => ({ ...sploseView(a, names), exact: minutesApart(a.start, r.start_time) < 1 }))
      .sort((x, y) => minutesApart(x.start, r.start_time) - minutesApart(y.start, r.start_time));
    const exact = cands.filter(c => c.exact);
    if (exact.length === 1 && cands.length === 1) items.push({ key: 'local:' + r.id, action: 'link', local: localView(r), remote: exact[0], candidates: cands });
    else if (cands.length) items.push({ key: 'local:' + r.id, action: 'review', local: localView(r), remote: null, candidates: cands });
    else items.push({ key: 'local:' + r.id, action: 'create', local: localView(r), remote: null, candidates: [] });
  }
  return claimOnce(items);
}

/**
 * Splose → portal.
 *   appointments  Splose appointments in the window (practitioner's)
 *   locals        the person's live client bookings without a splose_id
 *   heldIds       Set of Splose ids held by any portal row
 */
function planFromSplose({ appointments, locals, heldIds, names }) {
  const held = heldIds || new Set();
  const items = [];
  for (const a of appointments || []) {
    if (!a || held.has(String(a.id)) || isCancelledAppointment(a)) continue;
    const pids = patientIdsOf(a);
    const cands = (locals || [])
      .filter(r => !r.is_deleted && !r.splose_id && r.client_id && pids.includes(String(r.client_id))
        && sameDayWithin(a.start, r.start_time, SPLOSE_WINDOW_MIN))
      .map(r => ({ ...localView(r), exact: minutesApart(a.start, r.start_time) < 1 }))
      .sort((x, y) => minutesApart(x.start, a.start) - minutesApart(y.start, a.start));
    const exact = cands.filter(c => c.exact);
    const remote = sploseView(a, names);
    if (exact.length === 1 && cands.length === 1) items.push({ key: 'remote:' + a.id, action: 'link', local: exact[0], remote, candidates: cands });
    else if (cands.length) items.push({ key: 'remote:' + a.id, action: 'review', local: null, remote, candidates: cands });
    else items.push({ key: 'remote:' + a.id, action: 'create', local: null, remote, candidates: [] });
  }
  return claimOnce(items);
}

/**
 * Two items may not link to the same counterpart: when they would, both
 * become 'review' so the person decides which one it really is.
 */
function claimOnce(items) {
  const counts = new Map();
  const target = (it) => (it.action === 'link' ? (it.key.startsWith('local:') ? 'r:' + it.remote.id : 'l:' + it.local.id) : null);
  for (const it of items) { const t = target(it); if (t) counts.set(t, (counts.get(t) || 0) + 1); }
  return items.map(it => {
    const t = target(it);
    if (t && counts.get(t) > 1) return { ...it, action: 'review', remote: it.key.startsWith('local:') ? null : it.remote, local: it.key.startsWith('local:') ? it.local : null };
    return it;
  });
}

/** Defaults the preview pre-selects: links, creates and updates go; deletes and reviews wait for a tick. */
function defaultDecision(item) {
  if (item.action === 'link') return { key: item.key, action: 'link', counterpartId: item.key.startsWith('local:') ? item.remote.id : item.local.id };
  if (item.action === 'create' || item.action === 'update') return { key: item.key, action: item.action };
  return null;
}

/**
 * Pure: which decisions the fresh plan permits.
 * Returns { accepted: [{ item, action, counterpartId? }], rejected: [{ key, code }] }.
 */
function vetDecisions(items, decisions) {
  const byKey = new Map(items.map(i => [i.key, i]));
  const seen = new Set();
  const accepted = [], rejected = [];
  for (const d of Array.isArray(decisions) ? decisions : []) {
    const key = d && typeof d.key === 'string' ? d.key : null;
    if (!key || seen.has(key)) { rejected.push({ key, code: 'duplicate_or_missing_key' }); continue; }
    seen.add(key);
    const item = byKey.get(key);
    if (!item) { rejected.push({ key, code: 'no_longer_offered' }); continue; }
    const action = d.action;
    if (action === 'link') {
      if (!['link', 'review'].includes(item.action)) { rejected.push({ key, code: 'not_linkable' }); continue; }
      const cid = String(d.counterpartId || '');
      if (!(item.candidates || []).some(c => String(c.id) === cid)) { rejected.push({ key, code: 'not_a_candidate' }); continue; }
      accepted.push({ item, action, counterpartId: cid });
    } else if (action === 'create') {
      if (!['create', 'review'].includes(item.action)) { rejected.push({ key, code: 'not_creatable' }); continue; }
      accepted.push({ item, action });
    } else if (action === 'update' || action === 'delete') {
      if (item.action !== action) { rejected.push({ key, code: 'action_mismatch' }); continue; }
      accepted.push({ item, action });
    } else {
      rejected.push({ key, code: 'unknown_action' });
    }
  }
  // A counterpart may be claimed by one decision only.
  const claimed = new Map();
  for (const a of accepted) if (a.counterpartId) claimed.set(a.counterpartId, (claimed.get(a.counterpartId) || 0) + 1);
  const final = [];
  for (const a of accepted) {
    if (a.counterpartId && claimed.get(a.counterpartId) > 1) rejected.push({ key: a.item.key, code: 'counterpart_claimed_twice' });
    else final.push(a);
  }
  return { accepted: final, rejected };
}

// ── Reader / writer ──────────────────────────────────────────────────────────

/**
 * deps: { db, outlookApi, sploseApi, draftSync, getToken(userId) → token|null,
 *         practitionerFor(userId) → id|null, now() → Date, log }
 */
function createBackfill(deps) {
  const { db, outlookApi, sploseApi, draftSync, getToken, practitionerFor, now = () => new Date(), log = () => {} } = deps;

  async function outlookHeld(userId) {
    const { rows } = await db.pool.query(
      `SELECT outlook_id FROM events WHERE user_id = $1 AND outlook_id IS NOT NULL`, [userId]);
    return new Set(rows.map(r => String(r.outlook_id)));
  }
  async function sploseHeld(ids) {
    const held = new Set();
    if (!ids.length) return held;
    const { rows } = await db.pool.query(`SELECT DISTINCT splose_id FROM events WHERE splose_id = ANY($1::text[])`, [ids]);
    for (const r of rows) held.add(String(r.splose_id));
    return held;
  }
  async function readOutlook(userId, win) {
    const token = await getToken(userId);
    if (!token) { const e = new Error('Outlook is not connected for this calendar'); e.code = 'outlook_not_connected'; throw e; }
    const list = await outlookApi.getOutlookCalendarEvents(token, win.from, win.to);
    return { token, remotes: list || [], complete: !list || list._fetchComplete !== false };
  }
  async function readSplose(userId, win, fresh) {
    if (!sploseApi.isConfigured || !sploseApi.isConfigured()) { const e = new Error('Splose is not connected'); e.code = 'splose_not_connected'; throw e; }
    const practitioner = await practitionerFor(userId);
    if (!practitioner) { const e = new Error('This calendar is not linked to a Splose practitioner'); e.code = 'no_practitioner'; throw e; }
    const fromDay = prefsMod.localDay(new Date(new Date(win.from).getTime() - DAY_MS));
    const toDay = prefsMod.localDay(new Date(new Date(win.to).getTime() + DAY_MS));
    const all = await sploseApi.getAppointments(fromDay, toDay, null, fresh ? { fresh: true } : {});
    const fromMs = new Date(win.from).getTime(), toMs = new Date(win.to).getTime();
    const mine = (all || []).filter(a => String(a.practitionerId) === String(practitioner)
      && new Date(a.start).getTime() >= fromMs && new Date(a.start).getTime() < toMs);
    return { appointments: mine, practitioner, complete: !all || all._fetchComplete !== false };
  }
  async function names() {
    const out = { patients: new Map(), services: new Map() };
    const load = async (fn, map, label) => {
      if (typeof sploseApi[fn] !== 'function') return;
      try { for (const x of (await sploseApi[fn]()) || []) map.set(String(x.id), label(x)); } catch (_) { /* names are a nicety */ }
    };
    await load('getPatients', out.patients, p => p.fullName || [p.firstname, p.lastname].filter(Boolean).join(' ') || null);
    await load('getServices', out.services, s => s.title || s.name || null);
    return out;
  }

  /**
   * Read both sides and plan. Never writes.
   * opts.fresh  bypass the Splose list cache (apply always does)
   */
  async function plan(direction, userId, opts = {}) {
    if (!prefsMod.DIRECTIONS.includes(direction)) { const e = new Error('Unknown direction'); e.code = 'bad_direction'; throw e; }
    const prefs = await prefsMod.effectiveFor(db, userId);
    const p = prefs[direction];
    if (!p.runs) {
      const e = new Error(p.blockedBy ? `Switched off in this environment (${p.blockedBy})` : 'This sync is switched off in your Sync settings');
      e.code = 'sync_off'; e.blockedBy = p.blockedBy || null; throw e;
    }
    const win = planWindow(p.syncFrom, now());
    const base = { direction, userId: String(userId), window: win, syncFrom: p.syncFrom };

    if (OUTLOOK_TARGETS[direction]) {
      const origin = OUTLOOK_TARGETS[direction];
      const [{ remotes, complete, token }, held, locals] = await Promise.all([
        readOutlook(userId, win),
        outlookHeld(userId),
        db.pool.query(
          `SELECT id, title, start_time, end_time, location, client_name, outlook_id, sync_status, last_modified_by, is_deleted
             FROM events
            WHERE user_id = $1 AND source = $2 AND COALESCE(event_type, '') <> 'travel'
              AND start_time >= ($3::timestamptz AT TIME ZONE 'UTC') AND start_time < ($4::timestamptz AT TIME ZONE 'UTC')
              AND (is_deleted IS NOT TRUE OR outlook_id IS NOT NULL)`,
          [userId, origin, win.from, win.to]).then(r => r.rows),
      ]);
      return { ...base, complete, items: planToOutlook({ locals, remotes, heldIds: held }), _ctx: { token, locals } };
    }
    if (direction === 'outlook_to_portal') {
      const [{ remotes, complete, token }, held, locals] = await Promise.all([
        readOutlook(userId, win),
        outlookHeld(userId),
        db.pool.query(
          `SELECT id, title, start_time, end_time, client_name, outlook_id, is_deleted
             FROM events
            WHERE user_id = $1 AND outlook_id IS NULL AND (is_deleted IS NOT TRUE)
              AND start_time >= ($2::timestamptz AT TIME ZONE 'UTC') - interval '1 day' AND start_time < ($3::timestamptz AT TIME ZONE 'UTC') + interval '1 day'`,
          [userId, win.from, win.to]).then(r => r.rows),
      ]);
      return { ...base, complete, items: planFromOutlook({ remotes, locals, heldIds: held }), _ctx: { token, remotes } };
    }
    if (direction === 'portal_to_splose') {
      const [{ appointments, complete, practitioner }, locals, nm] = await Promise.all([
        readSplose(userId, win, opts.fresh),
        db.pool.query(
          `SELECT e.id, e.title, e.start_time, e.end_time, e.client_id, e.client_name, e.splose_id, e.is_deleted
             FROM events e
            WHERE e.user_id = $1 AND e.client_id IS NOT NULL AND e.splose_id IS NULL
              AND e.created_by_source = 'app' AND (e.is_deleted IS NOT TRUE) AND e.splose_sync_ignored_at IS NULL
              AND e.start_time >= ($2::timestamptz AT TIME ZONE 'UTC') AND e.start_time < ($3::timestamptz AT TIME ZONE 'UTC')
              AND NOT EXISTS (SELECT 1 FROM splose_sync_queue q WHERE q.event_id = e.id AND q.status IN ('pending', 'publishing', 'failed'))`,
          [userId, win.from, win.to]).then(r => r.rows),
        opts.withNames === false ? null : names(),
      ]);
      const held = await sploseHeld(appointments.map(a => String(a.id)));
      const queued = await db.pool.query(
        `SELECT COUNT(*)::int AS n FROM splose_sync_queue WHERE user_id = $1 AND status IN ('pending', 'failed')`, [userId]);
      return { ...base, complete, practitioner, queuedChanges: queued.rows[0] ? queued.rows[0].n : 0,
        items: planToSplose({ locals, appointments, heldIds: held, names: nm }), _ctx: { locals } };
    }
    // splose_to_portal
    const [{ appointments, complete, practitioner }, locals, nm] = await Promise.all([
      readSplose(userId, win, opts.fresh),
      db.pool.query(
        `SELECT id, title, start_time, end_time, client_id, client_name, splose_id, is_deleted
           FROM events
          WHERE user_id = $1 AND client_id IS NOT NULL AND splose_id IS NULL AND (is_deleted IS NOT TRUE)
            AND start_time >= ($2::timestamptz AT TIME ZONE 'UTC') - interval '1 day' AND start_time < ($3::timestamptz AT TIME ZONE 'UTC') + interval '1 day'`,
        [userId, win.from, win.to]).then(r => r.rows),
      opts.withNames === false ? null : names(),
    ]);
    const held = await sploseHeld(appointments.map(a => String(a.id)));
    return { ...base, complete, practitioner, items: planFromSplose({ appointments, locals, heldIds: held, names: nm }), _ctx: { appointments } };
  }

  /** Public view of a plan: no context, plus the default ticks. */
  function present(p) {
    const { _ctx, ...rest } = p;
    const counts = {};
    for (const it of p.items) counts[it.action] = (counts[it.action] || 0) + 1;
    return { ...rest, counts, defaults: p.items.map(defaultDecision).filter(Boolean) };
  }

  // ── Writers (one per direction/action) ──
  async function linkOutlook(eventId, outlookId) {
    await db.updateEventOutlookId(eventId, outlookId);
  }
  async function createInOutlook(token, local, eventId) {
    const r = await db.pool.query(`SELECT title, start_time, end_time, location FROM events WHERE id = $1`, [eventId]);
    const ev = r.rows[0];
    if (!ev) throw Object.assign(new Error('Event gone'), { code: 'event_gone' });
    const created = await outlookApi.createOutlookEvent(token, {
      title: ev.title, startTime: perthIso(ev.start_time), endTime: perthIso(ev.end_time),
      location: ev.location || '', categories: [], appEventId: eventId,
    });
    await db.updateEventOutlookId(eventId, created.outlookId);
  }

  async function applyOne(direction, userId, actorUserId, plan, d) {
    const { item, action } = d;
    if (OUTLOOK_TARGETS[direction]) {
      const id = item.local.id;
      if (action === 'link') return linkOutlook(id, d.counterpartId);
      if (action === 'create') return createInOutlook(plan._ctx.token, item.local, id);
      if (action === 'update') {
        const r = await db.pool.query(`SELECT title, start_time, end_time, location FROM events WHERE id = $1`, [id]);
        const ev = r.rows[0];
        await outlookApi.updateOutlookEvent(plan._ctx.token, item.remote.id, {
          title: ev.title, startTime: perthIso(ev.start_time), endTime: perthIso(ev.end_time), location: ev.location || '',
        });
        await db.pool.query(`UPDATE events SET sync_status = 'synced', updated_at = NOW() WHERE id = $1 AND user_id = $2`, [id, userId]);
        return null;
      }
      if (action === 'delete') return outlookApi.deleteOutlookEvent(plan._ctx.token, item.remote.id);
    }
    if (direction === 'outlook_to_portal') {
      if (action === 'link') return linkOutlook(d.counterpartId, item.remote.id);
      const o = plan._ctx.remotes.find(x => String(x.outlookId || x.id) === item.remote.id);
      await db.upsertOutlookEvent(userId, { ...o, eventType: classifyEventType(o.categories || [], o.isTeamsMeeting || false) });
      return null;
    }
    if (direction === 'portal_to_splose') {
      const id = item.local.id;
      if (action === 'link') {
        const r = await db.pool.query(
          `UPDATE events SET splose_id = $2, last_synced_to_splose = NOW(), updated_at = NOW()
            WHERE id = $1 AND user_id = $3 AND splose_id IS NULL RETURNING id`, [id, d.counterpartId, userId]);
        if (!r.rows.length) throw Object.assign(new Error('Changed meanwhile'), { code: 'event_changed' });
        return null;
      }
      const local = plan._ctx.locals.find(x => x.id === id);
      const q = await draftSync.enqueueChange(db, {
        userId, createdBy: actorUserId, eventId: id, action: 'create',
        payload: { start: iso(local.start_time), end: iso(local.end_time), patientId: Number(local.client_id) || local.client_id, serviceId: null, summary: local.title },
      });
      if (!q) throw Object.assign(new Error('Not queued'), { code: 'not_queued' });
      return null;
    }
    // splose_to_portal
    if (action === 'link') {
      const r = await db.pool.query(
        `UPDATE events SET splose_id = $2, last_synced_to_splose = NOW(), updated_at = NOW()
          WHERE id = $1 AND user_id = $3 AND splose_id IS NULL RETURNING id`, [d.counterpartId, item.remote.id, userId]);
      if (!r.rows.length) throw Object.assign(new Error('Changed meanwhile'), { code: 'event_changed' });
      return null;
    }
    const a = plan._ctx.appointments.find(x => String(x.id) === item.remote.id);
    return importSplose(userId, a, item.remote.patientName || null);
  }

  /**
   * One Splose appointment becomes a portal event; then, when Splose → Outlook
   * runs automatically and the appointment is on or after its sync-from date,
   * the Outlook copy is made too (otherwise "Sync now" for Splose → Outlook
   * offers it later).
   */
  async function importSplose(userId, a, patientName) {
    const pid = patientIdsOf(a)[0] || null;
    const ins = await db.pool.query(
      `INSERT INTO events (user_id, title, start_time, end_time, event_type, splose_id, client_id, client_name, source, created_by_source, sync_status, last_modified_by, last_synced_to_splose)
       VALUES ($1, $2, $3, $4, 'therapy', $5, $6, $7, 'splose', 'splose', 'synced', 'splose', NOW()) RETURNING id`,
      // UTC instants: a TIMESTAMP column drops any '+08:00' and would store Perth wall-clock.
      [userId, SPLOSE_TITLE, iso(a.start), iso(a.end), String(a.id), pid, patientName]);
    const eventId = ins.rows[0].id;
    let outlook = false;
    const prefs = await prefsMod.effectiveOrNull(db, userId, log);
    if (prefsMod.allows(prefs, 'splose_to_outlook', { start: a.start })) {
      try {
        const token = await getToken(userId);
        if (token) { await createInOutlook(token, null, eventId); outlook = true; }
      } catch (err) { log(`Splose import ${eventId}: Outlook copy skipped (${err.code || 'failed'})`); }
    }
    return { eventId, outlook };
  }

  /**
   * The watcher's automatic Splose → portal import for one new appointment:
   * links it when exactly one portal booking is the same client at the same
   * time, imports it when nothing in the portal resembles it, and leaves it to
   * the person (returns 'ask') when there is anything to choose between.
   */
  async function autoImport(userId, sploseAppointmentId) {
    const appt = await sploseApi.getAppointment(sploseAppointmentId);
    if (!appt || isCancelledAppointment(appt)) return { outcome: 'skipped' };
    const held = await sploseHeld([String(appt.id)]);
    if (held.size) return { outcome: 'skipped' };
    const { rows: locals } = await db.pool.query(
      `SELECT id, title, start_time, end_time, client_id, client_name, splose_id, is_deleted
         FROM events
        WHERE user_id = $1 AND client_id IS NOT NULL AND splose_id IS NULL AND (is_deleted IS NOT TRUE)
          AND start_time >= ($2::timestamptz AT TIME ZONE 'UTC') - interval '1 day'
          AND start_time <  ($2::timestamptz AT TIME ZONE 'UTC') + interval '1 day'`,
      [userId, iso(appt.start)]);
    const [item] = planFromSplose({ appointments: [appt], locals, heldIds: new Set() });
    if (!item || item.action === 'review') return { outcome: 'ask' };
    if (item.action === 'link') {
      const r = await db.pool.query(
        `UPDATE events SET splose_id = $2, last_synced_to_splose = NOW(), updated_at = NOW()
          WHERE id = $1 AND user_id = $3 AND splose_id IS NULL RETURNING id`, [item.local.id, String(appt.id), userId]);
      return r.rows.length ? { outcome: 'linked', eventId: item.local.id } : { outcome: 'ask' };
    }
    const out = await importSplose(userId, appt, null);
    return { outcome: 'imported', ...out };
  }

  /**
   * Re-plan from fresh reads, vet the decisions against it, carry out the
   * accepted ones one at a time. Returns per-key results.
   */
  async function apply(direction, userId, actorUserId, decisions) {
    const p = await plan(direction, userId, { fresh: true, withNames: true });
    if (p.complete === false) { const e = new Error('The other side could not be read in full — nothing was changed'); e.code = 'incomplete_read'; throw e; }
    const { accepted, rejected } = vetDecisions(p.items, decisions);
    const done = [], failed = [...rejected.map(r => ({ key: r.key, code: r.code }))];
    for (const d of accepted) {
      try {
        const out = await applyOne(direction, userId, actorUserId, p, d);
        done.push({ key: d.item.key, action: d.action, ...(out || {}) });
      } catch (err) {
        // A unique-index refusal means the counterpart is already held elsewhere.
        const code = err.code === '23505' ? 'already_linked_elsewhere'
          : err.code === 'FEATURE_DISABLED' ? 'switched_off_in_environment'
          : (typeof err.code === 'string' && /^[a-z_]+$/.test(err.code) ? err.code : 'failed');
        log(`sync-now ${direction}: ${d.item.key} ${d.action} failed (${code})`);
        failed.push({ key: d.item.key, action: d.action, code });
      }
    }
    return { direction, done, failed, considered: (decisions || []).length };
  }

  return { plan, present, apply, autoImport };
}

module.exports = {
  planWindow,
  planToOutlook,
  planFromOutlook,
  planToSplose,
  planFromSplose,
  defaultDecision,
  vetDecisions,
  createBackfill,
  perthIso,
};
