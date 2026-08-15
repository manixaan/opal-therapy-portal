'use strict';

/**
 * ASSESSMENT FRAMEWORK — AVAILABILITY
 *
 * Derives what a clinician may actually do with an assessment right now, from
 * two kinds of fact:
 *
 *   1. what source material the project holds for it   (definitions.js)
 *   2. whether its implementing module is running here (runtime)
 *
 * Pure: no database, no IO, no Express. Every branch is a statement about one
 * of those two facts, which is what makes the resulting badge checkable.
 *
 * ── The state this replaces ────────────────────────────────────────────────
 * The Assessments tab previously answered "may this be used?" with a single
 * rule over the governance register: rights_status must be 'licensed-for-use'
 * or 'official-link-only' AND clinical_status must be 'current'. Both default
 * to 'unreviewed', so in practice EVERY assessment — including the one whose
 * WHO source documents ship in this repository — rendered as "cannot be
 * started yet: its rights and clinical review are not confirmed".
 *
 * That conflated two questions. Governance review is real work and it stays
 * visible on the information page; it is simply no longer the thing that
 * decides whether a button appears. What decides that is whether we hold the
 * instrument.
 *
 * ── The states ─────────────────────────────────────────────────────────────
 *   electronic-and-pdf       complete on screen, and print/download the form
 *   electronic               complete on screen (no blank form to issue)
 *   pdf                      issue and file the form, but no on-screen items
 *   source-required          nothing to administer; missingSources says what
 *   temporarily-unavailable  implemented, but not usable here and now, with a
 *                            concrete technical reason (module disabled in this
 *                            environment, asset integrity failure)
 */

const { AVAILABILITY } = require('./definitions');

/**
 * @param {object} def          a definition from definitions.js
 * @param {object} [runtime]
 * @param {object} [runtime.modules]  moduleName → { enabled, healthy, reason }
 * @returns {object} availability descriptor, safe to serialise to the browser
 */
function availabilityFor(def, runtime) {
  const modules = (runtime && runtime.modules) || {};
  const mod = def.module ? modules[def.module] : null;

  const canElectronic = Boolean(def.capabilities.electronic
    && def.sources.questions && def.sources.responseOptions);
  const canBlankPdf = Boolean(def.capabilities.blankPdf && def.sources.blankForm);

  /* ORDER MATTERS. An instrument that names an implementing module is one we
     HOLD; if that module is off or its assets failed to load, the answer is
     "not right now, and here is the technical reason" — never "we do not have
     this instrument, go and obtain these documents". Running the source check
     first got that backwards, because a module that fails to load also fails
     to report its sources. Never a rights sentence in this branch: it is only
     ever reached for a technical fault or an environment switch. */
  if (def.module) {
    if (def.moduleHealthy === false) {
      return descriptor(AVAILABILITY.TEMPORARILY_UNAVAILABLE, {
        canStart: false,
        canDownloadBlank: false,
        canScore: false,
        reason: 'The assessment\'s source documents could not be loaded, so it cannot be '
          + 'administered until that is resolved. This is a fault in this deployment, not a '
          + 'missing instrument.',
        missingSources: [],
      });
    }
    if (!mod || mod.enabled === false) {
      return descriptor(AVAILABILITY.TEMPORARILY_UNAVAILABLE, {
        canStart: false,
        canDownloadBlank: false,
        canScore: false,
        reason: (mod && mod.reason)
          || 'The module that administers this assessment is switched off in this environment.',
        missingSources: [],
      });
    }
    if (mod.healthy === false) {
      return descriptor(AVAILABILITY.TEMPORARILY_UNAVAILABLE, {
        canStart: false,
        canDownloadBlank: false,
        canScore: false,
        reason: mod.reason
          || 'The assessment\'s source documents failed their integrity check and will not be served.',
        missingSources: [],
      });
    }
  }

  // No implementing module and no source material: the honest answer is that
  // the instrument itself is missing, and which documents would supply it.
  if (!canElectronic && !canBlankPdf) {
    return descriptor(AVAILABILITY.SOURCE_REQUIRED, {
      canStart: false,
      canDownloadBlank: false,
      canScore: false,
      reason: null,
      missingSources: def.missingSources.slice(),
    });
  }

  if (canElectronic && canBlankPdf) {
    return descriptor(AVAILABILITY.ELECTRONIC_AND_PDF, {
      canStart: true,
      canDownloadBlank: true,
      canScore: Boolean(def.capabilities.scoring && def.sources.scoringRules),
      reason: null,
      missingSources: [],
    });
  }

  if (canElectronic) {
    return descriptor(AVAILABILITY.ELECTRONIC, {
      canStart: true,
      canDownloadBlank: false,
      canScore: Boolean(def.capabilities.scoring && def.sources.scoringRules),
      reason: null,
      missingSources: [],
    });
  }

  // A blank form but no items: the paper pathway works, on-screen completion
  // does not. Say which of the two is missing rather than offering a form that
  // cannot be filled in.
  return descriptor(AVAILABILITY.PDF, {
    canStart: false,
    canDownloadBlank: true,
    canScore: false,
    reason: null,
    missingSources: def.missingSources.slice(),
  });
}

const LABELS = {
  [AVAILABILITY.ELECTRONIC_AND_PDF]: 'Electronic and PDF',
  [AVAILABILITY.ELECTRONIC]: 'Available electronically',
  [AVAILABILITY.PDF]: 'PDF available',
  [AVAILABILITY.SOURCE_REQUIRED]: 'Source required',
  [AVAILABILITY.TEMPORARILY_UNAVAILABLE]: 'Temporarily unavailable',
};

const SUMMARIES = {
  [AVAILABILITY.ELECTRONIC_AND_PDF]:
    'Complete this assessment in the portal, or print and issue the blank form.',
  [AVAILABILITY.ELECTRONIC]:
    'Complete this assessment in the portal.',
  [AVAILABILITY.PDF]:
    'The blank form can be printed and a completed copy filed, but the items are '
    + 'not available for on-screen completion.',
  [AVAILABILITY.SOURCE_REQUIRED]:
    'The portal does not hold this instrument. It is registered here so its use can '
    + 'be governed, and it will become available once its source material is supplied.',
  [AVAILABILITY.TEMPORARILY_UNAVAILABLE]:
    'This assessment is implemented but cannot be opened right now.',
};

function descriptor(state, extra) {
  return Object.assign({
    state,
    label: LABELS[state],
    summary: SUMMARIES[state],
  }, extra);
}

/**
 * Runtime facts about the WHODAS module: is it switched on here, and did its
 * hash-pinned WHO templates load?
 *
 * `verify` is injected so the caller decides how expensive the check is; the
 * catalogue route reads it once per request, which is a manifest lookup, not a
 * re-hash of every PDF.
 */
function whodasRuntime({ enabled, verify }) {
  if (!enabled) {
    return {
      enabled: false,
      healthy: false,
      reason: 'WHODAS 2.0 is switched off in this environment '
        + '(ENABLE_WHODAS_ASSESSMENT). Ask an administrator to enable it.',
    };
  }
  try {
    if (typeof verify === 'function') verify();
    return { enabled: true, healthy: true, reason: null };
  } catch (err) {
    return {
      enabled: true,
      healthy: false,
      reason: 'The official WHO source documents failed their integrity check '
        + 'and will not be served.',
      detail: err.message,
    };
  }
}

module.exports = {
  availabilityFor,
  whodasRuntime,
  LABELS,
  SUMMARIES,
};
