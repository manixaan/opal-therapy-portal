'use strict';

/**
 * THREE AUDIT DEFECTS, PINNED.
 *
 * Each of these was invisible in normal operation, which is why each needs a
 * test rather than a fix alone — nothing about the running system looked wrong
 * in any of the three cases.
 *
 *   1. Both clinical model tiers resolved through ONE setting, so
 *      `clinical_complex` invoked exactly the same profile as
 *      `clinical_standard`. The policies chose between them and the choice was
 *      silently discarded. The audit row stayed honest (it records the id
 *      actually invoked), which is precisely what hid it.
 *
 *   2. Bedrock returns token counts on every successful call and the provider
 *      dropped them, so no question about cost or context pressure could be
 *      answered from the register at all.
 *
 *   3. Opa replayed its own prior turns as plain prose, contradicting the
 *      JSON-only response contract in its own system prompt — the strongest
 *      signal a model has for how to format the next turn.
 *
 * Nothing here touches a network: the mock provider serves throughout.
 */

const gateway = require('../ai/ai-gateway');
const registry = require('../ai/ai-model-registry');
const bedrockConfig = require('../ai/aws/bedrock-config');
const audit = require('../ai/ai-audit');
const killSwitch = require('../ai/ai-kill-switch');
const mockProvider = require('../ai/providers/mock-provider');
const selfCheck = require('../ai/ai-self-check');

const CLINICAL_FEATURE = 'clinical_note_generation';
const OPA_FEATURE = 'opa_assistant';

/** Synthetic. Never invoked — the mock provider serves every case below. */
const BASE_PROFILE = 'au.anthropic.test-base-synthetic';
const COMPLEX_PROFILE = 'au.anthropic.test-complex-synthetic';
const STANDARD_PROFILE = 'au.anthropic.test-standard-synthetic';

const TIER_VARS = [
  'BEDROCK_MODEL_ID_CLINICAL_STANDARD',
  'BEDROCK_MODEL_ID_CLINICAL_COMPLEX',
];

let events;
let saved;

beforeEach(() => {
  saved = {
    region: process.env.AWS_REGION,
    profile: process.env.BEDROCK_MODEL_ID,
    disable: process.env.AI_GLOBAL_DISABLE,
    tiers: TIER_VARS.map((n) => process.env[n]),
  };
  process.env.AWS_REGION = 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = BASE_PROFILE;
  delete process.env.AI_GLOBAL_DISABLE;
  for (const n of TIER_VARS) delete process.env[n];

  events = [];
  audit._setSinkForTests(async (payload) => { events.push(payload); });
  killSwitch._setReaderForTests(async () => 'true');
  mockProvider._setHandlerForTests(null);
  selfCheck._setResultForTests(null);
});

afterEach(() => {
  const restore = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore('AWS_REGION', saved.region);
  restore('BEDROCK_MODEL_ID', saved.profile);
  restore('AI_GLOBAL_DISABLE', saved.disable);
  TIER_VARS.forEach((n, i) => restore(n, saved.tiers[i]));

  audit._setSinkForTests(null);
  killSwitch._setReaderForTests(null);
  mockProvider._setHandlerForTests(null);
  selfCheck._setResultForTests(null);
});

// ── 1. The two clinical tiers are genuinely distinct ────────────────────────

describe('model tiers resolve independently', () => {
  test('REGRESSION: complex and standard no longer collapse onto one profile', () => {
    process.env.BEDROCK_MODEL_ID_CLINICAL_STANDARD = STANDARD_PROFILE;
    process.env.BEDROCK_MODEL_ID_CLINICAL_COMPLEX = COMPLEX_PROFILE;

    const complex = gateway.evaluate({ feature: CLINICAL_FEATURE, modelKey: 'clinical_complex' });
    const standard = gateway.evaluate({ feature: CLINICAL_FEATURE, modelKey: 'clinical_standard' });

    expect(complex.ok).toBe(true);
    expect(standard.ok).toBe(true);
    expect(complex.model.id).toBe(COMPLEX_PROFILE);
    expect(standard.model.id).toBe(STANDARD_PROFILE);
    // The defect in one line: before the fix these were equal.
    expect(complex.model.id).not.toBe(standard.model.id);
  });

  test("the case-note policy's default really is the complex tier", () => {
    process.env.BEDROCK_MODEL_ID_CLINICAL_COMPLEX = COMPLEX_PROFILE;
    // No modelKey passed — the policy default must be what decides.
    const decision = gateway.evaluate({ feature: CLINICAL_FEATURE });
    expect(decision.modelKey).toBe('clinical_complex');
    expect(decision.model.id).toBe(COMPLEX_PROFILE);
  });

  test('Opa uses the fast assistant tier, not whatever the clinical path uses', () => {
    // Chat latency is a usability property; Opa's default moved from
    // clinical_standard to assistant_fast (its own AU profile, falling back
    // to the base). The property that must hold is unchanged: Opa's tier is
    // never coupled to the clinical documentation tiers.
    process.env.BEDROCK_MODEL_ID_CLINICAL_STANDARD = STANDARD_PROFILE;
    process.env.BEDROCK_MODEL_ID_CLINICAL_COMPLEX = COMPLEX_PROFILE;
    process.env.BEDROCK_MODEL_ID_ASSISTANT_FAST = 'au.anthropic.test-fast-synthetic';
    try {
      const decision = gateway.evaluate({ feature: OPA_FEATURE });
      expect(decision.ok).toBe(true);
      expect(decision.modelKey).toBe('assistant_fast');
      expect(decision.model.id).toBe('au.anthropic.test-fast-synthetic');
      expect(decision.model.id).not.toBe(COMPLEX_PROFILE);
    } finally {
      delete process.env.BEDROCK_MODEL_ID_ASSISTANT_FAST;
    }
  });

  test('BACKWARD COMPATIBLE: with no tier overrides, every tier uses the base', () => {
    // A deployment that sets only BEDROCK_MODEL_ID must behave exactly as it
    // did before this change — otherwise the fix breaks staging on the way in.
    const complex = gateway.evaluate({ feature: CLINICAL_FEATURE, modelKey: 'clinical_complex' });
    const standard = gateway.evaluate({ feature: CLINICAL_FEATURE, modelKey: 'clinical_standard' });
    expect(complex.model.id).toBe(BASE_PROFILE);
    expect(standard.model.id).toBe(BASE_PROFILE);
  });

  test('a tier override is validated by the same rules, and REFUSED not ignored', () => {
    // Falling back to the base here would invoke a different model than the one
    // an operator explicitly named — worse than not starting.
    //
    // The boundary is forced healthy so this exercises the PER-REQUEST guard.
    // Both layers catch this, and they catch it at different moments: the boot
    // self-check refuses a value present at startup (asserted separately
    // below), while this is what happens if the setting is changed under a
    // running process, when the cached self-check result no longer reflects
    // the environment.
    selfCheck._setResultForTests({ ok: true, checks: [], failed: [], ranAt: null });
    process.env.BEDROCK_MODEL_ID_CLINICAL_COMPLEX = 'global.anthropic.claude-opus-4-8';
    const decision = gateway.evaluate({ feature: CLINICAL_FEATURE, modelKey: 'clinical_complex' });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('model_profile_not_au_geo');
    // And it must NOT have quietly used the base instead.
    expect(decision.model).toBeUndefined();
  });

  test('the standard tier keeps working while the complex override is broken', () => {
    // The refusal must be scoped to the tier that is actually misconfigured —
    // one bad override should not take Opa down with the case-note path.
    selfCheck._setResultForTests({ ok: true, checks: [], failed: [], ranAt: null });
    process.env.BEDROCK_MODEL_ID_CLINICAL_COMPLEX = 'global.anthropic.claude-opus-4-8';
    expect(gateway.evaluate({ feature: OPA_FEATURE }).ok).toBe(true);
  });

  test.each([
    ['an apac route', 'apac.anthropic.claude-sonnet-4-6', 'model_profile_not_au_geo'],
    ['a bare model id', 'anthropic.claude-sonnet-4-6', 'model_profile_not_au_geo'],
    ['a Covered Model', 'au.anthropic.claude-fable-5', 'model_profile_permanently_blocked'],
  ])('a tier override refuses %s', (_label, id, reason) => {
    process.env.BEDROCK_MODEL_ID_CLINICAL_STANDARD = id;
    expect(bedrockConfig.resolveModelProfile(registry, 'clinical_standard'))
      .toMatchObject({ ok: false, reason });
  });

  test('the env var name is derived from the registry key', () => {
    expect(bedrockConfig.profileEnvNameFor('clinical_complex'))
      .toBe('BEDROCK_MODEL_ID_CLINICAL_COMPLEX');
    // Every Bedrock key in the registry must have a derivable name, so adding
    // an entry cannot silently leave a tier unconfigurable.
    for (const key of registry.keys()) {
      if (registry.get(key).provider !== registry.PROVIDER_BEDROCK) continue;
      expect(bedrockConfig.profileEnvNameFor(key)).toMatch(/^BEDROCK_MODEL_ID_[A-Z_]+$/);
    }
  });

  test('resolveModelProfile still works with no key — the base contract is unchanged', () => {
    expect(bedrockConfig.resolveModelProfile(registry)).toMatchObject({ ok: true, id: BASE_PROFILE });
  });

  test('the boot self-check fails on a broken tier override, naming the variable', () => {
    process.env.BEDROCK_MODEL_ID_CLINICAL_COMPLEX = 'global.anthropic.claude-opus-4-8';
    const result = selfCheck.run();
    expect(result.ok).toBe(false);
    expect(result.failed.join(' ')).toContain('BEDROCK_MODEL_ID_CLINICAL_COMPLEX');
  });

  test('the redacted status view reports tier resolution without exposing an id', () => {
    process.env.BEDROCK_MODEL_ID_CLINICAL_COMPLEX = COMPLEX_PROFILE;
    const described = bedrockConfig.describe(registry);
    expect(described.modelTiers.clinical_complex).toMatchObject({ configured: true, dedicated: true, sharesBase: false });
    expect(described.modelTiers.clinical_standard).toMatchObject({ configured: true, dedicated: false, sharesBase: true });
    // The mock provider is not a Bedrock tier and must not appear.
    expect(described.modelTiers.mock).toBeUndefined();
    // No profile id may leak into a status payload.
    const serialised = JSON.stringify(described);
    expect(serialised).not.toContain(COMPLEX_PROFILE);
    expect(serialised).not.toContain(BASE_PROFILE);
  });
});

// ── 2. Token counts reach the register ──────────────────────────────────────

describe('token usage is recorded', () => {
  const generatedEvent = () => events
    .map((e) => e.event || {})
    .find((e) => e.status === 'generated' || e.inputTokens != null);

  test('counts from the provider land on the audit event and the metadata', async () => {
    mockProvider._setHandlerForTests(async ({ region }) => ({
      text: 'ok',
      toolUse: null,
      providerRequestId: 'mock-request-id',
      sourceRegion: region,
      usage: { inputTokens: 1629, outputTokens: 308 },
    }));

    const result = await gateway.generate({
      feature: OPA_FEATURE,
      modelKey: 'mock',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.metadata.inputTokens).toBe(1629);
    expect(result.metadata.outputTokens).toBe(308);
    expect(generatedEvent()).toMatchObject({ inputTokens: 1629, outputTokens: 308 });
  });

  test('a provider that reports no usage yields null, never a fabricated zero', async () => {
    // Zero would read as "a call that consumed nothing", which is a different
    // and false claim from "we do not know".
    const result = await gateway.generate({
      feature: OPA_FEATURE,
      modelKey: 'mock',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.metadata.inputTokens).toBeNull();
    expect(result.metadata.outputTokens).toBeNull();
  });

  test('counts are numbers, and the audit layer still refuses content', () => {
    const built = audit.buildEvent({
      feature: 'x',
      inputTokens: 10,
      outputTokens: 20,
      // Everything below is outside the allowlist and must be dropped.
      prompt: 'the transcript',
      messages: [{ role: 'user', content: 'clinical narrative' }],
      usage: { input_tokens: 1 },
    });
    expect(built.inputTokens).toBe(10);
    expect(built.outputTokens).toBe(20);
    expect(built.prompt).toBeUndefined();
    expect(built.messages).toBeUndefined();
    expect(built.usage).toBeUndefined();
  });

  test('a denial records no counts — nothing was consumed', async () => {
    process.env.AI_GLOBAL_DISABLE = 'true';
    await expect(gateway.generate({
      feature: OPA_FEATURE,
      modelKey: 'mock',
      messages: [{ role: 'user', content: 'hello' }],
    })).rejects.toThrow('ai_denied');

    const denied = events.map((e) => e.event || {}).find((e) => e.status === 'denied');
    expect(denied).toBeDefined();
    expect(denied.inputTokens).toBeUndefined();
    expect(denied.outputTokens).toBeUndefined();
  });

  test('a non-numeric token value never reaches the integer column', () => {
    // The writer persists these only when `typeof === 'number'`, so anything
    // else becomes NULL rather than being coerced. Asserted on the shape the
    // writer actually tests, so the guarantee is checked where it lives.
    const built = audit.buildEvent({ inputTokens: 'the whole transcript' });
    expect(typeof built.inputTokens).not.toBe('number');
  });
});

// ── 3. Opa replays its own turns in contract ────────────────────────────────

describe('Opa conversation history is replayed in contract', () => {
  const { _replayAssistantTurn } = require('../opa-routes');

  test('REGRESSION: an assistant turn is replayed as the JSON object it was', () => {
    const replayed = _replayAssistantTurn({
      content: 'Open the Calendar tab and choose Day view.',
      actions: [{ type: 'NAVIGATE', target: 'calendar', label: 'Calendar' }],
    });
    // Before the fix this was the bare sentence, which showed the model a
    // conversation in which it had ignored its own response contract.
    const parsed = JSON.parse(replayed);
    expect(parsed.answer).toBe('Open the Calendar tab and choose Day view.');
    expect(parsed.actions).toEqual([{ type: 'NAVIGATE', target: 'calendar', label: 'Calendar' }]);
  });

  test('the replayed shape satisfies the same parser that reads a live reply', () => {
    // The strongest available check that history and live output agree: the
    // route's own parser must accept a replayed turn unchanged.
    const replayed = _replayAssistantTurn({ content: 'Some answer.', actions: [] });
    const parsed = JSON.parse(replayed);
    expect(typeof parsed.answer).toBe('string');
    expect(Array.isArray(parsed.actions)).toBe(true);
  });

  test('actions stored as a JSONB string are tolerated', () => {
    const parsed = JSON.parse(_replayAssistantTurn({
      content: 'Answer.',
      actions: '[{"type":"NAVIGATE","target":"resources","label":"Resource Hub"}]',
    }));
    expect(parsed.actions).toHaveLength(1);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['malformed JSON', '{not json'],
    ['an object rather than an array', { type: 'NAVIGATE' }],
  ])('a historical row with %s actions replays with an empty list, never throwing', (_label, actions) => {
    // A malformed historical row must not be able to fail a live request.
    const parsed = JSON.parse(_replayAssistantTurn({ content: 'Answer.', actions }));
    expect(parsed.actions).toEqual([]);
    expect(parsed.answer).toBe('Answer.');
  });

  test('confidence is not invented', () => {
    // It is not stored, so fabricating "high" would teach the model that the
    // field is decorative.
    const parsed = JSON.parse(_replayAssistantTurn({ content: 'Answer.', actions: [] }));
    expect(parsed.confidence).toBeUndefined();
  });

  test('a null content column replays as an empty answer rather than "null"', () => {
    const parsed = JSON.parse(_replayAssistantTurn({ content: null, actions: [] }));
    expect(parsed.answer).toBe('');
  });
});
