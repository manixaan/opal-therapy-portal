'use strict';

/**
 * SUPPORT LETTER TEMPLATE MAP — the static description of
 * fca/templates/support-letter-v1.docx, the Templates editor's letter of
 * support (funding recommendation) for an NDIS participant.
 *
 * It replaces the Templates catalogue's "Progress Note" card. The progress-note
 * letter master and its own wizard (fca/letter-template-map.js,
 * letter-routes.js) are untouched — this is a second, separate master.
 *
 * ── Where the master comes from ─────────────────────────────────────────────
 * scripts/build-clinical-templates.js writes the .docx FROM THIS FILE: every
 * control's tag, alias and prompt, every section's heading and order. The map
 * and the master therefore cannot disagree, and
 * tests/templates-clinical-maps.test.js re-reads the shipped file to prove it.
 * Change the wording here, re-run the builder, re-pin the hash.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 * The package shell (styles, letterhead header, document-id footer, logo) is
 * the progress-note letter's, so both letters carry the same letterhead.
 *
 *   date · recipient block · reference panel (participant, NDIS number,
 *   date of birth, subject, quote reference) · greeting ·
 *   eight body sections, each a heading and a narrative · custom sections ·
 *   closing · signature block · enclosures · CC
 *
 * Narrative fields are BLOCK-level controls listed in PARAGRAPH_TAGS: each line
 * the clinician types becomes its own paragraph in the document, so a letter
 * written in the portal reads as paragraphs, not one block with line breaks.
 */

const { EN_DASH, STYLE } = require('../fca/template-map');

const TEMPLATE_VERSION = 'v1';
const TEMPLATE_NAME = 'Opal Therapy Letter of Support';
const TEMPLATE_FILENAME = 'support-letter-v1.docx';

/** Pinned so a swapped master fails a test instead of shipping quietly. */
const TEMPLATE_SHA256 = '55a77d6e9348a1cb5d0215dccda2d47e20710d2389c1c41626660e6bd88eaf01';

const CUSTOM_SECTION_ANCHOR = 'OPAL_ANCHOR_SUPPORT_LETTER_CUSTOM_SECTIONS';

/** The letter shell's parts — the same names the progress-note letter uses. */
const CONTROL_PARTS = ['word/document.xml', 'word/header6.xml', 'word/footer6.xml'];

const NARRATIVE_MAX_CHARS = 8000;

// ── Sections ────────────────────────────────────────────────────────────────
// Every section is a heading plus one narrative field. All are optional: the
// clinician removes what the letter does not need in the Content step.
// `field` names the narrative scalar the section owns, so the editor can hide
// a removed section's field.

const SECTIONS = [
  { key: 'PURPOSE', title: 'Purpose of this letter', defaultSelected: true,
    description: 'What is being recommended, for whom, and the need it addresses.',
    field: 'OPAL_LETTER_PURPOSE', fieldLabel: 'Purpose of this letter',
    prompt: 'State what you are recommending and why, in one or two sentences.' },
  { key: 'BACKGROUND', title: 'Background and current situation', defaultSelected: true,
    description: 'Disability, functional presentation and the current arrangement.',
    field: 'OPAL_LETTER_BACKGROUND', fieldLabel: 'Background and current situation',
    prompt: 'Describe the participant’s disability, current functioning and how the task is managed now, including risks.' },
  { key: 'RECOMMENDED_SUPPORT', title: 'Recommended support', defaultSelected: true,
    description: 'The support, equipment or service recommended and its specification.',
    field: 'OPAL_LETTER_RECOMMENDED_SUPPORT', fieldLabel: 'Recommended support',
    prompt: 'Specify the recommended support, equipment or service, including features, configuration and fitting.' },
  { key: 'CLINICAL_JUSTIFICATION', title: 'Clinical justification', defaultSelected: true,
    description: 'How the support addresses the disability-related need and reduces risk.',
    field: 'OPAL_LETTER_CLINICAL_JUSTIFICATION', fieldLabel: 'Clinical justification',
    prompt: 'Explain how the recommendation addresses the disability-related need, safety and independence.' },
  { key: 'VALUE_FOR_MONEY', title: 'Value for money and alternatives considered', defaultSelected: true,
    description: 'Why this option is reasonable and necessary, and why alternatives are not.',
    field: 'OPAL_LETTER_VALUE_FOR_MONEY', fieldLabel: 'Value for money and alternatives considered',
    prompt: 'Explain why this option represents value for money and why lower-cost alternatives would not meet the need.' },
  { key: 'NDIS_GOALS', title: 'Alignment with NDIS goals', defaultSelected: true,
    description: 'The participant’s NDIS goals the support will help achieve.',
    field: 'OPAL_LETTER_NDIS_GOALS', fieldLabel: 'Alignment with NDIS goals',
    prompt: 'Link the recommendation to the participant’s stated NDIS goals and everyday participation.' },
  { key: 'IMPACT_IF_NOT_FUNDED', title: 'Impact if not funded', defaultSelected: false,
    description: 'Risks and consequences if the support is not provided.',
    field: 'OPAL_LETTER_IMPACT_IF_NOT_FUNDED', fieldLabel: 'Impact if not funded',
    prompt: 'Describe the foreseeable risks to the participant and their supports if the recommendation is not funded.' },
  { key: 'RECOMMENDATION', title: 'Recommendation', defaultSelected: true,
    description: 'The formal recommendation and any quote or supporting document.',
    field: 'OPAL_LETTER_CONCLUSION', fieldLabel: 'Recommendation',
    prompt: 'State the formal recommendation, referring to any attached quote or report.' },
].map((s, i) => ({
  ...s,
  tag: `OPAL_SECTION_SUPPORT_LETTER_${s.key}`,
  label: s.title,
  group: 'letter_body',
  parent: null,
  required: false,
  // Letter headings print at Heading 3 — a letter is not a report.
  level: 3,
  defaultOrder: i,
}));

const SECTION_BY_TAG = new Map(SECTIONS.map((s) => [s.tag, s]));

// ── Scalars ─────────────────────────────────────────────────────────────────
// Layers exactly as fca/resolve-scalars.js defines them. `alias` is the
// control's human label inside the master ("[PORTAL — ALIAS]"); `hint` is what
// the portal shows under the field. `optionalLine` removes the whole paragraph
// when empty; `optionalRow` removes the whole table row when empty.

const SCALAR_TAGS = [
  // ── Letter ───────────────────────────────────────────────────────────────
  { tag: 'OPAL_LETTER_DATE', label: 'Letter date', alias: 'LETTER DATE', layer: 'report', isDate: true, group: 'Letter' },
  { tag: 'OPAL_LETTER_SUBJECT', label: 'Subject', alias: 'SUBJECT', layer: 'report', group: 'Letter',
    hint: 'e.g. Funding recommendation — wheeled shower commode' },
  { tag: 'OPAL_LETTER_QUOTE_REFERENCE', label: 'Quote or reference number', alias: 'QUOTE REFERENCE', layer: 'report', group: 'Letter',
    optionalRow: true, hint: 'Optional. Leave blank and the row is left out.' },
  { tag: 'OPAL_LETTER_GREETING', label: 'Greeting', alias: 'GREETING', layer: 'report', group: 'Letter',
    hint: 'e.g. Dear Ms Smith — or — To whom it may concern' },

  // ── Recipient ────────────────────────────────────────────────────────────
  { tag: 'OPAL_LETTER_RECIPIENT_NAME', label: 'Recipient name', alias: 'RECIPIENT NAME', layer: 'report', group: 'Recipient',
    hint: 'e.g. National Disability Insurance Agency' },
  { tag: 'OPAL_LETTER_RECIPIENT_ROLE', label: 'Recipient role', alias: 'RECIPIENT ROLE', layer: 'report', group: 'Recipient', optionalLine: true },
  { tag: 'OPAL_LETTER_RECIPIENT_ORGANISATION', label: 'Recipient organisation', alias: 'RECIPIENT ORGANISATION', layer: 'report', group: 'Recipient', optionalLine: true },
  { tag: 'OPAL_LETTER_RECIPIENT_ADDRESS', label: 'Recipient address', alias: 'RECIPIENT ADDRESS', layer: 'report', group: 'Recipient',
    optionalLine: true, multiline: true },

  // ── Participant ──────────────────────────────────────────────────────────
  { tag: 'OPAL_CLIENT_FULL_NAME', label: 'Participant name', alias: 'CLIENT NAME', layer: 'splose', field: 'fullName', group: 'Participant' },
  { tag: 'OPAL_CLIENT_NDIS_NUMBER', label: 'NDIS number', alias: 'NDIS NUMBER', layer: 'splose', field: 'ndisNumber', group: 'Participant' },
  { tag: 'OPAL_CLIENT_DATE_OF_BIRTH', label: 'Date of birth', alias: 'DATE OF BIRTH', layer: 'client_profile', profileField: 'date_of_birth',
    isDate: true, optionalRow: true, group: 'Participant' },

  // ── Body: one narrative per section, generated below ─────────────────────

  // ── Author ───────────────────────────────────────────────────────────────
  { tag: 'OPAL_THERAPIST_FULL_NAME', label: 'Therapist name', alias: 'THERAPIST NAME', layer: 'portal', field: 'therapistName', group: 'Author' },
  { tag: 'OPAL_THERAPIST_ROLE', label: 'Therapist role', alias: 'THERAPIST ROLE', layer: 'portal', field: 'therapistRoleTitle', group: 'Author' },
  { tag: 'OPAL_THERAPIST_QUALIFICATIONS', label: 'Qualifications', alias: 'THERAPIST QUALIFICATIONS', layer: 'report', group: 'Author',
    optionalLine: true, multiline: true,
    hint: 'e.g. Bachelor of Science (Occupational Therapy, First Class Honours), Curtin University' },
  { tag: 'OPAL_THERAPIST_AHPRA_NUMBER', label: 'AHPRA registration', alias: 'AHPRA NUMBER', layer: 'portal', field: 'ahpraNumber', group: 'Author', optionalLine: true },
  { tag: 'OPAL_THERAPIST_PHONE', label: 'Therapist phone', alias: 'THERAPIST PHONE', layer: 'portal', field: 'therapistPhone', group: 'Author' },
  { tag: 'OPAL_THERAPIST_EMAIL', label: 'Therapist email', alias: 'THERAPIST EMAIL', layer: 'portal', field: 'therapistEmail', group: 'Author' },

  // ── Enclosures and copies ────────────────────────────────────────────────
  { tag: 'OPAL_LETTER_ENCLOSURES', label: 'Enclosures', alias: 'ENCLOSURES', layer: 'report', group: 'Enclosures and copies',
    optionalLine: true, multiline: true, hint: 'Optional. e.g. Quote QC040111 — one per line.' },
  { tag: 'OPAL_LETTER_CC', label: 'CC recipients', alias: 'CC RECIPIENTS', layer: 'report', group: 'Enclosures and copies',
    optionalLine: true, multiline: true, hint: 'Optional. One per line.' },

  // ── Letterhead (word/header6.xml) ────────────────────────────────────────
  { tag: 'OPAL_ORGANISATION_ADDRESS', label: 'Business address', alias: 'BUSINESS ADDRESS', layer: 'organisation', field: 'businessAddress',
    parts: ['word/header6.xml'], multiline: true, group: 'Letterhead' },
  { tag: 'OPAL_ORGANISATION_PHONE', label: 'Business phone', alias: 'BUSINESS PHONE', layer: 'organisation', field: 'businessPhone', parts: ['word/header6.xml'], group: 'Letterhead' },
  { tag: 'OPAL_ORGANISATION_EMAIL', label: 'Business email', alias: 'BUSINESS EMAIL', layer: 'organisation', field: 'businessEmail', parts: ['word/header6.xml'], group: 'Letterhead' },
  { tag: 'OPAL_ORGANISATION_WEBSITE', label: 'Website', alias: 'WEBSITE', layer: 'organisation', field: 'website', parts: ['word/header6.xml'], group: 'Letterhead' },

  // ── Document control (word/footer6.xml) ──────────────────────────────────
  { tag: 'OPAL_LETTER_DOCUMENT_ID', label: 'Document ID', alias: 'DOCUMENT ID', layer: 'server', field: 'documentReference',
    parts: ['word/footer6.xml'], group: 'Document details' },
];

// The narrative fields, in section order, placed after the participant group.
const NARRATIVE_SCALARS = SECTIONS.map((s) => ({
  tag: s.field,
  label: s.fieldLabel,
  alias: s.fieldLabel.toUpperCase(),
  layer: 'report',
  group: 'Letter content',
  narrative: true,
  paragraphs: true,
  multiline: true,
  maxChars: NARRATIVE_MAX_CHARS,
  section: s.tag,
  hint: s.prompt,
}));
const AUTHOR_AT = SCALAR_TAGS.findIndex((s) => s.tag === 'OPAL_THERAPIST_FULL_NAME');
SCALAR_TAGS.splice(AUTHOR_AT, 0, ...NARRATIVE_SCALARS);

const SCALAR_BY_TAG = new Map(SCALAR_TAGS.map((s) => [s.tag, s]));
const SCALAR_TAG_LIST = SCALAR_TAGS.map((s) => s.tag);

const MULTILINE_TAGS = new Set(SCALAR_TAGS.filter((s) => s.multiline && !s.paragraphs).map((s) => s.tag));
const PARAGRAPH_TAGS = new Set(SCALAR_TAGS.filter((s) => s.paragraphs).map((s) => s.tag));
const OPTIONAL_LINE_TAGS = new Set(SCALAR_TAGS.filter((s) => s.optionalLine).map((s) => s.tag));
const OPTIONAL_ROW_TAGS = new Set(SCALAR_TAGS.filter((s) => s.optionalRow).map((s) => s.tag));

/** The prompt an unresolved control shows in the portal preview. */
function promptFor(tag) {
  const s = SCALAR_BY_TAG.get(tag);
  return `[PORTAL — ${s ? s.alias : tag}]`;
}

const SECTION_CATALOGUE = {
  SECTIONS,
  SECTION_BY_TAG,
  REQUIRED_SECTION_TAGS: [],
  SECTION_DEPENDENT_ROWS: {},
  MAX_CUSTOM_SECTIONS: 5,
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
