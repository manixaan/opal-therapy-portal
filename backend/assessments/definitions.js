'use strict';

/**
 * ASSESSMENT FRAMEWORK — DEFINITIONS
 *
 * One shape for every standardised assessment the practice offers, whether or
 * not Opal can administer it yet. A definition says what the instrument IS
 * (identity, edition, attribution, structure) and what SOURCE MATERIAL the
 * project actually holds for it. Nothing here decides policy; availability is
 * derived from these facts in availability.js.
 *
 * ── Why the source inventory, and not a rights flag ────────────────────────
 * The register (controlled_instruments, migration 027) answers a governance
 * question: whose instrument is this, and what has a human confirmed about its
 * licence. It answered a second question badly — "can a clinician use it?" —
 * by defaulting to "no" for everything, which left every assessment, including
 * the one whose authoritative WHO source ships in this repository, behind a
 * blanket "awaiting human confirmation" notice.
 *
 * Those are different questions. Whether the portal CAN administer an
 * assessment is a fact about what is on disk: do we hold its items, its
 * response options, its scoring rules, a blank form? That is what `sources`
 * records, per assessment, and it is checkable. The register's rights and
 * clinical review remain visible on the information page, because a clinician
 * should see them — they simply no longer gate the button.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * No item wording, no response wording and no scoring rule appears in this
 * file for ANY instrument. WHODAS's come from backend/whodas/ (derived from the
 * WHO source PDFs shipped with the application); every other entry declares,
 * in `missingSources`, exactly which documents would be needed. Writing a
 * plausible-looking item list for an instrument we do not hold would be
 * fabrication, and a fabricated assessment is worse than an absent one.
 */

const { NEW_INSTRUMENTS } = require('../resource-instrument-map');

// ── Availability vocabulary ─────────────────────────────────────────────────
// Mirrors what the Assessments tab renders. 'source-required' is a statement
// about this repository, not about anybody's permission.

const AVAILABILITY = {
  ELECTRONIC_AND_PDF: 'electronic-and-pdf',
  ELECTRONIC: 'electronic',
  PDF: 'pdf',
  SOURCE_REQUIRED: 'source-required',
  TEMPORARILY_UNAVAILABLE: 'temporarily-unavailable',
};

const AVAILABILITY_VALUES = Object.keys(AVAILABILITY).map((k) => AVAILABILITY[k]);

/** Every source artefact an electronic assessment needs, in plain language. */
const SOURCE_KINDS = {
  questions: 'the authoritative item wording',
  responseOptions: 'the authoritative response options',
  scoringRules: 'the published scoring rules',
  blankForm: 'a blank form that may be printed and issued',
};

const SOURCE_KEYS = Object.keys(SOURCE_KINDS);

/**
 * A definition with nothing asserted. Spreading this first means a new field
 * added here is safe by default for every entry that has not been updated.
 */
function baseDefinition() {
  return {
    key: null,
    name: null,
    abbreviation: null,
    edition: null,
    itemSet: null,
    description: '',
    // Whose work this is. Never Opal's.
    attribution: {
      rightsHolder: null,
      sourceTitle: null,
      copyright: null,
      sourceNote: null,
    },
    // The implementing module, when one exists. Everything else links only.
    module: null,
    // What this repository actually holds for the instrument.
    sources: SOURCE_KEYS.reduce((acc, k) => Object.assign(acc, { [k]: false }), {}),
    // Named documents still needed. Empty when nothing is missing.
    missingSources: [],
    // What the portal can do once the sources are present.
    capabilities: {
      electronic: false,
      draft: false,
      scoring: false,
      blankPdf: false,
      completedPdf: false,
      upload: false,
      amend: false,
      share: false,
    },
    // Administration options the source material defines (never invented).
    administrationMethods: [],
    // Section/domain outline for the information page.
    structure: null,
    // Interpretation the SOURCE states. Never a locally invented band.
    interpretation: null,
    // Governance/licensing prose worth showing beside the instrument.
    notes: null,
  };
}

// ── WHODAS 2.0 (36-item) ────────────────────────────────────────────────────
// The one instrument whose authoritative source ships with the application:
// four WHO template PDFs (hash-pinned), the item text derived from them, and
// both WHO scoring workbooks. Everything below is READ from those modules
// rather than restated, so the definition cannot drift from what is on disk.

function whodasDefinition() {
  // Required lazily: whodas/ reads its manifest and hashes its templates at
  // require time, and a catalogue request must not fail because one asset is
  // being replaced. availability.js turns a throw here into
  // 'temporarily-unavailable' with the real reason.
  const instrument = require('../whodas/instrument');
  const registry = require('../whodas/template-registry');
  const scoring = require('../whodas/scoring');

  const manifest = registry.manifest();
  const templates = registry.instrumentTemplates();
  const flashcards = registry.flashcardsTemplate();

  const def = baseDefinition();

  def.key = 'whodas-2.0-36';
  def.name = 'WHO Disability Assessment Schedule 2.0 (36-item)';
  def.abbreviation = 'WHODAS 2.0';
  def.edition = '2.0';
  def.itemSet = '36-item';
  def.description =
    'A generic assessment of functioning and disability across six domains of life, '
    + 'covering the 30 days before administration. The 36-item version yields domain '
    + 'scores and an overall score, and is administered by interview, by the client '
    + 'themselves, or by a proxy.';

  def.attribution = {
    rightsHolder: 'World Health Organization',
    sourceTitle: manifest.source.title,
    copyright: manifest.source.copyright,
    sourceNote: manifest.source.note,
  };

  def.module = 'whodas';

  def.sources = {
    questions: true,
    responseOptions: true,
    scoringRules: true,
    blankForm: true,
  };
  def.missingSources = [];

  def.capabilities = {
    electronic: true,
    draft: true,
    scoring: true,
    blankPdf: true,
    completedPdf: true,
    upload: true,
    amend: true,
    share: true,
  };

  def.administrationMethods = templates.map((t) => ({
    method: t.method,
    templateKey: t.key,
    name: t.name,
    pageCount: t.pageCount,
  }));

  def.structure = {
    itemCount: instrument.ITEM_IDS.length,
    // The four work/school items are administered only when the respondent
    // works or studies — the instrument's own skip rule, not a local one.
    conditionalItemIds: instrument.WORK_SCHOOL_ITEMS.slice(),
    domains: instrument.DOMAINS.map((d) => ({
      key: d.key,
      title: d.title,
      conceptName: d.conceptName,
      itemCount: instrument.itemsInDomain(d.domain).length,
    })),
    flashcards: flashcards
      ? { templateKey: flashcards.key, name: flashcards.name, pageCount: flashcards.pageCount }
      : null,
  };

  def.interpretation = {
    // Verbatim from the source. The supplied WHO material defines no cut-points
    // and no severity bands, so none are offered anywhere in the product.
    scale: '0-100',
    statement: '0 = no disability, 100 = full disability',
    source: 'WHODAS 2.0 manual (WHO, 2010)',
    cutPoints: null,
    cutPointsNote:
      'The supplied WHO sources define no cut-points or severity bands for the '
      + '0-100 score, so none are shown. A score is reported with the method that '
      + 'produced it and nothing more.',
    scoringMethods: scoring.ALL_METHODS.slice(),
    defaultScoringMethod: scoring.DEFAULT_METHOD,
    scoringVersion: scoring.SCORING_VERSION,
  };

  def.notes =
    'WHO places the instrument in the public domain (manual §5.1) subject to '
    + 'registration on the WHODAS 2.0 web site and to no substantive changes being '
    + 'made. The portal therefore renders WHO\'s own document rather than a '
    + 're-typeset copy, and completed forms are produced by overlaying responses '
    + 'onto it.';

  return def;
}

// ── Everything else in the register ─────────────────────────────────────────
// Visible, addressable, with an information page and a route — but no items and
// no scoring rules, because this repository holds none. Each entry names the
// documents that would make it administrable.

/** Instruments registered before the catalogue mapping existed. */
const REGISTER_ONLY = [
  {
    key: 'copm',
    abbreviation: 'COPM',
    name: 'Canadian Occupational Performance Measure',
    rightsHolder: 'Not confirmed',
    notes: 'A semi-structured interview; the manual carries the administration and scoring '
      + 'procedure. Publisher, current edition and licence terms are not confirmed in the register.',
  },
  {
    key: 'moca',
    abbreviation: 'MoCA',
    name: 'Montreal Cognitive Assessment',
    rightsHolder: 'Not confirmed',
    notes: 'MoCA has historically required user registration or training. Version, publisher '
      + 'and any certification requirement are unconfirmed.',
  },
  {
    key: 'rudas',
    abbreviation: 'RUDAS',
    name: 'Rowland Universal Dementia Assessment Scale',
    rightsHolder: 'Not confirmed',
    notes: 'Rights holder, current version and distribution terms are unconfirmed in the register.',
  },
  {
    key: 'sensory-profile',
    abbreviation: 'Sensory Profile',
    name: 'Sensory Profile',
    rightsHolder: 'Not confirmed',
    notes: 'Commercially published. Edition, publisher and purchase terms are unconfirmed.',
  },
  {
    key: 'mohost',
    abbreviation: 'MOHOST',
    name: 'Model of Human Occupation Screening Tool',
    rightsHolder: 'Not confirmed',
    notes: 'Rights holder, current version and licence terms are unconfirmed in the register.',
  },
];

/**
 * Turns a register-shaped row into a full definition whose only assertion is
 * that the source material is absent.
 */
function sourceRequiredDefinition(row) {
  const def = baseDefinition();
  def.key = row.key;
  def.name = row.name;
  def.abbreviation = row.abbreviation;
  def.edition = row.edition || null;
  def.description = row.description
    || 'Registered for clinical governance. The portal holds no items, response options '
    + 'or scoring rules for this instrument, so it cannot yet be administered here.';
  def.attribution = {
    rightsHolder: row.rightsHolder || null,
    sourceTitle: null,
    copyright: null,
    sourceNote: null,
  };
  def.module = null;
  def.sources = SOURCE_KEYS.reduce((acc, k) => Object.assign(acc, { [k]: false }), {});
  def.missingSources = SOURCE_KEYS.map((k) => SOURCE_KINDS[k]);
  def.notes = row.notes || null;
  return def;
}

/**
 * The whole catalogue, in a stable order: implemented instruments first, then
 * the rest alphabetically by abbreviation so the list reads like a register.
 *
 * @returns {Array<object>} definitions (fresh objects; callers may annotate)
 */
function allDefinitions() {
  const implemented = [];
  try {
    implemented.push(whodasDefinition());
  } catch (err) {
    // The instrument's own assets failed to load. Keep the entry visible and
    // let availability.js explain why, rather than dropping it from the list —
    // an assessment that silently disappears is the harder failure to diagnose.
    //
    // Built from baseDefinition, NOT sourceRequiredDefinition: we DO hold this
    // instrument, and something on disk is broken. Reporting it as "Source
    // required" told clinicians the portal does not have WHODAS and listed
    // documents to go and obtain — when the real answer is that an asset
    // failed to load and an administrator should look at the logs.
    // missingSources stays empty for the same reason: nothing is missing.
    const stub = baseDefinition();
    stub.key = 'whodas-2.0-36';
    stub.abbreviation = 'WHODAS 2.0';
    stub.name = 'WHO Disability Assessment Schedule 2.0 (36-item)';
    stub.attribution.rightsHolder = 'World Health Organization';
    stub.description = 'Registered and implemented in this portal. Its source documents could '
      + 'not be loaded, so it cannot be administered until that is resolved.';
    stub.module = 'whodas';
    stub.moduleHealthy = false;      // availability.js reads this
    stub.moduleError = err.message;
    implemented.push(stub);
  }

  const others = REGISTER_ONLY
    .concat(NEW_INSTRUMENTS)
    .filter((row) => row.key !== 'whodas-2.0-36')
    .map(sourceRequiredDefinition)
    .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation, 'en'));

  return implemented.concat(others);
}

function definitionByKey(key) {
  const wanted = String(key || '').trim().toLowerCase();
  if (!wanted) return null;
  return allDefinitions().find((d) => d.key.toLowerCase() === wanted) || null;
}

module.exports = {
  AVAILABILITY,
  AVAILABILITY_VALUES,
  SOURCE_KINDS,
  SOURCE_KEYS,
  allDefinitions,
  definitionByKey,
  // exported for tests
  baseDefinition,
  sourceRequiredDefinition,
  REGISTER_ONLY,
};
