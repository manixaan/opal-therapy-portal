'use strict';

/**
 * RUN JOBS — invoicing runs off the request path.
 *
 * 1. Background runs. "Create drafts" starts a run and returns at once; the
 *    page polls the job for its stage ("Checking Splose…", "Working out
 *    travel…") and its summary. Most of a run is spent reading Splose, which
 *    allows about two requests a second, so the owner should never wait on it.
 *    Jobs live in this process only: after a restart a poll gets 404 and the
 *    page says to look at the drafts (the run itself either committed or
 *    rolled back as one transaction).
 *
 * 2. Nightly drafts (migration 096). After AUTO_DRAFTS_HOUR local time each
 *    day, every organisation with auto drafts on gets a run for the current
 *    week so far (Monday → today), all practitioners. It is the same
 *    idempotent run the owner presses, so by Monday the week's drafts already
 *    exist and pressing "Create drafts" only tops up what changed.
 */

const { pool: defaultPool } = require('../database');
const Gen = require('./invoice-generation');

const MAX_JOBS = 50;
const JOB_TTL_MS = 6 * 60 * 60 * 1000;
const jobs = new Map(); // jobId → job
let seq = 0;

function newId() {
  seq = (seq + 1) % 1e6;
  return `run-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function prune() {
  const cut = Date.now() - JOB_TTL_MS;
  for (const [id, j] of jobs) if (j.startedAt < cut && j.state !== 'RUNNING') jobs.delete(id);
  while (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()].filter(j => j.state !== 'RUNNING').sort((a, b) => a.startedAt - b.startedAt)[0];
    if (!oldest) break;
    jobs.delete(oldest.id);
  }
}

function publicJob(j) {
  return { jobId: j.id, state: j.state, stage: j.stage, from: j.from, to: j.to, startedAt: new Date(j.startedAt).toISOString(),
    finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : null, result: j.result || null, error: j.error || null };
}

/** Start a run in the background. Returns the job at once. */
function startRun({ pool = defaultPool, orgId, userId, from, to, practitionerIds = null, clientIds = null, run = Gen.runInvoicing }) {
  prune();
  // One run per organisation at a time: a second press joins the running one.
  for (const j of jobs.values()) {
    if (j.orgId === orgId && j.state === 'RUNNING' && j.from === from && j.to === to
        && JSON.stringify(j.practitionerIds) === JSON.stringify(practitionerIds) && JSON.stringify(j.clientIds) === JSON.stringify(clientIds)) {
      return publicJob(j);
    }
  }
  const j = { id: newId(), orgId, userId, from, to, practitionerIds, clientIds, state: 'RUNNING', stage: 'Starting', startedAt: Date.now() };
  jobs.set(j.id, j);
  Promise.resolve()
    .then(() => run({ pool, orgId, userId, from, to, practitionerIds, clientIds, kind: 'NORMAL', progress: s => { j.stage = s; } }))
    .then(result => { j.state = 'DONE'; j.stage = 'Done'; j.result = result; })
    .catch(e => {
      j.state = 'FAILED'; j.stage = 'Failed';
      // A 4xx is a message for the owner; anything else stays generic (no internals).
      j.error = e && e.status && e.status < 500 ? String(e.message) : 'The run could not finish. Nothing was half-saved; try again.';
      console.error('invoicing background run failed:', e && e.message);
    })
    .finally(() => { j.finishedAt = Date.now(); });
  return publicJob(j);
}

function getJob(orgId, jobId) {
  const j = jobs.get(String(jobId));
  return j && j.orgId === orgId ? publicJob(j) : null;
}

/** The newest job for the organisation (running first), for a page that reopens. */
function latestJob(orgId) {
  const mine = [...jobs.values()].filter(j => j.orgId === orgId).sort((a, b) => b.startedAt - a.startedAt);
  const running = mine.find(j => j.state === 'RUNNING');
  return running ? publicJob(running) : (mine[0] ? publicJob(mine[0]) : null);
}

// ── Nightly drafts ──────────────────────────────────────────────────────────

const AUTO_DRAFTS_HOUR = Number(process.env.INVOICING_AUTO_DRAFTS_HOUR || 21);
const CHECK_EVERY_MS = 15 * 60 * 1000;

function localParts(now, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: p.weekday };
}

/** Monday of the week holding `ymd` (weeks run Monday → Sunday). */
function mondayOf(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
}

/**
 * One pass: run every organisation that is due. Exposed for tests.
 * Due = auto drafts on, past the hour locally, and not yet run today.
 */
async function autoDraftsTick({ pool = defaultPool, now = new Date(), run = Gen.runInvoicing } = {}) {
  const { rows } = await pool.query(
    `SELECT organisation_id, COALESCE(timezone, 'Australia/Perth') AS tz, to_char(auto_drafts_last_date, 'YYYY-MM-DD') AS last_date
       FROM billing_settings WHERE auto_drafts_enabled = TRUE`);
  const done = [];
  for (const r of rows) {
    const local = localParts(now, r.tz);
    if (local.hour < AUTO_DRAFTS_HOUR || r.last_date === local.date) continue;
    // Claim the day first so two app instances never both run it.
    const { rowCount } = await pool.query(
      `UPDATE billing_settings SET auto_drafts_last_date = $2::date
        WHERE organisation_id = $1 AND (auto_drafts_last_date IS NULL OR auto_drafts_last_date < $2::date)`,
      [r.organisation_id, local.date]);
    if (!rowCount) continue;
    const from = mondayOf(local.date);
    const to = local.date;
    try {
      const out = await run({ pool, orgId: r.organisation_id, userId: null, from, to, kind: 'NORMAL', now });
      await pool.query(
        `UPDATE billing_settings SET auto_drafts_last_at = NOW(), auto_drafts_last_error = NULL,
                auto_drafts_last_period = $2 WHERE organisation_id = $1`,
        [r.organisation_id, JSON.stringify({ from, to, runId: out && out.runId,
          invoicesCreated: out && out.summary ? out.summary.invoicesCreated : null,
          invoicesUpdated: out && out.summary ? out.summary.invoicesUpdated : null,
          itemsNeedAttention: out && out.summary ? out.summary.itemsNeedAttention : null })]);
      done.push({ orgId: r.organisation_id, from, to, ok: true });
    } catch (e) {
      await pool.query(`UPDATE billing_settings SET auto_drafts_last_error = $2 WHERE organisation_id = $1`,
        [r.organisation_id, 'The overnight drafts could not finish; they will try again tomorrow night.']).catch(() => {});
      console.error('invoicing nightly drafts failed:', e && e.message);
      done.push({ orgId: r.organisation_id, from, to, ok: false });
    }
  }
  return done;
}

let timer = null;
function startAutoDrafts({ pool = defaultPool } = {}) {
  if (timer || process.env.NODE_ENV === 'test' || process.env.INVOICING_AUTO_DRAFTS === 'off') return false;
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    autoDraftsTick({ pool }).catch(e => console.error('invoicing nightly drafts tick:', e && e.message)).finally(() => { busy = false; });
  };
  timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
  return true;
}

module.exports = { startRun, getJob, latestJob, autoDraftsTick, startAutoDrafts, mondayOf, localParts, _jobs: jobs };
