'use strict';

/**
 * CLINICAL NOTE PROVIDER — the ONLY seam through which case-note generation
 * reaches an AI model. Deliberately separate from opa-provider (Opa chat has
 * a different privacy boundary: feature knowledge only; this seam carries
 * dictated clinical narrative and is governed accordingly).
 *
 * Fail-closed: isEnabled() requires BOTH CLINICAL_NOTE_AI_ENABLED='true'
 * AND ANTHROPIC_API_KEY. There is no fallback provider — if the approved
 * provider is not configured, generation is off and callers must surface
 * that without losing the transcript. Server-side only; the mobile app
 * never holds an AI credential.
 *
 * What is transmitted to the provider (see docs/mobile/CASE_NOTE_AI_PRIVACY.md):
 *   - the therapist's dictated transcript (verbatim, as reviewed on device)
 *   - session date (DD/MM/YYYY) and the service label
 *   - the versioned style prompt and optional regenerate modifier
 * NOT transmitted: client full name/address/DOB, event ids, therapist
 * identity, billing, travel, or any other appointment metadata — those are
 * merged deterministically after generation.
 *
 * Structured output: the model must answer via the case_note tool; the
 * result is validated here (shape, types, size caps) and anything else is
 * rejected as provider_error. Model text is never trusted as HTML.
 *
 * Env:
 *   CLINICAL_NOTE_AI_ENABLED   'true' to enable (default off — fail closed)
 *   ANTHROPIC_API_KEY          server-side credential (never logged)
 *   CLINICAL_NOTE_MODEL        default 'claude-sonnet-5'
 *   CLINICAL_NOTE_MAX_TOKENS   default 3000 (clamped 512..8192)
 *   CLINICAL_NOTE_TIMEOUT_MS   default 60000 (clamped 5000..120000)
 */

const axios = require('axios');
const { STYLE_PROFILES, INSTRUCTION_MODIFIERS } = require('./case-note-style');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

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

function isEnabled() {
  return process.env.CLINICAL_NOTE_AI_ENABLED === 'true' && !!process.env.ANTHROPIC_API_KEY;
}

const clampInt = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

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
 * @returns {Promise<{identify, sessionDetails, plan: string[], warnings: string[]}>}
 * @throws Error('generation_disabled') | Error('provider_error')
 */
async function generateCaseNote({ transcript, styleVersion, instruction, session } = {}) {
  if (_providerOverride) {
    return _providerOverride({ transcript, styleVersion, instruction, session });
  }
  if (!isEnabled()) throw new Error('generation_disabled');

  const stylePrompt = STYLE_PROFILES[styleVersion];
  if (!stylePrompt) throw new Error('provider_error');

  const modifier = instruction && INSTRUCTION_MODIFIERS[instruction]
    ? `\n\nTHERAPIST ADJUSTMENT FOR THIS REGENERATION: ${INSTRUCTION_MODIFIERS[instruction]}`
    : '';

  const context = [
    session?.dateLabel ? `Session date: ${session.dateLabel}` : null,
    session?.serviceLabel ? `Service: ${session.serviceLabel}` : null,
  ].filter(Boolean).join('\n');

  const timeout = clampInt(process.env.CLINICAL_NOTE_TIMEOUT_MS, 60000, 5000, 120000);
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeout + 500);
  if (abortTimer.unref) abortTimer.unref();

  try {
    const res = await axios.post(
      ANTHROPIC_URL,
      {
        model: process.env.CLINICAL_NOTE_MODEL || 'claude-sonnet-5',
        max_tokens: clampInt(process.env.CLINICAL_NOTE_MAX_TOKENS, 3000, 512, 8192),
        system: stylePrompt + modifier,
        tools: [CASE_NOTE_TOOL],
        tool_choice: { type: 'tool', name: 'case_note' },
        messages: [{
          role: 'user',
          content: `${context ? `${context}\n\n` : ''}Dictated session notes (verbatim):\n\n${transcript}`,
        }],
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        timeout,
        signal: controller.signal,
      }
    );

    const blocks = Array.isArray(res.data?.content) ? res.data.content : [];
    const toolUse = blocks.find((b) => b && b.type === 'tool_use' && b.name === 'case_note');
    if (!toolUse) throw new Error('malformed');
    return validateResult(toolUse.input);
  } catch (err) {
    // Status only — never the request/response body (it contains clinical
    // narrative) and never the key.
    const status = err?.response?.status
      || (err?.code === 'ECONNABORTED' || err?.name === 'CanceledError' ? 'timeout' : err?.message === 'malformed' ? 'malformed' : 'network');
    console.warn(`[clinical-note-provider] request failed (status: ${status})`);
    throw new Error('provider_error');
  } finally {
    clearTimeout(abortTimer);
  }
}

function providerIdentity() {
  return {
    providerId: 'anthropic',
    modelId: process.env.CLINICAL_NOTE_MODEL || 'claude-sonnet-5',
  };
}

function _setProviderForTests(fn) {
  _providerOverride = typeof fn === 'function' ? fn : null;
}

module.exports = { generateCaseNote, isEnabled, providerIdentity, validateResult, _setProviderForTests };
