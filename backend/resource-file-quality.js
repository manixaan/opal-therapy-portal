'use strict';

/**
 * Quality gate for any file proposed for governed storage.
 *
 * Runs on the BYTES, not on what the filename or the upload form claimed. A
 * file that says .pdf and is really a Word document fails here rather than
 * three months later when a therapist cannot open it.
 *
 * WHAT "RENDER EVERY PAGE" MEANS HONESTLY
 * `pdfjs.getOperatorList()` is called for every page. That fully parses and
 * resolves each page's content stream, fonts and embedded resources, and throws
 * on a malformed one — so it does catch broken fonts, truncated streams and
 * unparseable pages. It does NOT rasterise to pixels, because there is no
 * canvas in this stack. So it proves a page CAN be rendered; it cannot prove the
 * result looks right. Visual checks — clipping, contrast, whether a form field
 * is big enough to write in — remain human work, and the report says so rather
 * than implying a machine has done them.
 *
 * Nothing here is called with a private file. The 94 excluded records have no
 * code path that reaches this module.
 */

const crypto = require('crypto');
const path = require('path');
const JSZip = require('jszip');
const { scanTextForClientContent } = require('./resource-privacy-scan');

const { Worker } = require('node:worker_threads');

/**
 * All pdfjs work happens in a worker_thread (resource-file-quality-pdf-worker
 * .js). pdfjs 4 ships ESM only, and importing ESM from CommonJS inside a
 * Jest-managed VM proved version-sensitive — Node either refuses the dynamic
 * import outright or routes it through Jest's per-suite module registry,
 * which fails nondeterministically when suites share a worker process. A
 * worker_thread is a plain Node realm with no test-runner hooks, so the gate
 * behaves identically under test, in CI and in the server.
 */
const PDF_WORKER = path.join(__dirname, 'resource-file-quality-pdf-worker.js');
const PDF_WORKER_TIMEOUT_MS = 120000;

function runPdfWorker(op, buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(PDF_WORKER, {
      workerData: { op, data: new Uint8Array(buffer) },
    });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      fn(value);
    };
    // A pathological PDF must fail the gate, not wedge the process.
    const timer = setTimeout(
      () => finish(reject, new Error(`pdf inspection timed out after ${PDF_WORKER_TIMEOUT_MS}ms`)),
      PDF_WORKER_TIMEOUT_MS);
    worker.once('message', (msg) => {
      if (msg && msg.ok) finish(resolve, msg.result);
      else finish(reject, new Error((msg && msg.error) || 'pdf worker failed'));
    });
    worker.once('error', (err) => finish(reject, err));
    worker.once('exit', (code) => {
      if (code !== 0) finish(reject, new Error(`pdf worker exited with code ${code}`));
    });
  });
}

/** Leading bytes that identify a format regardless of what the name claims. */
const MAGIC = [
  { format: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },                  // %PDF
  { format: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },                  // PK.. (docx/pptx/zip)
  { format: 'ole', bytes: [0xd0, 0xcf, 0x11, 0xe0] },                  // legacy .doc/.ppt, or encrypted OOXML
  { format: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { format: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
];

const MIME_BY_FORMAT = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sniffMagic(buffer) {
  for (const m of MAGIC) {
    if (buffer.length >= m.bytes.length && m.bytes.every((b, i) => buffer[i] === b)) return m.format;
  }
  return 'unknown';
}

/**
 * Patterns that would indicate a real person is named in a file that is meant
 * to be a blank template. Deliberately broad: a false positive costs a human
 * thirty seconds, a false negative publishes a participant's Medicare number.
 */
const IDENTIFIER_PATTERNS = [
  { kind: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  { kind: 'medicare-number', re: /\b\d{4}\s?\d{5}\s?\d\b/g },
  { kind: 'ndis-participant-number', re: /\b43\d{7}\b/g },
  { kind: 'date-of-birth', re: /\b(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:19|20)\d{2}\b/g },
  { kind: 'australian-phone', re: /\b(?:\+?61|0)[2-478](?:[ -]?\d){8}\b/g },
];

function scanForIdentifiers(text) {
  const findings = [];
  for (const p of IDENTIFIER_PATTERNS) {
    const hits = String(text || '').match(p.re);
    // The COUNT is reported, never the matched value — logging the match would
    // copy the identifier into a log file, which is the problem being detected.
    if (hits && hits.length) findings.push({ kind: p.kind, count: hits.length });
  }
  return findings;
}

async function inspectPdf(buffer) {
  try {
    return await runPdfWorker('inspect', buffer);
  } catch (err) {
    // Worker-level failures fail closed, exactly like an unparseable file.
    return {
      pages: 0, perPage: [], textChars: 0, hasTextLayer: false,
      encrypted: false, corrupt: true,
      error: err ? err.message : 'pdf inspection failed', blankPages: [],
    };
  }
}

/** Per-page plain text of a PDF (items space-joined), for fidelity checks. */
function pdfPageTexts(buffer) {
  return runPdfWorker('text', buffer);
}

/** Per-page text items with positions ({ str, x, y, w, h }), for reading a form's values beside its labels. */
function pdfPageItems(buffer) {
  return runPdfWorker('items', buffer);
}

async function inspectDocx(buffer) {
  const out = { parts: 0, hasDocumentXml: false, textChars: 0, encrypted: false, corrupt: false, error: null };
  if (sniffMagic(buffer) === 'ole') {
    // An OLE container where a .docx is expected is either a legacy .doc or an
    // encrypted OOXML package. Either way it is not a .docx.
    out.encrypted = true;
    out.error = 'OLE compound file — legacy .doc or password-protected package.';
    return out;
  }
  try {
    const zip = await JSZip.loadAsync(buffer);
    out.parts = Object.keys(zip.files).length;
    const docXml = zip.file('word/document.xml');
    out.hasDocumentXml = !!docXml;
    if (docXml) {
      const xml = await docXml.async('string');
      out.textChars = (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
        .reduce((n, t) => n + t.replace(/<[^>]+>/g, '').length, 0);
    } else {
      out.corrupt = true;
      out.error = 'No word/document.xml — not a Word document.';
    }
  } catch (err) {
    out.corrupt = true;
    out.error = err ? err.message : 'unreadable archive';
  }
  return out;
}

/** Extract the plain text of a DOCX, for the identifier scan. */
async function docxText(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const f = zip.file('word/document.xml');
    if (!f) return '';
    const xml = await f.async('string');
    return (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
      .map((t) => t.replace(/<[^>]+>/g, '')).join(' ');
  } catch (_) { return ''; }
}

/**
 * Assess one file.
 *
 * @param {Buffer} buffer
 * @param {object} opts { declaredFormat, declaredName, expectPageCount }
 * @returns {Promise<{passed: boolean, failures: string[], warnings: string[], report: object}>}
 */
async function assessFile(buffer, opts = {}) {
  const declaredFormat = String(opts.declaredFormat || '').toLowerCase();
  const failures = [];
  const warnings = [];
  const report = {
    declaredFormat,
    declaredName: opts.declaredName || null,
    sizeBytes: buffer.length,
    checksumSha256: sha256(buffer),
    magic: sniffMagic(buffer),
    mime: MIME_BY_FORMAT[declaredFormat] || null,
    identifierFindings: [],
    accessibility: 'not-assessed',
    visualReviewRequired: true,
  };

  if (!buffer.length) {
    failures.push('File is empty.');
    return { passed: false, failures, warnings, report };
  }

  // Extension must agree with the declared format.
  if (opts.declaredName) {
    const ext = String(opts.declaredName).split('.').pop().toLowerCase();
    if (ext !== declaredFormat) failures.push(`Filename extension .${ext} does not match declared format ${declaredFormat}.`);
  }

  if (declaredFormat === 'pdf') {
    if (report.magic !== 'pdf') {
      failures.push(`Declared PDF but the file begins with a ${report.magic} signature.`);
      return { passed: false, failures, warnings, report };
    }
    const pdf = await inspectPdf(buffer);
    report.pdf = pdf;
    report.pageCount = pdf.pages;
    if (pdf.encrypted) failures.push('PDF is password-protected.');
    if (pdf.corrupt) failures.push(`PDF failed to parse: ${pdf.error || 'page render error'}.`);
    if (!pdf.pages) failures.push('PDF reports zero pages.');
    if (pdf.blankPages.length) warnings.push(`Blank page(s): ${pdf.blankPages.join(', ')}.`);
    if (!pdf.hasTextLayer) {
      failures.push('PDF has no text layer — it is an image-only scan and is not accessible.');
      report.accessibility = 'no-text-layer';
    } else {
      // A text layer is necessary for accessibility but not sufficient: tagging,
      // reading order and alt text are not verifiable here.
      report.accessibility = 'text-layer-present-tagging-unverified';
    }
    if (opts.expectPageCount && pdf.pages !== opts.expectPageCount) {
      warnings.push(`Expected ${opts.expectPageCount} pages, found ${pdf.pages}.`);
    }
    const text = pdf.perPage.length ? await pdfText(buffer) : '';
    report.identifierFindings = scanForIdentifiers(text);
    report.privacy = scanTextForClientContent(text);
  } else if (declaredFormat === 'docx') {
    if (report.magic !== 'zip' && report.magic !== 'ole') {
      failures.push(`Declared DOCX but the file begins with a ${report.magic} signature.`);
      return { passed: false, failures, warnings, report };
    }
    const docx = await inspectDocx(buffer);
    report.docx = docx;
    if (docx.encrypted) failures.push(docx.error || 'DOCX is password-protected.');
    if (docx.corrupt) failures.push(`DOCX failed to parse: ${docx.error}.`);
    if (!docx.textChars) warnings.push('DOCX contains no text runs.');
    const text = await docxText(buffer);
    report.identifierFindings = scanForIdentifiers(text);
    report.privacy = scanTextForClientContent(text);
    report.accessibility = 'docx-structure-unverified';
  } else {
    failures.push(`No quality gate implemented for format "${declaredFormat}".`);
  }

  if (report.identifierFindings.length) {
    failures.push('Possible client identifiers detected: '
      + report.identifierFindings.map((f) => `${f.kind} x${f.count}`).join(', '));
  }

  // Content-evidence privacy scan (resource-privacy-scan.js). A populated
  // person-field is a hard failure; weak-only evidence is a warning that the
  // caller must route to human review rather than publish.
  if (report.privacy && report.privacy.verdict === 'client-confidential') {
    failures.push('Populated client details detected: '
      + report.privacy.strong.map((f) => `${f.kind} x${f.count}`).join(', '));
  } else if (report.privacy && report.privacy.verdict === 'privacy-review') {
    warnings.push('Possible personal content — needs privacy review: '
      + report.privacy.weak.map((f) => `${f.kind} x${f.count}`).join(', '));
  }

  return { passed: failures.length === 0, failures, warnings, report };
}

async function pdfText(buffer) {
  const texts = await pdfPageTexts(buffer);
  return texts.map((t) => ` ${t}`).join('');
}

module.exports = {
  MIME_BY_FORMAT,
  pdfPageTexts,
  pdfPageItems,
  sha256,
  sniffMagic,
  scanForIdentifiers,
  inspectPdf,
  inspectDocx,
  assessFile,
};
