'use strict';

/**
 * TRAVEL → OUTLOOK MIRROR (5 Oct 2026).
 *
 * The portal works out a day's travel legs from the physical appointments
 * (frontend travel.js computeDayTravelSegments) and sends the whole set for
 * that day here. This module makes Outlook match it: one Outlook event per
 * leg (category 'Travel'), created, moved or deleted as the legs change.
 * Nothing goes to Splose.
 *
 * Identity: a leg is "<owner event id>|before" (the drive into an
 * appointment) or "<owner event id>|after" (the drive away from one). The
 * mirror row stores it as custom_metadata.travelLegKey, with related_event_id
 * = the owner so deleting the appointment cascades (travel-cascade.js).
 * Migration 073's unique index means a live key exists once per user — the
 * row is claimed BEFORE the Outlook event is written, so a race or a retry
 * can never produce a second Outlook event.
 *
 * Fail-closed:
 *   • a day is synced only when the portal saw every one of the user's own
 *     timed events for it, and nobody else's (seenEventIds) — a stale view,
 *     or someone else's calendar, is refused rather than deleting legs it did
 *     not know about;
 *   • every leg owner must be the user's own live event;
 *   • past days are left alone; staging/production need the flag set.
 *
 * Titles and rows carry suburbs and minutes only — no client names.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_RE = new RegExp('^(' + UUID + ')\\|(before|after)$', 'i');
const UUID_RE = new RegExp('^' + UUID + '$', 'i');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LEGS = 40;
const TZ = 'Australia/Perth';

function isEnabled() {
  const raw = process.env.ENABLE_TRAVEL_OUTLOOK_SYNC;
  if (raw !== undefined && raw !== '') return raw === 'true';
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' || env === 'test';
}

/** Perth calendar date of an instant, YYYY-MM-DD. */
function perthDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function cleanText(v, max) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
}

/**
 * PURE — validate the request body. Returns { ok, date, legs, seen } or { ok:false, error }.
 * legs: [{ key, ownerEventId, start, end, title, location }] (start/end as Date).
 */
function validateRequest(body, now = new Date()) {
  const b = body || {};
  if (typeof b.date !== 'string' || !DATE_RE.test(b.date)) return { ok: false, error: 'date must be YYYY-MM-DD' };
  if (!Array.isArray(b.legs) || b.legs.length > MAX_LEGS) return { ok: false, error: 'legs must be a list of at most ' + MAX_LEGS };
  if (!Array.isArray(b.seenEventIds) || b.seenEventIds.length > 200 || !b.seenEventIds.every(x => typeof x === 'string' && UUID_RE.test(x))) {
    return { ok: false, error: 'seenEventIds must list the day\'s event ids' };
  }
  const legs = [], keys = new Set();
  for (const l of b.legs) {
    const m = l && typeof l.key === 'string' ? l.key.match(KEY_RE) : null;
    if (!m) return { ok: false, error: 'each leg needs a key "<event id>|before|after"' };
    if (keys.has(l.key)) return { ok: false, error: 'duplicate leg key' };
    keys.add(l.key);
    const start = new Date(l.start), end = new Date(l.end);
    if (isNaN(start) || isNaN(end) || end <= start || end - start > 12 * 3600e3) return { ok: false, error: 'each leg needs a start before its end' };
    if (perthDate(start) !== b.date) return { ok: false, error: 'a leg starts outside the day' };
    const title = cleanText(l.title, 120);
    if (!title) return { ok: false, error: 'each leg needs a title' };
    legs.push({ key: l.key, ownerEventId: m[1].toLowerCase(), start, end, title, location: cleanText(l.location, 200) });
  }
  return { ok: true, date: b.date, legs, seen: new Set(b.seenEventIds.map(x => x.toLowerCase())), past: b.date < perthDate(now) };
}

/**
 * PURE — what to do: { create:[leg], update:[{row, leg}], remove:[row] }.
 * existing: mirror rows for these keys (any date) or on this date
 * [{ id, key, outlookId, start, end, title, location, date }].
 */
function planSync(existing, legs, date) {
  const byKey = new Map(existing.map(r => [r.key, r]));
  const wanted = new Set(legs.map(l => l.key));
  const create = [], update = [];
  for (const leg of legs) {
    const row = byKey.get(leg.key);
    if (!row) { create.push(leg); continue; }
    const same = row.outlookId && +row.start === +leg.start && +row.end === +leg.end && row.title === leg.title && (row.location || '') === leg.location;
    if (!same) update.push({ row, leg });
  }
  const remove = existing.filter(r => r.date === date && !wanted.has(r.key));
  return { create, update, remove };
}

const perUser = new Map(); // userId → promise chain: one sync at a time per user
function serialise(userId, fn) {
  const prev = perUser.get(userId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  // The stored copy is only a queue position: a failure is the caller's to
  // handle (via `next`), so the copy swallows it — otherwise every refused run
  // (e.g. "Outlook not connected") was logged as an unhandled rejection.
  perUser.set(userId, next.catch(() => {}).finally(() => { if (perUser.get(userId) === next) perUser.delete(userId); }));
  return next;
}

/** Outlook wants a Perth wall-clock time with the Perth time zone. */
function perthIso(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

/**
 * Link a mirror row to the Outlook event just created for it (10 Oct 2026).
 * The delta sync can import that same event in the gap before the link — an
 * 'outlook' row with no travelLegKey, drawn as a second travel tile, whose
 * outlook_id blocks this link (events_user_outlook_unique). Release that twin
 * (soft-delete + drop its outlook_id) and link, in one transaction: the same
 * release as database.js updateEventOutlookId.
 */
async function linkCreated(pool, userId, rowId, outlookId, sql, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE events SET outlook_id = NULL, is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW()
        WHERE user_id = $1 AND outlook_id = $2 AND id <> $3 AND created_by_source = 'outlook'`,
      [userId, outlookId, rowId]);
    await client.query(sql, params);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Make Outlook match the day's legs. deps: { pool, outlook: { createOutlookEvent,
 * updateOutlookEvent, deleteOutlookEvent }, getAccessToken: () => Promise<token> }.
 * Returns { status, body }.
 */
async function syncDay(deps, userId, body, now = new Date()) {
  if (!isEnabled()) return { status: 200, body: { ok: true, skipped: 'disabled' } };
  const v = validateRequest(body, now);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  if (v.past) return { status: 200, body: { ok: true, skipped: 'past' } };
  return serialise(userId, () => syncValidated(deps, userId, v));
}

async function syncValidated({ pool, outlook, getAccessToken }, userId, v) {
  const { date, legs, seen } = v;
  // The user's own live events on this date (not travel mirrors). `drawn` =
  // the ones the calendar draws as timed tiles (not cancelled, not all-day):
  // the portal must have seen every one of them, or its leg set is not this
  // user's day, and only those can own a leg. The view may also hold the
  // user's own all-day chips or cancelled rows (10 Oct 2026 — any day with an
  // all-day event was refused as not_own_day, so its legs never reached
  // Outlook); anyone else's event is still refused.
  const own = await pool.query(
    `SELECT id, (LOWER(COALESCE(status, '')) <> 'cancelled'
                 AND end_time - start_time < interval '23 hours') AS drawn
       FROM events
      WHERE user_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
        AND NOT (COALESCE(custom_metadata, '{}'::jsonb) ? 'travelLegKey')   -- NULL metadata is an ordinary event
        AND ((start_time AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')::date = $2::date`,
    [userId, date]);
  const knownIds = new Set(own.rows.map(r => String(r.id).toLowerCase()));
  const ownIds = new Set(own.rows.filter(r => r.drawn === true).map(r => String(r.id).toLowerCase()));
  for (const id of ownIds) if (!seen.has(id)) return { status: 409, body: { error: 'The calendar view is out of date for this day — reload and try again', code: 'stale_view' } };
  for (const id of seen) if (!knownIds.has(id)) return { status: 409, body: { error: 'Travel can only be synced from your own calendar', code: 'not_own_day' } };
  for (const leg of legs) if (!ownIds.has(leg.ownerEventId)) return { status: 409, body: { error: 'A travel leg belongs to an appointment that is not yours', code: 'not_own_leg' } };

  const keys = legs.map(l => l.key);
  const ex = await pool.query(
    `SELECT id, outlook_id, start_time, end_time, title, location, custom_metadata->>'travelLegKey' AS key,
            to_char(((start_time AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS local_date
       FROM events
      WHERE user_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE AND custom_metadata ? 'travelLegKey'
        AND (custom_metadata->>'travelLegKey' = ANY($2::text[])
             OR ((start_time AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')::date = $3::date)`,
    [userId, keys, date]);
  const existing = ex.rows.map(r => ({ id: r.id, key: r.key, outlookId: r.outlook_id, start: asUtc(r.start_time), end: asUtc(r.end_time),
    title: r.title, location: r.location || '', date: r.local_date }));
  const plan = planSync(existing, legs, date);
  if (!plan.create.length && !plan.update.length && !plan.remove.length) return { status: 200, body: { ok: true, created: 0, updated: 0, removed: 0 } };

  const token = await getAccessToken();
  const out = { ok: true, created: 0, updated: 0, removed: 0, failed: 0 };

  for (const leg of plan.create) {
    // Claim the key first: the unique index turns a racing duplicate into a
    // conflict here, before anything reaches Outlook.
    let rowId;
    try {
      const ins = await pool.query(
        `INSERT INTO events (user_id, title, start_time, end_time, location, event_type, categories, source, created_by_source,
                             sync_status, last_modified_by, related_event_id, custom_metadata)
         VALUES ($1, $2, $3, $4, $5, 'travel', ARRAY['Travel'], 'app', 'app', 'pending', 'app', $6,
                 jsonb_build_object('travelLegKey', $7::text, 'travelMirror', true))
         RETURNING id`,
        [userId, leg.title, leg.start.toISOString(), leg.end.toISOString(), leg.location || null, leg.ownerEventId, leg.key]);
      rowId = ins.rows[0].id;
    } catch (e) {
      if (e.code === '23505') continue; // another sync holds this key — it will write Outlook
      throw e;
    }
    let r;
    try {
      r = await outlook.createOutlookEvent(token, { title: leg.title, startTime: perthIso(leg.start), endTime: perthIso(leg.end),
        location: leg.location, categories: ['Travel'], appEventId: rowId, sploseId: null });
    } catch (e) {
      // Nothing reached Outlook: give the key back so the next sync retries.
      await pool.query(`DELETE FROM events WHERE id = $1 AND outlook_id IS NULL`, [rowId]).catch(() => {});
      if (e.code === 'FEATURE_DISABLED') throw e;
      out.failed++;
      continue;
    }
    try {
      await linkCreated(pool, userId, rowId, r.outlookId,
        `UPDATE events SET outlook_id = $2, sync_status = 'synced', last_synced_to_outlook = NOW() WHERE id = $1`, [rowId, r.outlookId]);
      out.created++;
    } catch (e) {
      // The Outlook event exists but is not linked: take it back out of
      // Outlook as well, or the retry would leave it orphaned beside a new one.
      await outlook.deleteOutlookEvent(token, r.outlookId).catch(() => {});
      await pool.query(`DELETE FROM events WHERE id = $1 AND outlook_id IS NULL`, [rowId]).catch(() => {});
      out.failed++;
    }
  }
  for (const { row, leg } of plan.update) {
    let created = null;
    try {
      if (row.outlookId) {
        await outlook.updateOutlookEvent(token, row.outlookId, { title: leg.title, startTime: perthIso(leg.start), endTime: perthIso(leg.end),
          location: leg.location, categories: ['Travel'] });
      } else {
        const r = await outlook.createOutlookEvent(token, { title: leg.title, startTime: perthIso(leg.start), endTime: perthIso(leg.end),
          location: leg.location, categories: ['Travel'], appEventId: row.id, sploseId: null });
        created = row.outlookId = r.outlookId;
      }
      const sql = `UPDATE events SET title = $2, start_time = $3, end_time = $4, location = $5, related_event_id = $6, outlook_id = $7,
                sync_status = 'synced', last_modified_by = 'app', last_synced_to_outlook = NOW(), updated_at = NOW()
          WHERE id = $1`;
      const params = [row.id, leg.title, leg.start.toISOString(), leg.end.toISOString(), leg.location || null, leg.ownerEventId, row.outlookId];
      if (created) await linkCreated(pool, userId, row.id, created, sql, params);
      else await pool.query(sql, params);
      out.updated++;
    } catch (e) {
      if (e.code === 'FEATURE_DISABLED') throw e;
      if (created) await outlook.deleteOutlookEvent(token, created).catch(() => {});
      out.failed++;
    }
  }
  for (const row of plan.remove) {
    try {
      if (row.outlookId) {
        try { await outlook.deleteOutlookEvent(token, row.outlookId); }
        catch (e) { if (e.code === 'FEATURE_DISABLED') throw e; /* already gone in Outlook — still retire the row */ }
      }
      await pool.query(`UPDATE events SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id]);
      out.removed++;
    } catch (e) {
      if (e.code === 'FEATURE_DISABLED') throw e;
      out.failed++;
    }
  }
  return { status: 200, body: out };
}

/** TIMESTAMP (no zone) columns hold UTC instants; database.js parses them as
    UTC Dates (type 1114). A raw string is read the same way. */
function asUtc(v) {
  if (v instanceof Date) return v;
  return new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'));
}

module.exports = { isEnabled, validateRequest, planSync, syncDay, perthIso, perthDate, asUtc, KEY_RE };
