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

const { resolveScalars } = require('../fca/resolve-scalars');
const { composeDocx } = require('../fca/docx-engine');
const { readMaster } = require('./catalogue');
const { severDocx } = require('./export-boundary');
const { readDocumentModel } = require('./document-model');
const { renderTemplatePdf } = require('./pdf-export');

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
 * The in-portal document: still bound, still carrying the master's own prompts
 * for anything outstanding. This is what the live preview renders, and it is
 * the input the export boundary severs.
 */
async function composePortalDocx(state) {
  const { template, scalarData } = state;
  const composed = await composeDocx({
    templateBuffer: readMaster(template),
    manifest: {
      scalarData,
      scalarSources: state.scalarSources,
      // Every section, in the master's own order. Templates renders the
      // complete document; choosing which optional sections appear is the FCA
      // wizard's clinical decision, not this capability's.
      sections: [],
      excludedTags: [],
      dependentRows: [],
    },
    options: {
      controlParts: template.controlParts,
      customSectionAnchor: template.customSectionAnchor,
      buildCustomSection: null,
      multilineTags: template.multilineTags,
      dropParagraphWhenEmpty: template.optionalLineTags || new Set(),
      rebuildToc: false,
      label: `template:${template.id}`,
    },
  });
  return Buffer.isBuffer(composed) ? composed : composed.buffer;
}

/** Filename stem, safe for a Content-Disposition and for a filesystem. */
function safePart(value, fallback) {
  const s = String(value || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-');
  return s || fallback;
}

function exportFilename(state, extension) {
  const { template, row } = state;
  return `${template.filenameStem}-${safePart(row.title, 'Document')}.${extension}`;
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
  }));

  const severed = await severDocx({
    buffer: portalDocx,
    fields,
    controlParts: template.controlParts,
    internalTags: template.internalTags,
    anchorTags: template.anchorTags,
    documentTitle: row.title || template.name,
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
    title: row.title || template.name,
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
  DOCX_MIME,
  PDF_MIME,
};
