'use strict';

/**
 * PROGRESS REPORT TEMPLATE MAP — the static description of
 * fca/templates/progress-report-v1.docx, the Templates editor's Occupational
 * Therapy progress report for an NDIS plan review.
 *
 * ── Where the master comes from ─────────────────────────────────────────────
 * scripts/build-clinical-templates.js writes the .docx FROM THIS FILE, on the
 * FCA master's package shell (styles, cover band, logo, running header and
 * footer, page numbering), so a progress report and an FCA are visibly the same
 * family. tests/templates-clinical-maps.test.js re-reads the shipped file.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 *   cover · contents ·
 *   Participant Details (+ Assessor Details) ·
 *   Participant Information
 *     Background · Formal Supports funded by NDIS · Plan Utilisation ·
 *     Participant Goals · Formal Assessment ·
 *   Progress Towards NDIS Goals
 *     NDIS Goal 1 … NDIS Goal 8 (status, relevant OT goals, progress) ·
 *     [custom sections] ·
 *   Overall Summary of Progress ·
 *   Ongoing Recommendations
 *     Core Supports · Capacity Building (with recommended hours) ·
 *   Professional Declaration · Appendices
 *
 * Every section is optional in the Content step. Goals 1–4 start included and
 * 5–8 start removed — restore as many as the plan has. Each goal's statement
 * resolves from the participant's current NDIS plan goals when they are
 * recorded on the client profile.
 *
 * Table rows a report may not need (a second support provider, a fifth result)
 * are `optionalRow`: an empty row is removed whole, so a short table never
 * prints a column of blanks. The first row of each table is always kept.
 */

const { EN_DASH, STYLE } = require('../fca/template-map');

const TEMPLATE_VERSION = 'v1';
const TEMPLATE_NAME = 'Opal Therapy Occupational Therapy Progress Report';
const TEMPLATE_FILENAME = 'progress-report-v1.docx';

/** Pinned so a swapped master fails a test instead of shipping quietly. */
const TEMPLATE_SHA256 = '4d6cadf0dd7287492353d4197ef6f8136ae4289e16cfef161a967f3e2551e97e';

const CUSTOM_SECTION_ANCHOR = 'OPAL_ANCHOR_PROGRESS_REPORT_CUSTOM_SECTIONS';

/** The FCA shell's parts. */
const CONTROL_PARTS = [
  'word/document.xml',
  'word/header4.xml', 'word/header5.xml', 'word/header6.xml',
  'word/footer4.xml', 'word/footer5.xml', 'word/footer6.xml',
];

const GOAL_SLOTS = 8;
const GOALS_INCLUDED_BY_DEFAULT = 4;
const SUPPORT_ROWS = 8;
const RESULT_ROWS = 8;
const HOURS_ROWS = 6;

const NARRATIVE_MAX_CHARS = 12000;

const T = (key) => `OPAL_SECTION_REPORT_${key}`;

// ── Sections ────────────────────────────────────────────────────────────────

const GOAL_SECTIONS = Array.from({ length: GOAL_SLOTS }, (_, i) => ({
  key: `GOAL_${i + 1}`,
  parent: T('PROGRESS'),
  title: `NDIS Goal ${i + 1}`,
  description: 'The goal, its status, the relevant OT goals and progress over the period.',
  level: 3,
  defaultSelected: i < GOALS_INCLUDED_BY_DEFAULT,
}));

const SECTIONS = [
  { key: 'PARTICIPANT_DETAILS', title: 'Participant Details',
    description: 'Participant identifiers, plan dates and the assessor’s details.' },
  { key: 'PARTICIPANT_INFORMATION', title: 'Participant Information',
    description: 'Background, supports, plan utilisation, goals and formal assessment.' },
  { key: 'BACKGROUND', parent: T('PARTICIPANT_INFORMATION'), title: 'Background Information',
    description: 'The participant, their household, diagnosis and current therapy.' },
  { key: 'FORMAL_SUPPORTS', parent: T('PARTICIPANT_INFORMATION'), title: 'Formal Supports funded by NDIS',
    description: 'The treating team and other supports, with commentary.' },
  { key: 'PLAN_UTILISATION', parent: T('PARTICIPANT_INFORMATION'), title: 'Plan Utilisation',
    description: 'Hours used this plan period, sessions remaining and the delivery model.' },
  { key: 'PARTICIPANT_GOALS', parent: T('PARTICIPANT_INFORMATION'), title: 'Participant Goals',
    description: 'The participant’s NDIS goals as stated in the plan.' },
  { key: 'FORMAL_ASSESSMENT', parent: T('PARTICIPANT_INFORMATION'), title: 'Formal Assessment',
    description: 'A standardised assessment, its results table and interpretation.' },
  { key: 'PROGRESS', title: 'Progress Towards NDIS Goals',
    description: 'Progress against each NDIS goal over the reporting period.' },
  ...GOAL_SECTIONS,
  { key: 'SUMMARY', title: 'Overall Summary of Progress',
    description: 'The overall picture: gains, ongoing difficulties and clinical reasoning.' },
  { key: 'RECOMMENDATIONS', title: 'Ongoing Recommendations',
    description: 'Recommended supports for the next plan period.' },
  { key: 'CORE_SUPPORTS', parent: T('RECOMMENDATIONS'), title: 'Core Supports',
    description: 'Support work and other core supports, with justification.' },
  { key: 'CAPACITY_BUILDING', parent: T('RECOMMENDATIONS'), title: 'Capacity Building',
    description: 'Therapy recommendations and the recommended hours.' },
  { key: 'DECLARATION', title: 'Professional Declaration',
    description: 'The therapist’s declaration, signature and date.' },
].map((s) => ({ ...s, tag: T(s.key) }));

// The appendices section reuses the FCA's tag, so attached PDFs are listed in
// it by templates/appendices.js exactly as they are in an FCA.
SECTIONS.push({
  key: 'APPENDICES', tag: 'OPAL_SECTION_APPENDICES', title: 'Appendices',
  description: 'Attached assessment score sheets and supporting documents.',
  group: 'appendix', defaultSelected: false,
});

SECTIONS.forEach((s, i) => {
  s.label = s.title;
  s.parent = s.parent || null;
  s.group = s.group || (s.parent ? 'subsection' : 'core');
  s.required = false;
  s.level = s.level || (s.parent ? 2 : 1);
  if (s.defaultSelected === undefined) s.defaultSelected = true;
  s.defaultOrder = i;
});

const SECTION_BY_TAG = new Map(SECTIONS.map((s) => [s.tag, s]));

// ── Scalars ─────────────────────────────────────────────────────────────────

const narrative = (tag, label, section, hint, extra = {}) => ({
  tag, label, alias: label.toUpperCase(), layer: 'report', section, hint,
  narrative: true, paragraphs: true, multiline: true, maxChars: NARRATIVE_MAX_CHARS, ...extra,
});

const SCALAR_TAGS = [
  // ── Participant ──────────────────────────────────────────────────────────
  { tag: 'OPAL_CLIENT_FULL_NAME', label: 'Participant name', alias: 'CLIENT NAME', layer: 'splose', field: 'fullName',
    parts: ['word/header6.xml'], group: 'Participant' },
  { tag: 'OPAL_CLIENT_PREFERRED_NAME', label: 'Preferred name', alias: 'PREFERRED NAME', layer: 'client_profile',
    profileField: 'preferred_name', fallbackField: 'firstname', group: 'Participant',
    hint: 'Used in running text, e.g. “Korra’s NDIS goals include …”' },
  { tag: 'OPAL_CLIENT_NDIS_NUMBER', label: 'NDIS number', alias: 'NDIS NUMBER', layer: 'splose', field: 'ndisNumber',
    parts: ['word/header6.xml'], group: 'Participant' },
  { tag: 'OPAL_CLIENT_DATE_OF_BIRTH', label: 'Date of birth', alias: 'DATE OF BIRTH', layer: 'client_profile',
    profileField: 'date_of_birth', isDate: true, group: 'Participant' },
  { tag: 'OPAL_CLIENT_PRIMARY_DISABILITY', label: 'Primary disability', alias: 'PRIMARY DISABILITY', layer: 'client_profile',
    profileField: 'primary_disability', optionalRow: true, group: 'Participant' },
  { tag: 'OPAL_CLIENT_NDIS_PLAN_START', label: 'NDIS plan start', alias: 'PLAN START', layer: 'client_profile',
    profilePlanField: 'plan_start', isDate: true, group: 'Participant' },
  { tag: 'OPAL_CLIENT_NDIS_PLAN_END', label: 'NDIS plan end', alias: 'PLAN END', layer: 'client_profile',
    profilePlanField: 'plan_end', isDate: true, group: 'Participant' },

  // ── Report ───────────────────────────────────────────────────────────────
  { tag: 'OPAL_REPORT_DATE', label: 'Report date', alias: 'REPORT DATE', layer: 'server', field: 'reportDate', isDate: true, group: 'Report' },
  { tag: 'OPAL_REPORT_PERIOD', label: 'Reporting period', alias: 'REPORTING PERIOD', layer: 'report', optionalRow: true, group: 'Report',
    hint: 'e.g. December 2025 to October 2026' },
  { tag: 'OPAL_REPORT_DOCUMENT_ID', label: 'Document ID', alias: 'REPORT ID', layer: 'server', field: 'documentReference',
    parts: ['word/footer6.xml'], group: 'Report' },

  // ── Assessor ─────────────────────────────────────────────────────────────
  { tag: 'OPAL_THERAPIST_FULL_NAME', label: 'Therapist name', alias: 'THERAPIST NAME', layer: 'portal', field: 'therapistName', group: 'Therapist' },
  { tag: 'OPAL_THERAPIST_ROLE', label: 'Therapist role', alias: 'THERAPIST ROLE', layer: 'portal', field: 'therapistRoleTitle', group: 'Therapist' },
  { tag: 'OPAL_THERAPIST_QUALIFICATIONS', label: 'Qualifications', alias: 'THERAPIST QUALIFICATIONS', layer: 'report', group: 'Therapist',
    hint: 'e.g. Bachelor of Science (Occupational Therapy), Curtin University' },
  { tag: 'OPAL_THERAPIST_AHPRA_NUMBER', label: 'AHPRA registration', alias: 'AHPRA NUMBER', layer: 'portal', field: 'ahpraNumber', group: 'Therapist' },
  { tag: 'OPAL_THERAPIST_ORGANISATION', label: 'Organisation', alias: 'ORGANISATION', layer: 'portal', field: 'organisationName', group: 'Therapist' },
  { tag: 'OPAL_THERAPIST_PHONE', label: 'Therapist phone', alias: 'THERAPIST PHONE', layer: 'portal', field: 'therapistPhone', group: 'Therapist' },
  { tag: 'OPAL_THERAPIST_EMAIL', label: 'Therapist email', alias: 'THERAPIST EMAIL', layer: 'portal', field: 'therapistEmail', group: 'Therapist' },

  // ── Participant information ──────────────────────────────────────────────
  narrative('OPAL_REPORT_BACKGROUND', 'Background information', T('BACKGROUND'),
    'Who the participant is, their household, schooling or work, diagnosis, and the therapy currently provided.',
    { group: 'Background' }),
];

// Formal supports: a two-column table, one row per provider.
for (let i = 1; i <= SUPPORT_ROWS; i++) {
  SCALAR_TAGS.push(
    { tag: `OPAL_REPORT_SUPPORT_${i}_ROLE`, label: `Support ${i} — role`, alias: `SUPPORT ${i} ROLE`, layer: 'report',
      group: 'Formal supports', section: T('FORMAL_SUPPORTS'), optionalRow: i > 1,
      hint: i === 1 ? 'e.g. Support Coordinator, Speech Pathologist' : undefined },
    { tag: `OPAL_REPORT_SUPPORT_${i}_PROVIDER`, label: `Support ${i} — name and provider`, alias: `SUPPORT ${i} PROVIDER`, layer: 'report',
      group: 'Formal supports', section: T('FORMAL_SUPPORTS'), optionalRow: i > 1,
      hint: i === 1 ? 'e.g. Linda Reiss, Linda Reiss COS' : undefined },
  );
}
SCALAR_TAGS.push(
  narrative('OPAL_REPORT_SUPPORTS_COMMENTARY', 'Supports commentary', T('FORMAL_SUPPORTS'),
    'How the treating team works together, and mainstream or health supports in place.',
    { group: 'Formal supports' }),
  narrative('OPAL_REPORT_PLAN_UTILISATION', 'Plan utilisation', T('PLAN_UTILISATION'),
    'Hours used to date, sessions still scheduled, and how and where therapy has been delivered.',
    { group: 'Plan utilisation' }),
  narrative('OPAL_REPORT_GOALS_LIST', 'NDIS goals (one per line)', T('PARTICIPANT_GOALS'),
    'One goal per line, as written in the plan. Each line prints as a bullet.',
    { group: 'Participant goals', bullets: true }),
  { tag: 'OPAL_REPORT_ASSESSMENT_NAME', label: 'Assessment name', alias: 'ASSESSMENT NAME', layer: 'report',
    group: 'Formal assessment', section: T('FORMAL_ASSESSMENT'),
    hint: 'e.g. Vineland Adaptive Behavior Scales, Third Edition (Vineland-3)' },
  narrative('OPAL_REPORT_ASSESSMENT_OVERVIEW', 'About the assessment', T('FORMAL_ASSESSMENT'),
    'What the assessment measures, who completed it and when.',
    { group: 'Formal assessment' }),
);
for (let i = 1; i <= RESULT_ROWS; i++) {
  const g = { layer: 'report', group: 'Assessment results', section: T('FORMAL_ASSESSMENT'), optionalRow: i > 1 };
  SCALAR_TAGS.push(
    { tag: `OPAL_REPORT_RESULT_${i}_DOMAIN`, label: `Result ${i} — domain`, alias: `RESULT ${i} DOMAIN`, ...g,
      hint: i === 1 ? 'e.g. Adaptive Behaviour Composite' : undefined },
    { tag: `OPAL_REPORT_RESULT_${i}_SCORE`, label: `Result ${i} — score`, alias: `RESULT ${i} SCORE`, ...g },
    { tag: `OPAL_REPORT_RESULT_${i}_PERCENTILE`, label: `Result ${i} — percentile`, alias: `RESULT ${i} PERCENTILE`, ...g },
    { tag: `OPAL_REPORT_RESULT_${i}_CLASSIFICATION`, label: `Result ${i} — classification`, alias: `RESULT ${i} CLASSIFICATION`, ...g },
  );
}
SCALAR_TAGS.push(
  narrative('OPAL_REPORT_ASSESSMENT_INTERPRETATION', 'Interpretation of results', T('FORMAL_ASSESSMENT'),
    'What the scores mean for everyday function, domain by domain. Start each domain on a new line.',
    { group: 'Assessment results' }),
);

// Goals.
for (let i = 1; i <= GOAL_SLOTS; i++) {
  const section = T(`GOAL_${i}`);
  const group = `NDIS goal ${i}`;
  SCALAR_TAGS.push(
    { tag: `OPAL_REPORT_GOAL_${i}`, label: `Goal ${i} — NDIS goal`, alias: `NDIS GOAL ${i}`, layer: 'client_profile',
      profilePlanField: `goal:${i - 1}`, group, section,
      hint: 'Filled from the participant’s current NDIS plan goals when recorded.' },
    { tag: `OPAL_REPORT_GOAL_${i}_STATUS`, label: `Goal ${i} — progress rating`, alias: `GOAL ${i} STATUS`, layer: 'report',
      optionalLine: true, group, section,
      hint: 'Optional. e.g. Progressing — partially achieved' },
    narrative(`OPAL_REPORT_GOAL_${i}_OT_GOALS`, `Goal ${i} — relevant OT goals`, section,
      'One therapy goal per line. Each line prints as a bullet.', { group, bullets: true }),
    narrative(`OPAL_REPORT_GOAL_${i}_PROGRESS`, `Goal ${i} — progress over time`, section,
      'Where the participant started, what was worked on, what has changed, and what support is still needed.',
      { group }),
  );
}

SCALAR_TAGS.push(
  narrative('OPAL_REPORT_SUMMARY', 'Overall summary of progress', T('SUMMARY'),
    'Overall gains, areas of continuing difficulty, and why ongoing support is required.',
    { group: 'Summary' }),
  narrative('OPAL_REPORT_CORE_SUPPORTS', 'Core supports', T('CORE_SUPPORTS'),
    'Recommended core supports (e.g. support work hours, ratios) with justification and value for money.',
    { group: 'Recommendations' }),
  narrative('OPAL_REPORT_CAPACITY_BUILDING', 'Capacity building', T('CAPACITY_BUILDING'),
    'Recommended therapy and other capacity-building supports, the focus of intervention and justification.',
    { group: 'Recommendations' }),
);
for (let i = 1; i <= HOURS_ROWS; i++) {
  const g = { layer: 'report', group: 'Recommended hours', section: T('CAPACITY_BUILDING'), optionalRow: i > 1 };
  SCALAR_TAGS.push(
    { tag: `OPAL_REPORT_HOURS_${i}_ITEM`, label: `Hours ${i} — item`, alias: `HOURS ${i} ITEM`, ...g,
      hint: i === 1 ? 'e.g. Fortnightly therapy sessions, including provider travel' : undefined },
    { tag: `OPAL_REPORT_HOURS_${i}_HOURS`, label: `Hours ${i} — hours`, alias: `HOURS ${i} HOURS`, ...g },
  );
}
SCALAR_TAGS.push(
  { tag: 'OPAL_REPORT_HOURS_TOTAL', label: 'Total recommended hours', alias: 'TOTAL HOURS', layer: 'report',
    group: 'Recommended hours', section: T('CAPACITY_BUILDING'), optionalRow: true, hint: 'e.g. 50 hours per year' },
);

for (const s of SCALAR_TAGS) {
  if (!s.group) s.group = 'Other details';
  if (!s.alias) s.alias = s.label.toUpperCase();
}

const SCALAR_BY_TAG = new Map(SCALAR_TAGS.map((s) => [s.tag, s]));
const SCALAR_TAG_LIST = SCALAR_TAGS.map((s) => s.tag);

const MULTILINE_TAGS = new Set(SCALAR_TAGS.filter((s) => s.multiline && !s.paragraphs).map((s) => s.tag));
const PARAGRAPH_TAGS = new Set(SCALAR_TAGS.filter((s) => s.paragraphs).map((s) => s.tag));
const OPTIONAL_LINE_TAGS = new Set(SCALAR_TAGS.filter((s) => s.optionalLine).map((s) => s.tag));
const OPTIONAL_ROW_TAGS = new Set(SCALAR_TAGS.filter((s) => s.optionalRow).map((s) => s.tag));

function promptFor(tag) {
  const s = SCALAR_BY_TAG.get(tag);
  return `[PORTAL — ${s ? s.alias : tag}]`;
}

const SECTION_CATALOGUE = {
  SECTIONS,
  SECTION_BY_TAG,
  REQUIRED_SECTION_TAGS: [],
  SECTION_DEPENDENT_ROWS: {},
  MAX_CUSTOM_SECTIONS: 10,
  MAX_CUSTOM_TITLE_CHARS: 120,
  MAX_CUSTOM_GUIDANCE_CHARS: 2000,
};

module.exports = {
  EN_DASH,
  STYLE,
  TEMPLATE_VERSION,
  TEMPLATE_NAME,
  TEMPLATE_FILENAME,
  TEMPLATE_SHA256,
  CUSTOM_SECTION_ANCHOR,
  CONTROL_PARTS,
  GOAL_SLOTS,
  SUPPORT_ROWS,
  RESULT_ROWS,
  HOURS_ROWS,
  SECTIONS,
  SECTION_BY_TAG,
  SECTION_CATALOGUE,
  SCALAR_TAGS,
  SCALAR_BY_TAG,
  SCALAR_TAG_LIST,
  CATALOGUE: { SCALAR_TAGS, SCALAR_BY_TAG, SCALAR_TAG_LIST },
  MULTILINE_TAGS,
  PARAGRAPH_TAGS,
  OPTIONAL_LINE_TAGS,
  OPTIONAL_ROW_TAGS,
  promptFor,
};
