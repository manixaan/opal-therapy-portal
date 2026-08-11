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
 * Checked against the AWS Bedrock model cards on 2026-08-10. Re-check before
 * adding an entry:
 *   aws bedrock get-inference-profile \
 *     --inference-profile-identifier <id> --region <region>
 *
 * THE TWO CLINICAL IDS BELOW ARE PROVISIONAL.
 * They were taken from public model cards, not from the practice's own AWS
 * account, and nobody with access to that account has confirmed the profiles
 * exist in it. Profile availability is granted per account, so a correct-looking
 * id can still be absent.
 *
 * A deployment that knows better overrides them with BEDROCK_MODEL_ID, which is
 * validated against the same invariants as an entry here (Australian geo
 * profile, not a Covered Model) and refused outright if it fails either. See
 * ai-bedrock-config.js. That is the supported way to correct these without a
 * code change — and the reason the override exists at all.
 */

const AU_REGIONS = Object.freeze(['ap-southeast-2', 'ap-southeast-4']);

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

const APPROVED_MODELS = Object.freeze({
  /** Everyday structuring and summarisation. The default for most work. */
  clinical_standard: Object.freeze({
    id: 'au.anthropic.claude-sonnet-4-6',
    provider: PROVIDER_BEDROCK,
    regions: AU_REGIONS,
    residency: 'australia',
    description: 'Claude Sonnet 4.6 via Australian geo inference profile.',
  }),

  /** Report-grade fidelity where omission risk matters most. */
  clinical_complex: Object.freeze({
    id: 'au.anthropic.claude-opus-4-8',
    provider: PROVIDER_BEDROCK,
    regions: AU_REGIONS,
    residency: 'australia',
    description: 'Claude Opus 4.8 via Australian geo inference profile.',
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
  if (PERMANENTLY_BLOCKED[model.id]) return `model_permanently_blocked:${model.id}`;
  if (model.provider === PROVIDER_BEDROCK && !model.id.startsWith(AU_GEO_PREFIX)) {
    return `model_not_au_geo_profile:${model.id}`;
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
