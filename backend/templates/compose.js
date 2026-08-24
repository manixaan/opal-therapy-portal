'use strict';

/**
 * TEMPLATE COMPOSITION — resolve a document instance, then render it.
 *
 *   resolveDocument({ template, row, client })   → the resolved state
 *   composePortalDocx(state)                     → the in-portal document
 *   exportDocument(state, format)                → the independent document
 *
 * ── One computation, three surfaces ─────────────────────────────────────────
 * The preview, the Word export and the PDF export all start from
 * composePortalDocx(state) with the same state object. That is the same rule
 * the FCA follows and for the same reason: a preview composed independently is
 * a second implementation of the document, and the failure it produces is
 * "the preview showed something the file does not".
 *
 *   resolveDocument      → scalarData, scalarSources, missingFields
 *   composePortalDocx    → the portal-bound .docx (preview renders this)
 *   severDocx            → the boundary: bindings out, values kept
 *   readDocumentModel    → what the severed file actually contains
 *   renderTemplatePdf    → the PDF, from that same severed content
 *
 * ── Precedence ──────────────────────────────────────────────────────────────
 * Unchanged from fca/resolve-scalars.js, which is the only resolver:
 * a user's own entry for this document wins; otherwise Splose is authoritative
 * for identity and contact; the organisation-scoped client profile supplies
 * durable facts Splose has no field for; organisation settings supply
 * letterhead; anything left is MISSING and is never inferred.
 *
 * A value typed here belongs to THIS DOCUMENT. Nothing in this module writes to
 * the client profile, to organisation settings or to the master — completing a
 * document instance cannot alter anything it was resolved from.
 */

const crypto = require('crypto');

const { resolveScalars } = require('../fca/resolve-scalars');
const { composeDocx, FCA_OPTIONS } = require('../fca/docx-engine');
const { normaliseSelection, normaliseCustomSections, buildManifest } = require('../fca/manifest');
const { readMaster } = require('./catalogue');
const { severDocx, scrubPortalSurface } = require('./export-boundary');
const { readDocumentModel } = require('./document-model');
const { renderTemplatePdf } = require('./pdf-export');

const HEADING_LEVELS = [1, 2, 3];

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

/** A short, human document reference derived from the instance's own id. */
function documentReference(row) {
  const stem = String(row.id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
  return `OPAL-${stem}`;
}

function issueDate(row) {
  const d = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve every control the master declares.
 *
 * @param {object} template  a catalogue entry
 * @param {object} row       the template_documents row
 * @param {object} client    { splose, profile, currentPlan, goals } or nulls
 * @param {object} portal    loadPortalData() shape
 * @param {object} organisation loadOrganisationSettings() shape
 */
function resolveDocument({ template, row, client = {}, portal = null, organisation = null }) {
  const overrides = (row && row.field_values && typeof row.field_values === 'object')
    ? row.field_values
    : {};

  const { scalarData, scalarSources, missingFields } = resolveScalars({
    splose: client.splose || null,
    profile: client.profile || null,
    currentPlan: client.currentPlan || null,
    goals: client.goals || [],
    overrides,
    portal,
    organisation,
    server: { documentReference: documentReference(row), reportDate: issueDate(row) },
    catalogue: template.catalogue,
  });

  return { template, row, scalarData, scalarSources, missingFields };
}

/**
 * The section structure this document composes with.
 *
 * Templates with no section catalogue render the complete master, untouched.
 * The FCA carries one, so its stored selection/order — `row.sections`, shaped
 * `{ selected: [tags], order: [tags] }` — is normalised through the SAME
 * helpers the FCA wizard uses: unknown tags are dropped, required sections are
 * re-added whatever was stored, order falls back to the master's own, and the
 * dependent results-table rows of an excluded assessment travel with it.
 */
function sectionStructure(template, row) {
  if (!template.sectionCatalogue) return { sections: [], dependentRows: [] };

  const stored = (row && row.sections && typeof row.sections === 'object'
    && !Array.isArray(row.sections)) ? row.sections : {};

  // fca/manifest's default catalogue IS the FCA — the only template that
  // declares a sectionCatalogue.
  const { selectedSections, sectionOrder } = normaliseSelection({
    selectedSections: Array.isArray(stored.selected) ? stored.selected : undefined,
    sectionOrder: Array.isArray(stored.order) ? stored.order : undefined,
  });

  // Clinician-created sections, rendered at the master's custom-section
  // anchor. Ids are server-minted at save time, so the derived tag is stable
  // across composes; the fallback factory only fires for a legacy row.
  const storedCustom = Array.isArray(stored.custom) ? stored.custom.filter(Boolean) : [];
  const customSections = normaliseCustomSections(
    storedCustom.map((c) => ({ id: c.id, title: c.title, guidance: c.guidance })),
    () => crypto.randomUUID()
  );

  const manifest = buildManifest({
    selectedSections,
    sectionOrder,
    customSections,
    scalarData: {},
    scalarSources: {},
    excludedFields: [],
  });

  // Heading-level overrides: master sections are keyed by tag, custom
  // sections by their stored id (their tag is derived, so the id is the
  // stable key the editor holds).
  const levels = (stored.levels && typeof stored.levels === 'object') ? stored.levels : {};
  const levelById = new Map(storedCustom
    .filter((c) => c.id !== undefined)
    .map((c) => [String(c.id), c.level]));
  const levelByCustomTag = new Map();
  for (const c of customSections) {
    const lv = levelById.get(String(c.id));
    if (HEADING_LEVELS.includes(lv)) levelByCustomTag.set(c.tag, lv);
  }

  const sections = manifest.sections.map((s) => {
    const lv = s.kind === 'custom' ? levelByCustomTag.get(s.tag) : levels[s.tag];
    return HEADING_LEVELS.includes(lv) ? { ...s, headingLevel: lv } : s;
  });

  return { sections, dependentRows: manifest.dependentRows };
}

/**
 * The in-portal document: still bound, still carrying the master's own prompts
 * for anything outstanding. This is what the live preview renders, and it is
 * the input the export boundary severs — so a section choice made in the
 * editor is visible in the preview AND in both exports, because all three are
 * this one composition.
 */
async function composePortalDocx(state) {
  const { template, row, scalarData } = state;
  const structure = sectionStructure(template, row);
  const composed = await composeDocx({
    templateBuffer: readMaster(template),
    manifest: {
      scalarData,
      scalarSources: state.scalarSources,
      sections: structure.sections,
      excludedTags: [],
      dependentRows: structure.dependentRows,
    },
    options: {
      controlParts: template.controlParts,
      customSectionAnchor: template.customSectionAnchor,
      // Clinician-created sections use the FCA's own builder — the only
      // template with a section catalogue is the FCA, and its custom
      // sections must look identical whichever surface composed them.
      buildCustomSection: template.sectionCatalogue ? FCA_OPTIONS.buildCustomSection : null,
      multilineTags: template.multilineTags,
      dropParagraphWhenEmpty: template.optionalLineTags || new Set(),
      // A template whose sections can change must keep its cached contents
      // list honest; the others ship the master's own TOC untouched.
      rebuildToc: Boolean(template.sectionCatalogue),
      label: `template:${template.id}`,
    },
  });
  const buffer = Buffer.isBuffer(composed) ? composed : composed.buffer;

  // The master's template-maintainer language ("Using this FCA template",
  // the TEMPLATE CONTROL header band) is for people MAINTAINING the master,
  // not for a clinician completing a document — so it never reaches the
  // portal surface either. The export boundary keeps its own removal and
  // verification as the backstop.
  return scrubPortalSurface({
    buffer,
    controlParts: template.controlParts,
    internalBlocks: template.internalBlocks || [],
    textReplacements: template.textReplacements || [],
  });
}

/** Filename stem, safe for a Content-Disposition and for a filesystem. */
function safePart(value, fallback) {
  const s = String(value || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-');
  return s || fallback;
}

/** The participant this document resolves against, when the template names one. */
function participantName(state) {
  const tag = state.template.participantTag;
  const v = tag ? state.scalarData[tag] : null;
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s || null;
}

/**
 * The exported document's own title: the instance title, with the participant
 * appended when the document is about one — "Functional Capacity Assessment —
 * Jane Smith", never just the generic template name. Nothing beyond the name
 * is added: an NDIS number in a filename or a title bar is disclosure, not
 * context.
 */
function exportTitle(state) {
  const base = String(state.row.title || state.template.name).trim() || state.template.name;
  const name = participantName(state);
  if (!name) return base;
  if (base.toLowerCase().includes(name.toLowerCase())) return base;
  return `${base} — ${name}`;
}

function exportFilename(state, extension) {
  const { template, row } = state;
  const name = participantName(state);
  const title = String(row.title || '').trim();

  const parts = [template.filenameStem];
  // The instance title, when it says more than the template's own name does.
  if (title && title !== template.name) parts.push(safePart(title, ''));
  // The participant, unless the title already names them.
  if (name && !parts.some((p) => p.toLowerCase().includes(safePart(name, '').toLowerCase()))) {
    parts.push(safePart(name, ''));
  }
  return `${parts.filter(Boolean).join('-')}.${extension}`;
}

/**
 * The independent document. Word and PDF are the SAME severed bytes read twice,
 * which is what makes "both exports represent the same document state" a
 * property of the pipeline rather than a claim about it.
 *
 * @returns {{ buffer, filename, contentType, unfinished, report }}
 */
async function exportDocument(state, format) {
  const { template, row } = state;

  const portalDocx = await composePortalDocx(state);

  const resolvedSet = new Set(
    Object.keys(state.scalarData).filter((tag) => {
      const v = state.scalarData[tag];
      return v !== null && v !== undefined && String(v).trim() !== '';
    })
  );

  const fields = template.scalars.map((s) => ({
    tag: s.tag,
    label: s.label,
    resolved: resolvedSet.has(s.tag),
    // An unfinished date exports as Word's own calendar picker, not a text box.
    isDate: Boolean(s.isDate),
  }));

  const title = exportTitle(state);

  const severed = await severDocx({
    buffer: portalDocx,
    fields,
    controlParts: template.controlParts,
    internalTags: template.internalTags,
    anchorTags: template.anchorTags,
    internalBlocks: template.internalBlocks || [],
    internalSentences: template.internalSentences || [],
    textReplacements: template.textReplacements || [],
    documentTitle: title,
  });

  if (format === 'docx') {
    return {
      buffer: severed.buffer,
      filename: exportFilename(state, 'docx'),
      contentType: DOCX_MIME,
      unfinished: severed.unfinished,
      report: severed.report,
    };
  }

  const model = await readDocumentModel(severed.buffer);
  const buffer = await renderTemplatePdf({
    model,
    title,
    footer: template.footer,
  });

  return {
    buffer,
    filename: exportFilename(state, 'pdf'),
    contentType: PDF_MIME,
    unfinished: severed.unfinished,
    report: severed.report,
  };
}

module.exports = {
  resolveDocument,
  composePortalDocx,
  exportDocument,
  documentReference,
  sectionStructure,
  exportTitle,
  DOCX_MIME,
  PDF_MIME,
};
