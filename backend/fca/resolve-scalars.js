'use strict';

/**
 * OPAL SCALAR RESOLVER — pure. No database, no network, no clock.
 *
 *   resolveScalars({ splose, profile, currentPlan, goals, overrides,
 *                    portal, organisation, server, templateTags, catalogue })
 *     → { scalarData, scalarSources, missingFields }
 *
 * ONE resolver, TWO document types. `catalogue` selects which template's tag
 * table is being resolved (fca/template-map by default, fca/letter-template-map
 * for the progress-note letter). Precedence is a property of the LAYER a tag
 * declares, not of the document, so a second document type adds tags — never a
 * second precedence rule.
 *
 * Every scalar tag in the template gets exactly one value and exactly one
 * SOURCE ATTRIBUTION, so the wizard can show a therapist where each field came
 * from and the frozen snapshot records it forever.
 *
 * ── PRECEDENCE ──────────────────────────────────────────────────────────────
 * The four layers, and how they actually compose:
 *
 *   1. Current authoritative SPLOSE data           (system of record)
 *   2. Reusable organisation-scoped CLIENT PROFILE (supplements Splose)
 *   3. Report-specific THERAPIST OVERRIDES         (this draft only)
 *   4. Immutable GENERATION SNAPSHOT               (the frozen result of 1–3)
 *
 * Layer 4 is not a resolution input — it is what this function's output BECOMES
 * once the report is generated. It is never re-resolved at download time.
 *
 * Resolution order depends on which layer OWNS the tag, and that ownership is
 * declared once in template-map.js:
 *
 *   SPLOSE-AUTHORITATIVE tags   override > splose > missing
 *       The client profile is NOT CONSULTED AT ALL. This is the important one:
 *       a stale profile copy of a name, NDIS number, address, email or phone
 *       must never silently shadow the live Splose record. If Splose has a
 *       value, that value wins and the source reads 'splose'. A therapist may
 *       still correct a field for one report — that is an explicit, visible,
 *       report-scoped act — but it is never written back to the profile.
 *
 *   PROFILE-OWNED tags          override > client_profile > missing
 *       Durable client facts Splose has no field for. Backed either by a
 *       column on fca_client_profiles or by the CURRENT NDIS plan version.
 *
 *   PORTAL tags                 override > portal > missing
 *       Assessor and organisation facts read from this database.
 *
 *   ORGANISATION tags           override > organisation settings > missing
 *       Letterhead facts (business address, phone, email, website) read from
 *       the organisation's saved settings. Attributed 'portal', because that is
 *       exactly what they are: this portal's own configuration, not client data
 *       and not Splose. A setting that has never been filled in is MISSING —
 *       an address is never inferred from anything.
 *
 *   REPORT-SPECIFIC tags        override > missing
 *       Belong to one report. There is nowhere else they could come from.
 *
 *   SERVER tags                 override > server > missing
 *       The document id, date, version and status OPAL ISSUES — not facts it
 *       looks up. They are minted once, when the draft is created, and stored
 *       on it, so they are real values in the review step rather than fields a
 *       therapist is told are "Missing" and could not possibly supply. The
 *       issued value is a DEFAULT: a therapist genuinely issuing version 2.0,
 *       or marking a report Final, overrides it exactly like any other field
 *       and the source attribution then reads 'report_override'.
 *
 *       This is deliberately narrow. Only values Opal ITSELF ORIGINATES are
 *       issued this way. An issue date, a reviewer's name and role, and the
 *       authorised recipients are facts about the world; they stay 'missing'
 *       until a human supplies them, because the alternative is a clinical
 *       document that quietly states something nobody checked.
 *
 * ── SOURCE VOCABULARY ───────────────────────────────────────────────────────
 * 'splose' | 'client_profile' | 'report_override' | 'portal' | 'server' |
 * 'missing'.
 *
 * The four values named in the API contract keep their exact meaning. 'portal'
 * and 'server' are a deliberate SUPERSET: collapsing an assessor's AHPRA
 * number into 'splose' or a server-minted document id into 'client_profile'
 * would be false attribution, and the whole point of this field is that a
 * therapist can trust it.
 *
 * ── MISSING IS FLAGGED, NEVER FABRICATED ────────────────────────────────────
 * Nothing here infers, derives or guesses. A first name is not a preferred
 * name. An empty string, a whitespace-only string and a null are all absent.
 * An absent value resolves to null with source 'missing' and the tag is listed
 * in missingFields — the engine then leaves the template's own placeholder on
 * the page, so the gap is visible in the document rather than papered over.
 */

const fcaMap = require('./template-map');

/** The default catalogue: the FCA report's tag table. */
const DEFAULT_CATALOGUE = {
  SCALAR_TAGS: fcaMap.SCALAR_TAGS,
  SCALAR_BY_TAG: fcaMap.SCALAR_BY_TAG,
  SCALAR_TAG_LIST: fcaMap.SCALAR_TAG_LIST,
};

// ── Value normalisation ──────────────────────────────────────────────────────

/** Absent unless it is a non-blank scalar. Objects and arrays are never values. */
function present(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const TWO = (n) => String(n).padStart(2, '0');

/**
 * Australian English date rendering: DD/MM/YYYY.
 * Accepts a pg DATE (Date object) or an ISO 'YYYY-MM-DD' string. A DATE column
 * carries no timezone, so the UTC components are read directly — using local
 * getters would shift the date by a day for anyone west of Greenwich.
 */
function formatDate(value) {
  if (value instanceof Date) {
    return `${TWO(value.getUTCDate())}/${TWO(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
  }
  const s = String(value);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return s; // already human-entered — pass through untouched
}

const DATE_TAGS = new Set([
  'OPAL_CLIENT_DATE_OF_BIRTH',
  'OPAL_CLIENT_NDIS_PLAN_START',
  'OPAL_CLIENT_NDIS_PLAN_END',
]);

// ── Layer readers ────────────────────────────────────────────────────────────

/**
 * Is this tag rendered as a date? Either it is one of the FCA's date tags, or
 * its own catalogue entry declares `isDate` — so a second template adds date
 * tags without editing a set in here.
 */
function isDateTag(tag, meta) {
  return DATE_TAGS.has(tag) || Boolean(meta && meta.isDate);
}

/** The profile / current-plan / goals value backing a profile-owned tag. */
function readProfileLayer(meta, profile, currentPlan, goals) {
  if (meta.profileField) {
    return profile ? present(profile[meta.profileField]) : null;
  }
  if (meta.profilePlanField) {
    const goalMatch = /^goal:(\d+)$/.exec(meta.profilePlanField);
    if (goalMatch) {
      // The template exposes only two goal controls. Goals are stored
      // unbounded and already ordered by sort_order; tag N maps to the
      // current plan's Nth goal, in order. A third or later goal is retained
      // and queryable but has no control in fca-v1 and is not rendered.
      const goal = Array.isArray(goals) ? goals[Number(goalMatch[1])] : null;
      if (!goal) return null;
      return present(typeof goal === 'string' ? goal : goal.goalText ?? goal.goal_text);
    }
    return currentPlan ? present(currentPlan[meta.profilePlanField]) : null;
  }
  return null;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * @param {object}  splose        normalisePatient() shape from splose-api.js
 * @param {object}  profile       fca_client_profiles row (snake_case), or null
 * @param {object}  currentPlan   the CURRENT fca_client_ndis_plans row, or null
 * @param {Array}   goals         that plan's goals, already ordered by sort_order
 * @param {object}  overrides     { TAG: value } report-specific overrides
 * @param {object}  portal        { therapistName, therapistRoleTitle,
 *                                  therapistEmail, therapistPhone,
 *                                  organisationName, ahpraNumber }
 * @param {object}  server        { documentReference, reportDate,
 *                                  reportVersion, reportStatus }
 * @param {Array}   templateTags  tags to resolve; defaults to the whole template
 */
function resolveScalars({
  splose = null,
  profile = null,
  currentPlan = null,
  goals = [],
  overrides = {},
  portal = null,
  organisation = null,
  server = null,
  templateTags = null,
  catalogue = null,
} = {}) {
  const cat = catalogue || DEFAULT_CATALOGUE;
  const tags = Array.isArray(templateTags) && templateTags.length
    ? templateTags
    : cat.SCALAR_TAG_LIST;

  const scalarData = {};
  const scalarSources = {};
  const missingFields = [];

  for (const tag of tags) {
    const meta = cat.SCALAR_BY_TAG.get(tag);
    if (!meta) continue; // unknown tag — never invented into the output

    const override = present(overrides ? overrides[tag] : null);

    let value = null;
    let source = 'missing';

    if (override !== null) {
      // An explicit therapist value wins over EVERY layer, the server-issued
      // defaults included: a version number or a status is a claim about their
      // own document, and Opal has no standing to overrule it.
      value = override;
      source = 'report_override';
    } else if (meta.layer === 'server') {
      const v = server ? present(server[meta.field]) : null;
      if (v !== null) { value = v; source = 'server'; }
    } else if (meta.layer === 'splose') {
      // The client profile is intentionally not consulted for these tags.
      const v = splose ? present(splose[meta.field]) : null;
      if (v !== null) { value = v; source = 'splose'; }
    } else if (meta.layer === 'client_profile') {
      const v = readProfileLayer(meta, profile, currentPlan, goals);
      if (v !== null) { value = v; source = 'client_profile'; }
      else if (meta.fallbackField) {
        // A DECLARED, SAFE fallback — never an inference. Only a tag whose
        // catalogue entry names the Splose field it may fall back to gets one,
        // and the source reads 'splose' so the therapist sees where it came
        // from. (The letter's preferred name falls back to the given name: a
        // salutation must never be blank mid-sentence. The FCA declares no
        // fallback, so a first name is still never a preferred name there.)
        const v2 = splose ? present(splose[meta.fallbackField]) : null;
        if (v2 !== null) { value = v2; source = 'splose'; }
      }
    } else if (meta.layer === 'portal') {
      const v = portal ? present(portal[meta.field]) : null;
      if (v !== null) { value = v; source = 'portal'; }
    } else if (meta.layer === 'organisation') {
      const v = organisation ? present(organisation[meta.field]) : null;
      if (v !== null) { value = v; source = 'portal'; }
    }
    // layer 'report' with no override falls through as missing, by design.

    if (value !== null && isDateTag(tag, meta)) value = formatDate(value);
    if (value instanceof Date) value = formatDate(value);

    scalarData[tag] = value === null ? null : String(value);
    scalarSources[tag] = source;
    if (source === 'missing') missingFields.push(tag);
  }

  return { scalarData, scalarSources, missingFields };
}

/**
 * The tag → layer table, for docs and for the frontend's source legend.
 * Derived from template-map.js so it can never drift from resolution.
 */
function layerTable(catalogue = null) {
  const cat = catalogue || DEFAULT_CATALOGUE;
  return cat.SCALAR_TAGS.map((s) => ({
    tag: s.tag,
    label: s.label,
    layer: s.layer,
    backedBy: s.field || s.profileField || s.profilePlanField || null,
    occurrences: s.occurrences,
  }));
}

module.exports = {
  resolveScalars,
  layerTable,
  DEFAULT_CATALOGUE,
  _internals: { present, formatDate, isDateTag },
};
