'use strict';

/**
 * BEDROCK PROVIDER — the only file in the backend that may import an AI SDK.
 *
 * Enforced by tests/ai-gateway-boundary.test.js, which fails if any AI SDK
 * import or vendor endpoint appears outside backend/ai/providers/.
 *
 * Transport only. This module makes no policy decisions: which model, which
 * region and whether the call is permitted at all are settled by the gateway
 * before it is reached. It exists to turn an already-approved request into an
 * HTTPS call and a normalised response.
 *
 * Two things are deliberate:
 *
 * 1. `AnthropicBedrock`, not `AnthropicBedrockMantle`. Australian geo
 *    inference profiles (`au.anthropic.*`) exist only on the
 *    `bedrock-runtime` endpoint; on `bedrock-mantle` the geo inference id is
 *    documented as N/A. The Mantle client has nicer ergonomics and cannot do
 *    the one thing this system requires.
 *
 * 2. No STATIC credentials are read here, and none exist. On Azure App Service
 *    the module obtains short-lived credentials through the federation
 *    exchange (managed identity → Entra → STS AssumeRoleWithWebIdentity);
 *    anywhere without a managed identity it hands the SDK nothing and the
 *    standard AWS chain resolves a local profile. There is no key in the
 *    environment, no key on disk, and no fallback that would accept one.
 *    Credentials pass through this file into the client and are never logged,
 *    serialised or returned.
 *
 * Errors are sanitised to Error('provider_error') after a status-only warn.
 * Request and response bodies carry clinical narrative and must never reach a
 * log line.
 */

const { AnthropicBedrock } = require('@anthropic-ai/bedrock-sdk');
const bedrockConfig = require('../aws/bedrock-config');
const awsConfig = require('../aws/bedrock-config');
const credentials = require('../aws/credential-provider');

const PROVIDER_ID = 'aws-bedrock';

/**
 * Bedrock applies a guardrail to InvokeModel through request headers. They are
 * sent per-request rather than as client `defaultHeaders` because the client
 * is cached by `${region}|${timeout}` — headers baked into a cached client
 * would outlive a configuration change and could not be varied per call.
 *
 * Custom headers are merged before SigV4 signing, so they are covered by the
 * signature rather than stripped or rejected.
 *
 * GuardrailTrace is deliberately NOT sent. The trace echoes the matched
 * content back in the response — which for this application means the
 * clinical narrative that tripped the filter, returned into a code path whose
 * entire job is to avoid holding exactly that.
 */
const GUARDRAIL_ID_HEADER = 'X-Amzn-Bedrock-GuardrailIdentifier';
const GUARDRAIL_VERSION_HEADER = 'X-Amzn-Bedrock-GuardrailVersion';

/**
 * Did the guardrail stop this?
 *
 * An intervention is NOT an error. It arrives as HTTP 200 carrying masked or
 * substituted content, so a caller that only inspects `content` gets a
 * plausible-looking result and files it as a clinical note. That is the
 * failure this function exists to prevent, which is why it checks several
 * shapes: the documented top-level marker, a guardrail stop reason, and the
 * camelCase spelling. A false positive costs one refused generation. A false
 * negative puts guardrail-masked text into a participant's file.
 */
function guardrailIntervened(res) {
  if (!res || typeof res !== 'object') return false;
  const marker = res['amazon-bedrock-guardrailAction']
    ?? res.amazonBedrockGuardrailAction
    ?? res?.amazon_bedrock_guardrailAction;
  if (String(marker || '').toUpperCase() === 'INTERVENED') return true;
  return /guardrail/i.test(String(res.stop_reason || ''));
}

/**
 * Did this failure come from the guardrail rather than the transport?
 *
 * Tested against the error TYPE and a bounded slice of its message. Bedrock's
 * validation errors name the guardrail when one is misapplied, and those must
 * be distinguishable from a network fault so the caller can refuse rather than
 * invite a retry.
 */
function guardrailError(err) {
  const haystack = [
    err?.error?.type, err?.error?.message, err?.name, err?.message,
  ].filter((v) => typeof v === 'string').join(' ').slice(0, 500);
  return /guardrail/i.test(haystack);
}

let _client = null;
let _clientKey = null;

/**
 * Discards SDK-internal logging. The Anthropic SDK honours ANTHROPIC_LOG, and
 * at debug level it prints request bodies — which here means the verbatim
 * dictated transcript and the system prompt. An environment variable must not
 * be able to put clinical narrative on stdout, where it lands in Azure log
 * streams and stays there.
 *
 * Our own error path already logs status codes only.
 */
const SILENT_LOGGER = {
  debug() {}, info() {}, warn() {}, error() {},
};

/**
 * Obtain AWS credentials for this call.
 *
 * On Azure App Service the platform injects a managed identity, and the only
 * sanctioned path to AWS is the federation exchange: managed identity → Entra
 * JWT → STS AssumeRoleWithWebIdentity → temporary credentials. There is no
 * static-key fallback, by design.
 *
 * Anywhere without a managed identity — a developer machine, CI — this returns
 * null and the SDK falls back to the standard AWS credential chain (a local
 * profile). That is why the check is on the platform's identity endpoint
 * rather than on NODE_ENV: it describes what is actually available rather than
 * what the build thinks it is.
 *
 * A federation failure propagates. The alternative would be falling through to
 * the default chain, which on App Service finds nothing and produces a
 * confusing auth error instead of an honest "federation is broken".
 */
async function resolveCredentials() {
  if (!awsConfig.hasManagedIdentity()) return null;
  return credentials.getCredentials();
}

async function getClient(region, timeout) {
  const creds = await resolveCredentials();

  // The credential's own identifier is part of the cache key, so a client
  // never outlives the credentials it was built with. STS sessions are
  // one-hour; without this the cached client would keep presenting expired
  // credentials until the process restarted, and every clinical generation
  // would fail with an auth error that looks nothing like an expiry.
  const key = `${region}|${timeout}|${creds ? creds.accessKeyId : 'default-chain'}`;
  if (_client && _clientKey === key) return _client;

  _client = new AnthropicBedrock({
    awsRegion: region,
    ...(creds ? {
      awsAccessKey: creds.accessKeyId,
      awsSecretKey: creds.secretAccessKey,
      awsSessionToken: creds.sessionToken,
    } : {}),
    // PINNED, not inherited. Without an explicit baseURL the SDK falls back to
    // ANTHROPIC_BEDROCK_BASE_URL, and awsRegion only sets the SigV4 signing
    // scope — so an environment variable could send every clinical transcript
    // to us-east-1 (or an arbitrary host) while the gateway, the audit row and
    // the health endpoint all still reported ap-southeast-2. The destination
    // must be derived from the region the policy engine approved, in code.
    baseURL: `https://bedrock-runtime.${region}.amazonaws.com`,
    logger: SILENT_LOGGER,
    timeout,
    // The caller surfaces a clean error and keeps the user's input; a retry
    // storm on a clinical request helps nobody.
    maxRetries: 1,
  });
  _clientKey = key;
  return _client;
}

/** Exposed so the self-check can assert the destination is code-controlled. */
function expectedBaseUrl(region) {
  return `https://bedrock-runtime.${region}.amazonaws.com`;
}

/**
 * Invoke an approved model.
 *
 * @param {object} opts
 * @param {string}  opts.model      resolved model id (an `au.` profile)
 * @param {string}  opts.region     AWS region to send from
 * @param {string}  [opts.system]   system prompt
 * @param {Array}   opts.messages   [{ role, content }]
 * @param {number}  opts.maxTokens
 * @param {number}  opts.timeoutMs
 * @param {Array}   [opts.tools]        tool definitions, when forcing structure
 * @param {object}  [opts.toolChoice]   e.g. { type: 'tool', name: 'case_note' }
 * @returns {Promise<{text: string|null, toolUse: object|null, providerRequestId: string|null, sourceRegion: string}>}
 */
async function invoke({
  model, region, system, messages, maxTokens, timeoutMs, tools, toolChoice, stream,
} = {}) {
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  // FAIL CLOSED BEFORE ANY TRANSMISSION.
  //
  // Without the guardrail headers this request still succeeds, and returns a
  // draft indistinguishable from a guarded one — no field marks it, the audit
  // row looks the same, the therapist sees the same screen. There is no later
  // point at which the omission becomes visible, so the only place it can be
  // caught is here, before the content leaves.
  const guardrail = bedrockConfig.resolveGuardrail();
  if (!guardrail.ok) {
    console.warn(`[bedrock-provider] refusing to invoke — guardrail unresolved (reason: ${guardrail.reason})`);
    throw new Error('guardrail_not_configured');
  }

  // STREAMING IS REFUSED, and this is a safety control rather than a missing
  // feature.
  //
  // AWS emits the guardrail intervention marker as a trailing chunk carrying
  // no `type` field, and the SDK's event accumulator drops chunks it cannot
  // type. The marker therefore never reaches the assembled message: under
  // streaming, guardrailIntervened() below returns false for a response the
  // guardrail actually stopped. It fails OPEN, silently, and the masked text
  // would be composed into a clinical draft.
  //
  // Nothing streams today, so this cannot fire now. It exists because the
  // person who later adds streaming for a nicer typing effect will have no
  // reason to suspect any of the above, and the failure it produces is
  // invisible. Making it a loud refusal is the only version of this that
  // survives being forgotten.
  // Checked on the ARGUMENT, not on `body` — `stream` is deliberately never
  // copied into the request body, so reading it there would make this guard
  // look present while never firing.
  if (stream) throw new Error('streaming_not_permitted_with_guardrail');

  try {
    const client = await getClient(region, timeoutMs);
    const res = await client.messages.create(body, {
      headers: {
        [GUARDRAIL_ID_HEADER]: guardrail.id,
        [GUARDRAIL_VERSION_HEADER]: guardrail.version,
      },
    });

    // Checked BEFORE the content is read, so masked text has no path to a
    // caller that might compose it into a note.
    if (guardrailIntervened(res)) throw new Error('guardrail_intervened');

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
      // Correlates this call to its CloudTrail entry, which is where the
      // authoritative processing region lives
      // (additionalEventData.inferenceRegion). The geo profile may process a
      // Sydney-sourced request in Melbourne; both are Australian, but only
      // CloudTrail records which.
      providerRequestId: res?._request_id || null,
      sourceRegion: region,
    };
  } catch (err) {
    // Thrown by the check above — a decision, not a failure. Re-thrown intact
    // so the gateway can distinguish it; collapsing it into provider_error is
    // what would put a Retry button in front of a refusal.
    if (err?.message === 'guardrail_intervened') throw err;
    if (guardrailError(err)) throw new Error('guardrail_intervened');

    const status = err?.status
      || err?.response?.status
      || (err?.name === 'APIConnectionTimeoutError' || err?.code === 'ETIMEDOUT' ? 'timeout' : 'network');
    console.warn(`[bedrock-provider] request failed (region: ${region}, status: ${status})`);
    throw new Error('provider_error');
  }
}

/** Drop the cached client — used by tests that change region between cases. */
function _resetForTests() {
  _client = null;
  _clientKey = null;
}

module.exports = { PROVIDER_ID, invoke, expectedBaseUrl, _resetForTests };
