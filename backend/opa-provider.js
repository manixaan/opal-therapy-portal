'use strict';

/**
 * OPA AI PROVIDER — the assistant's model access, behind the AI gateway.
 *
 * Everything upstream (routes, prompt building, knowledge retrieval) still
 * treats this as an opaque `generateOpaResponse` so tests can swap it out
 * with `_setProviderForTests` and no test ever touches a network.
 *
 * ── WHY OPA MOVED ONSHORE ─────────────────────────────────────────────────
 * Opa is documented as a feature-knowledge assistant that receives no
 * clinical content, and it previously called the Anthropic API in the US on
 * the strength of that boundary. That reasoning was weak. A chat box inside
 * a clinical portal will eventually be asked to "summarise what happened with
 * Johan today", whatever the interface says, and a documented boundary is a
 * policy rather than a control.
 *
 * So Opa's policy (backend/ai/ai-policy.js → opa_assistant) declares the
 * classification the feature can *receive*, not the one it is supposed to,
 * and routes through the same Australian Bedrock path as clinical
 * documentation. Accidentally typing clinical content into Opa now changes
 * nothing about where the data goes.
 *
 * humanReview is false — Opa answers questions rather than producing records,
 * and nothing it returns becomes clinical documentation. If that ever
 * changes, the policy must change with it.
 *
 * Fail-closed: isEnabled() requires OPA_AI_ENABLED='true' AND a gateway
 * configuration that satisfies policy. Failures surface as a sanitised
 * Error('provider_error') after a status-only warn — never the body, which
 * may contain whatever the therapist typed.
 *
 * Env:
 *   OPA_AI_ENABLED            'true' to enable (default off)
 *   OPA_MAX_OUTPUT_TOKENS     default 1024 (clamped 64..4096)
 *   OPA_REQUEST_TIMEOUT_MS    default 25000 (clamped 5000..60000)
 * Model and region are gateway/policy concerns — see AWS_REGION.
 */

const gateway = require('./ai/ai-gateway');

const FEATURE = 'opa_assistant';

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 25000;

// Test seam: when set, generateOpaResponse delegates to this function.
let _providerOverride = null;

function isEnabled() {
  return process.env.OPA_AI_ENABLED === 'true' && gateway.isAvailable(FEATURE);
}

/** Why Opa is unavailable, or null. Safe to log. */
function configError() {
  if (process.env.OPA_AI_ENABLED !== 'true') return 'feature_disabled';
  return gateway.unavailableReason(FEATURE);
}

const clampInt = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

function maxOutputTokens(requested) {
  const configured = clampInt(process.env.OPA_MAX_OUTPUT_TOKENS, DEFAULT_MAX_TOKENS, 64, 4096);
  if (requested === undefined || requested === null) return configured;
  return clampInt(requested, configured, 64, 4096);
}

function requestTimeoutMs(requested) {
  const configured = clampInt(process.env.OPA_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5000, 60000);
  if (requested === undefined || requested === null) return configured;
  return clampInt(requested, configured, 5000, 60000);
}

/**
 * Call the model. Returns { text }. Throws sanitised Error('provider_error')
 * on any failure — callers never see provider internals and nothing
 * sensitive is ever logged.
 *
 * @param {object} opts
 * @param {string} opts.system     system prompt
 * @param {Array}  opts.messages   [{ role: 'user'|'assistant', content: string }]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.userId]   audit actor
 * @param {string} [opts.organisationId]
 */
async function generateOpaResponse({ system, messages, maxTokens, timeoutMs, userId, organisationId } = {}) {
  if (_providerOverride) {
    return _providerOverride({ system, messages, maxTokens, timeoutMs });
  }

  try {
    const res = await gateway.generate({
      feature: FEATURE,
      userId,
      organisationId,
      system,
      messages,
      maxTokens: maxOutputTokens(maxTokens),
      timeoutMs: requestTimeoutMs(timeoutMs),
    });

    const text = (res.text || '').trim();
    if (!text) throw new Error('empty_response');
    return { text };
  } catch (err) {
    if (err instanceof gateway.AiPolicyError) {
      // Already audited by the gateway with its reason code.
      throw new Error('provider_error');
    }
    // A guardrail refusal must stay distinguishable from a transport failure.
    // Opa's policy permits clinical_document output, so an intervention here is
    // possible — and collapsing it into provider_error would tell the user to
    // "try again in a moment", which invites them to resubmit content a control
    // has already declined.
    if (err?.message === 'guardrail_intervened') throw new Error('content_blocked');
    if (err?.message === 'guardrail_not_configured') throw new Error('provider_error');
    if (err?.message === 'provider_error') throw err;
    console.warn(`[opa-provider] request failed (reason: ${err?.message || 'unknown'})`);
    throw new Error('provider_error');
  }
}

/**
 * Replace the generate implementation for tests. Pass a function to override,
 * or null to restore the real provider.
 */
function _setProviderForTests(fn) {
  _providerOverride = typeof fn === 'function' ? fn : null;
}

module.exports = { FEATURE, generateOpaResponse, isEnabled, configError, _setProviderForTests };
