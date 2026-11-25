'use strict';

/**
 * PUSH JOBS — the two reminders the Opa app gets, run every two minutes.
 *
 *   leave        "Time to leave — 25 min drive to your 2:00 pm session."
 *                When now reaches start − travel − LEAVE_BUFFER_MIN for the
 *                caller's next in-person session with priced travel. Keyed
 *                to the session AND its start, so moving it re-arms it.
 *   notes_owing  "3 case notes to write from today." Once a day, from
 *                DIGEST_AT_MIN (Perth) until DIGEST_UNTIL_MIN, only when
 *                something from today is owed.
 *
 * Content rule: never a client's name, address or anything clinical — times,
 * minutes and counts only. Each send claims a mobile_push_sent row FIRST
 * (ON CONFLICT DO NOTHING), so two instances or a re-run never double-send.
 *
 * Off unless PUSH_NOTIFICATIONS_ENABLED=true AND APNs is configured.
 */

const { pool } = require('../database');
const apns = require('./apns');
const notesOwing = require('../mobile-notes-owing');
const log = require('../logger').createLogger('push');

const TICK_MS = 2 * 60 * 1000;
const LEAVE_BUFFER_MIN = 5;
const PERTH_OFFSET_MIN = 480;
const DIGEST_AT_MIN = 17 * 60 + 30;
const DIGEST_UNTIL_MIN = 21 * 60;

function enabled() {
  return String(process.env.PUSH_NOTIFICATIONS_ENABLED || '').toLowerCase() === 'true' && apns.configured();
}

const perth = (d) => new Date(d.getTime() + PERTH_OFFSET_MIN * 60000);
const perthDate = (d) => perth(d).toISOString().slice(0, 10);
const perthMinuteOfDay = (d) => { const p = perth(d); return p.getUTCHours() * 60 + p.getUTCMinutes(); };
function perthClock(d) {
  const p = perth(d);
  const h = p.getUTCHours(); const m = p.getUTCMinutes();
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
const perthMidnightUtc = (d) => new Date(Date.parse(`${perthDate(d)}T00:00:00Z`) - PERTH_OFFSET_MIN * 60000);

/** Claim a send. True only for the one caller that inserted the row. */
async function claim(userId, kind, ref) {
  const r = await pool.query(
    `INSERT INTO mobile_push_sent (user_id, kind, ref) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING 1`, [userId, kind, String(ref).slice(0, 120)]);
  return r.rowCount === 1;
}

async function devicesFor(userId) {
  const { rows } = await pool.query(
    `SELECT id, token, environment FROM mobile_push_devices
      WHERE user_id = $1 AND disabled_at IS NULL`, [userId]);
  return rows;
}

/** Send to every live device of a user; disable the ones Apple says are gone. */
async function sendToUser(userId, message) {
  const devices = await devicesFor(userId);
  let sent = 0;
  for (const d of devices) {
    // eslint-disable-next-line no-await-in-loop
    const r = await apns.send(d, message);
    if (r.ok) sent += 1;
    else if (r.gone) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `UPDATE mobile_push_devices SET disabled_at = NOW(), disabled_reason = $2 WHERE id = $1`,
        [d.id, String(r.reason || 'gone').slice(0, 40)]);
    } else {
      log.warn('push not delivered', { status: r.status, reason: r.reason });
    }
  }
  return sent;
}

/** Users with at least one live device, with what the owner clause needs. */
async function pushUsers() {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.therapist_profile_id
       FROM mobile_push_devices d JOIN users u ON u.id = d.user_id
      WHERE d.disabled_at IS NULL AND COALESCE(u.is_active, TRUE) = TRUE`);
  return rows;
}

/** The next in-person session for a user whose leave time has come. */
async function leaveDue(user, now) {
  const params = [now.toISOString(), new Date(now.getTime() + 4 * 3600000).toISOString(), user.id];
  let owner = 'e.user_id = $3';
  if (user.therapist_profile_id) { params.push(user.therapist_profile_id); owner = '(e.user_id = $3 OR e.therapist_profile_id = $4)'; }
  const { rows } = await pool.query(
    `SELECT e.id, e.start_time, e.travel_time_minutes FROM events e
      WHERE ${owner} AND e.event_type = 'therapy'
        AND (e.is_deleted IS NULL OR e.is_deleted = FALSE)
        AND (e.status IS NULL OR e.status <> 'cancelled')
        AND e.start_time > $1 AND e.start_time <= $2
        AND e.travel_time_minutes IS NOT NULL AND e.travel_time_minutes > 0
      ORDER BY e.start_time ASC LIMIT 1`, params);
  const ev = rows[0];
  if (!ev) return null;
  const start = new Date(ev.start_time);
  const minutes = Math.round(Number(ev.travel_time_minutes));
  const leaveAt = start.getTime() - (minutes + LEAVE_BUFFER_MIN) * 60000;
  // Due from one tick before leave time; never once the session has begun.
  if (now.getTime() < leaveAt - TICK_MS / 2) return null;
  return { id: ev.id, start, minutes };
}

async function runLeave(user, now) {
  const due = await leaveDue(user, now);
  if (!due) return 0;
  if (!(await claim(user.id, 'leave', `${due.id}@${due.start.toISOString()}`))) return 0;
  return sendToUser(user.id, {
    title: 'Time to leave',
    body: `${due.minutes} min drive to your ${perthClock(due.start)} session.`,
    data: { type: 'leave', appointmentId: due.id },
    collapseId: `leave-${due.id}`,
    threadId: 'leave',
  });
}

async function runDigest(user, now) {
  const minute = perthMinuteOfDay(now);
  if (minute < DIGEST_AT_MIN || minute >= DIGEST_UNTIL_MIN) return 0;
  const owed = await notesOwing.listOwed(user, { now, since: perthMidnightUtc(now) });
  if (!owed.length) return 0;
  if (!(await claim(user.id, 'notes_owing', perthDate(now)))) return 0;
  const n = owed.length;
  return sendToUser(user.id, {
    title: 'Case notes',
    body: `${n} case note${n === 1 ? '' : 's'} to write from today.`,
    data: { type: 'notes_owing' },
    collapseId: 'notes-owing',
    threadId: 'notes',
  });
}

/** One pass over every user with a device. Never throws. */
async function tick(now = new Date()) {
  if (!enabled()) return { skipped: true };
  let sent = 0;
  try {
    for (const user of await pushUsers()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        sent += await runLeave(user, now);
        // eslint-disable-next-line no-await-in-loop
        sent += await runDigest(user, now);
      } catch (err) {
        log.warn('push pass failed for a user', { error: err.message });
      }
    }
    // Keep the de-dupe table small: nothing older than a fortnight matters.
    await pool.query(`DELETE FROM mobile_push_sent WHERE sent_at < NOW() - INTERVAL '14 days'`);
  } catch (err) {
    if (!/relation .* does not exist/i.test(err.message)) log.warn('push tick failed', { error: err.message });
  }
  return { sent };
}

function start() {
  if (!enabled()) {
    log.info('push notifications off (PUSH_NOTIFICATIONS_ENABLED / APNS_* not set)');
    return null;
  }
  setTimeout(() => tick(), 30000).unref();
  const timer = setInterval(() => tick(), TICK_MS);
  timer.unref();
  log.info('push notifications on');
  return timer;
}

module.exports = { start, tick, enabled, sendToUser, perthClock, LEAVE_BUFFER_MIN };
