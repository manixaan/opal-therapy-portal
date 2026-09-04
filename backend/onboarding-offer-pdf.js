'use strict';

/**
 * LETTER OF OFFER — the PDF, from the same .docx the employee is sent.
 *
 *   offerPdfFromDocx(docxBytes, { title, footer }) → Promise<Buffer>
 *   offerPdfModel(docxBytes)                        → Promise<model>   (tests)
 *
 * ── Why it reads the .docx rather than the terms ────────────────────────────
 * The Word file is the letter: it is what was generated from the record, or
 * what an Owner uploaded after editing it in Word. Reading the PDF's content
 * back out of those bytes means the two downloads cannot disagree — an edited
 * clause, a removed condition, a changed closing date all reach the PDF
 * because they are in the file it was read from.
 *
 * ── How it renders ──────────────────────────────────────────────────────────
 * The letter's values live in Word content controls (the OPAL_LOO_* tags the
 * fill engine writes into). templates/document-model.js reads a control as an
 * unfilled form field — right for a severed template, wrong for a letter whose
 * controls are already populated — so every control is unwrapped into its own
 * text first, and the reader then sees plain runs.
 *
 * The letter template's style ids (OPALHeading1, OPALNumberedList2, …) are
 * mapped to the exporter's roles here; numbered clauses are numbered in text
 * because the exporter draws bullets, not counters, and a letter's conditions
 * are numbered for a reason.
 *
 * Same honesty as templates/pdf-export.js: this is the letter's content and
 * structure in the Opal palette, paginated by this renderer, not a page-for-page
 * copy of Word's layout. The .docx remains the master.
 */

const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { readDocumentModel } = require('./templates/document-model');
const { renderTemplatePdf } = require('./templates/pdf-export');

/** The letter template's paragraph styles → exporter roles. */
const STYLE_ROLES = {
  OPALDocumentTitle: 'title',
  OPALSubtitle: 'subtitle',
  OPALHeading1: 'h1',
  OPALHeading2: 'h2',
  OPALHeading3: 'h3',
  OPALHeading4: 'h3',
  OPALBodyEmphasis: 'emphasis',
  OPALKeyFinding: 'emphasis',
  OPALBullet: 'list',
  OPALBullet2: 'list',
  OPALNumberedList: 'numbered',
  OPALNumberedList2: 'numbered',
};

const PDF_FOOTER = 'Opal Therapy | Confidential | Letter of Offer';

/**
 * Replace every content control in the part with its own content, in place,
 * so a populated value reads as the text it is.
 */
function unwrapControls(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  // Innermost first: a block control can hold run controls.
  const sdts = Array.from(doc.getElementsByTagName('w:sdt')).reverse();
  for (const sdt of sdts) {
    const parent = sdt.parentNode;
    if (!parent) continue;
    let content = null;
    for (let c = sdt.firstChild; c; c = c.nextSibling) {
      if (c.nodeName === 'w:sdtContent') { content = c; break; }
    }
    if (content) {
      while (content.firstChild) parent.insertBefore(content.firstChild, sdt);
    }
    parent.removeChild(sdt);
  }
  return new XMLSerializer().serializeToString(doc);
}

function hasText(block) {
  return block.type === 'table' || block.segments.some((s) => s.type === 'text' && s.text.trim() !== '');
}

/** The document model the PDF is rendered from: filled text, letter roles, numbered clauses. */
async function offerPdfModel(docxBytes) {
  const zip = await JSZip.loadAsync(docxBytes);
  const part = zip.file('word/document.xml');
  if (!part) throw new Error('letter pdf: word/document.xml is missing');
  zip.file('word/document.xml', unwrapControls(await part.async('string')));
  const model = await readDocumentModel(await zip.generateAsync({ type: 'nodebuffer' }));

  const blocks = [];
  let counter = 0;
  for (const block of model.blocks) {
    if (block.type !== 'paragraph') { blocks.push(block); counter = 0; continue; }
    const role = STYLE_ROLES[block.style] || 'body';
    if (role === 'numbered') {
      if (!hasText(block)) continue; // a dropped condition leaves no gap in the numbering
      counter += 1;
      const first = block.segments.find((s) => s.type === 'text');
      const segments = block.segments.slice();
      segments.splice(segments.indexOf(first), 0, { type: 'text', text: `${counter}.  `, bold: false, italic: false });
      blocks.push({ ...block, role: 'body', segments });
      continue;
    }
    counter = 0;
    blocks.push({ ...block, role });
  }
  // Leading blank paragraphs are Word spacing, not content.
  while (blocks.length && blocks[0].type === 'paragraph' && !hasText(blocks[0])) blocks.shift();
  return { blocks, fields: [] };
}

/**
 * @param {Buffer} docxBytes  the letter — generated or uploaded
 * @param {{ title?: string, footer?: string }} [opts]
 */
async function offerPdfFromDocx(docxBytes, { title = 'Letter of Offer', footer = PDF_FOOTER } = {}) {
  const model = await offerPdfModel(docxBytes);
  return renderTemplatePdf({ model, title, footer });
}

/** `Letter of Offer - Jane Smith - Opal Therapy - 2026-09-03.docx` → the same name, `.pdf`. */
function pdfFileName(docxName) {
  return String(docxName || 'Letter of Offer').replace(/\.docx$/i, '') + '.pdf';
}

module.exports = { offerPdfFromDocx, offerPdfModel, pdfFileName, unwrapControls, STYLE_ROLES, PDF_FOOTER, PDF_MIME: 'application/pdf' };
