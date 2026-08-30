'use strict';

/**
 * APPROVED MODEL REGISTRY — the single place a model id may be written.
 *
 * Nothing else in the codebase may contain a raw model string. Features
 * reference a logical key ('clinical_standard'), policies list keys, and
 * when a new Claude generation ships you change one file rather than
 * grepping for version numbers across a clinical system.
 *
 * Every entry records the regions the model may be *sourced* from, because
 * Australian routing is NOT uniform across models: Claude Sonnet 5, for
 * example, has a genuine `au.` profile that cannot be sourced from Sydney.
 * A flat "these models are Australian" list would hide that.
 *
 * NO BEDROCK PROFILE ID IS WRITTEN IN THIS FILE.
 * The two clinical entries previously carried ids taken from public model
 * cards. Nobody with access to the practice's AWS account had confirmed those
 * profiles existed in it, and profile availability is granted per account — so
 * a correct-looking id can still be absent, and "provisional" is not a state a
 * clinical system should invoke from.
 *
 * The id is supplied by BEDROCK_MODEL_ID and resolved in
 * ai/aws/bedrock-config.js, which applies the same invariants an entry here
 * would (Australian geo profile, not a Covered Model) and refuses outright if
 * either fails. Verify before configuring:
 *   aws bedrock get-inference-profile \
 *     --inference-profile-identifier <id> --region <region>
 */

// Imported, not redeclared. This list existed in two files; two copies of an
// allowlist is one copy that can be widened without the other noticing. The
// config owner holds it, and takes the registry as a parameter rather than
// importing it, so this direction cannot cycle.
const { ALLOWED_REGIONS: AU_REGIONS } = require('./aws/bedrock-config');

/** Provider ids. Only Bedrock is approved for anything real. */
const PROVIDER_BEDROCK = 'aws-bedrock';
const PROVIDER_MOCK = 'mock';

/**
 * Australian geo inference profiles carry this prefix. Checked independently
 * of the registry so a mistyped entry cannot smuggle in a `global.` or
 * `apac.` route — the latter reads as regional but also reaches Tokyo,
 * Seoul, Osaka, Mumbai, Hyderabad and Singapore.
 */
const AU_GEO_PREFIX = 'au.anthropic.';

/**
 * NO BEDROCK MODEL ID IS WRITTEN HERE.
 *
 * `id: null` is deliberate. This registry previously carried literal
 * `au.anthropic.*` profile strings as defaults. Which inference profiles exist
 * is a fact about one AWS account, it cannot be read from source, and it was
 * never verified — so those literals were guesses that looked like decisions.
 * A wrong-but-plausible profile id is the worst kind: it passes every local
 * check, is written into the audit row as the model in use, and only fails when
 * a therapist is waiting.
 *
 * The id now comes from BEDROCK_MODEL_ID via ai/aws/bedrock-config.js, which is
 * the only module that may resolve one. This registry keeps what it can
 * genuinely assert from source: which logical models exist, which provider and
 * regions they may use, and which ids are permanently forbidden.
 */
const APPROVED_MODELS = Object.freeze({
  /** Everyday structuring and summarisation. The default for most work. */
  clinical_standard: Object.freeze({
    id: null,
    provider: PROVIDER_BEDROCK,
    regions: AU_REGIONS,
    residency: 'australia',
    description: 'Australian geo inference profile supplied by BEDROCK_MODEL_ID.',
  }),

  /**
   * Low-latency assistant tier for interactive chat (Opa). Same provider,
   * same Australian residency rules, same guardrail — only the profile is
   * expected to point at a faster model. Resolved via
   * BEDROCK_MODEL_ID_ASSISTANT_FAST, falling back to the base
   * BEDROCK_MODEL_ID when a deployment has not separated them, so declaring
   * this tier never weakens or changes anything until an operator supplies
   * the dedicated profile.
   */
  assistant_fast: Object.freeze({
    id: null,
    provider: PROVIDER_BEDROCK,
    regions: AU_REGIONS,
    residency: 'australia',
    description: 'Australian geo inference profile supplied by BEDROCK_MODEL_ID_ASSISTANT_FAST (falls back to BEDROCK_MODEL_ID).',
  }),

  /** Report-grade fidelity where omission risk matters most. */
  clinical_complex: Object.freeze({
    id: null,
    provider: PROVIDER_BEDROCK,
    regions: AU_REGIONS,
    residency: 'australia',
    description: 'Australian geo inference profile supplied by BEDROCK_MODEL_ID.',
  }),

  /** Deterministic stand-in for tests and credential-free local dev. */
  mock: Object.freeze({
    id: 'mock-model',
    provider: PROVIDER_MOCK,
    regions: AU_REGIONS,
    residency: 'australia',
    description: 'Deterministic mock. Never reaches a network.',
  }),
});

/**
 * Models that must NEVER be reachable, with the reason recorded so a future
 * reader does not "helpfully" add them back.
 *
 * Fable 5 and Mythos 5 are Covered Models: they REQUIRE data retention, share
 * prompts and completions with the model provider for up to 30 days on
 * Bedrock (`provider_data_share`), and are excluded from Bedrock's HIPAA
 * eligibility. Unusable for any classification above PUBLIC, and there is no
 * reason to allow them at all.
 *
 * This list is belt to the allowlist's braces — an unlisted model is already
 * denied. It exists so the denial is *explained* rather than incidental, and
 * so a test can assert it. Mirror it with an AWS organisation-level deny.
 */
const PERMANENTLY_BLOCKED = Object.freeze({
  'au.anthropic.claude-fable-5': 'Covered Model — mandates data retention and provider data sharing.',
  'au.anthropic.claude-mythos-5': 'Covered Model — mandates data retention and provider data sharing.',
  'anthropic.claude-fable-5': 'Covered Model — mandates data retention and provider data sharing.',
  'anthropic.claude-mythos-5': 'Covered Model — mandates data retention and provider data sharing.',
});

function get(key) {
  return APPROVED_MODELS[key] || null;
}

function keys() {
  return Object.keys(APPROVED_MODELS);
}

/** Why this model key is unusable in this region, or null when it is fine. */
function validate(key, region) {
  const model = get(key);
  if (!model) return `model_not_in_registry:${key}`;
  // A Bedrock entry carries no id of its own; the deployment supplies it and
  // ai/aws/bedrock-config.js applies these same two rules to that value. The
  // checks below therefore only run when an id is actually present, which is
  // the mock provider and any future non-Bedrock entry.
  if (model.id) {
    if (PERMANENTLY_BLOCKED[model.id]) return `model_permanently_blocked:${model.id}`;
    if (model.provider === PROVIDER_BEDROCK && !model.id.startsWith(AU_GEO_PREFIX)) {
      return `model_not_au_geo_profile:${model.id}`;
    }
  }
  if (region && !model.regions.includes(region)) {
    return `model_not_available_in_region:${region}`;
  }
  return null;
}

module.exports = {
  APPROVED_MODELS,
  PERMANENTLY_BLOCKED,
  AU_REGIONS,
  AU_GEO_PREFIX,
  PROVIDER_BEDROCK,
  PROVIDER_MOCK,
  get,
  keys,
  validate,
};
