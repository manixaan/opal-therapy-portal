'use strict';

/**
 * WARM-UP — the first person to ask never pays for a cold start.
 *
 * After a restart three things are cold: the practice directory (several
 * Splose pages), the record fingerprints, and the path to the model (managed
 * identity → Microsoft token → AWS role → Bedrock). The first real question
 * used to carry all of that, and sometimes timed out into "I couldn't reach my
 * knowledge service". So the server asks first, in the background:
 *
 *   at start     directory + fingerprints, then one tiny model call
 *   every 10 min directory + fingerprints (they expire at ten minutes)
 *   every 15 min the tiny model call, so credentials never lapse unused
 *
 * The model call is a fixed synthetic string through the normal gateway — it
 * is policy-checked, gate-checked and audited like any other call, with no
 * user attached. Nothing here can throw into the server: a failed warm-up is
 * logged by reason only and tried again next time.
 */

const gateway = require('../ai/ai-gateway');
const directory = require('./identity-directory');
const knownValues = require('./known-values');

const DIRECTORY_EVERY_MS = 10 * 60 * 1000;
const MODEL_EVERY_MS = 15 * 60 * 1000;
const PING = { system: 'Reply with the single word: ready', messages: [{ role: 'user', content: 'ready?' }] };

const state = { directoryAt: null, modelAt: null, modelOk: null, lastReason: null };

/** Features whose switch is on and whose gateway configuration is valid — in order of preference for the ping. */
function warmFeature() {
  const flags = [['opa_assistant', 'OPA_AI_ENABLED'], ['opal_assist', 'OPAL_ASSIST_ENABLED']];
  const hit = flags.find(([feature, flag]) => process.env[flag] === 'true' && gateway.isAvailable(feature));
  return hit ? hit[0] : null;
}

async function warmDirectory() {
  try { await directory.load(); await knownValues.matcher(); state.directoryAt = new Date(); }
  catch (err) { state.lastReason = `directory:${err?.code || 'error'}`; }
}

async function warmModel() {
  const feature = warmFeature();
  if (!feature) { state.modelOk = null; return; }
  try {
    await gateway.generate({ feature, ...PING, maxTokens: 64, timeoutMs: 20000 });
    state.modelOk = true; state.modelAt = new Date(); state.lastReason = null;
  } catch (err) {
    state.modelOk = false; state.lastReason = `model:${err?.reason || err?.message || 'error'}`;
    console.warn(`[warmup] model path not ready (reason: ${state.lastReason})`);
  }
}

let started = false;
function start({ delayMs = 8000 } = {}) {
  if (started || process.env.NODE_ENV === 'test') return;
  started = true;
  const first = setTimeout(async () => { await warmDirectory(); await warmModel(); }, delayMs);
  const d = setInterval(warmDirectory, DIRECTORY_EVERY_MS);
  const m = setInterval(warmModel, MODEL_EVERY_MS);
  [first, d, m].forEach((t) => t.unref && t.unref());
}

/** For the owner's AI status page. No content — times and a reason code. */
function status() { return { directory_warmed_at: state.directoryAt, model_warmed_at: state.modelAt, model_ready: state.modelOk, last_reason: state.lastReason }; }

/**
 * Run a model call; on a TRANSPORT failure try once more. A policy denial, a
 * guardrail refusal and a de-identification refusal are decisions, not
 * glitches — they are never retried. `canRetry()` lets a streaming caller
 * refuse the retry once anything has been shown.
 */
async function withOneRetry(call, canRetry = () => true) {
  try { return await call(); }
  catch (err) {
    const decision = err instanceof gateway.AiPolicyError || ['guardrail_intervened', 'guardrail_not_configured', 'content_blocked'].includes(err?.message);
    if (decision || !canRetry()) throw err;
    await new Promise((r) => setTimeout(r, 600));
    return call();
  }
}

module.exports = { start, status, withOneRetry, warmDirectory, warmModel, _state: state };
