'use strict';

/**
 * The data residency waiver and the direct provider.
 *
 * The Owner decided (17 Sep 2026) that the induction assistant — staff
 * training content, nothing clinical — may use the vendor's public API
 * instead of the Australian Bedrock path. These tests pin the SHAPE of that
 * exception so it cannot widen: one feature, no clinical capability, the key
 * read in one module, the gateway refusing the direct model to anything
 * without a waiver, and every call audited with the waiver on the row.
 */

process.env.AI_GLOBAL_DISABLE = 'false';

const registry = require('../ai/ai-model-registry');
const policy = require('../ai/ai-policy');
const classification = require('../ai/ai-classification');
const outputTypes = require('../ai/ai-output-type');
const gateway = require('../ai/ai-gateway');
const directConfig = require('../ai/direct-api-config');
const selfCheck = require('../ai/ai-self-check');

const WAIVER_FEATURE = 'induction_assistant';

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DIRECT_API_MODEL_ID;
  delete process.env.AWS_REGION;
  selfCheck.run();
});

describe('the waiver is exactly one feature, and it is not clinical-capable', () => {
  test('only the induction assistant carries it', () => {
    expect(policy.waiverFeatures()).toEqual([WAIVER_FEATURE]);
  });

  test('the waiver feature cannot receive clinical input or produce a clinical document', () => {
    const p = policy.get(WAIVER_FEATURE);
    expect(p.mayReceiveClinicalData).toBe(false);
    expect(p.allowedClassifications).not.toContain(classification.CLINICAL);
    expect(p.outputTypes).not.toContain(outputTypes.CLINICAL_DOCUMENT);
  });

  test('no other policy lists a direct-provider model', () => {
    for (const feature of policy.features()) {
      if (feature === WAIVER_FEATURE) continue;
      const p = policy.get(feature);
      expect(p.allowedProviders).not.toContain(registry.PROVIDER_DIRECT);
      for (const key of p.allowedModels) expect(registry.get(key).provider).not.toBe(registry.PROVIDER_DIRECT);
    }
  });

  test('validateAll refuses a waiver on a clinical-capable policy, and a direct model without one', () => {
    const original = { ...policy.AI_POLICIES.opa_assistant };
    try {
      policy.AI_POLICIES.opa_assistant = { ...original, dataResidencyWaiver: true };
      expect(() => policy.validateAll()).toThrow(/cannot be granted to a clinical-capable feature/);
    } finally { policy.AI_POLICIES.opa_assistant = original; }

    const onb = { ...policy.AI_POLICIES.onboarding_document_extraction };
    try {
      policy.AI_POLICIES.onboarding_document_extraction = {
        ...onb,
        allowedProviders: [...onb.allowedProviders, registry.PROVIDER_DIRECT],
        allowedModels: [...onb.allowedModels, 'assistant_direct'],
      };
      expect(() => policy.validateAll()).toThrow(/needs a data residency waiver/);
    } finally { policy.AI_POLICIES.onboarding_document_extraction = onb; }
    expect(() => policy.validateAll()).not.toThrow();
  });

  test('the self-check asserts the same invariant', () => {
    const r = selfCheck.run();
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.name)).toContain('the direct provider is reachable only under a non-clinical waiver');
  });
});

describe('the gateway', () => {
  test('refuses the direct model without the vendor key, with a reason and no fallback', () => {
    const d = gateway.evaluate({ feature: WAIVER_FEATURE });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('direct_api_not_configured');
  });

  test('permits the direct model with the key, with no Bedrock region at all', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-never-used';
    const d = gateway.evaluate({ feature: WAIVER_FEATURE });
    expect(d.ok).toBe(true);
    expect(d.model.provider).toBe(registry.PROVIDER_DIRECT);
    expect(d.model.id).toBe(registry.get('assistant_direct').id);
    expect(d.residencyWaived).toBe(true);
    expect(d.region).toBeNull();
  });

  test('the deployment can pin the direct model id', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-never-used';
    process.env.DIRECT_API_MODEL_ID = 'pinned-model';
    expect(gateway.evaluate({ feature: WAIVER_FEATURE }).model.id).toBe('pinned-model');
  });

  test('a clinical-capable feature can never reach the direct model, key or no key', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-never-used';
    process.env.AWS_REGION = 'ap-southeast-2';
    const d = gateway.evaluate({ feature: 'opa_assistant', modelKey: 'assistant_direct' });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('model_not_permitted_for_feature:assistant_direct');
  });

  test('a waiver feature that still names a Bedrock model needs the region like anyone else', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-never-used';
    const d = gateway.evaluate({ feature: WAIVER_FEATURE, modelKey: 'clinical_standard' });
    expect(d.ok).toBe(false);
    expect(String(d.reason)).toMatch(/region|bedrock/);
  });

  test('the key reader is the only module that knows the key, and never returns it on the status shape', () => {
    process.env.ANTHROPIC_API_KEY = 'secret-value';
    expect(directConfig.describe()).toEqual({ configured: true, model_overridden: false });
    expect(JSON.stringify(directConfig.describe())).not.toContain('secret-value');
  });
});
