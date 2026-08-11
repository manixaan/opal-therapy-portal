'use strict';

/**
 * Guardrail configuration and enforcement.
 *
 * The property under test throughout: a Bedrock call without a resolved
 * guardrail must not happen. Not "should not" — must not, and the refusal has
 * to be visible, because an unguarded call succeeds and returns a draft
 * indistinguishable from a guarded one. There is no later signal.
 *
 * The AWS resources these identifiers point at were created through the
 * console and cannot be verified from here, so nothing below asserts that a
 * guardrail EXISTS in AWS — only that this code refuses to proceed without
 * being told which one to use, and refuses masked content if one intervenes.
 */

const config = require('../ai/aws/bedrock-config');
const registry = require('../ai/ai-model-registry');
const bedrock = require('../ai/providers/bedrock-provider');

const ENV_KEYS = [
  'BEDROCK_GUARDRAIL_ID',
  'BEDROCK_GUARDRAIL_VERSION',
  'BEDROCK_MODEL_ID',
  'AWS_REGION',
];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  ENV_KEYS.forEach((k) => delete process.env[k]);
  // Required with no default. The gateway refuses before it reaches any model
  // or guardrail logic, so without this every case in this file would fail on
  // region rather than on the thing it is testing.
  process.env.AWS_REGION = 'ap-southeast-2';
  bedrock._resetForTests();
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
  bedrock._resetForTests();
});

const setGuardrail = (id, version) => {
  if (id !== undefined) process.env.BEDROCK_GUARDRAIL_ID = id;
  if (version !== undefined) process.env.BEDROCK_GUARDRAIL_VERSION = version;
};

// ── Resolution ───────────────────────────────────────────────────────────────

describe('guardrail resolution', () => {
  test('a bare id and numeric version resolve', () => {
    setGuardrail('abcd1234efgh', '1');
    expect(config.resolveGuardrail()).toMatchObject({ ok: true, id: 'abcd1234efgh', version: '1' });
  });

  test('a full guardrail ARN resolves', () => {
    setGuardrail('arn:aws:bedrock:ap-southeast-2:123456789012:guardrail/abc123', '1');
    expect(config.resolveGuardrail().ok).toBe(true);
  });

  test('surrounding whitespace is tolerated — a pasted console value still works', () => {
    setGuardrail('  abcd1234efgh \n', ' 1 ');
    expect(config.resolveGuardrail()).toMatchObject({ ok: true, version: '1' });
  });

  test('nothing configured is reported as unconfigured, not as broken', () => {
    // The normal state in development and test. Distinguished from a
    // misconfiguration so the boot log can be honest about which it is.
    expect(config.resolveGuardrail()).toEqual({
      ok: false, reason: 'guardrail_not_configured', configured: false,
    });
  });

  test.each([
    ['id without version', 'abcd1234efgh', undefined, 'guardrail_version_missing'],
    ['version without id', undefined, '1', 'guardrail_id_missing'],
  ])('%s is a MISCONFIGURATION, not an absence', (_label, id, version, reason) => {
    // Half-configured is somebody part-way through the setup, and it is the
    // state most likely to be mistaken for finished.
    setGuardrail(id, version);
    expect(config.resolveGuardrail()).toMatchObject({ ok: false, reason, configured: true });
  });

  test.each([
    ['too short', 'ab', '1', 'guardrail_id_malformed'],
    ['illegal characters', 'abc$def!ghi', '1', 'guardrail_id_malformed'],
    ['a placeholder left in', 'YOUR_GUARDRAIL_ID', '1', 'guardrail_id_malformed'],
    ['non-numeric version', 'abcd1234efgh', 'v1', 'guardrail_version_malformed'],
    ['version as a word', 'abcd1234efgh', 'latest', 'guardrail_version_malformed'],
  ])('%s is refused', (_label, id, version, reason) => {
    setGuardrail(id, version);
    expect(config.resolveGuardrail()).toMatchObject({ ok: false, reason });
  });

  test('DRAFT resolves but is flagged as mutable', () => {
    setGuardrail('abcd1234efgh', 'DRAFT');
    const r = config.resolveGuardrail();
    expect(r).toMatchObject({ ok: true, isDraft: true });
  });

  test('a failure reason never carries the value that failed', () => {
    // These strings reach the health endpoint. A rule name is diagnostic; an
    // identifier is a disclosure of the account's internals.
    setGuardrail('secret-looking-value-$$$', '1');
    const r = config.resolveGuardrail();
    expect(r.reason).toBe('guardrail_id_malformed');
    expect(JSON.stringify(r)).not.toContain('secret-looking-value');
  });
});

// ── Inference profile ────────────────────────────────────────────────────────

describe('inference profile', () => {
  test('absent refuses — there is no registry default to fall back to', () => {
    // This used to resolve to `{ ok: true, id: null }`, meaning "use the
    // registry's built-in id". The registry no longer has one, so absent is a
    // refusal. `configured: false` marks it as "nothing supplied" rather than
    // "supplied and wrong", which is what keeps the mock path usable.
    expect(config.resolveModelProfile(registry))
      .toMatchObject({ ok: false, reason: 'model_profile_not_configured', configured: false });
  });

  test('an Australian geo profile is accepted', () => {
    process.env.BEDROCK_MODEL_ID = `${registry.AU_GEO_PREFIX}claude-sonnet-4-6`;
    expect(config.resolveModelProfile(registry).ok).toBe(true);
  });

  test.each([
    ['a global route', 'global.anthropic.claude-opus-4-8'],
    ['an APAC route', 'apac.anthropic.claude-sonnet-4-6'],
    ['a bare model id', 'anthropic.claude-sonnet-4-6'],
  ])('%s is refused — offshore routing cannot be introduced by configuration', (_l, id) => {
    process.env.BEDROCK_MODEL_ID = id;
    expect(config.resolveModelProfile(registry)).toMatchObject({
      ok: false, reason: 'model_profile_not_au_geo',
    });
  });

  test('a Covered Model cannot be reintroduced by configuration', () => {
    // These mandate retention and provider data sharing. The blocklist has to
    // hold against an environment variable, not only against a code edit.
    const blocked = Object.keys(registry.PERMANENTLY_BLOCKED)
      .find((id) => id.startsWith(registry.AU_GEO_PREFIX));
    process.env.BEDROCK_MODEL_ID = blocked;
    expect(config.resolveModelProfile(registry)).toMatchObject({
      ok: false, reason: 'model_profile_permanently_blocked',
    });
  });
});

// ── Enforcement at the transport ─────────────────────────────────────────────

describe('the provider refuses to transmit without a guardrail', () => {
  const invocation = () => bedrock.invoke({
    model: `${registry.AU_GEO_PREFIX}claude-opus-4-8`,
    region: 'ap-southeast-2',
    messages: [{ role: 'user', content: 'Synthetic QA dictation.' }],
    maxTokens: 512,
    timeoutMs: 5000,
  });

  test('an unconfigured guardrail throws before any network call', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(invocation()).rejects.toThrow('guardrail_not_configured');
    } finally {
      warn.mockRestore();
    }
  });

  test('a malformed guardrail throws before any network call', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      setGuardrail('!!!', '1');
      await expect(invocation()).rejects.toThrow('guardrail_not_configured');
    } finally {
      warn.mockRestore();
    }
  });

  test('streaming is refused outright, because the marker check fails open', async () => {
    // Under streaming the SDK drops the AWS trailing chunk carrying the
    // intervention marker (it has no `type` field), so guardrailIntervened()
    // would return false for a response the guardrail actually stopped —
    // masked text composed into a clinical draft, with no signal anywhere.
    // Nothing streams today; this asserts the trap stays shut.
    setGuardrail('abcd1234efgh', '1');
    await expect(bedrock.invoke({
      model: `${registry.AU_GEO_PREFIX}claude-opus-4-8`,
      region: 'ap-southeast-2',
      messages: [{ role: 'user', content: 'Synthetic QA dictation.' }],
      maxTokens: 512,
      timeoutMs: 5000,
      stream: true,
    })).rejects.toThrow('streaming_not_permitted_with_guardrail');
  });

  test('the refusal never logs the transcript', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await invocation().catch(() => {});
      const logged = warn.mock.calls.flat().map(String).join(' ');
      expect(logged).not.toContain('Synthetic QA dictation');
      expect(logged).toContain('guardrail');
    } finally {
      warn.mockRestore();
    }
  });
});

// ── Redacted description ─────────────────────────────────────────────────────

describe('describe() is safe for the health endpoint', () => {
  test('reports state without ever reporting the identifier', () => {
    setGuardrail('abcd1234efgh', '1');
    process.env.BEDROCK_MODEL_ID = `${registry.AU_GEO_PREFIX}claude-sonnet-4-6`;

    const described = config.describe(registry);
    expect(described.guardrail).toMatchObject({ configured: true, version: '1' });
    expect(described.modelProfile).toEqual({ configured: true });

    const flat = JSON.stringify(described);
    expect(flat).not.toContain('abcd1234efgh');
    expect(flat).not.toContain('claude');
  });

  test('an unconfigured deployment is described plainly', () => {
    expect(config.describe(registry).guardrail).toMatchObject({
      configured: false, reason: 'guardrail_not_configured',
    });
  });
});

// ── The override must actually take effect ───────────────────────────────────

describe('the model profile override is APPLIED, not merely validated', () => {
  const gateway = require('../ai/ai-gateway');
  const FEATURE = 'clinical_note_generation';

  test('a valid override replaces the registry id in the decision', () => {
    // The defect this pins: the override was resolved, reported as
    // `configured: true` on the health endpoint, and passed the self-check —
    // while nothing used it to choose a model. The operator's only lever was
    // inert, and appeared to be working.
    const pinned = `${registry.AU_GEO_PREFIX}claude-sonnet-4-6`;
    process.env.BEDROCK_MODEL_ID = pinned;

    const decision = gateway.evaluate({ feature: FEATURE, modelKey: 'clinical_complex' });
    expect(decision.ok).toBe(true);
    expect(decision.model.id).toBe(pinned);
  });

  test('with no profile configured the call is refused, not defaulted', () => {
    delete process.env.BEDROCK_MODEL_ID;
    const decision = gateway.evaluate({ feature: FEATURE, modelKey: 'clinical_complex' });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('model_profile_not_configured');
  });

  test('an invalid profile refuses the call rather than falling back', () => {
    // Silently invoking a different model than the one an operator named is
    // worse than not starting.
    process.env.BEDROCK_MODEL_ID = 'global.anthropic.claude-opus-4-8';
    const decision = gateway.evaluate({ feature: FEATURE, modelKey: 'clinical_complex' });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('model_profile_not_au_geo');
  });

  test('the mock model is never rewritten by the override', () => {
    // The offline path must keep `mock-model`, or development and every
    // mock-backed test resolves to a profile that does not exist.
    process.env.BEDROCK_MODEL_ID = `${registry.AU_GEO_PREFIX}claude-sonnet-4-6`;
    const decision = gateway.evaluate({ feature: FEATURE, modelKey: 'mock' });
    expect(decision.ok).toBe(true);
    expect(decision.model.id).toBe(registry.get('mock').id);
  });

  test('an over-long profile is refused before anything is transmitted', () => {
    // model_id is VARCHAR(80). Accepting a longer value would invoke
    // successfully and fail on INSERT — after the clinical content had gone.
    process.env.BEDROCK_MODEL_ID = registry.AU_GEO_PREFIX + 'x'.repeat(80);
    expect(config.resolveModelProfile(registry)).toMatchObject({
      ok: false, reason: 'model_profile_too_long',
    });
  });
});
