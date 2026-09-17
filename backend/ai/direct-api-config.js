'use strict';

/**
 * DIRECT API CONFIGURATION — the one place the vendor API key is read.
 *
 * The portal's rule is that a model is reached through federated Bedrock in
 * Australia, and that rule still stands for every feature that can carry
 * personal or health information. This module exists for the narrow
 * exception the policy engine calls a DATA RESIDENCY WAIVER: a feature whose
 * inputs are practice-internal working material (staff training content)
 * and which the Owner has decided may use the vendor's public API instead.
 *
 * Which features may do that is a policy fact (ai-policy.js →
 * dataResidencyWaiver), enforced at load: a policy that can receive clinical
 * input, or produce a clinical document, can never carry the waiver. This
 * module only answers "is the direct route configured?".
 *
 * Env:
 *   ANTHROPIC_API_KEY      the vendor key; absent → direct calls refuse
 *   DIRECT_API_MODEL_ID    optional override of the registry's model id
 */

const str = (name) => {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/** The key, or null. Never logged, never returned to a client. */
function apiKey() {
  return str('ANTHROPIC_API_KEY');
}

function isConfigured() {
  return !!apiKey();
}

/**
 * The model id a direct-provider registry entry resolves to: the deployment's
 * override when set, else the registry's own public id.
 */
function resolveModelId(registryModel) {
  const override = str('DIRECT_API_MODEL_ID');
  if (override) return { ok: true, id: override, overridden: true };
  if (registryModel && registryModel.id) return { ok: true, id: registryModel.id, overridden: false };
  return { ok: false, reason: 'direct_api_model_not_configured' };
}

/** Status-page description: whether it resolved, never what to. */
function describe() {
  return {
    configured: isConfigured(),
    model_overridden: !!str('DIRECT_API_MODEL_ID'),
  };
}

module.exports = { apiKey, isConfigured, resolveModelId, describe };
