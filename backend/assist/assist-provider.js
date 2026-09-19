'use strict';

/**
 * Opal Assist — the model call, through the gateway, nothing else.
 *
 * Mirrors opa-provider.js: policy `opal_assist`, sanitised errors, streaming
 * as the narrower privilege (the gateway confines it to assistant_response
 * and the provider fails closed on any chunk it cannot recognise). Feature
 * flag OPAL_ASSIST_ENABLED gates the whole surface.
 */

const gateway = require('../ai/ai-gateway');
const { toPlainText, plainTextStream } = require('./plain-text');

const FEATURE = 'opal_assist';
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 45000;

let _providerOverride = null;

function isEnabled() {
  return process.env.OPAL_ASSIST_ENABLED === 'true' && gateway.isAvailable(FEATURE);
}

function configError() {
  if (process.env.OPAL_ASSIST_ENABLED !== 'true') return 'feature_disabled';
  return gateway.unavailableReason(FEATURE);
}

const clampInt = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

function mapError(err, where) {
  if (err instanceof gateway.AiPolicyError) return new Error('provider_error');
  if (err?.message === 'guardrail_intervened') return new Error('content_blocked');
  if (err?.message === 'guardrail_not_configured') return new Error('provider_error');
  if (err?.message === 'provider_error') return err;
  console.warn(`[assist-provider] ${where} failed (reason: ${err?.message || 'unknown'})`);
  return new Error('provider_error');
}

/**
 * Generate a reply. `onText` present ⇒ streaming. Returns { text }.
 * Throws Error('content_blocked') | Error('provider_error') only.
 */
async function generate({ system, messages, userId, organisationId, onText } = {}) {
  // Plain text only, whatever the model sends: streamed a line at a time, and the final text the same.
  const plain = typeof onText === 'function' ? plainTextStream(onText) : null;
  if (_providerOverride) {
    const r = await _providerOverride({ system, messages, ...(plain ? { onText: plain.push } : {}) });
    if (plain) plain.flush();
    return { ...r, text: toPlainText(r && r.text).trim() };
  }
  try {
    const res = await gateway.generate({
      feature: FEATURE,
      userId,
      organisationId,
      system,
      messages,
      maxTokens: clampInt(process.env.OPAL_ASSIST_MAX_OUTPUT_TOKENS, DEFAULT_MAX_TOKENS, 64, 8192),
      timeoutMs: clampInt(process.env.OPAL_ASSIST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5000, 120000),
      ...(plain ? { onText: plain.push } : {}),
    });
    if (plain) plain.flush();
    const text = toPlainText(res.text || '').trim();
    if (!text) throw new Error('empty_response');
    return { text };
  } catch (err) {
    throw mapError(err, onText ? 'stream' : 'request');
  }
}

function _setProviderForTests(fn) { _providerOverride = typeof fn === 'function' ? fn : null; }

module.exports = { FEATURE, generate, isEnabled, configError, _setProviderForTests };
