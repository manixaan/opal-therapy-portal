'use strict';

/**
 * AI POLICY ENGINE — what each feature is permitted to do.
 *
 * Every AI-using feature must have an entry here. A feature the gateway does
 * not recognise is denied: there is no default policy, because "whatever API
 * key happens to be configured" is exactly the failure mode this boundary
 * exists to prevent.
 *
 * Adding a feature is therefore a deliberate governance decision — you are
 * writing down, in reviewable code, what data it may receive, what it may
 * produce, where that data may be processed and which models may see it.
 * That declaration is also what the AI use register in the compliance pack
 * is built from.
 *
 * ── TWO AXES, NOT ONE ─────────────────────────────────────────────────────
 * `allowedClassifications` is about the INPUT — what the feature may be
 * given. `outputTypes` is about the ANSWER — whether it is informational or
 * destined for a clinical record. They are independent, and human review is
 * derived from the second, never declared by hand. See ai-output-type.js for
 * why the same Opa chat box needs both.
 *
 * Invariants are enforced at module load (validateAll below), so a policy
 * that breaches the clinical boundary fails the process at boot rather than
 * at 4pm on a Thursday mid-consultation.
 */

const registry = require('./ai-model-registry');
const classification = require('./ai-classification');
const outputTypes = require('./ai-output-type');

/**
 * @typedef {object} FeaturePolicy
 * @property {string}   classification           default/baseline input level
 * @property {string[]} allowedClassifications   input levels this may receive
 * @property {string[]} outputTypes              what it may produce
 * @property {string}   defaultOutputType        used when a caller omits one
 * @property {string[]} allowedProviders         provider ids from the registry
 * @property {string[]} allowedModels            REGISTRY KEYS, never raw ids
 * @property {string}   defaultModel             registry key, in allowedModels
 * @property {string}   region                   'australia' | null
 * @property {boolean}  mayReceiveClinicalData
 * @property {string}   auditCategory
 */

/** @type {Record<string, FeaturePolicy>} */
const AI_POLICIES = {
  /**
   * Dictated session narrative → structured case-note draft.
   * The transcript is the only clinical carrier; identifiers are merged
   * server-side after generation and never sent to the model.
   *
   * Produces clinical documents only — there is no informational mode, so
   * every output of this feature requires human review.
   */
  clinical_note_generation: {
    classification: classification.CLINICAL,
    allowedClassifications: [classification.CLINICAL],
    outputTypes: [outputTypes.CLINICAL_DOCUMENT],
    defaultOutputType: outputTypes.CLINICAL_DOCUMENT,
    allowedProviders: [registry.PROVIDER_BEDROCK, registry.PROVIDER_MOCK],
    allowedModels: ['clinical_complex', 'clinical_standard', 'mock'],
    defaultModel: 'clinical_complex',
    region: 'australia',
    mayReceiveClinicalData: true,
    auditCategory: 'clinical_documentation',
  },

  /**
   * Opa assistant — portal help, feature knowledge, and whatever a therapist
   * actually types.
   *
   * Declared clinical-capable rather than "general". That is not an
   * oversight: a chat box inside a clinical portal will eventually be asked
   * to summarise a session, whatever the interface says, and the transport
   * must already be safe when it happens. Classification reflects what a
   * feature CAN receive, not what it is supposed to.
   *
   * Both output types are permitted, and this is where the split earns its
   * keep. "Explain sensory processing difficulties" is an assistant response
   * and needs no review. "Write a progress summary for Johan" is a clinical
   * document and does — same feature, same input classification, different
   * risk. The caller declares which; the gateway enforces the consequence.
   */
  opa_assistant: {
    classification: classification.CLINICAL,
    allowedClassifications: [
      classification.PUBLIC,
      classification.INTERNAL,
      classification.CLINICAL,
    ],
    outputTypes: [outputTypes.ASSISTANT_RESPONSE, outputTypes.CLINICAL_DOCUMENT],
    defaultOutputType: outputTypes.ASSISTANT_RESPONSE,
    allowedProviders: [registry.PROVIDER_BEDROCK, registry.PROVIDER_MOCK],
    /**
     * assistant_fast is the interactive default: chat latency is a usability
     * property, and portal-help answers do not need report-grade fidelity.
     * It resolves through BEDROCK_MODEL_ID_ASSISTANT_FAST and falls back to
     * the base BEDROCK_MODEL_ID, so a deployment that has not configured the
     * fast tier invokes exactly the model it did before. clinical_standard
     * stays allowed for the clinical_document output path.
     */
    allowedModels: ['assistant_fast', 'clinical_standard', 'mock'],
    defaultModel: 'assistant_fast',
    region: 'australia',
    mayReceiveClinicalData: true,
    auditCategory: 'assistant',
    /**
     * Guardrail INPUT evaluation is scoped to the CURRENT user message via
     * Bedrock input tagging. Opa's system prompt embeds anti-injection
     * instructions — text a Prompt-attack filter exists to match — so
     * full-request evaluation had the guardrail refusing every request on the
     * strength of our own scaffolding, whatever the user typed.
     *
     * Each user utterance is evaluated at full filter strength exactly once,
     * on the request that carries it; replayed history turns already passed
     * on their original request and are not re-adjudicated. Output
     * evaluation is untouched. Absent (as on clinical_note_generation) means
     * the default: the whole request is evaluated.
     */
    guardrailInputScope: 'current_user_message',
  },

  /**
   * Opal Assist — the practice-wide assistant (web page, Word, Excel,
   * Outlook, and the phone). It exists to REPLACE every other AI tool a
   * staff member might reach for, so it must be allowed to receive whatever
   * they paste — including clinical narrative. Declared CLINICAL for that
   * reason, which pins it to Australia and to Bedrock behind the guardrail,
   * and makes a data residency waiver structurally impossible.
   *
   * What makes it safe to use freely is what happens BEFORE the gateway:
   * backend/assist/assist-deidentify.js replaces every known person
   * (practice-wide directory), every confirmed name and every contact
   * detail with tokens, and the chat route REFUSES any text that still
   * carries one. The model only ever sees tokens; the browser puts the
   * names back for the person who typed them. Output is a plain assistant
   * response — never a clinical document, so no draft is ever filed from
   * here without a human copying it into the proper place.
   */
  opal_assist: {
    classification: classification.CLINICAL,
    allowedClassifications: [
      classification.PUBLIC,
      classification.INTERNAL,
      classification.CLINICAL,
    ],
    outputTypes: [outputTypes.ASSISTANT_RESPONSE],
    defaultOutputType: outputTypes.ASSISTANT_RESPONSE,
    allowedProviders: [registry.PROVIDER_BEDROCK, registry.PROVIDER_MOCK],
    allowedModels: ['assistant_fast', 'clinical_standard', 'clinical_complex', 'mock'],
    defaultModel: 'assistant_fast',
    region: 'australia',
    mayReceiveClinicalData: true,
    auditCategory: 'assistant',
    // Same reasoning as Opa: the system prompt carries anti-injection
    // scaffolding that a Prompt-attack filter is built to match.
    guardrailInputScope: 'current_user_message',
  },

  /**
   * Induction assistant — the Owner's co-author for staff inductions and
   * portal walkthroughs on the Assign Learning page.
   *
   * INTERNAL, not clinical: it works on training content written by and for
   * staff — chapter titles, lesson text, quiz questions, walkthrough steps —
   * and on the Owner's instructions about them. No participant data has any
   * business here, so the feature does not declare the capacity to receive
   * it: a policy that can receive clinical input is a policy under which
   * clinical input will eventually arrive. INTERNAL still pins the call to
   * Australia (requirementsFor), so nothing about this is offshore.
   *
   * Tool use is how it acts — listing, reading, creating and updating
   * inductions through the same validators the routes use — and the gateway
   * refuses streaming with tools, so every turn is a whole, inspected
   * answer. Every tool call is a separate gateway generation and is audited
   * as one. Assigning is deliberately NOT a tool: putting learning in front
   * of a named person is the Owner's decision, made on the page.
   */
  induction_assistant: {
    classification: classification.INTERNAL,
    allowedClassifications: [classification.PUBLIC, classification.INTERNAL],
    outputTypes: [outputTypes.ASSISTANT_RESPONSE],
    defaultOutputType: outputTypes.ASSISTANT_RESPONSE,
    allowedProviders: [registry.PROVIDER_DIRECT, registry.PROVIDER_BEDROCK, registry.PROVIDER_MOCK],
    allowedModels: ['assistant_direct', 'clinical_standard', 'assistant_fast', 'mock'],
    defaultModel: 'assistant_direct',
    region: 'australia',
    mayReceiveClinicalData: false,
    auditCategory: 'assistant',
    guardrailInputScope: 'current_user_message',
    /**
     * DATA RESIDENCY WAIVER — the Owner's explicit decision (17 Sep 2026)
     * that this feature's inputs, staff training content the practice writes
     * about itself, may be processed through the vendor's public API rather
     * than the Australian Bedrock path. It is the only feature that carries
     * this, and validateAll refuses it to any policy that can receive
     * clinical input or produce a clinical document. The Bedrock models stay
     * allowed so a deployment without a vendor key can still run it onshore.
     */
    dataResidencyWaiver: true,
  },

  /**
   * Completed onboarding forms -> a structured transcription of what they say.
   *
   * Declared INTERNAL, not clinical, and that is the accurate call: a returned
   * Employee Details Form carries employment information about a person who
   * works here, not health information about somebody we treat. Clinical
   * classification exists to protect participants, and stretching it to cover
   * staff paperwork would blur the one distinction the register is for.
   *
   * INTERNAL still pins the call to Australia — see requirementsFor() — so
   * nothing about this is a relaxation of residency. What it does change is
   * the audit category, which is where a reviewer looks to answer "has any
   * participant data ever reached a model for this feature?" The honest answer
   * has to stay "no".
   *
   * ASSISTANT_RESPONSE only. A transcription is not a clinical document, and
   * declaring it as one would attach a clinical human-review obligation to the
   * wrong thing. The review that matters here is enforced by the feature
   * instead, and more strictly: nothing extracted reaches an employee record
   * until a person accepts it field by field.
   *
   * The standard model, not the complex one: reading labelled form fields is
   * transcription, and the harder model buys no accuracy on it.
   */
  onboarding_document_extraction: {
    classification: classification.INTERNAL,
    allowedClassifications: [classification.INTERNAL],
    outputTypes: [outputTypes.ASSISTANT_RESPONSE],
    defaultOutputType: outputTypes.ASSISTANT_RESPONSE,
    allowedProviders: [registry.PROVIDER_BEDROCK, registry.PROVIDER_MOCK],
    allowedModels: ['clinical_standard', 'mock'],
    defaultModel: 'clinical_standard',
    region: 'australia',
    mayReceiveClinicalData: false,
    auditCategory: 'onboarding_extraction',
  },

  /**
   * Reading a staff member's scanned credential — the AHPRA certificate, the
   * WWCC card, the insurance certificate of currency — so the expiry date is
   * transcribed rather than typed.
   *
   * SEPARATE FROM onboarding_document_extraction, deliberately. That feature
   * reads TEXT from returned forms and has no OCR path at all. This one sends
   * a PAGE IMAGE of an identity document to a vision model, which is a
   * materially different data flow, and folding it into the onboarding policy
   * would make `ai_interactions.feature` unable to answer the one question a
   * reviewer will ask: has an image of a staff identity document ever reached
   * a model? It must be answerable without reading code.
   *
   * INTERNAL, not clinical, and that is the accurate call: a practitioner's
   * own registration certificate is information about somebody who works here,
   * not health information about somebody we treat. INTERNAL still pins the
   * call to Australia — see requirementsFor().
   *
   * ASSISTANT_RESPONSE only. A transcription is not a clinical document. The
   * review that matters is enforced by the feature and more strictly: nothing
   * read from a scan reaches the credentials table until a person saves the
   * form field by field.
   *
   * The standard model, not the complex one: reading a printed certificate is
   * transcription, and the harder model buys no accuracy on it.
   */
  credential_document_extraction: {
    classification: classification.INTERNAL,
    allowedClassifications: [classification.INTERNAL],
    outputTypes: [outputTypes.ASSISTANT_RESPONSE],
    defaultOutputType: outputTypes.ASSISTANT_RESPONSE,
    allowedProviders: [registry.PROVIDER_BEDROCK, registry.PROVIDER_MOCK],
    allowedModels: ['clinical_standard', 'mock'],
    defaultModel: 'clinical_standard',
    region: 'australia',
    mayReceiveClinicalData: false,
    auditCategory: 'credential_extraction',
  },

};

/** Recognised guardrailInputScope values; absent means 'full'. */
const GUARDRAIL_INPUT_SCOPES = Object.freeze(['full', 'current_user_message']);

/**
 * Features that will need policies when they grow AI, listed so the omission
 * is visible rather than silent. None currently calls a model — FCA is a
 * deterministic docx engine and WHODAS is deterministic scoring.
 *
 * Do NOT pre-declare policies for them. An unused policy that turns out to be
 * wrong is worse than a loud denial that forces the decision when the feature
 * is actually built.
 */
const KNOWN_FUTURE_FEATURES = Object.freeze([
  'fca_generation',
  'whodas_interpretation',
  'report_writing',
  'resource_generation',
  'document_summarisation',
]);

function get(feature) {
  return Object.prototype.hasOwnProperty.call(AI_POLICIES, feature)
    ? AI_POLICIES[feature]
    : null;
}

function features() {
  return Object.keys(AI_POLICIES);
}

/** The features whose policy carries a data residency waiver. */
function waiverFeatures() {
  return Object.keys(AI_POLICIES).filter((f) => AI_POLICIES[f].dataResidencyWaiver === true);
}

/** Human review is derived, never declared — see ai-output-type.js. */
function requiresHumanReview(outputType) {
  return outputTypes.requiresHumanReview(outputType);
}

/**
 * Load-time invariants. Throwing is intentional: a policy file that breaches
 * the clinical boundary should stop the process, not degrade it.
 */
function validateAll() {
  for (const [feature, policy] of Object.entries(AI_POLICIES)) {
    const where = `ai-policy: ${feature}`;

    if (!classification.isValid(policy.classification)) {
      throw new Error(`${where} — unknown classification '${policy.classification}'`);
    }
    if (!Array.isArray(policy.allowedClassifications) || policy.allowedClassifications.length === 0) {
      throw new Error(`${where} — allowedClassifications must be a non-empty array`);
    }
    for (const level of policy.allowedClassifications) {
      if (!classification.isValid(level)) {
        throw new Error(`${where} — unknown classification '${level}' in allowedClassifications`);
      }
    }
    if (!policy.allowedClassifications.includes(policy.classification)) {
      throw new Error(`${where} — default classification '${policy.classification}' is not in allowedClassifications`);
    }

    if (!Array.isArray(policy.outputTypes) || policy.outputTypes.length === 0) {
      throw new Error(`${where} — outputTypes must be a non-empty array`);
    }
    for (const type of policy.outputTypes) {
      if (!outputTypes.isValid(type)) {
        throw new Error(`${where} — unknown output type '${type}'`);
      }
    }
    if (!policy.outputTypes.includes(policy.defaultOutputType)) {
      throw new Error(`${where} — defaultOutputType '${policy.defaultOutputType}' is not in outputTypes`);
    }

    // A feature that can produce clinical documents must be able to receive
    // clinical input — otherwise the declaration is internally inconsistent
    // and one of the two is wrong.
    if (policy.outputTypes.includes(outputTypes.CLINICAL_DOCUMENT)
        && !policy.allowedClassifications.includes(classification.CLINICAL)) {
      throw new Error(`${where} — produces clinical documents but may not receive clinical input`);
    }

    if (!Array.isArray(policy.allowedModels) || policy.allowedModels.length === 0) {
      throw new Error(`${where} — allowedModels must be a non-empty array of registry keys`);
    }
    for (const key of policy.allowedModels) {
      const model = registry.get(key);
      if (!model) throw new Error(`${where} — allowedModels references unknown registry key '${key}'`);
      if (!policy.allowedProviders.includes(model.provider)) {
        throw new Error(`${where} — model '${key}' uses provider '${model.provider}' which is not in allowedProviders`);
      }
    }
    if (!policy.allowedModels.includes(policy.defaultModel)) {
      throw new Error(`${where} — defaultModel '${policy.defaultModel}' is not in allowedModels`);
    }

    // A misspelt scope must fail at load, not silently narrow (or widen)
    // guardrail coverage at request time.
    if (policy.guardrailInputScope !== undefined
        && !GUARDRAIL_INPUT_SCOPES.includes(policy.guardrailInputScope)) {
      throw new Error(`${where} — guardrailInputScope '${policy.guardrailInputScope}' is not one of ${GUARDRAIL_INPUT_SCOPES.join(', ')}`);
    }

    // THE WAIVER IS NARROW. A policy may carry dataResidencyWaiver only when
    // nothing it can receive is clinical and nothing it can produce is a
    // clinical document. Everything else keeps the residency rule below.
    const waiver = policy.dataResidencyWaiver === true;
    if (waiver) {
      if (policy.allowedClassifications.includes(classification.CLINICAL)
          || policy.outputTypes.includes(outputTypes.CLINICAL_DOCUMENT)
          || policy.mayReceiveClinicalData) {
        throw new Error(`${where} — a data residency waiver cannot be granted to a clinical-capable feature`);
      }
    }
    // And the direct provider is reachable ONLY under a waiver: a model that
    // is not resident in Australia may appear in no other policy.
    for (const key of policy.allowedModels) {
      const model = registry.get(key);
      if (model.provider === registry.PROVIDER_DIRECT && !waiver) {
        throw new Error(`${where} — model '${key}' is the direct provider, which needs a data residency waiver`);
      }
    }

    // Anything above PUBLIC must stay onshore, for every classification the
    // feature may receive — not merely its default — unless waived.
    for (const level of policy.allowedClassifications) {
      const required = classification.requirementsFor(level);
      if (required.residency === 'australia' && policy.region !== 'australia') {
        throw new Error(`${where} — classification '${level}' requires region 'australia'`);
      }
      if (required.residency === 'australia' && !waiver) {
        for (const key of policy.allowedModels) {
          if (registry.get(key).residency !== 'australia') {
            throw new Error(`${where} — model '${key}' is not resident in Australia`);
          }
        }
      }
    }
  }
  return true;
}

validateAll();

module.exports = {
  AI_POLICIES,
  KNOWN_FUTURE_FEATURES,
  get,
  features,
  waiverFeatures,
  requiresHumanReview,
  validateAll,
};
