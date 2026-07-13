'use strict';

/**
 * ENVIRONMENT VALIDATION
 *
 * One place that knows which configuration the application needs, per
 * environment. server.js calls validateEnvironment() at boot:
 *   - development: problems are WARNED and boot continues
 *   - production/staging: missing critical config REFUSES to boot
 *
 * Pure function over an env object → fully unit-testable.
 */

const CRITICAL_IN_PRODUCTION = [
  { key: 'SESSION_SECRET',       why: 'session integrity', validate: v => v && v.length >= 32 && !WEAK_SECRETS.has(v) },
  { key: 'TOKEN_ENCRYPTION_KEY', why: 'OAuth tokens encrypted at rest', validate: v => /^[0-9a-f]{64}$/i.test(v || '') },
  { key: 'DB_PASSWORD',          why: 'database authentication' },
  { key: 'ALLOWED_ORIGINS',      why: 'CORS/CSRF allowlist must name the real domain' },
  { key: 'MICROSOFT_CLIENT_ID',  why: 'Outlook OAuth' },
  { key: 'MICROSOFT_CLIENT_SECRET', why: 'Outlook OAuth' },
  { key: 'MICROSOFT_REDIRECT_URI', why: 'must match the Azure app registration exactly' },
  { key: 'SPLOSE_API_KEY',       why: 'Splose integration' },
];

const RECOMMENDED = [
  { key: 'GOOGLE_MAPS_API_KEY',  why: 'travel time / geocoding features degrade without it' },
  { key: 'EMAIL_HOST',           why: 'verification/invite/reset emails fall back to console links' },
  { key: 'APP_BASE_URL',         why: 'email links point at localhost without it' },
  { key: 'MICROSOFT_TENANT_ID',  why: 'falls back to the development tenant' },
];

// Conditional: only required when the feature is enabled.
const CONDITIONAL = [
  {
    when: env => !!env.WEBHOOK_BASE_URL,
    key: 'WEBHOOK_CLIENT_STATE',
    why: 'webhooks enabled — clientState must not be the hardcoded default',
    validate: v => !!v && v !== 'opal-scheduler-webhook',
  },
];

const WEAK_SECRETS = new Set([
  '', 'dev-secret-change-in-production', 'thisismyrandomsecret12345',
  'secret', 'change_me', 'changeme', 'password',
]);

/**
 * @param {object} env  usually process.env
 * @returns {{ ok: boolean, environment: string, errors: Array, warnings: Array }}
 */
function validateEnvironment(env = process.env) {
  const environment = env.NODE_ENV || 'development';
  const strict = environment === 'production' || environment === 'staging';
  const errors = [];
  const warnings = [];

  for (const item of CRITICAL_IN_PRODUCTION) {
    const value = env[item.key];
    const valid = item.validate ? item.validate(value) : !!value;
    if (!valid) {
      (strict ? errors : warnings).push({ key: item.key, why: item.why });
    }
  }

  for (const item of RECOMMENDED) {
    if (!env[item.key]) warnings.push({ key: item.key, why: item.why });
  }

  for (const item of CONDITIONAL) {
    if (item.when(env)) {
      const valid = item.validate ? item.validate(env[item.key]) : !!env[item.key];
      if (!valid) (strict ? errors : warnings).push({ key: item.key, why: item.why });
    }
  }

  return { ok: errors.length === 0, environment, errors, warnings };
}

/** Boot-time wrapper: logs a readable report; exits in strict envs on errors. */
function enforceEnvironmentOrExit(env = process.env, exit = process.exit) {
  const report = validateEnvironment(env);
  for (const w of report.warnings) {
    console.warn(`⚠️  env: ${w.key} — ${w.why}`);
  }
  if (!report.ok) {
    for (const e of report.errors) {
      console.error(`❌ env: ${e.key} is missing/invalid — ${e.why}`);
    }
    console.error(`❌ Refusing to start in ${report.environment} with invalid configuration.`);
    exit(1);
  }
  return report;
}

module.exports = { validateEnvironment, enforceEnvironmentOrExit };
