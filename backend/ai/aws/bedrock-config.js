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
  resolve,
  isConfigured,
  hasManagedIdentity,
};
