'use strict';

/**
 * THE AI QUEUE — a busy moment means a few extra seconds, not "not available".
 *
 * Every model call in the portal goes through the gateway, and staging and
 * production share one AWS account's Bedrock quota. A load test on staging
 * (7 Nov 2026) was clean at 5 questions at once but lost 4 of 10 and 18 of 20,
 * and 1 of 3 long notes, all failing fast. So:
 *
 *   1. At most MAX_CONCURRENT calls are in flight; the rest wait in order.
 *   2. A call the provider turns away for rate reasons waits and tries again,
 *      with growing pauses and some jitter so a crowd does not return together.
 *      It keeps its slot meanwhile, which eases the pressure.
 *   3. Nothing waits for ever: past MAX_WAIT_MS in line, or with the line
 *      full, the call fails with 'ai_busy' so the person can be told plainly.
 *
 * A retry never happens once a word has been shown (`canRetry`), and only for
 * rate errors: a guardrail stop or a refusal is an answer, not a fault.
 * Per process: several App Service instances would each have their own line.
 * Holds no content. Pure apart from timers.
 */

const clampInt = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};
const maxConcurrent = () => clampInt(process.env.AI_MAX_CONCURRENT, 4, 1, 50);
const maxWaitMs = () => clampInt(process.env.AI_MAX_QUEUE_WAIT_MS, 60000, 1000, 180000);
const MAX_QUEUED = 200;
const BACKOFF_MS = [1500, 3000, 6000, 12000];

let _active = 0;
const _line = [];
let _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = { queued: 0, retried: 0, busy: 0, longestWaitMs: 0 };

/** Did the provider turn this call away for rate or capacity reasons? */
function isRateLimited(err) {
  const d = (err && err.diagnostic) || {};
  if (d.status === 429 || err?.status === 429) return true;
  return /throttl|toomanyrequests|too_many_requests|ratelimit|rate_limit|serviceunavailable|modelnotready/i.test(String(d.code || err?.code || ''));
}

function busy() { stats.busy++; const e = new Error('ai_busy'); e.aiBusy = true; return e; }

function acquire() {
  if (_active < maxConcurrent()) { _active++; return Promise.resolve(); }
  if (_line.length >= MAX_QUEUED) return Promise.reject(busy());
  stats.queued++;
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject, at: Date.now() };
    entry.timer = setTimeout(() => {
      const i = _line.indexOf(entry);
      if (i >= 0) { _line.splice(i, 1); reject(busy()); }
    }, maxWaitMs());
    if (entry.timer.unref) entry.timer.unref();
    _line.push(entry);
  });
}

function release() {
  const next = _line.shift();
  if (next) { // the slot passes straight on, so _active does not change
    clearTimeout(next.timer);
    stats.longestWaitMs = Math.max(stats.longestWaitMs, Date.now() - next.at);
    next.resolve();
  } else _active = Math.max(0, _active - 1);
}

/**
 * Run one model call in turn.
 * @param {() => Promise} task
 * @param {{canRetry?: () => boolean}} [opts] false once output has been shown
 */
async function run(task, { canRetry = () => true } = {}) {
  await acquire();
  try {
    for (let attempt = 0; ; attempt++) {
      try { return await task(); } catch (err) {
        if (!isRateLimited(err) || attempt >= BACKOFF_MS.length || !canRetry()) throw err;
        stats.retried++;
        await _sleep(BACKOFF_MS[attempt] * (0.7 + Math.random() * 0.6));
      }
    }
  } finally { release(); }
}

function snapshot() { return { active: _active, waiting: _line.length, limit: maxConcurrent(), ...stats }; }
function _resetForTests({ sleep } = {}) {
  _line.splice(0).forEach((e) => clearTimeout(e.timer));
  _active = 0; Object.assign(stats, { queued: 0, retried: 0, busy: 0, longestWaitMs: 0 });
  _sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
}

module.exports = { run, isRateLimited, snapshot, _resetForTests };
