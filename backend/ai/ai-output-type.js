'use strict';

/**
 * OUTPUT TYPE — what the model's answer is going to BE, as distinct from what
 * the request contained.
 *
 * Classification and output type are different axes and conflating them
 * under-protects one case and over-protects another. Through the same Opa
 * chat box:
 *
 *   "Explain sensory processing difficulties"
 *     → clinical-capable input, but the answer is an ANSWER. Nobody files it.
 *
 *   "Write a progress summary for Johan"
 *     → the answer is destined for a clinical record, and AHPRA holds the
 *       practitioner responsible for what lands there.
 *
 * Same feature, same classification, materially different risk. So the
 * gateway asks for both, and derives the human-review requirement from the
 * output type rather than from the feature.
 */

/** An answer to a question. Informational; never becomes documentation. */
const ASSISTANT_RESPONSE = 'assistant_response';

/**
 * Content destined for a clinical record — case notes, report sections,
 * assessment narrative, letters. ALWAYS a draft until a person accepts it.
 */
const CLINICAL_DOCUMENT = 'clinical_document';

const OUTPUT_TYPES = [ASSISTANT_RESPONSE, CLINICAL_DOCUMENT];

/**
 * Output types that may never skip human review, whatever a policy says.
 * Enforced at policy load, so a well-meaning edit cannot quietly turn a
 * clinical document into something that files itself.
 */
const REVIEW_MANDATORY = Object.freeze([CLINICAL_DOCUMENT]);

function isValid(outputType) {
  return OUTPUT_TYPES.includes(outputType);
}

function requiresHumanReview(outputType) {
  return REVIEW_MANDATORY.includes(outputType);
}

module.exports = {
  ASSISTANT_RESPONSE,
  CLINICAL_DOCUMENT,
  OUTPUT_TYPES,
  REVIEW_MANDATORY,
  isValid,
  requiresHumanReview,
};
