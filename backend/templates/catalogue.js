'use strict';

/**
 * TEMPLATE CATALOGUE — the templates the Resource Hub offers, each pointing
 * at a master in this repository.
 *
 *   Service Agreement  service-agreements/templates/service-agreement-v1.0.1.docx
 *   Support Letter     fca/templates/support-letter-v1.docx
 *   Progress Report    fca/templates/progress-report-v1.docx
 *   FCA                fca/templates/fca-v1.docx
 *   Progress Note      fca/templates/progress-note-letter-v1.docx   RETIRED
 *
 * A RETIRED template is no longer offered for new documents (listTemplates
 * leaves it out and the create route refuses it), but documents already
 * started from it still open, preview and export exactly as before. The
 * Support Letter replaced the Progress Note card on 7 Nov 2026.
 *
 * Nothing here re-authors a template. The wording, the clauses, the section
 * order and the field set are the masters' own; this module only says which
 * master a template id means, which tag map describes it, and how its fields
 * are grouped for the portal form. Two of the three masters were already
 * mapped (fca/template-map.js, fca/letter-template-map.js) and are reused
 * as-is; the Service Agreement master had never been mapped, so
 * templates/service-agreement-map.js was written for it in the same style.
 *
 * ── The master is read-only, structurally ───────────────────────────────────
 * `readMaster()` is the only way to reach a master's bytes, it opens the file
 * read-only, and it caches the Buffer for the process. No route, and nothing
 * downstream of here, has a path that writes to one. Completing a document
 * instance therefore cannot alter the reusable template: the instance's answers
 * live in template_documents, and composition always starts from a fresh copy
 * of the master buffer.
 */

const fs = require('fs');
const path = require('path');

const fcaMap = require('../fca/template-map');
const letterMap = require('../fca/letter-template-map');
const saMap = require('./service-agreement-map');
const supportLetterMap = require('./support-letter-map');
const progressReportMap = require('./progress-report-map');

const FCA_TEMPLATE_FILE = path.join(__dirname, '..', 'fca', 'templates', 'fca-v1.docx');

/**
 * The FCA wizard's section catalogue, with the required flags withdrawn.
 *
 * In the Templates editor NOTHING is required: the master is a starting point
 * and every section of it is negotiable, so the same catalogue that the FCA
 * wizard treats as partly fixed is offered here fully editable. The composer
 * receives THIS catalogue (compose.js passes it through to the manifest
 * helpers), so a removal the route accepts is also honoured at composition —
 * the wizard's own catalogue, and its required sections, are untouched.
 */
const TEMPLATE_FCA_SECTIONS = fcaMap.SECTIONS.map((s) => ({ ...s, required: false }));
const TEMPLATE_FCA_SECTION_CATALOGUE = {
  SECTIONS: TEMPLATE_FCA_SECTIONS,
  SECTION_BY_TAG: new Map(TEMPLATE_FCA_SECTIONS.map((s) => [s.tag, s])),
  REQUIRED_SECTION_TAGS: [],
  SECTION_DEPENDENT_ROWS: fcaMap.SECTION_DEPENDENT_ROWS,
  MAX_CUSTOM_SECTIONS: fcaMap.MAX_CUSTOM_SECTIONS,
  MAX_CUSTOM_TITLE_CHARS: fcaMap.MAX_CUSTOM_TITLE_CHARS,
  MAX_CUSTOM_GUIDANCE_CHARS: fcaMap.MAX_CUSTOM_GUIDANCE_CHARS,
};
const SUPPORT_LETTER_FILE = path.join(__dirname, '..', 'fca', 'templates', supportLetterMap.TEMPLATE_FILENAME);
const PROGRESS_REPORT_FILE = path.join(__dirname, '..', 'fca', 'templates', progressReportMap.TEMPLATE_FILENAME);

const LETTER_TEMPLATE_FILE = path.join(
  __dirname, '..', 'fca', 'templates', letterMap.LETTER_TEMPLATE_FILENAME
);

/**
 * Field groups for masters whose maps predate this capability and therefore
 * carry no `group` on their scalars. Derived from the tag's own namespace, so
 * a tag added to either map lands in the right group without editing this.
 */
const GROUP_BY_PREFIX = {
  CLIENT: 'Participant',
  PARTICIPANT: 'Participant',
  THERAPIST: 'Author',
  REPORT: 'Document details',
  LETTER: 'Letter',
  ORGANISATION: 'Provider details',
  ORG: 'Provider details',
};

function groupFor(scalar) {
  if (scalar.group) return scalar.group;
  const prefix = String(scalar.tag).split('_')[1];
  return GROUP_BY_PREFIX[prefix] || 'Other details';
}

/**
 * One catalogue entry.
 *
 * `catalogue`     what fca/resolve-scalars.js resolves against
 * `controlParts`  parts the engine and the export boundary may touch
 * `sections`      every section tag, so a template document is composed whole:
 *                 choosing which optional sections appear is the FCA wizard's
 *                 clinical job, not this capability's (see NON-GOALS — no
 *                 template designer). Templates renders the complete master.
 * `internalTags`  removed outright at export
 * `anchorTags`    insertion points removed outright at export
 * `internalBlocks`     heading-bounded template-guide blocks removed at export
 * `internalSentences`  exact portal-instruction sentences deleted at export
 * `textReplacements`   template-facing header/footer wording rewritten at export
 * `participantTag`     the scalar whose resolved value names the participant,
 *                      used to put participant context into the exported
 *                      document's title and filename
 * `sectionCatalogue`   present only where a therapist may shape the document's
 *                      section structure before export (the FCA); carries the
 *                      map's own SECTIONS table and dependent-row rules
 */
const TEMPLATES = [
  {
    id: 'service_agreement',
    name: 'Service Agreement',
    description: 'NDIS service agreement covering supports, prices, consents and signing.',
    version: saMap.TEMPLATE_VERSION,
    masterName: saMap.TEMPLATE_NAME,
    file: saMap.TEMPLATE_FILE,
    catalogue: saMap.CATALOGUE,
    scalars: saMap.SCALAR_TAGS,
    controlParts: saMap.CONTROL_PARTS,
    multilineTags: saMap.MULTILINE_TAGS,
    sectionTags: [...saMap.CLAUSE_TAGS],
    internalTags: saMap.INTERNAL_TAGS,
    anchorTags: saMap.ANCHOR_TAGS,
    customSectionAnchor: null,
    // v2.2 keeps every portal-facing instruction inside the tagged internal
    // governance blocks, which are removed whole at export — the v1 master's
    // two stray clause sentences no longer exist, so nothing is declared here.
    internalSentences: [],
    participantTag: 'OPAL_PARTICIPANT_FULL_NAME',
    filenameStem: 'Service-Agreement',
    footer: 'Opal Therapy · NDIS Service Agreement',
  },
  {
    id: 'support_letter',
    name: 'Support Letter',
    description: 'Letter of support recommending funding for a participant’s disability-related need.',
    version: supportLetterMap.TEMPLATE_VERSION,
    masterName: supportLetterMap.TEMPLATE_NAME,
    file: SUPPORT_LETTER_FILE,
    catalogue: supportLetterMap.CATALOGUE,
    scalars: supportLetterMap.SCALAR_TAGS,
    controlParts: supportLetterMap.CONTROL_PARTS,
    multilineTags: supportLetterMap.MULTILINE_TAGS,
    paragraphTags: supportLetterMap.PARAGRAPH_TAGS,
    optionalLineTags: supportLetterMap.OPTIONAL_LINE_TAGS,
    optionalRowTags: supportLetterMap.OPTIONAL_ROW_TAGS,
    sectionTags: supportLetterMap.SECTIONS.map((s) => s.tag),
    internalTags: [],
    anchorTags: [supportLetterMap.CUSTOM_SECTION_ANCHOR],
    customSectionAnchor: supportLetterMap.CUSTOM_SECTION_ANCHOR,
    // The anchor sits at the top level, after the last body section.
    customAnchorParent: null,
    customAfterTag: 'OPAL_SECTION_SUPPORT_LETTER_RECOMMENDATION',
    customDefaultLevel: 3,
    sectionCatalogue: supportLetterMap.SECTION_CATALOGUE,
    participantTag: 'OPAL_CLIENT_FULL_NAME',
    filenameStem: 'Support-Letter',
    footer: 'Opal Therapy · Letter of Support',
  },
  {
    id: 'progress_report',
    name: 'Progress Report',
    description: 'Occupational therapy progress report against NDIS goals, for plan review.',
    version: progressReportMap.TEMPLATE_VERSION,
    masterName: progressReportMap.TEMPLATE_NAME,
    file: PROGRESS_REPORT_FILE,
    catalogue: progressReportMap.CATALOGUE,
    scalars: progressReportMap.SCALAR_TAGS,
    controlParts: progressReportMap.CONTROL_PARTS,
    multilineTags: progressReportMap.MULTILINE_TAGS,
    paragraphTags: progressReportMap.PARAGRAPH_TAGS,
    optionalLineTags: progressReportMap.OPTIONAL_LINE_TAGS,
    optionalRowTags: progressReportMap.OPTIONAL_ROW_TAGS,
    sectionTags: progressReportMap.SECTIONS.map((s) => s.tag),
    internalTags: [],
    anchorTags: [progressReportMap.CUSTOM_SECTION_ANCHOR],
    customSectionAnchor: progressReportMap.CUSTOM_SECTION_ANCHOR,
    // Custom sections render at the end of Progress Towards NDIS Goals.
    customAnchorParent: 'OPAL_SECTION_REPORT_PROGRESS',
    customDefaultLevel: 3,
    sectionCatalogue: progressReportMap.SECTION_CATALOGUE,
    appendices: true,
    participantTag: 'OPAL_CLIENT_FULL_NAME',
    filenameStem: 'Progress-Report',
    footer: 'Opal Therapy · Occupational Therapy Progress Report',
  },
  {
    id: 'progress_note',
    // Retired 7 Nov 2026 — superseded by the Support Letter. Existing
    // documents keep working; no new ones are started from it.
    retired: true,
    name: 'Progress Note',
    description: 'Progress note letter reporting on a participant’s period of therapy.',
    version: letterMap.LETTER_TEMPLATE_VERSION,
    masterName: letterMap.LETTER_TEMPLATE_NAME,
    file: LETTER_TEMPLATE_FILE,
    catalogue: {
      SCALAR_TAGS: letterMap.LETTER_SCALAR_TAGS,
      SCALAR_BY_TAG: letterMap.LETTER_SCALAR_BY_TAG,
      SCALAR_TAG_LIST: letterMap.LETTER_SCALAR_TAG_LIST,
    },
    scalars: letterMap.LETTER_SCALAR_TAGS,
    controlParts: letterMap.LETTER_CONTROL_PARTS,
    multilineTags: letterMap.LETTER_MULTILINE_TAGS,
    sectionTags: letterMap.LETTER_SECTIONS.map((s) => s.tag),
    internalTags: [],
    anchorTags: [letterMap.LETTER_CUSTOM_SECTION_ANCHOR].filter(Boolean),
    customSectionAnchor: letterMap.LETTER_CUSTOM_SECTION_ANCHOR,
    optionalLineTags: letterMap.LETTER_OPTIONAL_LINE_TAGS,
    participantTag: 'OPAL_CLIENT_FULL_NAME',
    filenameStem: 'Progress-Note',
    footer: 'Opal Therapy · Progress Note',
  },
  {
    id: 'fca',
    name: 'Functional Capacity Assessment (FCA)',
    description: 'Functional assessment report covering referral, assessment and recommendations.',
    version: fcaMap.TEMPLATE_VERSION,
    masterName: fcaMap.TEMPLATE_NAME,
    file: FCA_TEMPLATE_FILE,
    catalogue: {
      SCALAR_TAGS: fcaMap.SCALAR_TAGS,
      SCALAR_BY_TAG: fcaMap.SCALAR_BY_TAG,
      SCALAR_TAG_LIST: fcaMap.SCALAR_TAG_LIST,
    },
    scalars: fcaMap.SCALAR_TAGS,
    controlParts: fcaMap.CONTROL_PARTS,
    multilineTags: new Set(),
    sectionTags: fcaMap.SECTIONS.map((s) => s.tag),
    internalTags: [],
    anchorTags: [fcaMap.CUSTOM_SECTION_ANCHOR].filter(Boolean),
    customSectionAnchor: fcaMap.CUSTOM_SECTION_ANCHOR,
    // The master's own "how to use this template" page. Guidance for the
    // portal editor, never content for an issued report.
    internalBlocks: [
      { startHeading: 'Using this FCA template', endHeading: 'Contents' },
    ],
    // The template-control header band and footer line of the master's front
    // matter, reworded into document language.
    textReplacements: [
      { find: 'TEMPLATE CONTROL | CONFIDENTIAL', replace: 'CONFIDENTIAL' },
      {
        find: 'Opal Therapy | Functional Assessment Report Template | Confidential',
        replace: 'Opal Therapy | Functional Assessment Report | Confidential',
      },
    ],
    participantTag: 'OPAL_CLIENT_FULL_NAME',
    // The FCA is the one template whose section structure a therapist may
    // shape before export: preview, drop a section, restore it, reorder
    // among siblings. Nothing is required here — see the catalogue's note.
    sectionCatalogue: TEMPLATE_FCA_SECTION_CATALOGUE,
    customAnchorParent: 'OPAL_SECTION_ASSESSMENT_RESULTS',
    appendices: true,
    filenameStem: 'Functional-Capacity-Assessment',
    footer: 'Opal Therapy · Functional Capacity Assessment',
  },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

/** The ids the migrations' CHECK constraint allows, in catalogue order. */
const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

function getTemplate(id) {
  return BY_ID.get(String(id || '')) || null;
}

// ── Master bytes ─────────────────────────────────────────────────────────────

const masterCache = new Map();

/**
 * The master's bytes, read once per process. Read-only by construction: this
 * is the only reader, and there is no writer anywhere in the capability.
 */
function readMaster(template) {
  const key = template.file;
  if (!masterCache.has(key)) masterCache.set(key, fs.readFileSync(key));
  return masterCache.get(key);
}

// ── The portal's view of a template's fields ─────────────────────────────────

/**
 * The form the portal renders: every scalar the master declares, grouped, with
 * the label and the layer it resolves from. No values — this is the SHAPE of
 * the document, and it is the same for every user regardless of scope.
 */
function fieldSpec(template) {
  const groups = new Map();
  for (const s of template.scalars) {
    const group = groupFor(s);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({
      tag: s.tag,
      label: s.label,
      layer: s.layer,
      multiline: Boolean(s.multiline),
      isDate: Boolean(s.isDate),
      // A long-form field: a tall box, each line a paragraph (or a bullet).
      narrative: Boolean(s.narrative),
      bullets: Boolean(s.bullets),
      hint: s.hint || null,
      maxChars: s.maxChars || null,
      // The section this field prints in, so the editor can set it aside
      // while that section is removed.
      section: s.section || null,
    });
  }
  return Array.from(groups, ([name, fields]) => ({ group: name, fields }));
}

/** The catalogue as the Templates landing page shows it — retired ones left out. */
function listTemplates() {
  return TEMPLATES.filter((t) => !t.retired).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    version: t.version,
    fieldCount: t.scalars.length,
  }));
}

module.exports = {
  TEMPLATES,
  TEMPLATE_IDS,
  getTemplate,
  readMaster,
  fieldSpec,
  listTemplates,
  groupFor,
};
