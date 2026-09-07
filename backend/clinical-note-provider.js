'use strict';

/**
 * CLINICAL NOTE GENERATION — dictated narrative → structured case-note draft.
 *
 * This module owns the *clinical* concerns: the case_note tool schema, the
 * style prompt selection, and rigorous validation of whatever comes back.
 * It owns none of the *security* concerns — jurisdiction, model approval,
 * provider approval and audit all live in backend/ai/ai-gateway.js, which is
 * the only path to a model anywhere in the backend.
 *
 * That split is the point. Previously this file chose its own region and
 * model, which meant every future AI feature would have had to re-implement
 * the same guards correctly. Now the boundary is enforced once, in one place,
 * and tests/ai-gateway-boundary.test.js fails the build if any module tries
 * to route around it.
 *
 * Policy for this feature (backend/ai/ai-policy.js → clinical_note_generation):
 *   classification  clinical    — health information, Australia-only inference
 *   models          clinical_complex (default) / clinical_standard
 *   humanReview     true        — output is ALWAYS a draft
 *
 * ── WHAT IS TRANSMITTED ───────────────────────────────────────────────────
 * (see docs/mobile/CASE_NOTE_AI_PRIVACY.md)
 *   - the therapist's dictated transcript (verbatim, as reviewed on device)
 *   - session date (DD/MM/YYYY) and the name-stripped service label
 *   - the versioned style prompt and optional regenerate modifier
 * NOT transmitted: client full name/address/DOB, event ids, therapist
 * identity, billing, travel, or any other appointment metadata — those are
 * merged deterministically after generation. No audio, ever.
 *
 * Fail-closed: isEnabled() requires CLINICAL_NOTE_AI_ENABLED='true' AND a
 * gateway configuration that satisfies policy. If either is missing,
 * generation is off and the caller must surface that without losing the
 * transcript. There is no fallback provider.
 *
 * Env:
 *   CLINICAL_NOTE_AI_ENABLED   'true' to enable (default off — fail closed)
 *   CLINICAL_NOTE_MAX_TOKENS   default 3000 (clamped 512..8192)
 *   CLINICAL_NOTE_TIMEOUT_MS   default 60000 (clamped 5000..120000)
 * Region and model are gateway/policy concerns — see AWS_REGION.
 */

const gateway = require('./ai/ai-gateway');
const { STYLE_PROFILES, INSTRUCTION_MODIFIERS } = require('./case-note-style');
const deid = require('./ai/deidentify');

/**
 * DE-IDENTIFICATION (backend/ai/deidentify.js). When the caller supplies
 * `identity` — the people this note may name — every known name is replaced
 * by a role token before the transcript leaves, the model is told to keep
 * tokens verbatim, and the names go back into the sections afterwards. A
 * result that carries a token we never issued, or a known name in the clear,
 * is refused ('names_not_hidden'): the therapist writes that note by hand.
 */
const TOKEN_INSTRUCTION = '\n\nPEOPLE ARE TOKENISED. The dictation refers to people by bracketed role tokens such as '
  + '[CLIENT], [CLIENT_MOTHER], [THERAPIST] or [PERSON]. Reproduce every token EXACTLY as written, including the '
  + 'square brackets, wherever that person is referred to. Never invent a token, never expand one into a name, '
  + 'never guess a name. Treat [CLIENT] as the participant the note is about.';

/** Names check without a model call: what would be hidden, what needs confirming. */
function previewNames({ transcript, identity }) {
  const map = deid.buildIdentityMap(identity && identity.people);
  const r = deid.deidentify(transcript || '', map, {
    confirmedNames: identity && identity.confirmedNames, ignoredWords: identity && identity.ignoredWords,
  });
  return {
    text: r.text,
    hidden: r.entries.map((e) => ({ token: e.token, label: deid.describeToken(e.token), count: e.count })),
    candidates: r.candidates,
  };
}

const FEATURE = 'clinical_note_generation';

const CASE_NOTE_TOOL = {
  name: 'case_note',
  description: 'Return the structured Opal Therapy case-note narrative.',
  input_schema: {
    type: 'object',
    properties: {
      identify: { type: 'string', description: 'Concise identification paragraph' },
      sessionDetails: { type: 'string', description: 'Chronological clinical narrative' },
      plan: { type: 'array', items: { type: 'string' }, description: 'Genuine follow-up actions only' },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Brief ambiguity flags for the therapist' },
    },
    required: ['identify', 'sessionDetails', 'plan', 'warnings'],
  },
};

// Size caps — a note section beyond these is a malformed response, not data.
const MAX_SECTION_CHARS = 12000;
const MAX_PLAN_ITEMS = 12;
const MAX_WARNINGS = 8;
const MAX_WARNING_CHARS = 200;

let _providerOverride = null;

const clampInt = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

function isEnabled() {
  return process.env.CLINICAL_NOTE_AI_ENABLED === 'true' && gateway.isAvailable(FEATURE);
}

/** Why generation is unavailable, or null. Safe to log — no secrets. */
function configError() {
  if (process.env.CLINICAL_NOTE_AI_ENABLED !== 'true') return 'feature_disabled';
  return gateway.unavailableReason(FEATURE);
}

/** Validate + trim the model's structured result. Throws on any violation. */
function validateResult(input) {
  if (!input || typeof input !== 'object') throw new Error('malformed');
  const { identify, sessionDetails, plan, warnings } = input;
  if (typeof identify !== 'string' || !identify.trim()) throw new Error('malformed');
  if (typeof sessionDetails !== 'string' || !sessionDetails.trim()) throw new Error('malformed');
  if (identify.length > MAX_SECTION_CHARS || sessionDetails.length > MAX_SECTION_CHARS) throw new Error('malformed');
  if (!Array.isArray(plan) || !Array.isArray(warnings)) throw new Error('malformed');
  const cleanPlan = plan
    .filter((p) => typeof p === 'string' && p.trim())
    .slice(0, MAX_PLAN_ITEMS)
    .map((p) => p.trim().slice(0, 500));
  const cleanWarnings = warnings
    .filter((w) => typeof w === 'string' && w.trim())
    .slice(0, MAX_WARNINGS)
    .map((w) => w.trim().slice(0, MAX_WARNING_CHARS));
  return {
    identify: identify.trim(),
    sessionDetails: sessionDetails.trim(),
    plan: cleanPlan,
    warnings: cleanWarnings,
  };
}

/**
 * Generate the narrative sections from a dictated transcript.
 *
 * @param {object} opts
 * @param {string} opts.transcript      reviewed dictation text
 * @param {string} opts.styleVersion    key into STYLE_PROFILES
 * @param {string} [opts.instruction]   key into INSTRUCTION_MODIFIERS
 * @param {object} opts.session        minimal context: { dateLabel, serviceLabel }
 * @param {string} [opts.userId]       audit actor
 * @param {string} [opts.organisationId]
 * @returns {Promise<{identify, sessionDetails, plan: string[], warnings: string[]}>}
 * @throws Error('generation_disabled') | Error('provider_error')
 */
async function generateCaseNote({
  transcript, styleVersion, instruction, session, userId, organisationId, modelKey, identity,
} = {}) {
  if (_providerOverride) {
    return _providerOverride({ transcript, styleVersion, instruction, session, identity });
  }
  if (!isEnabled()) throw new Error('generation_disabled');

  const stylePrompt = STYLE_PROFILES[styleVersion];
  if (!stylePrompt) throw new Error('provider_error');

  const modifier = instruction && INSTRUCTION_MODIFIERS[instruction]
    ? `\n\nTHERAPIST ADJUSTMENT FOR THIS REGENERATION: ${INSTRUCTION_MODIFIERS[instruction]}`
    : '';

  // Names out. `identity` absent means the caller chose not to de-identify
  // (legacy path); present means every known name is tokenised and the
  // result is checked on the way back.
  let sendText = transcript;
  let deidMap = null;
  let deidSummary = null;
  if (identity && Array.isArray(identity.people)) {
    const map = deid.buildIdentityMap(identity.people);
    const r = deid.deidentify(transcript, map, {
      confirmedNames: identity.confirmedNames, ignoredWords: identity.ignoredWords,
    });
    sendText = r.text;
    deidMap = r.map;
    deidSummary = { tokens: r.entries, candidateCount: r.candidates.length, version: 1 };
  }

  const context = [
    session?.dateLabel ? `Session date: ${session.dateLabel}` : null,
    session?.serviceLabel ? `Service: ${session.serviceLabel}` : null,
  ].filter(Boolean).join('\n');

  try {
    const res = await gateway.generate({
      feature: FEATURE,
      userId,
      organisationId,
      // Optional, and omitted by every route — the policy's default model is
      // what production uses. The gateway validates any value against that
      // feature's allowedModels, so this cannot reach a model the policy has
      // not already approved. It exists so tests can drive the mock provider
      // through the real gateway path instead of stubbing the gateway away.
      modelKey,
      // Explicit, though it is this feature's only permitted output type.
      // Declaring it keeps the human-review requirement derived from what the
      // answer IS rather than from which module happened to ask.
      outputType: 'clinical_document',
      system: stylePrompt + modifier + (deidMap ? TOKEN_INSTRUCTION : ''),
      // Forced tool use guarantees the structured shape and suppresses any
      // conversational preamble. `strict: true` is deliberately not set —
      // AWS model cards currently list structured outputs as unsupported on
      // Bedrock for these models, and validateResult() enforces shape, types
      // and size caps regardless.
      tools: [CASE_NOTE_TOOL],
      toolChoice: { type: 'tool', name: 'case_note' },
      maxTokens: clampInt(process.env.CLINICAL_NOTE_MAX_TOKENS, 3000, 512, 8192),
      timeoutMs: clampInt(process.env.CLINICAL_NOTE_TIMEOUT_MS, 60000, 5000, 120000),
      messages: [{
        role: 'user',
        content: `${context ? `${context}\n\n` : ''}Dictated session notes (verbatim):\n\n${sendText}`,
      }],
    });

    if (!res.toolUse || res.toolUse.name !== 'case_note') throw new Error('malformed');
    let sections = validateResult(res.toolUse.input);
    if (deidMap) {
      sections = restoreNames(sections, deidMap);
    }
    // `metadata` carries provenance only — model, provider, source region,
    // interaction id, review requirement. Never the prompt or a raw response:
    // the caller cannot persist what it is never handed.
    return { ...sections, metadata: res.metadata, deidentification: deidSummary };
  } catch (err) {
    if (err instanceof gateway.AiPolicyError) {
      // Policy refusal is a configuration state, not a transport failure —
      // the gateway has already audited it with the reason.
      throw new Error('generation_disabled');
    }
    // The guardrail declined the content. Distinct from every other outcome:
    // not a fault to retry, not a switch an operator can flip. The therapist
    // writes this note themselves, and the route turns it into a 422 so the
    // phone shows a refusal instead of a Retry button.
    if (err?.message === 'guardrail_intervened') throw new Error('content_blocked');
    // No guardrail configured. Reported as 'disabled' rather than 'blocked'
    // because it IS an operator-fixable configuration state — nothing about
    // the therapist's content was wrong, and the honest message is "not
    // available right now".
    if (err?.message === 'guardrail_not_configured') throw new Error('generation_disabled');
    if (err?.message === 'provider_error') throw err;
    // The model's answer could not be safely re-identified. Not retryable:
    // the same dictation would produce the same problem.
    if (err?.message === 'names_not_hidden') throw err;
    // Everything else (malformed structure, validation failure) is sanitised.
    console.warn(`[clinical-note] generation failed (reason: ${err?.message || 'unknown'})`);
    throw new Error('provider_error');
  }
}

/** Names back into every section; refuse anything we cannot account for. */
function restoreNames(sections, map) {
  const one = (text) => {
    const r = deid.reidentify(text, map);
    if (!r.ok) throw new Error('names_not_hidden');
    return r.text;
  };
  // A known full name in the clear in the MODEL's output means it was never
  // hidden on the way in (or was reconstructed) — either way, refuse.
  const leak = [sections.identify, sections.sessionDetails, ...sections.plan, ...sections.warnings]
    .some((t) => deid.containsKnownName(t, map));
  if (leak) throw new Error('names_not_hidden');
  return {
    identify: one(sections.identify),
    sessionDetails: one(sections.sessionDetails),
    plan: sections.plan.map(one),
    warnings: sections.warnings.map(one),
  };
}

/**
 * Provenance for the saved draft.
 *
 * NOTE THE `src=`. This records the region the request is SENT FROM, not the
 * region inference runs in. Under geographic cross-region inference an `au.`
 * profile sourced from Sydney may be processed in Sydney OR Melbourne. Both
 * are Australian, so residency holds either way — but do not cite this field
 * as proof of the processing location.
 *
 * The authoritative record is CloudTrail's
 * `additionalEventData.inferenceRegion`, logged in the source region.
 * Correlate on the gateway's providerRequestId and timestamp.
 *
 * Fits provider_id VARCHAR(40) / model_id VARCHAR(80) in migration 017.
 */
function providerIdentity() {
  const decision = gateway.evaluate({ feature: FEATURE });
  if (!decision.ok) {
    return { providerId: 'unavailable', modelId: 'unavailable' };
  }
  return {
    providerId: `${decision.model.provider}:src=${decision.region}`,
    modelId: decision.model.id,
  };
}

function _setProviderForTests(fn) {
  _providerOverride = typeof fn === 'function' ? fn : null;
}

module.exports = {
  FEATURE,
  generateCaseNote,
  previewNames,
  isEnabled,
  configError,
  providerIdentity,
  validateResult,
  _setProviderForTests,
};
