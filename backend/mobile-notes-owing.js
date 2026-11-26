'use strict';

/**
 * NOTES OWING — the caller's finished sessions that have no case note yet.
 *
 * One rule, shared by GET /api/mobile/notes-owing, the Today count and the
 * evening push:
 *   - a therapy session on the caller's own diary (their user, or their
 *     therapist profile — the same two owners loadOwnAppointments uses);
 *   - ended, and ended within the last WINDOW_DAYS days;
 *   - not cancelled, not deleted;
 *   - no live case-note draft by the caller links to it (an archived draft
 *     was discarded, so the session is owed again);
 *   - not dismissed by the caller as "noted elsewhere" (written straight
 *     into Splose, which this portal cannot see).
 *
 * Event times are TIMESTAMP (UTC wall time) — every bound is an ISO string
 * from JS, never NOW(), so the session time zone cannot shift the window.
 */

const { pool } = require('./database');

const WINDOW_DAYS = 7;

function ownerClause(user, firstParam) {
  if (user.therapist_profile_id) {
    return { sql: `(e.user_id = $${firstParam} OR e.therapist_profile_id = $${firstParam + 1})`,
      params: [user.id, user.therapist_profile_id] };
  }
  return { sql: `e.user_id = $${firstParam}`, params: [user.id] };
}

/**
 * The owed sessions, newest first. `since` narrows the window (the evening
 * push asks for today only). Rows carry what the phone shows — no notes.
 */
async function listOwed(user, { now = new Date(), since = null, limit = 50 } = {}) {
  const from = since || new Date(now.getTime() - WINDOW_DAYS * 86400000);
  const owner = ownerClause(user, 4);
  const { rows } = await pool.query(
    `SELECT e.id, e.title, e.start_time, e.end_time, e.client_id, e.client_name
       FROM events e
      WHERE ${owner.sql}
        AND e.event_type = 'therapy'
        AND (e.is_deleted IS NULL OR e.is_deleted = FALSE)
        AND (e.status IS NULL OR e.status <> 'cancelled')
        AND e.end_time <= $1 AND e.end_time > $2
        AND NOT EXISTS (SELECT 1 FROM case_note_drafts c
                         WHERE c.user_id = $3 AND c.linked_event_id = e.id AND c.status <> 'archived')
        AND NOT EXISTS (SELECT 1 FROM case_note_owed_dismissals d
                         WHERE d.user_id = $3 AND d.event_id = e.id)
      ORDER BY e.end_time DESC
      LIMIT ${Math.max(1, Math.min(200, Number(limit) || 50))}`,
    [now.toISOString(), from.toISOString(), user.id, ...owner.params]);
  return rows;
}

/** May the caller dismiss this session? Only an owed-shaped session of theirs. */
async function ownSession(user, eventId) {
  const owner = ownerClause(user, 2);
  const { rows } = await pool.query(
    `SELECT e.id FROM events e
      WHERE e.id = $1 AND ${owner.sql} AND e.event_type = 'therapy'
        AND (e.is_deleted IS NULL OR e.is_deleted = FALSE)`,
    [eventId, ...owner.params]);
  return rows[0] || null;
}

async function dismiss(user, eventId) {
  await pool.query(
    `INSERT INTO case_note_owed_dismissals (user_id, event_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`, [user.id, eventId]);
}

async function undismiss(user, eventId) {
  await pool.query('DELETE FROM case_note_owed_dismissals WHERE user_id = $1 AND event_id = $2',
    [user.id, eventId]);
}

module.exports = { WINDOW_DAYS, listOwed, ownSession, dismiss, undismiss };
