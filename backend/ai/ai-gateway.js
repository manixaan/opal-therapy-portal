'use strict';

/**
 * OPAL AI GATEWAY — the single entry point for every AI call in the backend.
 *
 * No feature may import an AI SDK or call a vendor endpoint directly. Case
 * notes, Opa, and any future FCA, WHODAS, report-writing or resource feature
 * all arrive here, and here is where jurisdiction, model approval, provider
 * approval, classification, output type and human review are decided.
 *
 * The reason for centralising rather than securing each feature separately is
 * that per-feature security only holds while every future developer remembers
 * it. A gateway plus tests/ai-gateway-boundary.test.js turns "remember not to
 * call Anthropic directly" into a build failure.
 *
 * ── ORDER OF CHECKS ───────────────────────────────────────────────────────
 *   kill switch off?         → deny (env checked synchronously, DB in generate)
 *   feature known?           → no: deny (there is no default policy)
 *   classification permitted → the stricter of policy and caller; never laxer
 *   output type permitted?   → no: deny; human review derives from it
 *   region approved?         → clinical work must source from Australia
 *   model in policy?         → registry keys only, never raw ids
 *   model approved + onshore?→ registry validates prefix, region, blocklist
 *   provider in policy?      → no: deny
 *   ── only then ── invoke
 *
 * Every outcome is recorded, denials included. A denial that leaves no trace
 * is indistinguishable from a call that never happened, which is exactly what
 * you do not want when reconstructing an incident.
 *
 * The result carries a metadata block — model, provider, region, review
 * requirement — and NEVER the prompt or a raw provider response.
 *
 * Fail-closed throughout: any unresolved question denies. There is no
 * fallback provider, no "try the global profile", no degraded mode.
 *
 * Env:
 *   AWS_REGION          REQUIRED; no default. Must be an approved AU region.
 *   AI_GLOBAL_DISABLE   'true' stops all AI without needing the database
 */

const registry = require('./ai-model-registry');
const policyEngine = require('./ai-policy');
const classification = require('./ai-classification');
const outputTypes = require('./ai-output-type');
const killSwitch = require('./ai-kill-switch');
const selfCheck = require('./ai-self-check');
const audit = require('./ai-audit');
const bedrockConfig = require('./aws/bedrock-config');

const bedrockProvider = require('./providers/bedrock-provider');
const mockProvider = require('./providers/mock-provider');


const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 60000;

const PROVIDERS = {
  [registry.PROVIDER_BEDROCK]: bedrockProvider,
  [registry.PROVIDER_MOCK]: mockProvider,
};

/** Thrown when policy refuses. Carries a short reason code, never user text. */
class AiPolicyError extends Error {
  constructor(reason) {
    super('ai_denied');
    this.name = 'AiPolicyError';
    this.reason = reason;
  }
}

const clampInt = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

/**
 * The region to invoke from, or null when it is not configured.
 *
 * Delegates to the single config owner. This used to read
 * `AI_AWS_REGION || 'ap-southeast-2'` — a deployment that forgot the setting
 * still invoked, in Sydney, because the code chose for it. There is no default
 * now: an absent region stops the call.
 */
function resolveRegion() {
  const r = bedrockConfig.resolveRegion();
  return r.ok ? r.region : null;
}

/**
 * Decide everything except whether the call succeeds. Pure and synchronous —
 * no network, no database — so policy can be unit tested exhaustively and the
 * security tests can assert on decisions rather than on mocked HTTP.
 *
 * The env kill switch is checked here because it is synchronous; the database
 * switch is checked in generate(), which can await.
 *
 * @returns {{ok: true, ...}|{ok: false, reason: string}}
 */
function evaluate({ feature, modelKey: requestedModelKey, classification: declared, outputType: requestedOutputType } = {}) {
  if (killSwitch.envDisabled()) {
    return { ok: false, reason: 'ai_globally_disabled:env' };
  }

  // An unverified boundary is treated as a broken one. If the policy or model
  // registry did not load cleanly, the guards below are not weaker — they are
  // unproven, which for a clinical system is the same thing.
  if (!selfCheck.isHealthy()) {
    return { ok: false, reason: 'ai_boundary_unverified' };
  }

  const policy = policyEngine.get(feature);
  if (!policy) return { ok: false, reason: `unknown_feature:${feature || 'none'}` };

  // The caller may declare a STRICTER classification than the policy default
  // (e.g. a generally-informational feature handling a clinical document this
  // once). It may never declare a laxer one — that direction is how
  // boundaries erode.
  let effectiveClassification = policy.classification;
  if (declared) {
    if (!classification.isValid(declared)) {
      return { ok: false, reason: `invalid_classification:${declared}`, policy };
    }
    if (!policy.allowedClassifications.includes(declared)) {
      return { ok: false, reason: `classification_not_permitted_for_feature:${declared}`, policy };
    }
    if (classification.isAtLeast(declared, policy.classification)) {
      effectiveClassification = declared;
    }
  }

  const outputType = requestedOutputType || policy.defaultOutputType;
  if (!outputTypes.isValid(outputType)) {
    return { ok: false, reason: `invalid_output_type:${outputType}`, policy };
  }
  if (!policy.outputTypes.includes(outputType)) {
    return { ok: false, reason: `output_type_not_permitted_for_feature:${outputType}`, policy };
  }

  // Derived, never declared. A clinical document is always a draft.
  const humanReviewRequired = policyEngine.requiresHumanReview(outputType);

  // Producing a clinical document means the answer is destined for a health
  // record, so the request is treated as clinical regardless of what the
  // input looked like.
  if (outputType === outputTypes.CLINICAL_DOCUMENT) {
    effectiveClassification = classification.CLINICAL;
  }

  const required = classification.requirementsFor(effectiveClassification);

  // Region first, and fail closed. Everything below reasons about residency,
  // and reasoning about residency without knowing the region is how a default
  // slips back in.
  const regionResult = bedrockConfig.resolveRegion();
  if (!regionResult.ok) return { ok: false, reason: regionResult.reason, policy };
  const region = regionResult.region;

  if (required.residency === 'australia') {
    if (!registry.AU_REGIONS.includes(region)) {
      return { ok: false, reason: `region_not_australian:${region}`, policy };
    }
    if (policy.region !== 'australia') {
      return { ok: false, reason: 'policy_region_mismatch', policy };
    }
  }

  const modelKey = requestedModelKey || policy.defaultModel;
  if (!policy.allowedModels.includes(modelKey)) {
    return { ok: false, reason: `model_not_permitted_for_feature:${modelKey}`, policy };
  }

  const registryError = registry.validate(modelKey, region);
  if (registryError) return { ok: false, reason: registryError, policy };

  const registryModel = registry.get(modelKey);

  // DEPLOYMENT OVERRIDE — applied here, at the single point where a model is
  // chosen, so the id that is audited is the id that is invoked.
  //
  // Which inference profiles exist is a fact about an AWS account, not about
  // this software, and it cannot be inspected from source. The registry's ids
  // are therefore a default, not a certainty. An operator who has read the
  // real profile out of the console must be able to pin it without a code
  // change — and if what they supply is invalid, the call is refused rather
  // than quietly falling back, because invoking a different model than the one
  // an operator explicitly named is worse than not starting.
  //
  // Bedrock only. The mock's id must stay `mock-model` or the offline path
  // (and every test that uses it) resolves to a profile that does not exist.
  let model = registryModel;
  if (registryModel.provider === registry.PROVIDER_BEDROCK) {
    // REQUIRED, not an override. The registry carries no Bedrock id at all now
    // (see its header), so this is the only place one can come from. No id
    // means no call — never a fallback to something that merely parses.
    const profile = bedrockConfig.resolveModelProfile(registry);
    if (!profile.ok) return { ok: false, reason: profile.reason, policy };
    model = { ...registryModel, id: profile.id };
  }

  if (!policy.allowedProviders.includes(model.provider)) {
    return { ok: false, reason: `provider_not_permitted:${model.provider}`, policy };
  }
  if (!PROVIDERS[model.provider]) {
    return { ok: false, reason: `provider_not_implemented:${model.provider}`, policy };
  }
  if (required.residency === 'australia' && model.residency !== 'australia') {
    return { ok: false, reason: `model_not_resident_in_australia:${modelKey}`, policy };
  }

  return {
    ok: true,
    policy,
    model,
    modelKey,
    region,
    classification: effectiveClassification,
    outputType,
    humanReviewRequired,
    // How much of the request the guardrail evaluates on INPUT. A policy
    // fact, not a caller option — see ai-policy.js. Absent means the whole
    // request.
    guardrailInputScope: policy.guardrailInputScope || 'full',
  };
}

/**
 * True when `feature` could run right now, on policy and the env kill switch.
 * Does NOT consult the database kill switch — features use this for their own
 * fail-closed check without an await, and generate() makes the final call.
 */
function isAvailable(feature) {
  return evaluate({ feature }).ok;
}

/** Why `feature` cannot run, or null when it can. Safe to log. */
function unavailableReason(feature) {
  const decision = evaluate({ feature });
  return decision.ok ? null : decision.reason;
}

/**
 * The only way to reach a model.
 *
 * @param {object} opts
 * @param {string}  opts.feature        must have a policy in ai-policy.js
 * @param {Array}   opts.messages       [{ role, content }]
 * @param {string}  [opts.system]
 * @param {string}  [opts.outputType]   'assistant_response' | 'clinical_document'
 * @param {string}  [opts.classification] may only escalate, never relax
 * @param {string}  [opts.userId]       audit actor
 * @param {string}  [opts.organisationId]
 * @param {string}  [opts.modelKey]     registry key; defaults to policy default
 * @param {number}  [opts.maxTokens]
 * @param {number}  [opts.timeoutMs]
 * @param {Array}   [opts.tools]
 * @param {object}  [opts.toolChoice]
 * @returns {Promise<{text, toolUse, metadata}>}
 * @throws {AiPolicyError} when policy refuses
 * @throws {Error} 'provider_error' on transport failure
 */
async function generate(opts = {}) {
  const {
    feature, messages, system, userId, organisationId,
    maxTokens, timeoutMs, tools, toolChoice,
  } = opts;

  const deny = async (reason, policy) => {
    await audit.record({
      actorUserId: userId,
      organisationId,
      event: {
        feature,
        classification: policy ? policy.classification : null,
        auditCategory: policy ? policy.auditCategory : null,
        status: 'denied',
        denyReason: reason,
      },
    });
    throw new AiPolicyError(reason);
  };

  const decision = evaluate(opts);
  if (!decision.ok) return deny(decision.reason, decision.policy);

  // The database kill switch — an operator can stop every AI call in seconds
  // during an incident, with no redeploy.
  if (!(await killSwitch.isGloballyEnabled())) {
    return deny('ai_globally_disabled:setting', decision.policy);
  }

  const provider = PROVIDERS[decision.model.provider];
  const startedAt = Date.now();

  const baseEvent = {
    feature,
    classification: decision.classification,
    outputType: decision.outputType,
    auditCategory: decision.policy.auditCategory,
    provider: decision.model.provider,
    model: decision.model.id,
    modelKey: decision.modelKey,
    sourceRegion: decision.region,
    humanReviewRequired: decision.humanReviewRequired,
  };

  // A clinical document RESERVES its audit row before anything is
  // transmitted. If the audit layer cannot record, generation is denied — a
  // note in a client's file that cannot be traced to a model, a region and a
  // person is worse than no note, and after the call the data has already
  // left. An assistant answer does not carry that weight, so it keeps the
  // cheaper after-the-fact record.
  const mustBeAttributable = decision.outputType === outputTypes.CLINICAL_DOCUMENT;
  let reserved = null;
  if (mustBeAttributable) {
    try {
      reserved = await audit.reserve({ actorUserId: userId, organisationId, event: baseEvent });
    } catch (err) {
      console.warn(`[ai-gateway] audit unavailable — refusing clinical generation (reason: ${err?.message || 'unknown'})`);
      return deny('audit_unavailable', decision.policy);
    }
  }

  let result;
  try {
    result = await provider.invoke({
      model: decision.model.id,
      region: decision.region,
      system,
      messages,
      maxTokens: clampInt(maxTokens, DEFAULT_MAX_TOKENS, 64, 8192),
      timeoutMs: clampInt(timeoutMs, DEFAULT_TIMEOUT_MS, 5000, 120000),
      tools,
      toolChoice,
      guardInputScope: decision.guardrailInputScope,
    });
  } catch (err) {
    // A guardrail refusal, and a refusal to call an unguarded model, are
    // DENIALS — a control did its job. Recording them as provider_error would
    // bury the one number a practice actually needs from this table ("how
    // often did the safety layer stop something?") inside a count of network
    // faults. `denied` is an existing status, so this needs no migration.
    const guardrailStop = err?.message === 'guardrail_intervened'
      || err?.message === 'guardrail_not_configured';
    const failure = guardrailStop
      ? { status: 'denied', denyReason: err.message }
      : { status: 'provider_error' };

    if (reserved) {
      await audit.finalise(reserved.eventId, { ...failure, latencyMs: Date.now() - startedAt });
    } else {
      await audit.record({
        actorUserId: userId,
        organisationId,
        event: { ...baseEvent, ...failure, latencyMs: Date.now() - startedAt },
      });
    }
    throw err;
  }

  let event;
  if (reserved) {
    await audit.finalise(reserved.eventId, {
      status: 'generated',
      providerRequestId: result.providerRequestId,
      latencyMs: Date.now() - startedAt,
    });
    event = reserved;
  } else {
    event = await audit.record({
      actorUserId: userId,
      organisationId,
      event: {
        ...baseEvent,
        status: 'generated',
        providerRequestId: result.providerRequestId,
        latencyMs: Date.now() - startedAt,
      },
    });
  }

  return {
    text: result.text,
    toolUse: result.toolUse,
    /**
     * Everything a caller needs to record provenance, and nothing that could
     * leak content. There is deliberately no rawPrompt or rawResponse here —
     * a caller cannot persist what it is never handed.
     */
    metadata: {
      aiUsed: true,
      interactionId: event.eventId,
      feature,
      classification: decision.classification,
      outputType: decision.outputType,
      provider: decision.model.provider,
      model: decision.model.id,
      modelKey: decision.modelKey,
      // Source, not processing region — a geo profile may process a
      // Sydney-sourced request in Melbourne. CloudTrail's
      // additionalEventData.inferenceRegion is authoritative; correlate on
      // providerRequestId.
      sourceRegion: result.sourceRegion,
      providerRequestId: result.providerRequestId,
      reviewRequired: decision.humanReviewRequired,
    },
  };
}

module.exports = {
  generate,
  evaluate,
  isAvailable,
  unavailableReason,
  resolveRegion,
  AiPolicyError,
};
