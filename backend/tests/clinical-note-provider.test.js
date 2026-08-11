'use strict';

/**
 * Clinical note generation — feature-level behaviour.
 *
 * The jurisdiction, model-approval and audit guarantees are the gateway's and
 * are tested in tests/ai-gateway.test.js. What this file covers is what the
 * feature itself owns: fail-closed behaviour, that a policy refusal never
 * degrades into a call, that the transcript survives failure, and that the
 * saved provenance does not overstate what it knows.
 */

const provider = require('../clinical-note-provider');
const gateway = require('../ai/ai-gateway');
const audit = require('../ai/ai-audit');
const mockProvider = require('../ai/providers/mock-provider');

const ENV_KEYS = ['CLINICAL_NOTE_AI_ENABLED', 'AI_AWS_REGION'];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  ENV_KEYS.forEach((k) => delete process.env[k]);
  provider._setProviderForTests(null);
  audit._setSinkForTests(async () => {});
  mockProvider._setHandlerForTests(null);
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
  provider._setProviderForTests(null);
  audit._setSinkForTests(null);
  mockProvider._setHandlerForTests(null);
});

// ── Fail-closed ─────────────────────────────────────────────────────────────

test('off by default — the feature flag alone gates generation', () => {
  expect(provider.isEnabled()).toBe(false);
  expect(provider.configError()).toBe('feature_disabled');

  process.env.CLINICAL_NOTE_AI_ENABLED = 'false';
  expect(provider.isEnabled()).toBe(false);
});

test('enabled with default configuration, which is onshore', () => {
  process.env.CLINICAL_NOTE_AI_ENABLED = 'true';
  expect(provider.configError()).toBeNull();
  expect(provider.isEnabled()).toBe(true);
});

test('a non-Australian region disables the feature rather than routing offshore', () => {
  process.env.CLINICAL_NOTE_AI_ENABLED = 'true';
  process.env.AI_AWS_REGION = 'us-east-1';

  expect(provider.isEnabled()).toBe(false);
  expect(provider.configError()).toBe('region_not_australian:us-east-1');
});

test('a refused configuration throws generation_disabled, keeping the transcript recoverable', async () => {
  process.env.CLINICAL_NOTE_AI_ENABLED = 'true';
  process.env.AI_AWS_REGION = 'eu-west-1';

  // The route turns this into a 503 and the therapist keeps their dictation.
  // What must NOT happen is the request going anywhere.
  await expect(provider.generateCaseNote({
    transcript: 'Synthetic QA dictation.',
    styleVersion: 'OPAL_CASE_NOTE_STYLE_V1',
    session: { dateLabel: '10/08/2026', serviceLabel: 'Therapy Session' },
  })).rejects.toThrow('generation_disabled');
});

test('an unknown style version fails before anything is transmitted', async () => {
  process.env.CLINICAL_NOTE_AI_ENABLED = 'true';
  let reached = false;
  mockProvider._setHandlerForTests(async () => { reached = true; return { text: null, toolUse: null }; });

  await expect(provider.generateCaseNote({
    transcript: 'Synthetic QA dictation.',
    styleVersion: 'NOT_A_REAL_STYLE',
    session: { dateLabel: '10/08/2026' },
  })).rejects.toThrow('provider_error');

  expect(reached).toBe(false);
});

// ── Structured output ───────────────────────────────────────────────────────

test('validateResult enforces shape, types and size caps', () => {
  expect(() => provider.validateResult(null)).toThrow('malformed');
  expect(() => provider.validateResult({ identify: '', sessionDetails: 'x', plan: [], warnings: [] })).toThrow('malformed');
  expect(() => provider.validateResult({ identify: 'a', sessionDetails: 'b', plan: 'no', warnings: [] })).toThrow('malformed');

  const cleaned = provider.validateResult({
    identify: '  Client attended.  ',
    sessionDetails: 'Worked on transfers.',
    plan: ['  Review next week  ', '', 42, 'Order equipment'],
    warnings: ['x'.repeat(500)],
  });

  expect(cleaned.identify).toBe('Client attended.');
  expect(cleaned.plan).toEqual(['Review next week', 'Order equipment']);
  expect(cleaned.warnings[0].length).toBeLessThanOrEqual(200);
});

test('a response missing the forced tool call is treated as malformed', async () => {
  process.env.CLINICAL_NOTE_AI_ENABLED = 'true';
  mockProvider._setHandlerForTests(async () => ({
    text: 'here is your note', toolUse: null, providerRequestId: 'r', sourceRegion: 'ap-southeast-2',
  }));

  // Prose where a structure was required means the contract was not met.
  // Accepting it would put unvalidated model text into a clinical draft.
  //
  // modelKey: 'mock' routes through the real gateway to the mock provider.
  // Without it this feature resolves to its policy default, which is a Bedrock
  // model — so the handler stubbed above was never consulted and the assertion
  // was satisfied by the SDK call failing for want of credentials. It passed,
  // but not for the reason it claimed, and it would have gone on passing if
  // the malformed-response branch were deleted.
  await expect(provider.generateCaseNote({
    transcript: 'Synthetic QA dictation.',
    styleVersion: 'OPAL_CASE_NOTE_STYLE_V1',
    session: { dateLabel: '10/08/2026' },
    modelKey: 'mock',
  })).rejects.toThrow('provider_error');
});

// ── Provenance ──────────────────────────────────────────────────────────────

test('provenance records the SOURCE region, and says so', () => {
  process.env.CLINICAL_NOTE_AI_ENABLED = 'true';
  process.env.AI_AWS_REGION = 'ap-southeast-4';
  const { providerId, modelId } = provider.providerIdentity();

  // The `src=` marker is load-bearing. A geo profile sourced from one
  // Australian region may be processed in the other, so this must not read as
  // proof of the processing location — CloudTrail's
  // additionalEventData.inferenceRegion is the authoritative record.
  expect(providerId).toBe('aws-bedrock:src=ap-southeast-4');
  expect(providerId).toContain('src=');
  expect(modelId).toBe('au.anthropic.claude-opus-4-8');

  // provider_id VARCHAR(40) / model_id VARCHAR(80) in migration 017.
  expect(providerId.length).toBeLessThanOrEqual(40);
  expect(modelId.length).toBeLessThanOrEqual(80);
});

test('provenance reports unavailable rather than inventing a region', () => {
  process.env.AI_AWS_REGION = 'us-east-1';
  const { providerId, modelId } = provider.providerIdentity();
  expect(providerId).toBe('unavailable');
  expect(modelId).toBe('unavailable');
});

// ── The gateway is the only path ────────────────────────────────────────────

test('the feature declares a policy the gateway recognises', () => {
  expect(provider.FEATURE).toBe('clinical_note_generation');
  expect(gateway.evaluate({ feature: provider.FEATURE }).ok).toBe(true);
});
