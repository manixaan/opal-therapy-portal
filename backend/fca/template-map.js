'use strict';

/**
 * FCA TEMPLATE MAP — the static description of the Opal Functional Assessment
 * Report template (fca-v1.docx).
 *
 * Everything here was derived by unzipping the real .docx and reading
 * word/document.xml, word/header6.xml and word/footer6.xml. The numbers are
 * asserted by tests/fca-docx-engine.test.js against the shipped template, so
 * this file cannot silently drift from the document.
 *
 * VERIFIED TEMPLATE FACTS (fca-v1.docx, sha256 bf918d21…5b2782)
 *   58 unique w:tag content controls, 84 occurrences in total.
 *   25 of them are section/anchor controls, 33 are scalar (text) controls.
 *   15 scalar tags repeat, up to 5 times (OPAL_THERAPIST_FULL_NAME).
 *   Parts carrying controls: word/document.xml (81), word/header6.xml (2:
 *   OPAL_CLIENT_PREFERRED_NAME, OPAL_CLIENT_NDIS_NUMBER), word/footer6.xml
 *   (1: OPAL_REPORT_DOCUMENT_ID).
 *   Optional controls are NESTED inside required parents — the five assessment
 *   tools inside ASSESSMENT_METHOD, the nine domains + the custom-section
 *   anchor inside ASSESSMENT_RESULTS, the two recommendation groups inside
 *   SUMMARY_RECOMMENDATIONS. APPENDICES is optional and top-level.
 *
 * ── DATA REALITY ────────────────────────────────────────────────────────────
 * There is NO clients/patients table in this database. Client data is fetched
 * from Splose at request time and provides only: id, firstname, lastname,
 * fullName, email, mobilePhone, ndisNumber and address parts.
 *
 * Every other participant fact the template asks for (preferred name,
 * pronouns, date of birth, plan dates, disability, goals, nominee, referrer,
 * support coordinator) has no Splose field. Those durable facts live in the
 * organisation-scoped OPAL CLIENT REPORT PROFILE (fca_client_profiles and its
 * versioned NDIS plans/goals), which SUPPLEMENTS Splose and never replaces it.
 * Anything still absent is marked MISSING and flagged to the therapist. It is
 * NEVER inferred, guessed or derived — a therapist may type a real value on
 * the draft, and only an explicit, permissioned save-back ever persists that
 * value to the profile.
 */

// ── Style IDs ───────────────────────────────────────────────────────────────
// The template's custom style IDs use an EN DASH (U+2013) with NO spaces.
// The display names use " – " with spaces. Written as escapes so the exact
// codepoint survives any editor or diff tool.
const EN_DASH = '–';
const STYLE = {
  BODY: `OPAL${EN_DASH}Body`,
  // Used by the progress-note letter for a custom block's short label. Both
  // templates ship the same Opal style set, so this lives with the others.
  BODY_EMPHASIS: `OPAL${EN_DASH}BodyEmphasis`,
  HEADING1: `OPAL${EN_DASH}Heading1`,
  HEADING2: `OPAL${EN_DASH}Heading2`,
  HEADING3: `OPAL${EN_DASH}Heading3`,
  PLACEHOLDER: `OPAL${EN_DASH}Placeholder`,
  CLINICAL_PROMPT: `OPAL${EN_DASH}ClinicalPrompt`,
};

const TEMPLATE_ID = 'fca';
const TEMPLATE_VERSION = 'v1';
const TEMPLATE_NAME = 'Opal Therapy Functional Assessment Report';
const CUSTOM_SECTION_ANCHOR = 'OPAL_ANCHOR_CUSTOM_SECTIONS';

// Parts that may carry content controls. Only these are ever modified.
const CONTROL_PARTS = [
  'word/document.xml',
  'word/header4.xml', 'word/header5.xml', 'word/header6.xml',
  'word/footer4.xml', 'word/footer5.xml', 'word/footer6.xml',
];

// ── Section catalogue ───────────────────────────────────────────────────────
// `parent` is null for top-level sections; nested sections may only be
// reordered among their own siblings. `title` is the heading text the template
// itself carries (used for TOC matching and for the frontend preview).
const SECTIONS = [
  { tag: 'OPAL_SECTION_PARTICIPANT_DETAILS', group: 'core', parent: null, required: true,
    label: 'Participant Details', title: 'Participant Details',
    description: 'Participant and assessor identity block, document control table.' },
  { tag: 'OPAL_SECTION_REFERRAL_INFORMATION', group: 'core', parent: null, required: true,
    label: 'Referral Information', title: 'Referral Information',
    description: 'Reason for referral, purpose and scope, consent, report recipients.' },
  { tag: 'OPAL_SECTION_PARTICIPANT_INFORMATION', group: 'core', parent: null, required: true,
    label: 'Participant Information', title: 'Participant Information',
    description: 'Background, living situation, supports, disability, conditions, goals.' },
  { tag: 'OPAL_SECTION_ASSESSMENT_METHOD', group: 'core', parent: null, required: true,
    label: 'Assessment Method', title: 'Assessment Method',
    description: 'Assessment activities, information sources, reports reviewed, limitations.' },

  { tag: 'OPAL_SECTION_ASSESSMENT_TOOL_WHODAS', group: 'assessment_tool', parent: 'OPAL_SECTION_ASSESSMENT_METHOD', required: false,
    label: 'WHODAS 2.0', title: 'WHODAS Assessment Schedule 2.0',
    description: 'WHODAS Assessment Schedule 2.0 results and interpretation.' },
  { tag: 'OPAL_SECTION_ASSESSMENT_TOOL_MOCA', group: 'assessment_tool', parent: 'OPAL_SECTION_ASSESSMENT_METHOD', required: false,
    label: 'MoCA', title: 'Montreal Cognitive Assessment (MoCA)',
    description: 'Montreal Cognitive Assessment results and interpretation.' },
  { tag: 'OPAL_SECTION_ASSESSMENT_TOOL_MBI', group: 'assessment_tool', parent: 'OPAL_SECTION_ASSESSMENT_METHOD', required: false,
    label: 'Modified Barthel Index', title: 'Modified Barthel Index (MBI)',
    description: 'Modified Barthel Index results and interpretation.' },
  { tag: 'OPAL_SECTION_ASSESSMENT_TOOL_CANS', group: 'assessment_tool', parent: 'OPAL_SECTION_ASSESSMENT_METHOD', required: false,
    label: 'Care and Needs Scale', title: 'Care and Needs Scale (CANS)',
    description: 'Care and Needs Scale results and interpretation.' },
  { tag: 'OPAL_SECTION_ASSESSMENT_TOOL_CARER_BURDEN', group: 'assessment_tool', parent: 'OPAL_SECTION_ASSESSMENT_METHOD', required: false,
    label: 'Carer Burden Scale', title: 'Carer Burden Scale',
    description: 'Carer Burden Scale results and interpretation.' },

  { tag: 'OPAL_SECTION_ASSESSMENT_RESULTS', group: 'core', parent: null, required: true,
    label: 'Assessment Results', title: 'Assessment results for Functional Capacity',
    description: 'Parent section for the functional domains and any custom sections.' },

  { tag: 'OPAL_SECTION_DOMAIN_MOBILITY', group: 'domain', parent: 'OPAL_SECTION_ASSESSMENT_RESULTS', required: false,
    label: 'Mobility', title: 'Mobility',
    description: 'Indoor/outdoor mobility, transfers, balance, tolerance, falls and pressure risk.' },
  { tag: 'OPAL_SECTION_DOMAIN_COGNITION', group: 'domain', parent: 'OPAL_SECTION_ASSESSMENT_RESULTS', required: false,
    label: 'Cognition', title: 'Cognition',
    description: 'Attention, memory, problem solving, supervision and safety.' },
  { tag: 'OPAL_SECTION_DOMAIN_COMMUNICATION', group: 'domain', parent: 'OPAL_SECTION_ASSESSMENT_RESULTS', required: false,
    label: 'Communication', title: 'Communication',
    description: 'Receptive and expressive communication, social skills, literacy.' },
  { tag: 'OPAL_SECTION_DOMAIN_PSYCHOLOGICAL_EMOTIONAL', group: 'domain', parent: 'OPAL_SECTION_ASSESSMENT_RESULTS', required: false,
    label: 'Psychological/Emotional', title: 'Psychological/Emotional',
    description: 'Mental health history, emotional and sensory regulation, motivation.' },
  { tag: 'OPAL_SECTION_DOMAIN_SELF_CARE_ADLS', group: 'domain', parent: 'OPAL_SECTION_ASSESSMENT_RESULTS', required: false,
    label: 'Self-Care ADLs', title: 'Self-Care ADLs',
    description: 'Toileting, showering, eating, grooming, dressing, medication, sleep.' },
  { tag: 'OPAL_SECTION_DOMAIN_DOMESTIC_ADLS', group: 'domain', parent: 'OPAL_SECTION_ASSESSMENT_RESULTS', required: false,
    label: 'Domestic ADLs', title: 'Domestic ADLs',
    description: 'Cleaning, cooking, laundry, maintenance, shopping, financial management.' },
  { tag: 'OPAL_SECTION_DOMAIN_COMMUNITY_ACCESS', group: 'domain', parent: 'OPAL_SECTION_ASSESSMENT_RESULTS', required: false,
    label: 'Community Access', title: 'Community Access',
    description: 'Transport, employment/volunteering, community and leisure participation.' },
  { tag: 'OPAL_SECTION_DOMAIN_BEHAVIOURS_OF_CONCERN', group: 'domain', parent: 'OPAL_SECTION_ASSESSMENT_RESULTS', required: false,
    label: 'Behaviours of Concern', title: 'Behaviours of Concern',
    description: 'Aggressive, self-injurious, disruptive and socially inappropriate behaviours.' },
  { tag: 'OPAL_SECTION_DOMAIN_HOME_MODIFICATIONS_AT', group: 'domain', parent: 'OPAL_SECTION_ASSESSMENT_RESULTS', required: false,
    label: 'Home Modifications and AT', title: 'Home Modifications and Assistive Technology',
    description: 'Home environment, current assistive technology, trials, recommendations.' },

  { tag: 'OPAL_SECTION_SUMMARY_RECOMMENDATIONS', group: 'core', parent: null, required: true,
    label: 'Summary and Recommendations', title: 'Summary and Recommendations',
    description: 'Summary, recommendation overview and alignment.' },

  { tag: 'OPAL_SECTION_RECOMMENDATION_CORE_SUPPORTS', group: 'recommendation', parent: 'OPAL_SECTION_SUMMARY_RECOMMENDATIONS', required: false,
    label: 'Core Supports', title: 'Core Supports',
    description: 'Daily life, social and community participation, transport, low-cost AT.' },
  { tag: 'OPAL_SECTION_RECOMMENDATION_CAPACITY_BUILDING', group: 'recommendation', parent: 'OPAL_SECTION_SUMMARY_RECOMMENDATIONS', required: false,
    label: 'Capacity Building', title: 'Capacity Building',
    description: 'Therapy and support coordination recommendations.' },

  { tag: 'OPAL_SECTION_PROFESSIONAL_DECLARATION', group: 'core', parent: null, required: true,
    label: 'Professional Declaration', title: 'Professional Declaration',
    description: 'Assessor declaration and contact details.' },
  { tag: 'OPAL_SECTION_APPENDICES', group: 'appendix', parent: null, required: false,
    label: 'Appendices', title: 'Appendices',
    description: 'Score sheets, evidence reviewed, supporting material, pre-issue checklist.' },
].map((s, i) => ({ ...s, defaultSelected: true, defaultOrder: i }));

const SECTION_BY_TAG = new Map(SECTIONS.map((s) => [s.tag, s]));
const REQUIRED_SECTION_TAGS = SECTIONS.filter((s) => s.required).map((s) => s.tag);
const OPTIONAL_SECTION_TAGS = SECTIONS.filter((s) => !s.required).map((s) => s.tag);

// ── Scalar tag catalogue ────────────────────────────────────────────────────
// Each scalar tag is classified by the LAYER that owns it. The layer decides
// both how resolve-scalars.js resolves a value and whether save-to-profile is
// allowed to persist a therapist's typed value back to the client profile.
//
//   layer 'splose'          SPLOSE-AUTHORITATIVE. Splose is the system of
//                           record for this fact. A stale client-profile value
//                           must NEVER shadow it, so the profile is not even
//                           consulted. A report-specific override still wins
//                           (a therapist correcting an address for one report
//                           is legitimate), but nothing is ever written back.
//   layer 'client_profile'  PROFILE-OWNED durable client fact. Splose has no
//                           field for it. Resolved from the organisation-scoped
//                           OPAL client report profile (or its current NDIS
//                           plan), overridable per report, and eligible for
//                           explicit, permissioned save-back.
//   layer 'portal'          Read from THIS database (users / therapist_profiles
//                           / organisations / credentials). Overridable per
//                           report; never client data, so never profile-eligible.
//   layer 'report'          REPORT-SPECIFIC. Belongs to one report only. Comes
//                           from a therapist override or nothing at all.
//                           save-to-profile REJECTS these.
//   layer 'server'          Issued by the server at generate time (ids, dates,
//                           version, status). readOnly: overrides are refused.
//
// `profileField`     column on fca_client_profiles that backs the tag.
// `profilePlanField` field on the CURRENT fca_client_ndis_plans row (or its
//                    ordered goals) that backs the tag.
// `occurrences` is the verified count across all parts; `parts` lists the
// non-document parts a tag also appears in.
const SCALAR_TAGS = [
  // ── Participant: Splose-authoritative identity and contact ───────────────
  { tag: 'OPAL_CLIENT_FULL_NAME', label: 'Full name', layer: 'splose', field: 'fullName', occurrences: 3 },
  { tag: 'OPAL_CLIENT_NDIS_NUMBER', label: 'NDIS number', layer: 'splose', field: 'ndisNumber', occurrences: 4, parts: ['word/header6.xml'] },
  { tag: 'OPAL_CLIENT_ADDRESS', label: 'Address', layer: 'splose', field: 'formattedAddress', occurrences: 1 },
  { tag: 'OPAL_CLIENT_EMAIL', label: 'Email', layer: 'splose', field: 'email', occurrences: 1 },
  { tag: 'OPAL_CLIENT_PHONE', label: 'Phone', layer: 'splose', field: 'mobilePhone', occurrences: 1 },

  // ── Participant: durable facts the client profile owns ───────────────────
  { tag: 'OPAL_CLIENT_PREFERRED_NAME', label: 'Preferred name', layer: 'client_profile', profileField: 'preferred_name', occurrences: 2, parts: ['word/header6.xml'],
    note: 'Splose has no preferred-name field. A first name is NOT a preferred name and is never substituted.' },
  { tag: 'OPAL_CLIENT_DATE_OF_BIRTH', label: 'Date of birth', layer: 'client_profile', profileField: 'date_of_birth', occurrences: 1 },
  { tag: 'OPAL_CLIENT_PRONOUNS', label: 'Pronouns', layer: 'client_profile', profileField: 'pronouns', occurrences: 1 },
  { tag: 'OPAL_CLIENT_PRIMARY_DISABILITY', label: 'Primary disability', layer: 'client_profile', profileField: 'primary_disability', occurrences: 1 },
  { tag: 'OPAL_CLIENT_OTHER_CONDITIONS', label: 'Other conditions', layer: 'client_profile', profileField: 'other_conditions', occurrences: 1 },
  { tag: 'OPAL_CLIENT_NOMINEE_DETAILS', label: 'Nominee or guardian', layer: 'client_profile', profileField: 'nominee_details', occurrences: 1 },
  { tag: 'OPAL_CLIENT_SUPPORT_COORDINATOR_DETAILS', label: 'Support coordinator', layer: 'client_profile', profileField: 'support_coordinator_details', occurrences: 1 },
  { tag: 'OPAL_CLIENT_REFERRER_DETAILS', label: 'Referrer', layer: 'client_profile', profileField: 'referrer_details', occurrences: 1,
    note: 'Suggested from the profile but genuinely report-specific in practice — referrals change, so the per-report override is expected to be used often.' },

  // ── Participant: current NDIS plan (versioned; never overwritten) ─────────
  { tag: 'OPAL_CLIENT_NDIS_PLAN_START', label: 'NDIS plan start', layer: 'client_profile', profilePlanField: 'plan_start', occurrences: 1 },
  { tag: 'OPAL_CLIENT_NDIS_PLAN_END', label: 'NDIS plan end', layer: 'client_profile', profilePlanField: 'plan_end', occurrences: 1 },
  { tag: 'OPAL_CLIENT_NDIS_GOAL_1', label: 'NDIS goal 1', layer: 'client_profile', profilePlanField: 'goal:0', occurrences: 1,
    note: 'The template exposes only two goal controls. Goals are stored unbounded and ordered by sort_order; goal 1 is the current plan\'s FIRST goal.' },
  { tag: 'OPAL_CLIENT_NDIS_GOAL_2', label: 'NDIS goal 2', layer: 'client_profile', profilePlanField: 'goal:1', occurrences: 1,
    note: 'The current plan\'s SECOND goal. Any third or later goal is stored and queryable but has no control in fca-v1 and is not rendered.' },

  // ── Assessor: portal-sourced ─────────────────────────────────────────────
  { tag: 'OPAL_THERAPIST_FULL_NAME', label: 'Assessor name', layer: 'portal', field: 'therapistName', occurrences: 5 },
  { tag: 'OPAL_THERAPIST_CREDENTIALS', label: 'Assessor credentials', layer: 'portal', field: 'therapistRoleTitle', occurrences: 4 },
  { tag: 'OPAL_THERAPIST_EMAIL', label: 'Assessor email', layer: 'portal', field: 'therapistEmail', occurrences: 3 },
  { tag: 'OPAL_THERAPIST_PHONE', label: 'Assessor phone', layer: 'portal', field: 'therapistPhone', occurrences: 3 },
  { tag: 'OPAL_THERAPIST_ORGANISATION', label: 'Organisation', layer: 'portal', field: 'organisationName', occurrences: 2 },
  { tag: 'OPAL_THERAPIST_AHPRA_NUMBER', label: 'AHPRA number', layer: 'portal', field: 'ahpraNumber', occurrences: 2,
    note: 'Read from an active credentials row whose type or name mentions AHPRA. MISSING when no such credential exists.' },

  // ── Assessor: no portal source; report override only ─────────────────────
  // These are durable THERAPIST facts, but the profile layer is CLIENT-scoped,
  // so there is nowhere to save them back to. Never profile-eligible.
  { tag: 'OPAL_THERAPIST_QUALIFICATIONS', label: 'Qualifications', layer: 'report', occurrences: 2 },
  { tag: 'OPAL_THERAPIST_PROVIDER_NUMBER', label: 'NDIS provider number', layer: 'report', occurrences: 2 },

  // ── Report control: server-issued ────────────────────────────────────────
  { tag: 'OPAL_REPORT_DOCUMENT_ID', label: 'Document ID', layer: 'server', field: 'documentReference', occurrences: 3, parts: ['word/footer6.xml'], readOnly: true },
  { tag: 'OPAL_REPORT_DATE', label: 'Report date', layer: 'server', field: 'reportDate', occurrences: 2, readOnly: true },
  { tag: 'OPAL_REPORT_VERSION', label: 'Report version', layer: 'server', field: 'reportVersion', occurrences: 2, readOnly: true },
  { tag: 'OPAL_REPORT_STATUS', label: 'Report status', layer: 'server', field: 'reportStatus', occurrences: 1, readOnly: true },

  // ── Report control: report-specific, therapist-supplied ──────────────────
  { tag: 'OPAL_REPORT_ISSUE_DATE', label: 'Issue date', layer: 'report', occurrences: 2,
    note: 'The date the report is issued to the participant is not known at generation time.' },
  { tag: 'OPAL_REPORT_REVIEWER_NAME', label: 'Reviewer name', layer: 'report', occurrences: 1 },
  { tag: 'OPAL_REPORT_REVIEWER_ROLE', label: 'Reviewer role', layer: 'report', occurrences: 1 },
  { tag: 'OPAL_REPORT_AUTHORISED_RECIPIENTS', label: 'Authorised recipients', layer: 'report', occurrences: 1 },
];

const SCALAR_BY_TAG = new Map(SCALAR_TAGS.map((s) => [s.tag, s]));
const SCALAR_TAG_LIST = SCALAR_TAGS.map((s) => s.tag);

// ── Layer-derived tag sets ──────────────────────────────────────────────────
const SPLOSE_AUTHORITATIVE_TAGS = SCALAR_TAGS.filter((s) => s.layer === 'splose').map((s) => s.tag);
const PORTAL_TAGS = SCALAR_TAGS.filter((s) => s.layer === 'portal').map((s) => s.tag);
const SERVER_TAGS = SCALAR_TAGS.filter((s) => s.layer === 'server').map((s) => s.tag);
const REPORT_SPECIFIC_TAGS = SCALAR_TAGS.filter((s) => s.layer === 'report').map((s) => s.tag);

/**
 * The ONLY tags save-to-profile may ever persist. Everything else is rejected
 * with a reason and nothing is written. Derived from the layer classification
 * so a new tag cannot become profile-eligible by accident.
 */
const PROFILE_ELIGIBLE_TAGS = SCALAR_TAGS.filter((s) => s.layer === 'client_profile').map((s) => s.tag);

/** Profile-eligible tags backed by the CURRENT NDIS plan (new plan version on save-back). */
const PROFILE_PLAN_TAGS = SCALAR_TAGS.filter((s) => s.layer === 'client_profile' && s.profilePlanField).map((s) => s.tag);

/** Why a tag may not be saved back to the client profile. Used verbatim in API responses. */
function profileRejectionReason(tag) {
  const meta = SCALAR_BY_TAG.get(tag);
  if (!meta) return 'unknown_tag';
  switch (meta.layer) {
    case 'splose': return 'splose_authoritative';
    case 'portal': return 'not_client_data';
    case 'server': return 'server_issued';
    case 'report': return 'report_specific';
    default: return 'not_profile_eligible';
  }
}

/**
 * Tags the server may report as MISSING. Only the four server-issued tags are
 * guaranteed, because the server mints them itself; everything else depends on
 * data that may genuinely not exist, and missing data is FLAGGED, never
 * fabricated.
 */
const MISSING_CAPABLE_TAGS = SCALAR_TAGS.filter((s) => s.layer !== 'server').map((s) => s.tag);

/** Tags a therapist may type a real value for. Server-issued ids are excluded. */
const OVERRIDABLE_TAGS = SCALAR_TAGS.filter((s) => !s.readOnly).map((s) => s.tag);

const MAX_OVERRIDE_CHARS = 400;
const MAX_CUSTOM_SECTIONS = 10;
const MAX_CUSTOM_TITLE_CHARS = 120;
const MAX_CUSTOM_GUIDANCE_CHARS = 600;

/**
 * Placeholder rendered when a scalar tag has no value. Never 'null' or
 * 'undefined', and clearly marked so a therapist can see what is outstanding.
 */
function missingPlaceholder(tag) {
  const meta = SCALAR_BY_TAG.get(tag);
  return `[TO COMPLETE ${EN_DASH} ${(meta ? meta.label : tag).toUpperCase()}]`;
}

/** Uppercase A-Z0-9 slug used inside generated custom-section tags. */
function slugForCustomSection(title) {
  const slug = String(title || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'SECTION';
}

/** The w:tag value the engine writes for a custom section. */
function customSectionTag(title, uuid) {
  return `OPAL_SECTION_CUSTOM_${slugForCustomSection(title)}_${String(uuid).toUpperCase().replace(/-/g, '')}`;
}

/** Contract shape for GET /api/fca/template. */
function templateDescriptor() {
  return {
    id: TEMPLATE_ID,
    version: TEMPLATE_VERSION,
    sections: SECTIONS.map((s) => ({
      tag: s.tag,
      group: s.group,
      label: s.label,
      description: s.description,
      required: s.required,
      defaultSelected: s.defaultSelected,
      defaultOrder: s.defaultOrder,
    })),
    scalarTags: SCALAR_TAG_LIST.slice(),
    profileEligibleTags: PROFILE_ELIGIBLE_TAGS.slice(),
    missingCapableTags: MISSING_CAPABLE_TAGS.slice(),
  };
}

module.exports = {
  EN_DASH,
  STYLE,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  TEMPLATE_NAME,
  CUSTOM_SECTION_ANCHOR,
  CONTROL_PARTS,
  SECTIONS,
  SECTION_BY_TAG,
  REQUIRED_SECTION_TAGS,
  OPTIONAL_SECTION_TAGS,
  SCALAR_TAGS,
  SCALAR_BY_TAG,
  SCALAR_TAG_LIST,
  SPLOSE_AUTHORITATIVE_TAGS,
  PORTAL_TAGS,
  SERVER_TAGS,
  REPORT_SPECIFIC_TAGS,
  PROFILE_ELIGIBLE_TAGS,
  PROFILE_PLAN_TAGS,
  profileRejectionReason,
  MISSING_CAPABLE_TAGS,
  OVERRIDABLE_TAGS,
  MAX_OVERRIDE_CHARS,
  MAX_CUSTOM_SECTIONS,
  MAX_CUSTOM_TITLE_CHARS,
  MAX_CUSTOM_GUIDANCE_CHARS,
  missingPlaceholder,
  slugForCustomSection,
  customSectionTag,
  templateDescriptor,
};
