'use strict';

/**
 * MOCK PROVIDER — deterministic, offline, no SDK, no network.
 *
 * Lets the gateway, policy engine and every feature above them be exercised
 * without AWS credentials. That matters for more than convenience: it means
 * the security tests proving that clinical data cannot route offshore can run
 * in CI, on a laptop, and in a build container, none of which should hold
 * credentials to a clinical AI account.
 *
 * It is registered as an approved model so it passes policy, but it is
 * resident nowhere and reaches nothing. Do not use it for real clinical work
 * — it returns fixed strings, not clinical reasoning.
 */

const PROVIDER_ID = 'mock';

let _handler = null;

/**
 * Mirrors the bedrock provider's signature and return shape so the gateway
 * cannot tell them apart.
 */
async function invoke({ model, region, system, messages, tools, toolChoice } = {}) {
  if (_handler) {
    return _handler({ model, region, system, messages, tools, toolChoice });
  }

  // Forced tool use: answer with an empty-but-valid structure so callers
  // exercise their own validation rather than a happy path.
  if (toolChoice && toolChoice.type === 'tool') {
    return {
      text: null,
      toolUse: { type: 'tool_use', name: toolChoice.name, input: {} },
      providerRequestId: 'mock-request-id',
      sourceRegion: region,
      // Mirrors the Bedrock provider's shape, with nulls rather than invented
      // counts: a mock that reports plausible token usage would let a cost
      // assertion pass against numbers nobody was billed for.
      usage: { inputTokens: null, outputTokens: null },
    };
  }

  return {
    text: '[mock provider response]',
    toolUse: null,
    providerRequestId: 'mock-request-id',
    sourceRegion: region,
    usage: { inputTokens: null, outputTokens: null },
  };
}

/**
 * Streaming mirror of invoke(): resolves the same response, but delivers the
 * text through `onText` in two chunks first, so callers genuinely exercise
 * their incremental path rather than receiving one blob that happens to work.
 */
async function invokeStream(opts = {}) {
  const { onText } = opts;
  if (typeof onText !== 'function') throw new Error('stream_requires_onText');
  const res = await invoke(opts);
  const text = res.text || '';
  if (text) {
    const mid = Math.ceil(text.length / 2);
    onText(text.slice(0, mid));
    onText(text.slice(mid));
  }
  return res;
}

/** Supply a deterministic response for a specific test. */
function _setHandlerForTests(fn) {
  _handler = typeof fn === 'function' ? fn : null;
}

module.exports = { PROVIDER_ID, invoke, invokeStream, _setHandlerForTests };
