'use strict';

/**
 * STREAMING — the narrower privilege, and its fail-closed edges.
 *
 * invoke() refuses `stream: true` because the SDK's event ACCUMULATOR drops
 * the guardrail intervention marker (an untyped trailing chunk) — that guard
 * is pinned in ai-bedrock-guardrail.test.js and stays. invokeStream() exists
 * because the hazard is in the accumulator, not in streaming itself: it
 * iterates the RAW events and treats anything it cannot recognise as an
 * intervention. This suite pins the properties that make that safe:
 *
 *   - the gateway confines streaming to assistant_response output — a
 *     clinical document is NEVER streamed, and the refusal is a policy
 *     denial, audited like every other denial;
 *   - an unrecognised chunk, or any chunk carrying a guardrail marker,
 *     aborts the stream as 'guardrail_intervened' — unknown fails CLOSED;
 *   - the guardrail headers are still sent, and an unresolved guardrail
 *     still refuses before any transmission;
 *   - deltas reach the caller and the assembled text matches what streamed.
 *
 * The SDK is mocked; nothing touches the network, AWS, or Azure.
 */

const mockBedrockState = { nextResult: null, calls: [] };

jest.mock('@anthropic-ai/bedrock-sdk', () => ({
  AnthropicBedrock: class {
    constructor() {
      this.messages = {
        create: async (body, opts) => {
          mockBedrockState.calls.push({ body, opts });
          return mockBedrockState.nextResult;
        },
      };
    }
  },
}));

const gateway = require('../ai/ai-gateway');
const audit = require('../ai/ai-audit');
const killSwitch = require('../ai/ai-kill-switch');
const mockProvider = require('../ai/providers/mock-provider');
const bedrock = require('../ai/providers/bedrock-provider');
const registry = require('../ai/ai-model-registry');

const SYNTHETIC_PROFILE = 'au.anthropic.test-profile-synthetic';
const ENV_KEYS = ['AWS_REGION', 'BEDROCK_MODEL_ID', 'BEDROCK_GUARDRAIL_ID',
  'BEDROCK_GUARDRAIL_VERSION', 'AI_GLOBAL_DISABLE'];
let saved;
let events;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.AWS_REGION = 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = SYNTHETIC_PROFILE;
  process.env.BEDROCK_GUARDRAIL_ID = 'abcd1234efgh';
  process.env.BEDROCK_GUARDRAIL_VERSION = '1';
  delete process.env.AI_GLOBAL_DISABLE;
  events = [];
  audit._setSinkForTests(async (payload) => { events.push(payload); });
  mockProvider._setHandlerForTests(null);
  killSwitch._setReaderForTests(async () => 'true');
  mockBedrockState.nextResult = null;
  mockBedrockState.calls = [];
  bedrock._resetForTests();
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
  audit._setSinkForTests(null);
  mockProvider._setHandlerForTests(null);
  killSwitch._setReaderForTests(null);
  bedrock._resetForTests();
});

/** An async iterable of raw stream events, as the mocked SDK returns. */
const eventStream = (list) => ({
  async* [Symbol.asyncIterator]() { yield* list; },
});

const CLEAN_EVENTS = [
  { type: 'message_start', message: { usage: { input_tokens: 42 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Create batch ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'drafts the invoices.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
  { type: 'message_stop' },
];

// ── Gateway: streaming is a policy decision ──────────────────────────────────

describe('the gateway confines streaming', () => {
  test('DENIED: a clinical document cannot stream, and the denial is audited', async () => {
    await expect(gateway.generate({
      feature: 'opa_assistant',
      outputType: 'clinical_document',
      modelKey: 'mock',
      messages: [{ role: 'user', content: 'Write a progress summary.' }],
      onText: () => {},
    })).rejects.toMatchObject({ name: 'AiPolicyError', reason: 'streaming_not_permitted_for_output_type' });

    const event = events[events.length - 1].event;
    expect(event.status).toBe('denied');
    expect(event.denyReason).toBe('streaming_not_permitted_for_output_type');
  });

  test('DENIED: streaming with tool use', async () => {
    await expect(gateway.generate({
      feature: 'opa_assistant',
      modelKey: 'mock',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 't' }],
      onText: () => {},
    })).rejects.toMatchObject({ reason: 'streaming_not_permitted_with_tools' });
  });

  test('ALLOWED: an assistant response streams, deltas reassemble, and success is audited', async () => {
    mockProvider._setHandlerForTests(async () => ({
      text: 'How the Calendar works.',
      toolUse: null,
      providerRequestId: 'mock-request-id',
      sourceRegion: 'ap-southeast-2',
      usage: { inputTokens: null, outputTokens: null },
    }));
    const deltas = [];
    const res = await gateway.generate({
      feature: 'opa_assistant',
      modelKey: 'mock',
      messages: [{ role: 'user', content: 'How does the calendar work?' }],
      onText: (t) => deltas.push(t),
    });
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe('How the Calendar works.');
    expect(res.text).toBe('How the Calendar works.');
    expect(events[events.length - 1].event.status).toBe('generated');
  });

  test('opa_assistant defaults to the assistant_fast tier', () => {
    const decision = gateway.evaluate({ feature: 'opa_assistant' });
    expect(decision.ok).toBe(true);
    expect(decision.modelKey).toBe('assistant_fast');
    // Falls back to the base profile until a dedicated one is configured.
    expect(decision.model.id).toBe(SYNTHETIC_PROFILE);
    expect(decision.model.residency).toBe('australia');
  });

  test('a dedicated fast profile wins over the base, under the same AU rules', () => {
    process.env.BEDROCK_MODEL_ID_ASSISTANT_FAST = 'au.anthropic.test-fast-synthetic';
    try {
      const decision = gateway.evaluate({ feature: 'opa_assistant' });
      expect(decision.ok).toBe(true);
      expect(decision.model.id).toBe('au.anthropic.test-fast-synthetic');
      // An offshore fast profile is refused outright, never fallen back from.
      process.env.BEDROCK_MODEL_ID_ASSISTANT_FAST = 'global.anthropic.fast';
      expect(gateway.evaluate({ feature: 'opa_assistant' }))
        .toMatchObject({ ok: false, reason: 'model_profile_not_au_geo' });
    } finally {
      delete process.env.BEDROCK_MODEL_ID_ASSISTANT_FAST;
    }
  });
});

// ── Provider: the raw stream fails closed ────────────────────────────────────

describe('invokeStream fails closed', () => {
  const streamCall = (onText) => bedrock.invokeStream({
    model: SYNTHETIC_PROFILE,
    region: 'ap-southeast-2',
    messages: [{ role: 'user', content: 'Synthetic QA question.' }],
    maxTokens: 256,
    timeoutMs: 5000,
    onText: onText || (() => {}),
  });

  test('a clean stream delivers deltas and the assembled text', async () => {
    mockBedrockState.nextResult = eventStream(CLEAN_EVENTS);
    const deltas = [];
    const res = await streamCall((t) => deltas.push(t));
    expect(deltas).toEqual(['Create batch ', 'drafts the invoices.']);
    expect(res.text).toBe('Create batch drafts the invoices.');
    expect(res.usage).toEqual({ inputTokens: 42, outputTokens: 9 });
    // The guardrail headers went with the request — scoped, never skipped.
    const { opts } = mockBedrockState.calls[0];
    expect(opts.headers['X-Amzn-Bedrock-GuardrailIdentifier']).toBe('abcd1234efgh');
    expect(opts.headers['X-Amzn-Bedrock-GuardrailVersion']).toBe('1');
  });

  test('an UNTYPED trailing chunk — the accumulator-dropped marker — refuses', async () => {
    // This is the exact chunk shape that made streaming fail open through the
    // SDK helper: no `type`, carrying the intervention marker.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockBedrockState.nextResult = eventStream([
        ...CLEAN_EVENTS,
        { 'amazon-bedrock-guardrailAction': 'INTERVENED' },
      ]);
      await expect(streamCall()).rejects.toThrow('guardrail_intervened');
    } finally {
      warn.mockRestore();
    }
  });

  test('an unrecognised event type refuses even WITHOUT a marker', async () => {
    // Unknown fails closed: a wire vocabulary change costs one refused
    // generation, never an unevaluated response passed through.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockBedrockState.nextResult = eventStream([
        CLEAN_EVENTS[0],
        { type: 'mystery_chunk', data: 'anything' },
      ]);
      await expect(streamCall()).rejects.toThrow('guardrail_intervened');
    } finally {
      warn.mockRestore();
    }
  });

  test('a guardrail stop reason on a TYPED event refuses', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockBedrockState.nextResult = eventStream([
        CLEAN_EVENTS[0], CLEAN_EVENTS[1], CLEAN_EVENTS[2],
        { type: 'message_delta', delta: { stop_reason: 'guardrail_intervened' }, usage: {} },
      ]);
      await expect(streamCall()).rejects.toThrow('guardrail_intervened');
    } finally {
      warn.mockRestore();
    }
  });

  test('an unresolved guardrail refuses before any transmission', async () => {
    delete process.env.BEDROCK_GUARDRAIL_ID;
    delete process.env.BEDROCK_GUARDRAIL_VERSION;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(streamCall()).rejects.toThrow('guardrail_not_configured');
      expect(mockBedrockState.calls).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  test('the refusal never logs the streamed text', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockBedrockState.nextResult = eventStream([
        ...CLEAN_EVENTS,
        { 'amazon-bedrock-guardrailAction': 'INTERVENED' },
      ]);
      await streamCall().catch(() => {});
      const logged = warn.mock.calls.flat().map(String).join(' ');
      expect(logged).not.toContain('Create batch');
      expect(logged).not.toContain('Synthetic QA question');
    } finally {
      warn.mockRestore();
    }
  });

  test('invoke() still refuses the stream flag — the original trap stays shut', async () => {
    await expect(bedrock.invoke({
      model: SYNTHETIC_PROFILE,
      region: 'ap-southeast-2',
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 64,
      timeoutMs: 5000,
      stream: true,
    })).rejects.toThrow('streaming_not_permitted_with_guardrail');
  });
});
