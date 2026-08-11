'use strict';

/**
 * AI GATEWAY SECURITY TESTS.
 *
 * These are compliance controls expressed as assertions. Clinical narrative
 * is health information; routing it outside Australia is a cross-border
 * disclosure under APP 8 and makes the practice accountable for the
 * recipient's acts under s 16C of the Privacy Act. The gateway must refuse
 * rather than degrade, and must leave an audit trail either way.
 *
 * Every scenario below is a way the boundary could plausibly be lost — a
 * pasted model id, a new feature without a policy, a caller quietly
 * downgrading a classification, a transcript ending up in a log.
 *
 * See docs/mobile/CLINICAL_AI_PROVIDER_DECISION.md.
 */

const gateway = require('../ai/ai-gateway');
const registry = require('../ai/ai-model-registry');
const policy = require('../ai/ai-policy');
const classification = require('../ai/ai-classification');
const audit = require('../ai/ai-audit');
const outputTypes = require('../ai/ai-output-type');
const killSwitch = require('../ai/ai-kill-switch');
const mockProvider = require('../ai/providers/mock-provider');

const CLINICAL_FEATURE = 'clinical_note_generation';
let events;
let savedRegion;
let savedProfile;

/** Synthetic. Not a real profile, and never invoked — the mock provider serves. */
const SYNTHETIC_PROFILE = 'au.anthropic.test-profile-synthetic';

let savedDisable;

beforeEach(() => {
  savedRegion = process.env.AWS_REGION;
  savedProfile = process.env.BEDROCK_MODEL_ID;
  savedDisable = process.env.AI_GLOBAL_DISABLE;
  // The gateway no longer defaults the region, so every case must state one.
  // Cases that assert the absent-region refusal delete it explicitly.
  process.env.AWS_REGION = 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = SYNTHETIC_PROFILE;
  delete process.env.AI_GLOBAL_DISABLE;
  events = [];
  audit._setSinkForTests(async (payload) => { events.push(payload); });
  mockProvider._setHandlerForTests(null);
  killSwitch._setReaderForTests(async () => 'true');
});

afterEach(() => {
  if (savedRegion === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = savedRegion;
  if (savedProfile === undefined) delete process.env.BEDROCK_MODEL_ID;
  else process.env.BEDROCK_MODEL_ID = savedProfile;
  if (savedDisable === undefined) delete process.env.AI_GLOBAL_DISABLE;
  else process.env.AI_GLOBAL_DISABLE = savedDisable;
  audit._setSinkForTests(null);
  mockProvider._setHandlerForTests(null);
  killSwitch._setReaderForTests(null);
});

// ── The five scenarios that must never succeed or fail wrongly ─────────────

test('ALLOWED: clinical work on the approved Australian Bedrock model', () => {
  const decision = gateway.evaluate({ feature: CLINICAL_FEATURE, modelKey: 'clinical_complex' });

  expect(decision.ok).toBe(true);
  expect(decision.model.provider).toBe(registry.PROVIDER_BEDROCK);
  // The id is whatever the deployment configured — the registry no longer
  // carries one. That is the point of the change: this asserts the wiring, not
  // a literal that could drift from the AWS account.
  expect(decision.model.id).toBe(SYNTHETIC_PROFILE);
  expect(registry.AU_REGIONS).toContain(decision.region);
  expect(decision.humanReviewRequired).toBe(true);
});

test('BLOCKED: a global inference profile', () => {
  // `global.` routes to every commercial AWS region worldwide. It is not in
  // the registry, so it cannot even be named — which is the point of keying
  // policies to registry entries rather than raw ids.
  // The registry holds no Bedrock id at all now, so the old "no entry starts
  // with global." assertion is vacuous. The real gate is config: a global
  // profile supplied through BEDROCK_MODEL_ID must be refused outright.
  const bedrockConfig = require('../ai/aws/bedrock-config');
  process.env.BEDROCK_MODEL_ID = 'global.anthropic.claude-opus-4-8';
  expect(bedrockConfig.resolveModelProfile(registry))
    .toMatchObject({ ok: false, reason: 'model_profile_not_au_geo' });
  process.env.BEDROCK_MODEL_ID = SYNTHETIC_PROFILE;

  const decision = gateway.evaluate({ feature: CLINICAL_FEATURE, modelKey: 'global.anthropic.claude-opus-4-8' });
  expect(decision.ok).toBe(false);
  expect(decision.reason).toMatch(/model_not_permitted_for_feature/);
});

test('BLOCKED: an apac profile — regional-looking but not Australian', () => {
  // `apac.` also reaches Tokyo, Seoul, Osaka, Mumbai, Hyderabad and
  // Singapore, with no way to choose. This is the trap that looks safe.
  const bedrockConfig = require('../ai/aws/bedrock-config');
  process.env.BEDROCK_MODEL_ID = 'apac.anthropic.claude-sonnet-4-6';
  expect(bedrockConfig.resolveModelProfile(registry))
    .toMatchObject({ ok: false, reason: 'model_profile_not_au_geo' });
  process.env.BEDROCK_MODEL_ID = SYNTHETIC_PROFILE;

  const decision = gateway.evaluate({ feature: CLINICAL_FEATURE, modelKey: 'apac.anthropic.claude-sonnet-4-6' });
  expect(decision.ok).toBe(false);
});

test('BLOCKED: a real Australian profile that is simply not approved', () => {
  // Sonnet 5 has a genuine `au.` profile, so a prefix check alone would let
  // it through. It is also the model whose Australian routing is NOT uniform
  // (no Sydney source), which is why an approved-set decision beats
  // "looks Australian".
  expect(registry.keys()).not.toContain('clinical_sonnet_5');
  const decision = gateway.evaluate({ feature: CLINICAL_FEATURE, modelKey: 'au.anthropic.claude-sonnet-5' });
  expect(decision.ok).toBe(false);
});

test('BLOCKED: clinical data can never reach a non-approved provider', () => {
  // There is no OpenAI provider, and no approved model may name one. This is
  // asserted structurally rather than by trying to call one, because the
  // guarantee should hold for providers nobody has thought of yet.
  const permitted = new Set([registry.PROVIDER_BEDROCK, registry.PROVIDER_MOCK]);
  for (const model of Object.values(registry.APPROVED_MODELS)) {
    expect(permitted.has(model.provider)).toBe(true);
  }

  const clinicalPolicy = policy.get(CLINICAL_FEATURE);
  for (const provider of clinicalPolicy.allowedProviders) {
    expect(permitted.has(provider)).toBe(true);
  }
});

// ── Region ─────────────────────────────────────────────────────────────────

test('BLOCKED: any region outside Australia, for every clinical feature', () => {
  for (const region of ['us-east-1', 'eu-west-1', 'ap-southeast-1', 'ap-northeast-1']) {
    process.env.AWS_REGION = region;
    for (const feature of policy.features()) {
      const decision = gateway.evaluate({ feature });
      expect(decision.ok).toBe(false);
      // Refused by config before residency logic runs, so the reason is the
      // config's, not the gateway's. Earlier and more general — the region is
      // rejected for every feature, not per classification.
      expect(decision.reason).toBe('region_not_permitted');
    }
  }
});

test('both Australian regions are accepted', () => {
  for (const region of registry.AU_REGIONS) {
    process.env.AWS_REGION = region;
    expect(gateway.evaluate({ feature: CLINICAL_FEATURE }).ok).toBe(true);
  }
});

// ── Policy ─────────────────────────────────────────────────────────────────

test('BLOCKED: a feature with no policy — there is no default', () => {
  // The failure this prevents: someone adds AI to a new module and it
  // inherits whatever configuration happens to exist.
  for (const feature of ['fca_generation', 'whodas_interpretation', 'report_writing', undefined]) {
    const decision = gateway.evaluate({ feature });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/^unknown_feature:/);
  }
});

test('classification may be escalated by a caller but never relaxed', () => {
  // Opa is declared clinical precisely because it can receive clinical
  // content. A caller claiming "this one is only public" must not thereby
  // unlock a laxer path.
  const relaxed = gateway.evaluate({ feature: 'opa_assistant', classification: classification.PUBLIC });
  expect(relaxed.ok).toBe(true);
  expect(relaxed.classification).toBe(classification.CLINICAL);

  const escalated = gateway.evaluate({ feature: 'opa_assistant', classification: classification.CLINICAL });
  expect(escalated.classification).toBe(classification.CLINICAL);
});

test('every declared policy satisfies the load-time invariants', () => {
  expect(() => policy.validateAll()).not.toThrow();
});

test('retention-mandating models are permanently blocked and explained', () => {
  // Fable 5 and Mythos 5 require data retention and provider data sharing,
  // and are outside Bedrock's HIPAA eligibility. They must be unreachable,
  // and the reason must be recorded so nobody re-adds them helpfully.
  for (const [id, reason] of Object.entries(registry.PERMANENTLY_BLOCKED)) {
    expect(typeof reason).toBe('string');
    expect(reason.length).toBeGreaterThan(10);
    const inRegistry = Object.values(registry.APPROVED_MODELS).some((m) => m.id === id);
    expect(inRegistry).toBe(false);
  }
});

// ── Audit ──────────────────────────────────────────────────────────────────

test('the audit trail cannot carry clinical content, even when handed it', async () => {
  // The highest-value assertion here. An audit log that also holds clinical
  // narrative doubles the breach surface and creates a second copy to secure,
  // retain and dispose of under APP 11.
  const SECRET = 'Pamela has schizoaffective disorder and lives at 14 Example St';

  mockProvider._setHandlerForTests(async () => ({
    text: SECRET, toolUse: null, providerRequestId: 'req-123', sourceRegion: 'ap-southeast-2',
  }));

  await gateway.generate({
    feature: 'opa_assistant',
    modelKey: 'mock',
    userId: 'therapist-1',
    system: SECRET,
    messages: [{ role: 'user', content: SECRET }],
  });

  expect(events).toHaveLength(1);
  const serialised = JSON.stringify(events[0]);
  expect(serialised).not.toContain('Pamela');
  expect(serialised).not.toContain('schizoaffective');
  expect(serialised).not.toContain('Example St');

  // What it SHOULD contain: the metadata needed to reconstruct the call.
  const { event } = events[0];
  expect(event.status).toBe('generated');
  expect(event.feature).toBe('opa_assistant');
  expect(event.sourceRegion).toBe('ap-southeast-2');
  expect(event.providerRequestId).toBe('req-123');
  expect(event.eventId).toBeTruthy();
});

test('content cannot be smuggled into an audit event through an unknown field', () => {
  const built = audit.buildEvent({
    feature: 'clinical_note_generation',
    status: 'generated',
    transcript: 'client reported worsening pain',
    prompt: 'full system prompt here',
    nested: { note: 'clinical narrative' },
    veryLong: 'x'.repeat(5000),
  });

  expect(built.transcript).toBeUndefined();
  expect(built.prompt).toBeUndefined();
  expect(built.nested).toBeUndefined();
  expect(built.veryLong).toBeUndefined();
  expect(JSON.stringify(built)).not.toContain('worsening pain');
  expect(built.feature).toBe('clinical_note_generation');
});

test('denials are audited too — a refusal must not be silent', async () => {
  process.env.AWS_REGION = 'us-east-1';

  await expect(gateway.generate({
    feature: CLINICAL_FEATURE,
    userId: 'therapist-1',
    messages: [{ role: 'user', content: 'synthetic' }],
  })).rejects.toThrow('ai_denied');

  expect(events).toHaveLength(1);
  expect(events[0].event.status).toBe('denied');
  expect(events[0].event.denyReason).toBe('region_not_permitted');
  expect(events[0].actorUserId).toBe('therapist-1');
});

test('a policy refusal throws AiPolicyError carrying a reason code', async () => {
  await expect(gateway.generate({ feature: 'nope', messages: [] }))
    .rejects.toBeInstanceOf(gateway.AiPolicyError);

  try {
    await gateway.generate({ feature: 'nope', messages: [] });
  } catch (err) {
    expect(err.reason).toBe('unknown_feature:nope');
    // The message must stay generic — reasons are for logs, not users.
    expect(err.message).toBe('ai_denied');
  }
});

test('the result carries provenance metadata and never the prompt', async () => {
  const res = await gateway.generate({
    feature: CLINICAL_FEATURE,
    modelKey: 'mock',
    messages: [{ role: 'user', content: 'synthetic dictation' }],
    toolChoice: { type: 'tool', name: 'case_note' },
    tools: [{ name: 'case_note', input_schema: { type: 'object' } }],
  });

  // AHPRA holds the practitioner responsible for the record, so a clinical
  // output must hand back the fact that it is a draft.
  expect(res.metadata.reviewRequired).toBe(true);
  expect(res.metadata.classification).toBe(classification.CLINICAL);
  expect(res.metadata.outputType).toBe('clinical_document');
  expect(res.metadata.aiUsed).toBe(true);
  expect(res.metadata.interactionId).toBeTruthy();
  expect(res.metadata.sourceRegion).toBe('ap-southeast-2');

  // A caller cannot persist what it is never handed.
  expect(res.metadata.rawPrompt).toBeUndefined();
  expect(res.metadata.rawResponse).toBeUndefined();
  expect(JSON.stringify(res.metadata)).not.toContain('synthetic dictation');
});

// ── Output type: the second axis ────────────────────────────────────────────

test('the same feature carries different risk depending on what it produces', () => {
  // "Explain sensory processing difficulties" — an answer, not a record.
  const answer = gateway.evaluate({
    feature: 'opa_assistant',
    outputType: outputTypes.ASSISTANT_RESPONSE,
  });
  expect(answer.ok).toBe(true);
  expect(answer.humanReviewRequired).toBe(false);

  // "Write a progress summary for Johan" — destined for a clinical record.
  const document = gateway.evaluate({
    feature: 'opa_assistant',
    outputType: outputTypes.CLINICAL_DOCUMENT,
  });
  expect(document.ok).toBe(true);
  expect(document.humanReviewRequired).toBe(true);
});

test('producing a clinical document forces the clinical classification', () => {
  // Even if the caller claims the input was public, an answer headed for a
  // health record is treated as clinical.
  const decision = gateway.evaluate({
    feature: 'opa_assistant',
    classification: classification.PUBLIC,
    outputType: outputTypes.CLINICAL_DOCUMENT,
  });
  expect(decision.ok).toBe(true);
  expect(decision.classification).toBe(classification.CLINICAL);
  expect(decision.humanReviewRequired).toBe(true);
});

test('BLOCKED: an output type the feature is not permitted to produce', () => {
  // Case-note generation may only produce clinical documents. It has no
  // informational mode, so it can never return something review-exempt.
  const decision = gateway.evaluate({
    feature: CLINICAL_FEATURE,
    outputType: outputTypes.ASSISTANT_RESPONSE,
  });
  expect(decision.ok).toBe(false);
  expect(decision.reason).toBe('output_type_not_permitted_for_feature:assistant_response');
});

test('human review can never be skipped for a clinical document', () => {
  // The invariant, asserted directly rather than inferred from policy.
  expect(outputTypes.requiresHumanReview(outputTypes.CLINICAL_DOCUMENT)).toBe(true);
  for (const feature of policy.features()) {
    const p = policy.get(feature);
    if (!p.outputTypes.includes(outputTypes.CLINICAL_DOCUMENT)) continue;
    const decision = gateway.evaluate({ feature, outputType: outputTypes.CLINICAL_DOCUMENT });
    expect(decision.humanReviewRequired).toBe(true);
  }
});

test('BLOCKED: a classification the feature may not receive', () => {
  // Case notes handle clinical input only; a caller cannot widen that.
  const decision = gateway.evaluate({
    feature: CLINICAL_FEATURE,
    classification: classification.PUBLIC,
  });
  expect(decision.ok).toBe(false);
  expect(decision.reason).toBe('classification_not_permitted_for_feature:public');
});

// ── Kill switch ─────────────────────────────────────────────────────────────

test('the env kill switch stops every feature, synchronously', () => {
  process.env.AI_GLOBAL_DISABLE = 'true';
  for (const feature of policy.features()) {
    const decision = gateway.evaluate({ feature });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('ai_globally_disabled:env');
  }
  // Works without a database, which is when you may most want it.
  expect(gateway.isAvailable(CLINICAL_FEATURE)).toBe(false);
});

test('the database kill switch denies and audits the refusal', async () => {
  killSwitch._setReaderForTests(async () => 'false');

  await expect(gateway.generate({
    feature: CLINICAL_FEATURE,
    modelKey: 'mock',
    userId: 'therapist-1',
    messages: [{ role: 'user', content: 'synthetic' }],
  })).rejects.toThrow('ai_denied');

  expect(events).toHaveLength(1);
  expect(events[0].event.status).toBe('denied');
  expect(events[0].event.denyReason).toBe('ai_globally_disabled:setting');
});

test('a deliberate disable survives a later database failure', async () => {
  // The failure mode this guards: an operator disables AI during an incident,
  // the cache expires, the next read fails, and the switch silently flips
  // back on. Last known must win over the default.
  let mode = 'false';
  killSwitch._setReaderForTests(async () => {
    if (mode === 'throw') throw new Error('connection refused');
    return mode;
  });

  expect(await killSwitch.isGloballyEnabled()).toBe(false);

  mode = 'throw';
  killSwitch.invalidate();
  expect(await killSwitch.isGloballyEnabled()).toBe(false);
});

test('a read failure with nothing known yet does not halt clinical work', async () => {
  // The other direction: a database hiccup at boot must not take out
  // documentation. The call is already gated by a feature flag and by policy,
  // so the kill switch is a fourth control rather than the only one.
  killSwitch._setReaderForTests(async () => { throw new Error('connection refused'); });
  expect(await killSwitch.isGloballyEnabled()).toBe(true);
});

test('a missing setting row is treated as enabled', async () => {
  // Pre-migration or a fresh database. Feature flags are off by default
  // anyway, so this cannot enable anything on its own.
  killSwitch._setReaderForTests(async () => null);
  expect(await killSwitch.isGloballyEnabled()).toBe(true);
});

// ── Attribution ─────────────────────────────────────────────────────────────

test('the audit event records the output type and review requirement', async () => {
  await gateway.generate({
    feature: 'opa_assistant',
    modelKey: 'mock',
    userId: 'therapist-1',
    outputType: outputTypes.CLINICAL_DOCUMENT,
    messages: [{ role: 'user', content: 'synthetic' }],
  });

  // A clinical document reserves its row first, then finalises — so the
  // lifecycle is 'pending' → 'generated', and a row stuck at 'pending' means
  // the call was made but its outcome was never confirmed.
  const reserve = events.find((e) => e.op === 'reserve');
  expect(reserve.event.outputType).toBe('clinical_document');
  expect(reserve.event.humanReviewRequired).toBe(true);
  expect(reserve.event.status).toBe('pending');

  const finalise = events.find((e) => e.op === 'finalise');
  expect(finalise.event.status).toBe('generated');
  expect(finalise.event.eventId).toBe(reserve.event.eventId);
});

test('markReviewed rejects anything that is not a real review decision', async () => {
  await expect(audit.markReviewed({ interactionId: 'x', reviewedBy: 'u', decision: 'maybe' }))
    .rejects.toThrow('invalid_review_decision');
  await expect(audit.markReviewed({ interactionId: null, reviewedBy: 'u', decision: 'approved' }))
    .rejects.toThrow('invalid_review_target');
});
