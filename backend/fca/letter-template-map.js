'use strict';

/**
 * PROGRESS NOTE LETTER TEMPLATE MAP — the static description of
 * progress-note-letter-v1.docx, written in the same style as template-map.js
 * and pinned to the exact file it describes.
 *
 * ── VERIFIED TEMPLATE CONTRACT ──────────────────────────────────────────────
 * progress-note-letter-v1.docx, sha256
 *   f686096730a793d44316f9e73aa329dd36ebe2583699df0ee80d0ece583ed5c5
 *
 *   30 unique w:tag content controls across 32 occurrences, made up of
 *     24 unique SCALAR tags across 26 occurrences,
 *      5 BLOCK controls (2 required + 3 optional),
 *      1 custom-content ANCHOR.
 *   Repeated scalars: OPAL_CLIENT_FULL_NAME x2 and OPAL_THERAPIST_ROLE x2,
 *   both entirely within word/document.xml.
 *   word/header6.xml carries the four OPAL_ORGANISATION_* letterhead tags.
 *   word/footer6.xml carries OPAL_LETTER_DOCUMENT_ID beside a live PAGE field
 *   that must survive generation untouched.
 *
 * Every one of those numbers is ASSERTED against the shipped file by
 * tests/letter-template-map.test.js, which discovers them by unzipping the
 * .docx — nothing in this file's LOGIC depends on a hard-coded count.
 *
 * ── STRUCTURE, AS FOUND (not as assumed) ────────────────────────────────────
 * The five block controls and the anchor are DIRECT CHILDREN OF w:body in this
 * template — they are not nested inside a parent control the way the FCA's
 * optional sections are. The engine's direct-child tag lookup is correct for
 * both shapes, so removing a block here can no more damage a neighbour than it
 * could there; the nesting-safety property simply is not exercised by this
 * template. This is recorded because the brief anticipated nesting.
 *
 * ── OPTIONAL-LINE CLEANUP ───────────────────────────────────────────────────
 * Six controls sit alone in a paragraph (three of them behind a literal label:
 * "AHPRA registration: " and "CC: "). When those values are absent the ENTIRE
 * w:p is deleted, never just the control — a letter that goes out with a bare
 * "CC:" or a stray "[PORTAL — RECIPIENT ROLE]" reads as unfinished. Every other
 * tag shares its paragraph with real sentence text, so it cannot be cleaned up
 * that way and is instead REQUIRED: generation is refused until it resolves.
 * That is what makes the promise "no unresolved [PORTAL — …] placeholder ever
 * ships" actually true rather than aspirational.
 */

const {
  EN_DASH,
  STYLE,
  CONTROL_PARTS,
  slugForCustomSection,
} = require('./template-map');

// ── Identity ────────────────────────────────────────────────────────────────

const LETTER_DOCUMENT_TYPE = 'progress_note_letter';
const LETTER_TEMPLATE_ID = 'progress_note_letter';
const LETTER_TEMPLATE_VERSION = 'v1';
const LETTER_TEMPLATE_NAME = 'Opal Therapy Progress Note Letter';
const LETTER_TEMPLATE_FILENAME = 'progress-note-letter-v1.docx';
const LETTER_TEMPLATE_STORAGE_PATH = `fca/templates/${LETTER_TEMPLATE_FILENAME}`;

/** Pinned so a swapped template file fails a test instead of shipping quietly. */
const LETTER_TEMPLATE_SHA256 =
  'f686096730a793d44316f9e73aa329dd36ebe2583699df0ee80d0ece583ed5c5';

const LETTER_CUSTOM_SECTION_ANCHOR = 'OPAL_ANCHOR_LETTER_CUSTOM_SECTIONS';

/** Reused verbatim from the FCA map — the same header/footer part names apply. */
const LETTER_CONTROL_PARTS = CONTROL_PARTS;

/** The document-id prefix this template issues. */
const LETTER_DOCUMENT_ID_PREFIX = 'LTR';

// ── Block catalogue ─────────────────────────────────────────────────────────
// `title` is the heading the alias in the template uses for this block; the
// letter has no visible headings, so it is the wizard's label for the block.

const LETTER_SECTIONS = [
  {
    tag: 'OPAL_SECTION_LETTER_PURPOSE_CONTEXT',
    group: 'letter_body',
    required: true,
    label: 'Purpose and context',
    title: 'Purpose and context',
    description: 'Why the letter was requested and the decision or matter it informs.',
  },
  {
    tag: 'OPAL_SECTION_LETTER_PROGRESS_UPDATE',
    group: 'letter_body',
    required: true,
    label: 'Therapy and progress update',
    title: 'Therapy and progress update',
    description: 'Therapy or intervention delivered and progress toward the relevant goals.',
  },
  {
    tag: 'OPAL_SECTION_LETTER_CURRENT_PRESENTATION',
    group: 'letter_body',
    required: false,
    label: 'Current presentation and support needs',
    title: 'Current presentation and support needs',
    description: 'Current functional presentation, strengths, barriers, risks and support needs.',
  },
  {
    tag: 'OPAL_SECTION_LETTER_CLINICAL_OPINION_RECOMMENDATIONS',
    group: 'letter_body',
    required: false,
    label: 'Clinical opinion and recommendations',
    title: 'Clinical opinion and recommendations',
    description: 'Clinical opinion, recommendations or requested action, linked to evidence and goals.',
  },
  {
    tag: 'OPAL_SECTION_LETTER_NEXT_STEPS',
    group: 'letter_body',
    required: false,
    label: 'Next steps and review',
    title: 'Next steps and review',
    description: 'Agreed next steps, responsible parties, timing and review requirements.',
  },
  // Every optional block defaults ON: the safe default for clinical
  // correspondence is the complete letter, with the therapist removing what
  // does not apply rather than having to remember to add it.
].map((s, i) => ({ ...s, defaultSelected: true, defaultOrder: i }));

const LETTER_SECTION_BY_TAG = new Map(LETTER_SECTIONS.map((s) => [s.tag, s]));
const LETTER_REQUIRED_SECTION_TAGS = LETTER_SECTIONS.filter((s) => s.required).map((s) => s.tag);
const LETTER_OPTIONAL_SECTION_TAGS = LETTER_SECTIONS.filter((s) => !s.required).map((s) => s.tag);

// ── Scalar catalogue ────────────────────────────────────────────────────────
// Layers, and what each one means for resolution (see resolve-scalars.js):
//   'splose'        Splose is the system of record; the client profile is not
//                   consulted. A per-report override still wins.
//   'client_profile' durable client fact the profile owns. `fallbackField`
//                   names a DECLARED, SAFE Splose fallback where one exists.
//   'portal'        read from this database (users / therapist_profiles /
//                   credentials).
//   'organisation'  read from the organisation's saved settings. Attributed
//                   'portal' — it is this portal's own configuration.
//   'report'        belongs to this letter only; a therapist override or
//                   nothing at all.
//   'server'        minted by the server at generate time. readOnly.
//
// `occurrences` and `parts` record the VERIFIED template shape.
// `multiline`  the control declares w:text multiLine="1"; values render with
//              real w:br line breaks between runs.
// `optionalLine` the control sits alone in its paragraph and the WHOLE
//              paragraph is deleted when the value is absent.
// Everything without `optionalLine` is required for generation: it shares a
// paragraph with sentence text or a label and cannot be cleanly removed.

const LETTER_SCALAR_TAGS = [
  // ── The letter itself: report-specific, therapist-supplied ───────────────
  { tag: 'OPAL_LETTER_DATE', label: 'Letter date', layer: 'report', occurrences: 1, isDate: true },
  { tag: 'OPAL_LETTER_SUBJECT', label: 'Subject', layer: 'report', occurrences: 1 },
  { tag: 'OPAL_LETTER_REPORTING_PERIOD', label: 'Reporting period', layer: 'report', occurrences: 1 },

  // ── Recipient block ──────────────────────────────────────────────────────
  { tag: 'OPAL_LETTER_RECIPIENT_NAME', label: 'Recipient name', layer: 'report', occurrences: 1 },
  { tag: 'OPAL_LETTER_RECIPIENT_ROLE', label: 'Recipient role', layer: 'report', occurrences: 1, optionalLine: true },
  { tag: 'OPAL_LETTER_RECIPIENT_ORGANISATION', label: 'Recipient organisation', layer: 'report', occurrences: 1, optionalLine: true },
  { tag: 'OPAL_LETTER_RECIPIENT_ADDRESS', label: 'Recipient address', layer: 'report', occurrences: 1, optionalLine: true, multiline: true },
  { tag: 'OPAL_LETTER_SALUTATION', label: 'Salutation', layer: 'report', occurrences: 1,
    note: 'Rendered inside "Dear …," — a blank here would ship a broken greeting, so it is required.' },
  { tag: 'OPAL_LETTER_CC', label: 'CC recipients', layer: 'report', occurrences: 1, optionalLine: true, multiline: true,
    note: 'The paragraph reads "CC: " before the control. With no CC the entire paragraph is deleted; a naked "CC:" is a failure.' },

  // ── Participant ──────────────────────────────────────────────────────────
  { tag: 'OPAL_CLIENT_FULL_NAME', label: 'Participant full name', layer: 'splose', field: 'fullName', occurrences: 2 },
  { tag: 'OPAL_CLIENT_NDIS_NUMBER', label: 'NDIS number', layer: 'splose', field: 'ndisNumber', occurrences: 1 },
  { tag: 'OPAL_CLIENT_PREFERRED_NAME', label: 'Preferred name', layer: 'client_profile',
    profileField: 'preferred_name', fallbackField: 'firstname', occurrences: 1,
    note: 'Profile first. A SAFE, DECLARED fallback to the Splose given name follows, because this letter '
      + 'names the participant in running prose and an empty slot mid-sentence is worse than a given name. '
      + 'The source attribution records which of the two was used.' },

  // ── Author ───────────────────────────────────────────────────────────────
  { tag: 'OPAL_THERAPIST_FULL_NAME', label: 'Therapist name', layer: 'portal', field: 'therapistName', occurrences: 1 },
  { tag: 'OPAL_THERAPIST_ROLE', label: 'Therapist role', layer: 'portal', field: 'therapistRoleTitle', occurrences: 2 },
  { tag: 'OPAL_THERAPIST_CREDENTIALS', label: 'Therapist credentials', layer: 'portal', field: 'therapistCredentials', occurrences: 1,
    note: 'Active credential names from the credentials table. Shares a paragraph with the role behind a "|" separator.' },
  { tag: 'OPAL_THERAPIST_QUALIFICATIONS', label: 'Qualifications', layer: 'report', occurrences: 1, optionalLine: true, multiline: true,
    note: 'No portal column holds free-text qualifications, so this is override-only and its line is dropped when unused.' },
  { tag: 'OPAL_THERAPIST_AHPRA_NUMBER', label: 'AHPRA number', layer: 'portal', field: 'ahpraNumber', occurrences: 1, optionalLine: true,
    note: 'The paragraph reads "AHPRA registration: " before the control; with no number the whole paragraph goes.' },
  { tag: 'OPAL_THERAPIST_PHONE', label: 'Therapist phone', layer: 'portal', field: 'therapistPhone', occurrences: 1 },
  { tag: 'OPAL_THERAPIST_EMAIL', label: 'Therapist email', layer: 'portal', field: 'therapistEmail', occurrences: 1 },

  // ── Letterhead (word/header6.xml) ────────────────────────────────────────
  { tag: 'OPAL_ORGANISATION_ADDRESS', label: 'Business address', layer: 'organisation', field: 'businessAddress', occurrences: 1, parts: ['word/header6.xml'], multiline: true },
  { tag: 'OPAL_ORGANISATION_PHONE', label: 'Business phone', layer: 'organisation', field: 'businessPhone', occurrences: 1, parts: ['word/header6.xml'] },
  { tag: 'OPAL_ORGANISATION_EMAIL', label: 'Business email', layer: 'organisation', field: 'businessEmail', occurrences: 1, parts: ['word/header6.xml'] },
  { tag: 'OPAL_ORGANISATION_WEBSITE', label: 'Website', layer: 'organisation', field: 'website', occurrences: 1, parts: ['word/header6.xml'] },

  // ── Document control (word/footer6.xml) ──────────────────────────────────
  { tag: 'OPAL_LETTER_DOCUMENT_ID', label: 'Document ID', layer: 'server', field: 'documentReference', occurrences: 1, parts: ['word/footer6.xml'], readOnly: true },
];

const LETTER_SCALAR_BY_TAG = new Map(LETTER_SCALAR_TAGS.map((s) => [s.tag, s]));
const LETTER_SCALAR_TAG_LIST = LETTER_SCALAR_TAGS.map((s) => s.tag);

// ── Layer-derived sets ──────────────────────────────────────────────────────

const LETTER_OVERRIDABLE_TAGS = LETTER_SCALAR_TAGS.filter((s) => !s.readOnly).map((s) => s.tag);

/** Tags rendered with real w:br line breaks rather than one flat run. */
const LETTER_MULTILINE_TAGS = LETTER_SCALAR_TAGS.filter((s) => s.multiline).map((s) => s.tag);

/** Tags whose ENTIRE paragraph is deleted when the value is absent. */
const LETTER_OPTIONAL_LINE_TAGS = LETTER_SCALAR_TAGS.filter((s) => s.optionalLine).map((s) => s.tag);

/**
 * Tags that MUST resolve before a letter may be generated.
 *
 * Derived, not listed: a tag is required exactly when it has no optional-line
 * cleanup, because such a control shares its paragraph with sentence text or a
 * literal label and there is no way to remove it without mangling the page.
 * Blocking generation is the only honest outcome — every one of these is
 * overridable, so the therapist can always supply the missing value.
 */
const LETTER_REQUIRED_VALUE_TAGS = LETTER_SCALAR_TAGS
  .filter((s) => !s.optionalLine)
  .map((s) => s.tag);

/** The only tag on this template that a save-back could ever persist. */
const LETTER_PROFILE_ELIGIBLE_TAGS = LETTER_SCALAR_TAGS
  .filter((s) => s.layer === 'client_profile')
  .map((s) => s.tag);

/** Tags the server may report as MISSING (everything it does not mint itself). */
const LETTER_MISSING_CAPABLE_TAGS = LETTER_SCALAR_TAGS
  .filter((s) => s.layer !== 'server')
  .map((s) => s.tag);

// ── Recipient sources ───────────────────────────────────────────────────────
// Where a recipient may be drawn from, and where an explicit save-back may
// write one to. The vocabulary is fixed by the API contract.
const RECIPIENT_TARGETS = ['support_coordinator', 'nominee', 'referrer', 'saved_contact'];

/** The profile column backing each structured recipient source. */
const RECIPIENT_PROFILE_COLUMN = {
  support_coordinator: 'support_coordinator_details',
  nominee: 'nominee_details',
  referrer: 'referrer_details',
};

/** The human role label a contact from each source carries. */
const RECIPIENT_SOURCE_ROLE = {
  support_coordinator: 'Support Coordinator',
  nominee: 'Nominee',
  referrer: 'Referrer',
  saved_contact: null,
};

// ── Limits ──────────────────────────────────────────────────────────────────
// A letter's recipient address and CC list are multi-line, so they need more
// headroom than the FCA's 400-character single-line overrides.
const LETTER_MAX_OVERRIDE_CHARS = 1000;
const LETTER_MAX_CUSTOM_SECTIONS = 5;
const LETTER_MAX_CUSTOM_LABEL_CHARS = 120;
const LETTER_MAX_CUSTOM_BODY_CHARS = 2000;
const LETTER_MAX_CC_RECIPIENTS = 10;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Placeholder the PREVIEW shows for an unresolved tag. Never 'null'. */
function letterMissingPlaceholder(tag) {
  const meta = LETTER_SCALAR_BY_TAG.get(tag);
  return `[TO COMPLETE ${EN_DASH} ${(meta ? meta.label : tag).toUpperCase()}]`;
}

/** The w:tag the engine writes for a custom letter block. */
function letterCustomSectionTag(label, uuid) {
  return `OPAL_SECTION_LETTER_CUSTOM_${slugForCustomSection(label)}_${String(uuid).toUpperCase().replace(/-/g, '')}`;
}

const LETTER_CUSTOM_TAG_PATTERN = /^OPAL_SECTION_LETTER_CUSTOM_[A-Z0-9_]+$/;

/** Contract shape for GET /api/letters/template. */
function letterTemplateDescriptor() {
  return {
    id: LETTER_TEMPLATE_ID,
    version: LETTER_TEMPLATE_VERSION,
    documentType: LETTER_DOCUMENT_TYPE,
    sections: LETTER_SECTIONS.map((s) => ({
      tag: s.tag,
      label: s.label,
      description: s.description,
      required: s.required,
      defaultSelected: s.defaultSelected,
      defaultOrder: s.defaultOrder,
    })),
    scalarTags: LETTER_SCALAR_TAG_LIST.slice(),
    profileEligibleTags: LETTER_PROFILE_ELIGIBLE_TAGS.slice(),
    requiredValueTags: LETTER_REQUIRED_VALUE_TAGS.slice(),
    optionalLineTags: LETTER_OPTIONAL_LINE_TAGS.slice(),
    missingCapableTags: LETTER_MISSING_CAPABLE_TAGS.slice(),
    recipientTargets: RECIPIENT_TARGETS.slice(),
  };
}

// ── Catalogues consumed by the shared modules ───────────────────────────────

/** For fca/manifest.js — everything it needs to compose a letter manifest. */
const LETTER_MANIFEST_CATALOGUE = {
  SECTIONS: LETTER_SECTIONS,
  SECTION_BY_TAG: LETTER_SECTION_BY_TAG,
  REQUIRED_SECTION_TAGS: LETTER_REQUIRED_SECTION_TAGS,
  OVERRIDABLE_TAGS: LETTER_OVERRIDABLE_TAGS,
  MAX_CUSTOM_SECTIONS: LETTER_MAX_CUSTOM_SECTIONS,
  MAX_CUSTOM_TITLE_CHARS: LETTER_MAX_CUSTOM_LABEL_CHARS,
  MAX_CUSTOM_GUIDANCE_CHARS: LETTER_MAX_CUSTOM_BODY_CHARS,
  MAX_OVERRIDE_CHARS: LETTER_MAX_OVERRIDE_CHARS,
  customSectionTag: letterCustomSectionTag,
  CUSTOM_TAG_PATTERN: LETTER_CUSTOM_TAG_PATTERN,
  // A letter block may be a bare paragraph with no label.
  requireTitle: false,
};

/** For fca/resolve-scalars.js — the letter's tag table. */
const LETTER_SCALAR_CATALOGUE = {
  SCALAR_TAGS: LETTER_SCALAR_TAGS,
  SCALAR_BY_TAG: LETTER_SCALAR_BY_TAG,
  SCALAR_TAG_LIST: LETTER_SCALAR_TAG_LIST,
};

module.exports = {
  EN_DASH,
  STYLE,
  LETTER_DOCUMENT_TYPE,
  LETTER_TEMPLATE_ID,
  LETTER_TEMPLATE_VERSION,
  LETTER_TEMPLATE_NAME,
  LETTER_TEMPLATE_FILENAME,
  LETTER_TEMPLATE_STORAGE_PATH,
  LETTER_TEMPLATE_SHA256,
  LETTER_CUSTOM_SECTION_ANCHOR,
  LETTER_CONTROL_PARTS,
  LETTER_DOCUMENT_ID_PREFIX,
  LETTER_SECTIONS,
  LETTER_SECTION_BY_TAG,
  LETTER_REQUIRED_SECTION_TAGS,
  LETTER_OPTIONAL_SECTION_TAGS,
  LETTER_SCALAR_TAGS,
  LETTER_SCALAR_BY_TAG,
  LETTER_SCALAR_TAG_LIST,
  LETTER_OVERRIDABLE_TAGS,
  LETTER_MULTILINE_TAGS,
  LETTER_OPTIONAL_LINE_TAGS,
  LETTER_REQUIRED_VALUE_TAGS,
  LETTER_PROFILE_ELIGIBLE_TAGS,
  LETTER_MISSING_CAPABLE_TAGS,
  RECIPIENT_TARGETS,
  RECIPIENT_PROFILE_COLUMN,
  RECIPIENT_SOURCE_ROLE,
  LETTER_MAX_OVERRIDE_CHARS,
  LETTER_MAX_CUSTOM_SECTIONS,
  LETTER_MAX_CUSTOM_LABEL_CHARS,
  LETTER_MAX_CUSTOM_BODY_CHARS,
  LETTER_MAX_CC_RECIPIENTS,
  LETTER_CUSTOM_TAG_PATTERN,
  letterMissingPlaceholder,
  letterCustomSectionTag,
  letterTemplateDescriptor,
  LETTER_MANIFEST_CATALOGUE,
  LETTER_SCALAR_CATALOGUE,
};
