'use strict';

/**
 * READING ENOUGH OF A DOCUMENT TO KNOW WHAT IT IS.
 *
 * Classification does not need a whole document; it needs the part that says
 * what the document is for. That is almost always the front of it — the title
 * page, the contents, the first headings — so this module SAMPLES rather than
 * extracts (§43). A hundred-page manual costs the same to classify as a
 * two-page worksheet, and neither one has its bytes shipped anywhere: the text
 * is reduced here, in the backend, and only the reduction is ever offered to a
 * model.
 *
 * ── NO NEW DEPENDENCY ─────────────────────────────────────────────────────
 * PDFs go through the Resource Hub's existing pdfjs worker — the same one the
 * file-quality gate uses — so there is no second PDF stack to keep patched.
 * DOCX is a zip with an XML part in it, which JSZip (already a dependency)
 * opens. Nothing here adds a package.
 *
 * ── WHEN THERE IS NO TEXT ─────────────────────────────────────────────────
 * A scanned handout has no text layer, and this portal has no OCR (§44). The
 * honest answer is to say so: `textSource: 'none'` travels with the profile,
 * the classifier falls back to metadata, and a document that cannot be read
 * and cannot be identified from its metadata lands in Needs Review rather than
 * being guessed at.
 */

const JSZip = require('jszip');
const fileStorage = require('./resource-file-storage');
const quality = require('./resource-file-quality');
const log = require('./logger').createLogger('resource-library-text');

/** Pages read from the front of a PDF. Purpose lives at the front. */
const PDF_SAMPLE_PAGES = 4;
/** Characters kept per document, whatever its length. */
const MAX_CHARS = 6000;
/** Files larger than this are classified from metadata; opening them is not worth it. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Word-ish content, collapsed. Layout tells us nothing about subject matter. */
function tidy(text) {
  return String(text || '')
    .replace(/ /g, ' ')
    .replace(/[ \t -​]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS);
}

/** Plain text of word/document.xml, paragraph breaks preserved. */
async function docxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const part = zip.file('word/document.xml');
  if (!part) return '';
  const xml = await part.async('string');
  const withBreaks = xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:br\s*\/>/g, '\n');
  const runs = withBreaks.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>|\n/g) || [];
  return tidy(runs
    .map((r) => (r === '\n' ? '\n' : r.replace(/<[^>]+>/g, '')))
    .join(' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
}

/** The first few pages of a PDF, joined. */
async function pdfText(buffer) {
  const pages = await quality.pdfPageTexts(buffer);
  if (!Array.isArray(pages)) return '';
  return tidy(pages.slice(0, PDF_SAMPLE_PAGES).join('\n\n'));
}

/**
 * Representative text for one resource file.
 *
 * Never throws: an unreadable file is a classification input we do not have,
 * not a failure of the run (§61). The reason is returned so the profile can
 * record honestly why it had only metadata to work with.
 *
 * @param {object} file  { storage_key, format, file_mime, file_data, file_size_bytes }
 * @returns {Promise<{text: string, source: string}>}
 */
async function sampleFile(file) {
  if (!file) return { text: '', source: 'none' };
  const size = Number(file.file_size_bytes || 0);
  if (size > MAX_FILE_BYTES) return { text: '', source: 'too-large' };

  const format = String(file.format || '').toLowerCase()
    || (String(file.file_mime || '').includes('pdf') ? 'pdf' : '');
  if (format !== 'pdf' && format !== 'docx') return { text: '', source: 'unsupported' };

  let buffer;
  try {
    if (file.storage_key) buffer = await fileStorage.getBuffer(file.storage_key);
    else if (file.file_data) buffer = Buffer.from(file.file_data, 'base64');
    else return { text: '', source: 'none' };
  } catch (err) {
    log.warn('resource file unreadable for classification', { reason: err && err.message });
    return { text: '', source: 'unreadable' };
  }

  try {
    const text = format === 'pdf' ? await pdfText(buffer) : await docxText(buffer);
    // A PDF that parses but yields nothing is a scan. Say so rather than
    // reporting an empty success.
    if (!text) return { text: '', source: format === 'pdf' ? 'no-text-layer' : 'empty' };
    return { text, source: format };
  } catch (err) {
    log.warn('text sampling failed', { reason: err && err.message });
    return { text: '', source: 'unreadable' };
  }
}

module.exports = { sampleFile, docxText, pdfText, tidy, MAX_CHARS, PDF_SAMPLE_PAGES, MAX_FILE_BYTES };
