'use strict';

/**
 * Configuration for the federated Bedrock path. Reads environment, decides
 * nothing else.
 *
 * FAIL CLOSED, AND SAY WHY
 * Every getter returns a value or a reason it cannot. There is no default for
 * anything that identifies an AWS resource — no fallback role ARN, no fallback
 * model, no fallback guardrail. A missing setting must stop the call, because
 * the alternative is a clinical request quietly going somewhere nobody chose.
 *
 * THE MODEL ID IS NOT DEFAULTED, DELIBERATELY
 * `BEDROCK_MODEL_ID` has no fallback and is validated against the Australian
 * geo prefix. The intended model is Claude Sonnet 5 via an Australia geo
 * inference profile, but the exact profile id could not be verified against the
 * AWS account from this environment, and writing an unverified profile string
 * into code would be inventing an identifier. Supply the verified id as
 * configuration; anything that is not an `au.` profile is refused here.
 *
 * Nothing in this module logs a value. Setting NAMES appear in errors so an
 * operator can fix the deployment; values never do.
 */

/** Australian geo inference profiles carry this prefix. */
const AU_GEO_PREFIX = 'au.anthropic.';

/**
 * Regions the Australia-only service-control policy permits.
 * Sydney and Melbourne. Global routing is not allowed and is not listed.
 */
const ALLOWED_REGIONS = Object.freeze(['ap-southeast-2', 'ap-southeast-4']);

const REQUIRED = Object.freeze([
  'AWS_ROLE_ARN',
  'AZURE_BEDROCK_AUDIENCE',
  'AWS_REGION',
  'BEDROCK_MODEL_ID',
  'BEDROCK_GUARDRAIL_ID',
  'BEDROCK_GUARDRAIL_VERSION',
]);

const str = (name) => {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/**
 * Resolve and validate the whole configuration in one pass.
 *
 * @returns {{ok: true, config: object} | {ok: false, reason: string, missing: string[]}}
 */
function resolve() {
  const missing = REQUIRED.filter((n) => !str(n));
  if (missing.length) {
    return { ok: false, reason: 'bedrock_config_incomplete', missing };
  }

  const region = str('AWS_REGION');
  if (!ALLOWED_REGIONS.includes(region)) {
    // Not merely unexpected — the AWS service-control policy would refuse it,
    // so calling would burn a request to learn what config already knows.
    return { ok: false, reason: 'region_not_permitted', missing: [] };
  }

  const modelId = str('BEDROCK_MODEL_ID');
  if (!modelId.startsWith(AU_GEO_PREFIX)) {
    // A `global.` or `apac.` profile reads as regional but reaches Tokyo,
    // Seoul, Mumbai and Singapore. Only `au.` stays onshore.
    return { ok: false, reason: 'model_not_au_geo_profile', missing: [] };
  }

  const roleArn = str('AWS_ROLE_ARN');
  if (!/^arn:aws[a-z-]*:iam::\d{12}:role\/.+/.test(roleArn)) {
    return { ok: false, reason: 'role_arn_malformed', missing: [] };
  }

  return {
    ok: true,
    config: Object.freeze({
      roleArn,
      audience: str('AZURE_BEDROCK_AUDIENCE'),
      region,
      modelId,
      guardrailId: str('BEDROCK_GUARDRAIL_ID'),
      guardrailVersion: str('BEDROCK_GUARDRAIL_VERSION'),
      sessionName: str('AWS_ROLE_SESSION_NAME') || 'opal-portal-staging',
    }),
  };
}

/** True when every required setting is present and valid. */
function isConfigured() {
  return resolve().ok === true;
}

// ── Per-concern resolvers ───────────────────────────────────────────────────
//
// These were previously a second module (ai/ai-bedrock-config.js). Two modules
// reading the same six variables meant two places for a rule to drift, and the
// pair had already disagreed once about what the guardrail variables were
// called. There is now exactly one owner.

/**
 * Guardrail identifiers are AWS-generated: lowercase alphanumeric, or a full
 * ARN. Validated for SHAPE only — whether the id EXISTS can be established by
 * exactly one thing, which is AWS answering a call with it.
 */
const GUARDRAIL_ID_PATTERN = /^([a-z0-9]{4,64}|arn:aws:bedrock:[a-z0-9-]+:\d{12}:guardrail\/[a-zA-Z0-9-]+)$/;

/** A numeric version, or the literal DRAFT that AWS uses for the unpublished one. */
const GUARDRAIL_VERSION_PATTERN = /^(\d{1,10}|DRAFT)$/;

/**
 * The region to invoke from.
 *
 * REQUIRED, WITH NO DEFAULT. This previously read `AI_AWS_REGION || 'ap-southeast-2'`,
 * which meant a deployment that forgot the setting still invoked — silently, in
 * Sydney, because the code chose for it. A default is indistinguishable from a
 * deliberate decision once it is running, and "fail closed" cannot coexist with
 * a fallback that makes the call succeed.
 *
 * @returns {{ok: true, region: string}|{ok: false, reason: string}}
 */
function resolveRegion() {
  const region = str('AWS_REGION');
  if (!region) return { ok: false, reason: 'region_not_configured' };
  if (!ALLOWED_REGIONS.includes(region)) return { ok: false, reason: 'region_not_permitted' };
  return { ok: true, region };
}

/**
 * The guardrail to apply to every clinical Bedrock call.
 *
 * WHY ABSENT MUST MEAN DISABLED, NOT UNGUARDED
 * A Bedrock call with no guardrail header succeeds. It returns a normal, well
 * formed, entirely usable clinical draft. Nothing in the response says the
 * safety layer was skipped, the audit row looks identical, and the therapist
 * sees the same screen. The failure is silent and total.
 *
 * `configured: false` means nothing was supplied at all — the normal state in
 * development and test, where the mock provider is used. `configured: true`
 * with ok:false is a genuine misconfiguration and is reported far more loudly.
 */
function resolveGuardrail() {
  const id = str('BEDROCK_GUARDRAIL_ID');
  const version = str('BEDROCK_GUARDRAIL_VERSION');

  if (!id && !version) return { ok: false, reason: 'guardrail_not_configured', configured: false };
  // Half-configured is the dangerous state: someone was mid-way through setting
  // this up. It must never resolve to "close enough".
  if (!id) return { ok: false, reason: 'guardrail_id_missing', configured: true };
  if (!version) return { ok: false, reason: 'guardrail_version_missing', configured: true };

  // Reasons carry the failing RULE, never the value. This string reaches the
  // health endpoint, and an identifier there would disclose account internals.
  if (!GUARDRAIL_ID_PATTERN.test(id)) {
    return { ok: false, reason: 'guardrail_id_malformed', configured: true };
  }
  if (!GUARDRAIL_VERSION_PATTERN.test(version)) {
    return { ok: false, reason: 'guardrail_version_malformed', configured: true };
  }
  // DRAFT is the unpublished, mutable version: its behaviour can change under a
  // running application without a deployment. Permitted, and surfaced.
  return { ok: true, id, version, isDraft: version === 'DRAFT' };
}

/**
 * The clinical inference profile.
 *
 * REQUIRED for Bedrock, not an override. The registry used to carry literal
 * `au.anthropic.*` ids as defaults; they were never verified against the AWS
 * account and could not be, from here. A wrong-but-plausible profile id fails
 * at invoke time having already been audited as the model in use, so the id now
 * comes from the deployment or the call does not happen.
 *
 * @param {object} registry injected so this module holds no model strings
 * @returns {{ok: true, id: string}|{ok: false, reason: string}}
 */
function resolveModelProfile(registry) {
  const id = str('BEDROCK_MODEL_ID');
  // `configured: false` distinguishes "nothing supplied" from "supplied and
  // wrong", exactly as resolveGuardrail does. Nothing supplied is the normal
  // state on a laptop and in tests, where the mock provider serves and no
  // Bedrock call happens; the gateway still refuses the moment a Bedrock model
  // is actually selected. Supplied-and-wrong is a misconfiguration and is fatal
  // to the self-check.
  if (!id) return { ok: false, reason: 'model_profile_not_configured', configured: false };

  if (!id.startsWith(registry.AU_GEO_PREFIX)) {
    return { ok: false, reason: 'model_profile_not_au_geo', configured: true };
  }
  if (registry.PERMANENTLY_BLOCKED[id]) {
    return { ok: false, reason: 'model_profile_permanently_blocked', configured: true };
  }
  // case_note_drafts.model_id is VARCHAR(80). A longer value would be accepted
  // here, invoked successfully, then fail on INSERT — after the clinical
  // content had already been sent.
  if (id.length > 80) return { ok: false, reason: 'model_profile_too_long', configured: true };
  return { ok: true, id };
}

/**
 * A redacted view for the health endpoint and the boot log.
 * Reports whether each input resolved, never what it resolved to.
 */
function describe(registry) {
  const guardrail = resolveGuardrail();
  const profile = resolveModelProfile(registry);
  const region = resolveRegion();
  return {
    region: region.ok ? { configured: true, region: region.region } : { configured: false, reason: region.reason },
    guardrail: guardrail.ok
      ? { configured: true, version: guardrail.version, isDraft: !!guardrail.isDraft }
      : { configured: !!guardrail.configured, reason: guardrail.reason },
    modelProfile: profile.ok ? { configured: true } : { configured: false, reason: profile.reason },
  };
}

/**
 * Whether this process can obtain a managed identity at all.
 *
 * App Service injects IDENTITY_ENDPOINT and IDENTITY_HEADER. A developer
 * laptop has neither, which is why localhost uses the mock adapter rather than
 * pretending to federate.
 */
function hasManagedIdentity() {
  return !!(process.env.IDENTITY_ENDPOINT && process.env.IDENTITY_HEADER);
}

module.exports = {
  AU_GEO_PREFIX,
  ALLOWED_REGIONS,
  REQUIRED,
  GUARDRAIL_ID_PATTERN,
  GUARDRAIL_VERSION_PATTERN,
  resolve,
  isConfigured,
  hasManagedIdentity,
  resolveRegion,
  resolveGuardrail,
  resolveModelProfile,
  describe,
};
