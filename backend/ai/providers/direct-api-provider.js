'use strict';

/**
 * DIRECT API PROVIDER — the vendor's public API, for waiver features only.
 *
 * Mirrors the Bedrock provider's signature and return shape so the gateway
 * cannot tell them apart. What it does NOT have is a guardrail, Australian
 * residency or managed-identity federation — which is exactly why the policy
 * engine only lets a feature reach it under a data residency waiver, and
 * refuses the waiver to any feature that can touch clinical content.
 *
 * Streaming is not implemented: the gateway denies a streaming request when
 * the provider has no invokeStream, and the only waiver feature uses tools,
 * which never stream.
 */

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../direct-api-config');

const PROVIDER_ID = 'anthropic-direct';

/** Where the request goes. Not a region: the vendor routes it. */
const SOURCE_REGION = 'vendor-global';

const SILENT_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };

let _client = null;
let _clientKey = null;

function getClient(timeout) {
  const key = config.apiKey();
  if (!key) throw new Error('direct_api_not_configured');
  const cacheKey = `${timeout}|${key.length}`;
  if (_client && _clientKey === cacheKey) return _client;
  _client = new Anthropic({ apiKey: key, timeout, maxRetries: 1, logger: SILENT_LOGGER });
  _clientKey = cacheKey;
  return _client;
}

/**
 * @returns {Promise<{text: string|null, toolUse: object|null, providerRequestId: string|null, sourceRegion: string, usage: object}>}
 */
async function invoke({ model, system, messages, maxTokens, timeoutMs, tools, toolChoice } = {}) {
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  let res;
  try {
    const client = getClient(timeoutMs);
    res = await client.messages.create(body);
  } catch (err) {
    if (err?.message === 'direct_api_not_configured') throw err;
    // Status only. The body may contain whatever the Owner typed.
    console.warn(`[direct-api-provider] request failed (status: ${err?.status || 'none'})`);
    throw new Error('provider_error');
  }

  const blocks = Array.isArray(res?.content) ? res.content : [];
  const text = blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim() || null;
  const toolUse = blocks.find((b) => b && b.type === 'tool_use') || null;

  return {
    text,
    toolUse,
    usage: {
      inputTokens: Number.isFinite(res?.usage?.input_tokens) ? res.usage.input_tokens : null,
      outputTokens: Number.isFinite(res?.usage?.output_tokens) ? res.usage.output_tokens : null,
    },
    providerRequestId: res?._request_id || null,
    sourceRegion: SOURCE_REGION,
  };
}

/** Test seam: drop the cached client so a new key or timeout takes effect. */
function _resetForTests() { _client = null; _clientKey = null; }

module.exports = { PROVIDER_ID, SOURCE_REGION, invoke, _resetForTests };
