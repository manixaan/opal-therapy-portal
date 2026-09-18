'use strict';

/**
 * TEMPLATE DOCUMENT APPENDICES
 *
 * Supporting material a therapist attaches to a template document (the FCA):
 * a PDF from their machine, or a completed interactive assessment this portal
 * already holds (a WHODAS 2.0 record with its generated PDF).
 *
 * Three jobs, all pure over their inputs except the two loaders:
 *
 *   1. insertAppendixEntries — put an "Appendix A — <title>" heading and a
 *      one-line description for every attachment INSIDE the master's Appendices
 *      section, so the contents page lists them and the Word download names
 *      them. Word cannot embed PDF pages, so the Word line refers the reader to
 *      the PDF download.
 *   2. mergeAppendixPdfs — after the report is rendered to PDF, add a divider
 *      page per appendix followed by the attachment's own pages.
 *   3. loadAppendixPdf — the bytes behind an appendix row: an uploaded PDF from
 *      the storage backend it was written with, or the LATEST generated
 *      document of the referenced assessment, read at export time so a
 *      re-issued assessment PDF is what ships.
 *
 * Nothing here decides WHETHER an appendix belongs — the routes own that (a
 * document's appendices are the caller's own rows, org-scoped). This module
 * renders exactly the list it is handed.
 */

const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const { pool } = require('../database');
const { getBackend } = require('../storage');
const { STYLE } = require('../fca/template-map');
const { toWinAnsi } = require('../interview-pdf');

const APPENDICES_SECTION_TAG = 'OPAL_SECTION_APPENDICES';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** 15 MB binary cap for an uploaded PDF (≈ 20 MB of base64). */
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_TITLE_CHARS = 200;
const MAX_APPENDICES = 26;

const KIND_LABEL = {
  pdf: 'Attached PDF',
  whodas: 'WHODAS 2.0 completed assessment',
};

// ── Small helpers ────────────────────────────────────────────────────────────

/** A, B, … Z, then AA, AB … — never a number, which the master reserves for pages. */
function appendixLetter(index) {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function describeAppendix(row) {
  const parts = [KIND_LABEL[row.kind] || 'Attachment'];
  if (row.kind === 'pdf' && row.filename) parts.push(row.filename);
  if (row.page_count) parts.push(`${row.page_count} page${row.page_count === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** The public shape. Ids, sizes and titles — never bytes. */
function serialiseAppendix(row, index) {
  return {
    id: row.id,
    letter: appendixLetter(index),
    kind: row.kind,
    title: row.title,
    filename: row.filename || null,
    pageCount: row.page_count || null,
    byteSize: row.byte_size || null,
    assessmentId: row.whodas_assessment_id || null,
    createdAt: row.created_at,
  };
}

// ── Loaders ──────────────────────────────────────────────────────────────────

async function listAppendices(documentId) {
  const { rows } = await pool.query(
    `SELECT a.*, wd.page_count AS assessment_page_count
       FROM template_document_appendices a
       LEFT JOIN LATERAL (
         SELECT page_count FROM whodas_generated_documents
          WHERE assessment_id = a.whodas_assessment_id
          ORDER BY created_at DESC LIMIT 1
       ) wd ON a.kind = 'whodas'
      WHERE a.document_id = $1
      ORDER BY a.sort_order, a.created_at`,
    [documentId]
  );
  // A completed-assessment appendix reports the assessment document's pages.
  return rows.map((r) => (r.kind === 'whodas' && !r.page_count
    ? { ...r, page_count: r.assessment_page_count || null }
    : r));
}

/**
 * The bytes for one appendix, or null when they cannot be found (an
 * assessment whose document was never generated). Never throws for a missing
 * document — the export names the appendix and continues; the therapist sees
 * a gap rather than losing the whole download.
 */
async function loadAppendixPdf(row) {
  if (row.kind === 'pdf') {
    const { base64 } = await getBackend(row.storage_backend || 'db').get({
      backend: row.storage_backend,
      storageKey: row.storage_key,
      fileData: row.file_data,
    });
    return base64 ? Buffer.from(base64, 'base64') : null;
  }
  if (row.kind === 'whodas') {
    const { rows } = await pool.query(
      `SELECT * FROM whodas_generated_documents
        WHERE assessment_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [row.whodas_assessment_id]
    );
    const doc = rows[0];
    if (!doc) return null;
    const { base64 } = await getBackend(doc.storage_backend || 'db').get({
      backend: doc.storage_backend,
      storageKey: doc.storage_key,
      fileData: doc.file_data,
    });
    return base64 ? Buffer.from(base64, 'base64') : null;
  }
  return null;
}

// ── PDF validation ───────────────────────────────────────────────────────────

/**
 * Accept only what pdf-lib can open: a real PDF under the cap. Returns the page
 * count, or throws an Error with `.code` the route maps to a 400.
 */
async function inspectUploadedPdf(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    const e = new Error('File content must be base64-encoded'); e.code = 'invalid_file'; throw e;
  }
  if (bytes.length > MAX_PDF_BYTES) {
    const e = new Error('PDF is larger than 15 MB'); e.code = 'file_too_large'; throw e;
  }
  if (bytes.slice(0, 5).toString('latin1') !== '%PDF-') {
    const e = new Error('Only PDF files can be attached'); e.code = 'not_a_pdf'; throw e;
  }
  // pdf-lib parses leniently and only fails when the page tree is read, so
  // both steps sit inside the guard.
  let pages = 0;
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    pages = pdf.getPageCount();
  } catch (err) {
    const e = new Error('This PDF could not be read'); e.code = 'invalid_pdf'; throw e;
  }
  if (!pages) { const e = new Error('This PDF has no pages'); e.code = 'invalid_pdf'; throw e; }
  return pages;
}

// ── DOCX: headings inside the Appendices section ─────────────────────────────

function directChild(node, name) {
  for (let n = node.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && n.nodeName === name) return n;
  }
  return null;
}

function findSectionSdt(doc, tag) {
  const sdts = Array.from(doc.getElementsByTagName('w:sdt'));
  for (const sdt of sdts) {
    const pr = directChild(sdt, 'w:sdtPr');
    const t = pr && directChild(pr, 'w:tag');
    if (t && t.getAttribute('w:val') === tag) return sdt;
  }
  return null;
}

function el(doc, name, attrs) {
  const node = doc.createElementNS(W_NS, name);
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function paragraph(doc, styleId, text, outlineLvl) {
  const p = el(doc, 'w:p');
  const pPr = el(doc, 'w:pPr');
  pPr.appendChild(el(doc, 'w:pStyle', { 'w:val': styleId }));
  if (outlineLvl !== undefined) pPr.appendChild(el(doc, 'w:outlineLvl', { 'w:val': String(outlineLvl) }));
  p.appendChild(pPr);
  const r = el(doc, 'w:r');
  const t = el(doc, 'w:t', { 'xml:space': 'preserve' });
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  p.appendChild(r);
  return p;
}

/**
 * Append one heading + description pair per appendix to the END of the
 * Appendices section's content. The section must be present in the composed
 * document — compose.js forces it in whenever appendices exist. If it is
 * somehow absent the document is returned untouched rather than guessed at.
 */
async function insertAppendixEntries(docxBuffer, appendices) {
  if (!Array.isArray(appendices) || appendices.length === 0) return docxBuffer;

  const zip = await JSZip.loadAsync(docxBuffer);
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const sdt = findSectionSdt(doc, APPENDICES_SECTION_TAG);
  const content = sdt && directChild(sdt, 'w:sdtContent');
  if (!content) return docxBuffer;

  appendices.forEach((row, i) => {
    const heading = `Appendix ${appendixLetter(i)} — ${row.title}`;
    content.appendChild(paragraph(doc, STYLE.HEADING2, heading, 1));
    content.appendChild(paragraph(
      doc, STYLE.BODY,
      `${describeAppendix(row)}. The full document follows this report in the PDF download.`
    ));
  });

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── PDF: divider page + the attachment's pages ───────────────────────────────

const A4 = { w: 595.28, h: 841.89 };
const GREEN = rgb(0x2f / 255, 0x56 / 255, 0x51 / 255);
const INK = rgb(0x26 / 255, 0x36 / 255, 0x33 / 255);
const SOFT = rgb(0x56 / 255, 0x6e / 255, 0x70 / 255);
const RULE = rgb(0xbf / 255, 0xcd / 255, 0xce / 255);

function wrap(font, text, size, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(probe, size) > width && line) { lines.push(line); line = w; }
    else line = probe;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * `items` — [{ letter, title, description, bytes|null }] in order. An item with
 * no bytes still gets its divider page, which then says the document was not
 * available, so the gap is visible on paper rather than silent.
 */
async function mergeAppendixPdfs(basePdfBytes, items) {
  if (!Array.isArray(items) || items.length === 0) return basePdfBytes;

  const out = await PDFDocument.load(basePdfBytes, { updateMetadata: false });
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const regular = await out.embedFont(StandardFonts.Helvetica);
  const margin = 72;
  const width = A4.w - margin * 2;

  for (const item of items) {
    const page = out.addPage([A4.w, A4.h]);
    let y = A4.h - 200;
    page.drawText(toWinAnsi(`APPENDIX ${item.letter}`), { x: margin, y, size: 11, font: bold, color: SOFT });
    y -= 34;
    for (const line of wrap(bold, toWinAnsi(item.title), 22, width)) {
      page.drawText(line, { x: margin, y, size: 22, font: bold, color: GREEN });
      y -= 30;
    }
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: A4.w - margin, y }, thickness: 1, color: RULE });
    y -= 26;
    const desc = item.bytes
      ? item.description
      : `${item.description}. The attached document was not available when this PDF was produced.`;
    for (const line of wrap(regular, toWinAnsi(desc), 11, width)) {
      page.drawText(line, { x: margin, y, size: 11, font: regular, color: INK });
      y -= 16;
    }

    if (!item.bytes) continue;
    let pages;
    try {
      const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true, updateMetadata: false });
      pages = await out.copyPages(src, src.getPageIndices());
    } catch (err) {
      continue; // the divider already names it; an unreadable file must not sink the export
    }
    for (const p of pages) out.addPage(p);
  }

  return Buffer.from(await out.save({ useObjectStreams: false }));
}

/** Rows → merge items, loading bytes. Used by the export path. */
async function appendixItems(rows) {
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let bytes = null;
    try { bytes = await loadAppendixPdf(row); } catch (err) { bytes = null; }
    items.push({
      letter: appendixLetter(i),
      title: row.title,
      description: describeAppendix(row),
      bytes,
    });
  }
  return items;
}

module.exports = {
  APPENDICES_SECTION_TAG,
  MAX_PDF_BYTES,
  MAX_TITLE_CHARS,
  MAX_APPENDICES,
  appendixLetter,
  describeAppendix,
  serialiseAppendix,
  listAppendices,
  loadAppendixPdf,
  inspectUploadedPdf,
  insertAppendixEntries,
  mergeAppendixPdfs,
  appendixItems,
};
