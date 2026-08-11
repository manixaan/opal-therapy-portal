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
const bedrockConfig = require('./ai/ai-bedrock-config');

const log = require('./logger').createLogger('ai-security');

/** Feature flags are per-feature; the gateway does not own them. */
const FEATURE_FLAGS = {
  clinical_note_generation: 'CLINICAL_NOTE_AI_ENABLED',
  opa_assistant: 'OPA_AI_ENABLED',
};

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
        // The CI boundary test is what makes this true; asserted here so the
        // claim is visible to whoever is debugging.
        direct_provider_access: false,
        features,
        checked_at: new Date().toISOString(),
      });
    } catch (err) {
      log.warn(`security-status failed (reason: ${err?.message || 'unknown'})`);
      res.status(500).json({ error: 'Unable to determine AI security status' });
    }
  }
);

module.exports = router;
