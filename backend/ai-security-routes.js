'use strict';

/**
 * AI SECURITY STATUS — a read-only view of the AI boundary's current shape.
 *
 * Exists for support and incident response: when someone asks "is AI on, what
 * is it pointed at, and is the boundary intact", this answers it in one
 * request instead of a shell on the app server.
 *
 * ── WHAT IT MUST NEVER RETURN ─────────────────────────────────────────────
 * No credentials, no AWS keys, no client data, no prompts, no clinical
 * content, no user identifiers. Everything here is configuration that is
 * already documented in docs/AI_SECURITY_ARCHITECTURE.md — approved models,
 * region, whether the switches are on. Proven by
 * tests/ai-security-routes.test.js.
 *
 * Restricted to owner/admin even so. It describes the security architecture,
 * and there is no reason a therapist account needs it.
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('./permissions');

const gateway = require('./ai/ai-gateway');
const registry = require('./ai/ai-model-registry');
const policyEngine = require('./ai/ai-policy');
const killSwitch = require('./ai/ai-kill-switch');
const selfCheck = require('./ai/ai-self-check');
const bedrockConfig = require('./ai/aws/bedrock-config');
const directApiConfig = require('./ai/direct-api-config');

const log = require('./logger').createLogger('ai-security');

/** Feature flags are per-feature; the gateway does not own them. */
const FEATURE_FLAGS = {
  clinical_note_generation: 'CLINICAL_NOTE_AI_ENABLED',
  opa_assistant: 'OPA_AI_ENABLED',
  opal_assist: 'OPAL_ASSIST_ENABLED',
  induction_assistant: 'INDUCTION_AI_ENABLED',
};

async function recentOutcomes() {
  try {
    const { rows } = await require('./database').pool.query(
      `SELECT feature, status, deny_reason, provider, latency_ms, created_at
         FROM ai_interactions ORDER BY created_at DESC LIMIT 15`);
    return rows;
  } catch {
    return null; // unknown beats a confident wrong answer
  }
}

router.get(
  '/api/ai/security-status',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const health = selfCheck.lastResult() || selfCheck.run();

      // The database switch is read here rather than trusted from cache, so
      // the answer reflects reality at the moment of asking.
      let globallyEnabled = null;
      try {
        globallyEnabled = await killSwitch.isGloballyEnabled();
      } catch {
        globallyEnabled = null; // unknown beats a confident wrong answer
      }

      const features = {};
      for (const feature of policyEngine.features()) {
        const policy = policyEngine.get(feature);
        const flag = FEATURE_FLAGS[feature];
        features[feature] = {
          flag_enabled: flag ? process.env[flag] === 'true' : null,
          gateway_permits: gateway.isAvailable(feature),
          blocked_reason: gateway.unavailableReason(feature),
          allowed_inputs: policy.allowedClassifications,
          output_types: policy.outputTypes,
          human_review: policy.outputTypes.includes('clinical_document'),
          // Offshore by decision, never by accident: only a waiver feature
          // can reach the vendor's public API, and this says which do.
          data_residency_waiver: policy.dataResidencyWaiver === true,
        };
      }

      res.json({
        ai_globally_enabled: globallyEnabled,
        kill_switch: {
          env_disabled: killSwitch.envDisabled(),
          setting_key: killSwitch.SETTING_KEY,
        },
        gateway_active: true,
        boundary_verified: health.ok,
        boundary_failures: health.ok ? [] : health.failed,
        provider: registry.PROVIDER_BEDROCK,
        region: gateway.resolveRegion(),
        approved_regions: registry.AU_REGIONS,
        approved_models: Object.values(registry.APPROVED_MODELS)
          .filter((m) => m.provider === registry.PROVIDER_BEDROCK)
          .map((m) => m.id),
        blocked_models: Object.keys(registry.PERMANENTLY_BLOCKED),
        // Whether the guardrail and any profile override RESOLVED — never
        // what they resolved to. An operator needs to know the guardrail is
        // pinned and at which version; the identifier itself is an account
        // internal that nothing on a status page needs.
        bedrock_configuration: bedrockConfig.describe(registry),
        // Which features may reach the vendor's public API, by policy waiver.
        // Everything else is confined to federated Bedrock by the boundary
        // tests. Empty means no feature leaves Australia.
        direct_provider_features: policyEngine.waiverFeatures(),
        direct_provider_configured: directApiConfig.isConfigured(),
        features,
        // The last few outcomes, so "it says unavailable" can be answered
        // without server logs. Metadata only - the audit table holds no content.
        recent_outcomes: await recentOutcomes(),
        warm_up: require('./assist/warmup').status(),
        checked_at: new Date().toISOString(),
      });
    } catch (err) {
      log.warn(`security-status failed (reason: ${err?.message || 'unknown'})`);
      res.status(500).json({ error: 'Unable to determine AI security status' });
    }
  }
);

module.exports = router;
