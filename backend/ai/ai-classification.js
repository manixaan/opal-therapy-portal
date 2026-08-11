'use strict';

/**
 * DATA CLASSIFICATION — what kind of information a request carries.
 *
 * Classification is declared by the calling feature, not sniffed from the
 * content. That is deliberate: content inspection is unreliable (see the
 * de-identification evidence in docs/mobile/CLINICAL_AI_PROVIDER_DECISION.md
 * §5 — best-case ~67% recall on Australian clinical text), and a boundary
 * that depends on correctly detecting clinical data would fail open the
 * first time detection missed something.
 *
 * So the rule is inverted: a feature must declare what it handles, and the
 * gateway enforces the strictest controls the declaration implies. A feature
 * that lies about its classification is a code review problem, not a runtime
 * one — but a feature that forgets to declare gets CLINICAL by default,
 * because the safe failure is over-restriction.
 *
 * Automated detection can be layered on later as a *second* check that can
 * only escalate a classification, never relax one.
 */

/** Public reference material. No personal information of any kind. */
const PUBLIC = 'public';

/** Practice-internal business content. Personal but not health information. */
const INTERNAL = 'internal';

/**
 * Health information about an identifiable person — case notes, FCA content,
 * WHODAS responses, therapy goals, diagnoses, client names in any context.
 * Sensitive information under the Privacy Act.
 */
const CLINICAL = 'clinical';

const CLASSIFICATIONS = [PUBLIC, INTERNAL, CLINICAL];

/** Ordered least → most restricted, for comparison. */
const RANK = { [PUBLIC]: 0, [INTERNAL]: 1, [CLINICAL]: 2 };

/**
 * Controls each classification demands. The gateway reads these; it does not
 * hard-code per-feature exceptions.
 *
 * `residency: 'australia'` on CLINICAL is the load-bearing one — it is what
 * keeps health information out of a cross-border disclosure under APP 8 and
 * away from s 16C accountability.
 */
const REQUIREMENTS = {
  [PUBLIC]: {
    residency: null,
    auditRequired: true,
    humanReviewDefault: false,
  },
  [INTERNAL]: {
    residency: 'australia',
    auditRequired: true,
    humanReviewDefault: false,
  },
  [CLINICAL]: {
    residency: 'australia',
    auditRequired: true,
    // A clinical draft is never the record until a person accepts it.
    // Policies may not set this to false — see ai-policy.js.
    humanReviewDefault: true,
  },
};

function isValid(classification) {
  return CLASSIFICATIONS.includes(classification);
}

/** True when `classification` is at least as restricted as `atLeast`. */
function isAtLeast(classification, atLeast) {
  return (RANK[classification] ?? -1) >= (RANK[atLeast] ?? Infinity);
}

function requirementsFor(classification) {
  return REQUIREMENTS[classification] || REQUIREMENTS[CLINICAL];
}

module.exports = {
  PUBLIC,
  INTERNAL,
  CLINICAL,
  CLASSIFICATIONS,
  REQUIREMENTS,
  isValid,
  isAtLeast,
  requirementsFor,
};
