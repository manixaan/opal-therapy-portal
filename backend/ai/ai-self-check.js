'use strict';

/**
 * AI BOUNDARY SELF-CHECK — verify the security boundary at boot, and refuse
 * to run AI if it is not intact.
 *
 * The gateway's guards assume its collaborators are present and sane: a
 * policy registry that validated, a model registry containing only Australian
 * geo profiles, an audit layer that can record, a kill switch that can be
 * read. If one of those is missing or malformed, the guards are not weaker —
 * they are *unverified*, which for a clinical system is the same thing.
 *
 * So this runs once at startup and its result gates the gateway. A failed
 * check disables AI for the life of the process. That is deliberate: a
 * healthcare system with an unverifiable safety boundary should decline to
 * use AI rather than proceed and hope.
 *
 * It is NOT a substitute for the CI boundary test — that scans source and
 * catches a developer adding an SDK to a feature module. This checks the
 * runtime shape of what actually loaded.
 */

const registry = require('./ai-model-registry');
const policyEngine = require('./ai-policy');
const classification = require('./ai-classification');
const outputTypes = require('./ai-output-type');
const killSwitch = require('./ai-kill-switch');
const audit = require('./ai-audit');
const bedrockConfig = require('./ai-bedrock-config');

/** Fields that must never appear in the audit allowlist. */
const FORBIDDEN_AUDIT_FIELDS = [
  'prompt', 'response', 'transcript', 'content', 'text',
  'note', 'noteBody', 'clientName', 'messages', 'system',
];

let _result = null;

function check(name, fn) {
  try {
    const detail = fn();
    return { name, ok: true, detail: detail || null };
  } catch (err) {
    return { name, ok: false, detail: err?.message || 'failed' };
  }
}

/**
 * Run every boundary check. Pure and synchronous — safe to call at boot
 * before the database is reachable.
 */
function run() {
  const checks = [
    check('policy registry loaded', () => {
      policyEngine.validateAll();
      const features = policyEngine.features();
      if (!features.length) throw new Error('no features declared');
      return `${features.length} feature(s)`;
    }),

    check('model registry loaded', () => {
      const keys = registry.keys();
      if (!keys.length) throw new Error('no models registered');
      return `${keys.length} model(s)`;
    }),

    check('approved models are Australian geo profiles', () => {
      for (const key of registry.keys()) {
        const model = registry.get(key);
        if (model.provider === registry.PROVIDER_MOCK) continue;
        if (!model.id.startsWith(registry.AU_GEO_PREFIX)) {
          throw new Error(`${key} is not an au. profile`);
        }
        if (model.residency !== 'australia') throw new Error(`${key} is not resident in Australia`);
        for (const region of model.regions) {
          if (!registry.AU_REGIONS.includes(region)) {
            throw new Error(`${key} permits non-Australian region ${region}`);
          }
        }
      }
      return 'all onshore';
    }),

    check('retention-mandating models are blocked', () => {
      const blocked = Object.keys(registry.PERMANENTLY_BLOCKED);
      if (!blocked.length) throw new Error('blocklist is empty');
      for (const id of blocked) {
        if (Object.values(registry.APPROVED_MODELS).some((m) => m.id === id)) {
          throw new Error(`${id} is both blocked and approved`);
        }
      }
      return `${blocked.length} blocked`;
    }),

    check('classification and output types intact', () => {
      if (!classification.CLASSIFICATIONS.includes(classification.CLINICAL)) {
        throw new Error('clinical classification missing');
      }
      if (!outputTypes.requiresHumanReview(outputTypes.CLINICAL_DOCUMENT)) {
        throw new Error('clinical documents no longer require human review');
      }
      return 'review invariant holds';
    }),

    check('audit layer available and content-free', () => {
      for (const fn of ['buildEvent', 'record', 'reserve', 'finalise', 'securityEvent']) {
        if (typeof audit[fn] !== 'function') throw new Error(`audit.${fn} missing`);
      }
      const lower = audit.ALLOWED_FIELDS.map((f) => f.toLowerCase());
      for (const forbidden of FORBIDDEN_AUDIT_FIELDS) {
        if (lower.includes(forbidden.toLowerCase())) {
          throw new Error(`audit allowlist contains '${forbidden}'`);
        }
      }
      return `${audit.ALLOWED_FIELDS.length} metadata fields`;
    }),

    check('transport destination is code-controlled', () => {
      // The Anthropic SDK falls back to these env vars for endpoint and auth.
      // awsRegion only sets the SigV4 signing scope, so an override would send
      // clinical transcripts elsewhere while every guard, audit row and status
      // response still reported an Australian region. The provider pins
      // baseURL; this makes the attempt fail the boundary rather than be
      // silently overridden.
      //
      // Only variables the Bedrock client actually honours. Verified
      // empirically on 2026-08-10: ANTHROPIC_BEDROCK_BASE_URL redirects it,
      // ANTHROPIC_BASE_URL does NOT (that is the first-party client's, and it
      // is commonly set in developer environments — checking it would disable
      // AI for the wrong reason). AWS_BEARER_TOKEN_BEDROCK makes the SDK skip
      // SigV4 entirely, so an off-AWS destination would succeed cleanly
      // instead of failing a signature check.
      //
      // Names only — this detail reaches boundary_failures on the health
      // endpoint, and a URL could carry a credential in its query or userinfo.
      const overrides = ['ANTHROPIC_BEDROCK_BASE_URL', 'AWS_BEARER_TOKEN_BEDROCK']
        .filter((key) => process.env[key]);
      if (overrides.length) {
        throw new Error(`transport override set: ${overrides.join(', ')}`);
      }
      return 'endpoint pinned in provider';
    }),

    check('bedrock guardrail configuration', () => {
      // Deliberately NOT fatal when nothing is configured. Development and
      // test run on the mock provider, where there is no guardrail to point
      // at, and failing the whole boundary there would disable AI for a
      // reason that does not apply.
      //
      // The enforcement lives in the provider, which refuses to transmit
      // without a resolved guardrail — so "absent" already means every real
      // Bedrock call fails closed. What this check adds is VISIBILITY: the
      // state is on the health endpoint and in the boot log rather than only
      // discoverable by making a request and reading the failure.
      //
      // A HALF-configured guardrail is fatal, because that is somebody
      // part-way through setting this up, and it is the state most likely to
      // be mistaken for done.
      const g = bedrockConfig.resolveGuardrail();
      if (g.ok) return `pinned at version ${g.version}${g.isDraft ? ' (DRAFT — mutable, not for clinical use)' : ''}`;
      if (g.configured) throw new Error(g.reason);
      return 'not configured — Bedrock calls will refuse';
    }),

    check('model profile override is valid if present', () => {
      const p = bedrockConfig.resolveModelProfileOverride(registry);
      if (!p.ok) throw new Error(p.reason);
      return p.id ? 'deployment override in use' : 'registry default';
    }),

    check('kill switch available', () => {
      if (typeof killSwitch.isGloballyEnabled !== 'function') throw new Error('unavailable');
      return killSwitch.envDisabled() ? 'present (currently DISABLED by env)' : 'present';
    }),
  ];

  const failed = checks.filter((c) => !c.ok);
  _result = {
    ok: failed.length === 0,
    checks,
    failed: failed.map((c) => `${c.name}: ${c.detail}`),
    ranAt: new Date().toISOString(),
  };
  return _result;
}

/**
 * Whether AI may run.
 *
 * Runs the checks on first use if boot never did, so a process that forgot to
 * wire runAndReport() still gets a verified boundary rather than an assumed
 * one. Fails closed on the outcome: a failing check disables AI.
 */
function isHealthy() {
  if (_result === null) run();
  return _result.ok === true;
}

function lastResult() {
  return _result;
}

/** Log the checklist at boot and record a security event on failure. */
function runAndReport(logger = console) {
  const result = run();
  const lines = result.checks.map(
    (c) => `  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`
  );
  logger.log([
    'AI SECURITY CHECK',
    '-----------------',
    ...lines,
    '',
    result.ok ? 'AI READY' : `AI DISABLED\nReason:\n  ${result.failed.join('\n  ')}`,
  ].join('\n'));

  if (!result.ok) {
    // Best effort — the database may be exactly what is broken.
    audit.securityEvent({
      eventType: 'self_check_failed',
      newState: 'disabled',
      detail: result.failed.join('; '),
    }).catch(() => {});
  }
  return result;
}

/** Test seam: force a state without re-running the real checks. */
function _setResultForTests(result) {
  _result = result;
}

module.exports = { run, runAndReport, isHealthy, lastResult, FORBIDDEN_AUDIT_FIELDS, _setResultForTests };
