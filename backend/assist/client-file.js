'use strict';

/**
 * OPAL ASSIST — the client file: what a client chat may look up.
 *
 * Read-only, no model call. Feeds the "Client file" panel in a client chat,
 * where the practitioner TICKS what to attach; the ticked text then goes
 * through the ordinary attachment path (/check → tokens → chat guard), so
 * nothing here ever reaches the AI unchecked or unchosen.
 *
 * Sources, and their honest limits:
 *   - case notes drafted in the PORTAL or Opa (case_note_drafts) — the
 *     caller's OWN notes for this client, not archived, not rejected.
 *     Notes written directly in Splose are NOT here: Splose's public API
 *     exposes no progress notes.
 *   - the client's Splose CASES (cached full list via splose-api): case
 *     number, issue/expiry, budget/hours tracking, the case's own note.
 *   - the client's therapy SESSIONS from the portal calendar (the caller's).
 *
 * Search is Postgres full-text over the note body (websearch syntax:
 * "stove incident", -cancelled, OR). Never AI.
 *
 * The route authorises the client (caseload scoping) BEFORE any of this
 * runs; these helpers trust the id they are given.
 */

const MAX_NOTES = 40;
const MAX_NOTE_CHARS = 8000;
const MAX_CASES = 5;
const MAX_CASE_NOTE_CHARS = 1000;
const PAST_SESSIONS = 20;
const NEXT_SESSIONS = 3;
const MAX_QUERY_CHARS = 200;

/** A search string fit for websearch_to_tsquery, or '' for "no search". */
function cleanQuery(q) {
  return String(q == null ? '' : q).replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
}

/** The caller's notes for this client, newest first; `query` narrows by full-text search. */
async function loadNotes(pool, { userId, clientId, query }) {
  const params = [clientId, userId];
  let search = '';
  if (query) { params.push(query); search = `AND to_tsvector('english', c.note_body) @@ websearch_to_tsquery('english', $3)`; }
  const { rows } = await pool.query(
    `SELECT c.id, c.created_at, c.note_body, c.review_status, e.title AS event_title, e.start_time AS event_start
       FROM case_note_drafts c
       LEFT JOIN events e ON e.id = c.linked_event_id
      WHERE c.user_id = $2 AND c.status <> 'archived' AND c.review_status <> 'rejected'
        AND (c.splose_patient_id = $1
             OR c.linked_event_id IN (SELECT id FROM events WHERE client_id = $1))
        ${search}
      ORDER BY COALESCE(e.start_time, c.created_at) DESC
      LIMIT ${MAX_NOTES + 1}`, params);
  return {
    more: rows.length > MAX_NOTES,
    notes: rows.slice(0, MAX_NOTES).map((r) => {
      const text = String(r.note_body || '').trim();
      return {
        id: r.id,
        date: r.event_start || r.created_at,
        title: r.event_title || null,
        review: r.review_status === 'approved' ? 'approved' : 'unreviewed',
        text: text.slice(0, MAX_NOTE_CHARS),
        cut: text.length > MAX_NOTE_CHARS,
      };
    }),
  };
}

/** The caller's therapy sessions with this client: the last few and the next few. */
async function loadSessions(pool, { user, clientId, now = new Date() }) {
  const params = [clientId, user.id];
  let owner = 'user_id = $2';
  if (user.therapist_profile_id) { params.push(user.therapist_profile_id); owner = '(user_id = $2 OR therapist_profile_id = $3)'; }
  const { rows } = await pool.query(
    `SELECT title, start_time, status FROM events
      WHERE client_id = $1 AND ${owner} AND event_type = 'therapy'
        AND (is_deleted IS NULL OR is_deleted = FALSE)
      ORDER BY start_time DESC LIMIT 80`, params);
  const toSession = (r) => ({ start: r.start_time, title: r.title || null, cancelled: r.status === 'cancelled' });
  const past = rows.filter((r) => new Date(r.start_time) <= now).slice(0, PAST_SESSIONS).map(toSession);
  const next = rows.filter((r) => new Date(r.start_time) > now && r.status !== 'cancelled')
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time)).slice(0, NEXT_SESSIONS).map(toSession);
  return { past, next };
}

/** This client's Splose cases, open first. */
function shapeCases(allCases, clientId) {
  return (Array.isArray(allCases) ? allCases : [])
    .filter((c) => c && String(c.patientId) === String(clientId) && !c.archived && !c.deletedAt)
    .map((c) => ({
      number: c.caseNumber || null,
      open: c.isOpen !== false,
      issued: c.issueDate || null,
      expires: c.expiryDate || null,
      track: c.trackType || null,
      budget: Number.isFinite(Number(c.budget)) && c.budget !== null ? Number(c.budget) : null,
      hours: Number.isFinite(Number(c.hours)) && c.hours !== null ? Number(c.hours) : null,
      appointments: Number.isFinite(Number(c.appointmentCount)) ? Number(c.appointmentCount) : null,
      note: c.notes ? String(c.notes).trim().slice(0, MAX_CASE_NOTE_CHARS) || null : null,
    }))
    .sort((a, b) => (b.open - a.open) || String(b.expires || '').localeCompare(String(a.expires || '')))
    .slice(0, MAX_CASES);
}

module.exports = { cleanQuery, loadNotes, loadSessions, shapeCases, MAX_NOTES, MAX_NOTE_CHARS, MAX_QUERY_CHARS };
