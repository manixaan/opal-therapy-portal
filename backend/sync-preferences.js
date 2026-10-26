'use strict';

/**
 * SYNC SETTINGS (migration 081) — which way each calendar sync runs, from
 * when, and whether it runs on its own.
 *
 * Five directions. For each one a person has three choices — on/off, a
 * "sync events from" date (anything starting earlier is left alone in that
 * direction) and auto (runs by itself) versus only when "Sync now" is pressed.
 * The Owner sets the practice defaults and three limits per direction:
 * allowed at all, allowed to run automatically, and the earliest sync-from
 * date anyone may choose.
 *
 * Resolution, fail-closed:
 *   enabled  = practice.allowed  AND (user.enabled ?? practice.enabled)
 *   auto     = practice.allowAuto AND (user.auto ?? practice.auto)
 *   syncFrom = the later of (user.syncFrom ?? practice.syncFrom) and practice.earliestFrom
 * and above all of it the environment flags (ENABLE_OUTLOOK_WRITE, ...) —
 * a page setting can never switch on what the environment has switched off.
 *
 * DEFAULTS reproduce how sync behaved before this page existed, so upgrading
 * changes nothing until someone changes a setting: the portal→Outlook copy on
 * save and the 90-second Outlook poll stay automatic; Splose publishing stays
 * exactly as automatic as ENABLE_SPLOSE_AUTO_SYNC makes it; Splose imports stay
 * manual (the watcher still asks about each change).
 *
 * Reading the settings can fail (database down, table missing). Callers treat
 * a failure as "not allowed": a booking is still saved in the portal, it just
 * isn't copied anywhere until the settings can be read.
 */

const flags = require('./feature-flags');

const DIRECTIONS = ['portal_to_outlook', 'outlook_to_portal', 'portal_to_splose', 'splose_to_portal', 'splose_to_outlook'];

const DEFAULTS = {
  portal_to_outlook: { allowed: true, allowAuto: true, enabled: true, auto: true,  syncFrom: null, earliestFrom: null },
  outlook_to_portal: { allowed: true, allowAuto: true, enabled: true, auto: true,  syncFrom: null, earliestFrom: null },
  portal_to_splose:  { allowed: true, allowAuto: true, enabled: true, auto: true,  syncFrom: null, earliestFrom: null },
  splose_to_portal:  { allowed: true, allowAuto: true, enabled: true, auto: false, syncFrom: null, earliestFrom: null },
  splose_to_outlook: { allowed: true, allowAuto: true, enabled: true, auto: true,  syncFrom: null, earliestFrom: null },
};

const PRACTICE_TIME_ZONE = 'Australia/Perth';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let _dayFmt = null;
/** The practice-local calendar day of an instant, 'YYYY-MM-DD' (null if unreadable). */
function localDay(value) {
  if (value === null || value === undefined || value === '') return null;
  const t = value instanceof Date ? value : new Date(value);
  if (isNaN(t.getTime())) return null;
  if (!_dayFmt) _dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: PRACTICE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
  return _dayFmt.format(t);
}

/** A DATE column (Date or string) → 'YYYY-MM-DD', or null. */
function asDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // pg returns DATE as a local-midnight Date; read its local parts back.
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v).slice(0, 10);
  return DATE_RE.test(s) ? s : null;
}

const laterOf = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));
const pick = (v, d) => (v === null || v === undefined ? d : v);

/** What the environment allows, per direction. Pure over the flags module. */
function environment(sploseConfigured) {
  const outlookWrite = flags.isOutlookWriteEnabled();
  const draft = flags.isSploseDraftSyncEnabled();
  const env = {};
  for (const d of DIRECTIONS) env[d] = { blockedBy: null, autoBlockedBy: null, writeBlockedBy: null };
  if (!outlookWrite) {
    env.portal_to_outlook.blockedBy = 'ENABLE_OUTLOOK_WRITE';
    env.splose_to_outlook.blockedBy = 'ENABLE_OUTLOOK_WRITE';
  }
  if (!draft) {
    env.portal_to_splose.blockedBy = 'ENABLE_SPLOSE_DRAFT_SYNC';
    env.splose_to_portal.blockedBy = 'ENABLE_SPLOSE_DRAFT_SYNC';
  } else if (!sploseConfigured) {
    // Reading Splose needs the connection; queueing for it never has.
    env.splose_to_portal.blockedBy = 'SPLOSE_NOT_CONNECTED';
  }
  // Queueing works without these; writing to Splose and running on a timer do not.
  if (!flags.isSploseWriteEnabled()) env.portal_to_splose.writeBlockedBy = 'ENABLE_SPLOSE_WRITE';
  else if (!sploseConfigured) env.portal_to_splose.writeBlockedBy = 'SPLOSE_NOT_CONNECTED';
  if (!flags.isSploseAutoSyncEnabled()) env.portal_to_splose.autoBlockedBy = 'ENABLE_SPLOSE_AUTO_SYNC';
  return env;
}

function rowToPractice(r) {
  return {
    allowed: r.allowed, allowAuto: r.allow_auto, enabled: r.enabled, auto: r.auto,
    syncFrom: asDate(r.sync_from), earliestFrom: asDate(r.earliest_from),
  };
}
function rowToUser(r) {
  return { enabled: r.enabled, auto: r.auto, syncFrom: asDate(r.sync_from) };
}

/**
 * Pure: settings rows + environment → the effective settings per direction.
 *   practiceRows  sync_settings rows with scope 'practice'
 *   userRows      sync_settings rows with scope 'user' for one person
 *   env           environment() output
 */
function resolve({ practiceRows, userRows, env }) {
  const byDir = (rows) => {
    const m = {};
    for (const r of rows || []) if (r && DIRECTIONS.includes(r.direction)) m[r.direction] = r;
    return m;
  };
  const pr = byDir(practiceRows), ur = byDir(userRows);
  const out = {};
  for (const d of DIRECTIONS) {
    const base = DEFAULTS[d];
    const p0 = pr[d] ? rowToPractice(pr[d]) : {};
    const practice = {
      allowed: pick(p0.allowed, base.allowed), allowAuto: pick(p0.allowAuto, base.allowAuto),
      enabled: pick(p0.enabled, base.enabled), auto: pick(p0.auto, base.auto),
      syncFrom: pick(p0.syncFrom, base.syncFrom), earliestFrom: pick(p0.earliestFrom, base.earliestFrom),
    };
    const user = ur[d] ? rowToUser(ur[d]) : { enabled: null, auto: null, syncFrom: null };
    const e = (env && env[d]) || { blockedBy: 'UNKNOWN' };
    const enabled = practice.allowed === true && pick(user.enabled, practice.enabled) === true;
    const auto = practice.allowAuto === true && pick(user.auto, practice.auto) === true;
    const syncFrom = laterOf(pick(user.syncFrom, practice.syncFrom), practice.earliestFrom);
    out[d] = {
      direction: d, enabled, auto, syncFrom, practice, user,
      blockedBy: e.blockedBy || null, autoBlockedBy: e.autoBlockedBy || null, writeBlockedBy: e.writeBlockedBy || null,
      runs: enabled && !e.blockedBy,
      runsAutomatically: enabled && auto && !e.blockedBy && !e.autoBlockedBy,
    };
  }
  return out;
}

/** True when an event starting at `start` is on or after the cutoff (no cutoff = always). */
function onOrAfter(start, syncFrom) {
  if (!syncFrom) return true;
  const day = localDay(start);
  if (!day) return false;
  return day >= syncFrom;
}

/**
 * May this direction carry this event now?
 *   prefs     resolve() output (or null when reading failed → no)
 *   opts.start   the event's start (cutoff check; omit to skip it)
 *   opts.manual  true for "Sync now" — auto is not required
 */
function allows(prefs, direction, opts = {}) {
  const p = prefs && prefs[direction];
  if (!p || !p.runs) return false;
  if (!opts.manual && !p.runsAutomatically) return false;
  if (opts.start !== undefined && !onOrAfter(opts.start, p.syncFrom)) return false;
  return true;
}

/**
 * Like allows(), for an event that is ALREADY linked on the other side. The
 * cutoff decides which old events are brought across, never whether a
 * synced event keeps in step — so only on/off and auto apply.
 */
function allowsLinked(prefs, direction, opts = {}) {
  return allows(prefs, direction, { manual: opts.manual });
}

/**
 * What the Splose watcher does with one alert, given the person's settings:
 *   'drop'  not recorded — the direction is off, or the event is before its date
 *   'auto'  recorded and acted on without asking (a new Splose appointment
 *           while Splose → portal runs automatically)
 *   'keep'  recorded and shown, as before
 * Only 'created' (new in Splose) and 'unlinked' (portal booking not in Splose)
 * are governed; moves and cancellations of linked appointments always ask.
 * Unreadable settings (null) keep — a warning is never silenced by an error.
 */
function alertDecision(prefs, alert) {
  if (!alert || !['created', 'unlinked'].includes(alert.kind) || !prefs) return 'keep';
  const d = alert.kind === 'created' ? 'splose_to_portal' : 'portal_to_splose';
  const start = alert.details && alert.details.start;
  if (!allows(prefs, d, { manual: true, start })) return 'drop';
  if (alert.kind === 'created' && allows(prefs, d, { start })) return 'auto';
  return 'keep';
}

/**
 * Outlook → portal cutoff for the delta feed. An Outlook event that starts
 * before the sync-from date and is NOT already in the portal is not brought
 * in; one the portal already holds keeps in step. Cancellations always pass
 * (they only ever touch a row that exists).
 *   changed   mapped delta items ({ outlookId, startTime, isCancelled, ... })
 *   knownIds  Set of outlook ids the portal already holds for this person
 * Returns { kept, skippedOld }.
 */
function partitionOldOutlook(changed, syncFrom, knownIds) {
  const kept = [];
  let skippedOld = 0;
  for (const ev of changed || []) {
    const old = !!syncFrom && !ev.isCancelled && ev.startTime && !onOrAfter(ev.startTime, syncFrom);
    if (old && !(knownIds && knownIds.has(String(ev.outlookId)))) { skippedOld++; continue; }
    kept.push(ev);
  }
  return { kept, skippedOld };
}

/** partitionOldOutlook() with the known ids read from the database. */
async function applyOutlookCutoff(db, userId, changed, syncFrom) {
  if (!syncFrom || !changed || !changed.length) return { kept: changed || [], skippedOld: 0 };
  const candidates = changed
    .filter(ev => !ev.isCancelled && ev.startTime && !onOrAfter(ev.startTime, syncFrom))
    .map(ev => String(ev.outlookId));
  const known = new Set();
  if (candidates.length) {
    const { rows } = await db.pool.query(
      `SELECT outlook_id FROM events WHERE user_id = $1 AND outlook_id = ANY($2::text[])`, [userId, candidates]);
    for (const r of rows || []) known.add(String(r.outlook_id));
  }
  return partitionOldOutlook(changed, syncFrom, known);
}

async function loadRows(db, userId) {
  const { rows } = await db.pool.query(
    `SELECT scope, user_id, direction, enabled, sync_from, auto, allowed, allow_auto, earliest_from, updated_at
       FROM sync_settings
      WHERE scope = 'practice' OR (scope = 'user' AND user_id = $1)`,
    [userId]
  );
  const list = Array.isArray(rows) ? rows : [];
  return {
    practiceRows: list.filter(r => r.scope === 'practice'),
    userRows: list.filter(r => r.scope === 'user'),
  };
}

function sploseConfigured() {
  try { return !!require('./splose-api').isConfigured(); } catch (_) { return false; }
}

/** Effective settings for one person. Throws when they cannot be read. */
async function effectiveFor(db, userId) {
  const rows = await loadRows(db, userId);
  return resolve({ ...rows, env: environment(sploseConfigured()) });
}

/** effectiveFor(), but null instead of throwing — callers deny on null. */
async function effectiveOrNull(db, userId, log = console.warn) {
  try { return await effectiveFor(db, userId); } catch (err) {
    log(`⚠️  Sync settings unreadable for ${userId} — sync held: ${err.message}`);
    return null;
  }
}

// ── Updates ─────────────────────────────────────────────────────────────────

function triState(v) {
  if (v === null) return { ok: true, value: null };
  if (v === true || v === false) return { ok: true, value: v };
  return { ok: false };
}
function dateOrNull(v) {
  if (v === null || v === '') return { ok: true, value: null };
  if (typeof v === 'string' && DATE_RE.test(v) && !isNaN(new Date(v + 'T00:00:00Z').getTime())) return { ok: true, value: v };
  return { ok: false };
}

/**
 * Validate one person's changes against the practice limits.
 *   practice  resolve()[d].practice per direction
 *   body      { [direction]: { enabled?, auto?, syncFrom? } } — null = back to the practice default
 * Returns { errors: [..], changes: { [direction]: { enabled?, auto?, syncFrom? } } }
 */
function validateUserUpdate(resolved, body) {
  const errors = [], changes = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: ['Nothing to save'], changes };
  for (const [d, raw] of Object.entries(body)) {
    if (!DIRECTIONS.includes(d)) { errors.push(`Unknown direction: ${d}`); continue; }
    if (!raw || typeof raw !== 'object') { errors.push(`${d}: expected an object`); continue; }
    const p = resolved[d].practice;
    const c = {};
    if ('enabled' in raw) {
      const t = triState(raw.enabled);
      if (!t.ok) errors.push(`${d}: enabled must be true, false or null`);
      else if (t.value === true && !p.allowed) errors.push(`${d}: the Owner has not allowed this sync`);
      else c.enabled = t.value;
    }
    if ('auto' in raw) {
      const t = triState(raw.auto);
      if (!t.ok) errors.push(`${d}: auto must be true, false or null`);
      else if (t.value === true && !p.allowAuto) errors.push(`${d}: the Owner has not allowed this sync to run automatically`);
      else c.auto = t.value;
    }
    if ('syncFrom' in raw) {
      const t = dateOrNull(raw.syncFrom);
      if (!t.ok) errors.push(`${d}: syncFrom must be a date (YYYY-MM-DD) or null`);
      // null falls back to the practice default, which resolve() clamps to the earliest date.
      else if (t.value !== null && p.earliestFrom && t.value < p.earliestFrom) errors.push(`${d}: the earliest date the Owner allows is ${p.earliestFrom}`);
      else c.syncFrom = t.value;
    }
    if (Object.keys(c).length) changes[d] = c;
  }
  return { errors, changes };
}

/** Validate the Owner's practice defaults and limits. */
function validatePracticeUpdate(body) {
  const errors = [], changes = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: ['Nothing to save'], changes };
  for (const [d, raw] of Object.entries(body)) {
    if (!DIRECTIONS.includes(d)) { errors.push(`Unknown direction: ${d}`); continue; }
    if (!raw || typeof raw !== 'object') { errors.push(`${d}: expected an object`); continue; }
    const c = {};
    for (const k of ['allowed', 'allowAuto', 'enabled', 'auto']) {
      if (!(k in raw)) continue;
      const t = triState(raw[k]);
      if (!t.ok) errors.push(`${d}: ${k} must be true, false or null`); else c[k] = t.value;
    }
    for (const k of ['syncFrom', 'earliestFrom']) {
      if (!(k in raw)) continue;
      const t = dateOrNull(raw[k]);
      if (!t.ok) errors.push(`${d}: ${k} must be a date (YYYY-MM-DD) or null`); else c[k] = t.value;
    }
    if (Object.keys(c).length) changes[d] = c;
  }
  return { errors, changes };
}

const COLUMN = { enabled: 'enabled', auto: 'auto', syncFrom: 'sync_from', allowed: 'allowed', allowAuto: 'allow_auto', earliestFrom: 'earliest_from' };

/** Upsert validated changes. scope 'user' needs userId. One transaction. */
async function saveChanges(db, { scope, userId = null, actorUserId, changes }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const [d, c] of Object.entries(changes)) {
      const keys = Object.keys(c);
      if (!keys.length) continue;
      const existing = await client.query(
        scope === 'practice'
          ? `SELECT id FROM sync_settings WHERE scope = 'practice' AND direction = $1 FOR UPDATE`
          : `SELECT id FROM sync_settings WHERE scope = 'user' AND user_id = $2 AND direction = $1 FOR UPDATE`,
        scope === 'practice' ? [d] : [d, userId]
      );
      if (existing.rows.length) {
        const sets = keys.map((k, i) => `${COLUMN[k]} = $${i + 2}`);
        await client.query(
          `UPDATE sync_settings SET ${sets.join(', ')}, updated_by = $${keys.length + 2}, updated_at = NOW() WHERE id = $1`,
          [existing.rows[0].id, ...keys.map(k => c[k]), actorUserId]
        );
      } else {
        const cols = keys.map(k => COLUMN[k]);
        const params = [scope, scope === 'practice' ? null : userId, d, ...keys.map(k => c[k]), actorUserId];
        const ph = params.map((_, i) => `$${i + 1}`);
        await client.query(
          `INSERT INTO sync_settings (scope, user_id, direction, ${cols.join(', ')}, updated_by) VALUES (${ph.join(', ')})`,
          params
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  DIRECTIONS,
  DEFAULTS,
  localDay,
  onOrAfter,
  environment,
  resolve,
  allows,
  allowsLinked,
  alertDecision,
  partitionOldOutlook,
  applyOutlookCutoff,
  effectiveFor,
  effectiveOrNull,
  validateUserUpdate,
  validatePracticeUpdate,
  saveChanges,
};
