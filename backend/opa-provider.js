'use strict';

/**
 * OPA AI PROVIDER — model access behind one narrow seam.
 *
 * The only place in the backend that talks to the Anthropic API. Everything
 * upstream (routes, prompt building, knowledge retrieval) treats this as an
 * opaque `generateOpaResponse` function so tests can swap it out with
 * `_setProviderForTests` and no test ever needs the network.
 *
 * Fail-closed: isEnabled() requires BOTH the explicit OPA_AI_ENABLED='true'
 * flag AND a configured ANTHROPIC_API_KEY. Credentials live server-side only
 * and are never logged — provider failures surface as a sanitised
 * Error('provider_error') after a status-only console.warn.
 *
 * Env:
 *   OPA_AI_ENABLED            'true' to enable (default off)
 *   ANTHROPIC_API_KEY         server-side credential (never logged)
 *   OPA_MODEL                 default 'claude-sonnet-5'
 *   OPA_MAX_OUTPUT_TOKENS     default 1024 (clamped 64..4096)
 *   OPA_REQUEST_TIMEOUT_MS    default 25000 (clamped 1000..60000)
 */

const axios = require('axios');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 25000;

// Test seam: when set, generateOpaResponse delegates to this function.
let _providerOverride = null;

function isEnabled() {
  return process.env.OPA_AI_ENABLED === 'true' && !!process.env.ANTHROPIC_API_KEY;
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
  const configured = clampInt(process.env.OPA_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 60000);
  if (requested === undefined || requested === null) return configured;
  return clampInt(requested, configured, 1000, 60000);
}

/**
 * Call the model. Returns { text }. Throws sanitised Error('provider_error')
 * on any failure (network, timeout, non-2xx, malformed body) — callers never
 * see provider internals and nothing sensitive is ever logged.
 *
 * @param {object} opts
 * @param {string} opts.system     system prompt
 * @param {Array}  opts.messages   [{ role: 'user'|'assistant', content: string }]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 */
async function generateOpaResponse({ system, messages, maxTokens, timeoutMs } = {}) {
  if (_providerOverride) {
    return _providerOverride({ system, messages, maxTokens, timeoutMs });
  }

  const timeout = requestTimeoutMs(timeoutMs);
  // Belt and braces: axios `timeout` covers the response clock; the abort
  // controller guarantees the socket is torn down even mid-stream.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeout + 500);
  if (abortTimer.unref) abortTimer.unref();

  try {
    const res = await axios.post(
      ANTHROPIC_URL,
      {
        model: process.env.OPA_MODEL || 'claude-sonnet-5',
        max_tokens: maxOutputTokens(maxTokens),
        system,
        messages,
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        timeout,
        signal: controller.signal,
      }
    );

    const blocks = Array.isArray(res.data?.content) ? res.data.content : [];
    const text = blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!text) throw new Error('empty_response');
    return { text };
  } catch (err) {
    // Status only — never the error body, headers or key.
    const status = err?.response?.status
      || (err?.code === 'ECONNABORTED' || err?.name === 'CanceledError' ? 'timeout' : 'network');
    console.warn(`[opa-provider] request failed (status: ${status})`);
    throw new Error('provider_error');
  } finally {
    clearTimeout(abortTimer);
  }
}

/**
 * Replace the generate implementation for tests. Pass a function to override,
 * or null to restore the real provider.
 */
function _setProviderForTests(fn) {
  _providerOverride = typeof fn === 'function' ? fn : null;
}

module.exports = { generateOpaResponse, isEnabled, _setProviderForTests };
