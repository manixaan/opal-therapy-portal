'use strict';

/**
 * WHODAS 2.0 — COMPLETED-ASSESSMENT PDF
 *
 * Produces a filled-in copy of the official WHO instrument by drawing, onto a
 * copy of the immutable source PDF, exactly what a person completing the paper
 * form would have written on it: a ring around each chosen response, and the
 * write-in values. Nothing else. No header, no footer, no logo, no watermark,
 * no explanatory text, no re-typeset questions.
 *
 * ── Why the source is never mutated ────────────────────────────────────────
 * The template bytes are loaded fresh (and re-hashed) for every generation, and
 * the modified document is a new byte string. The file on disk is never opened
 * for writing by this module. `assertTemplateUnchanged` proves it afterwards.
 *
 * ── Why a ring rather than a tick or a fill ────────────────────────────────
 * Every version of the instrument instructs the respondent to "circle only one
 * response". Drawing a ring around the printed option is the mark the document
 * itself asks for, and it leaves the WHO text fully legible underneath — a
 * filled box or a strike-through would obscure it.
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const registry = require('./template-registry');

/**
 * Ink colour. A dark blue reads unmistakably as something written onto the
 * form rather than part of it, and still separates from the black printing when
 * a clinic prints in greyscale.
 */
const INK = rgb(0.05, 0.12, 0.52);
const RING_WIDTH = 1.1;
const WRITE_IN_SIZE = 9;

/**
 * @param {object}  opts
 * @param {string}  opts.templateKey
 * @param {object}  opts.responses      itemId → semantic response value
 * @param {object} [opts.formData]      fieldId → coded option number or write-in text
 * @param {string[]} [opts.notApplicableItems]  left blank, as on paper
 * @returns {Promise<{ bytes: Buffer, pageCount: number, marksDrawn: number, warnings: string[] }>}
 */
async function generateCompletedPdf({
  templateKey,
  responses = {},
  formData = {},
  notApplicableItems = [],
} = {}) {
  const template = registry.templateByKey(templateKey);
  if (!template) throw new Error(`Unknown WHODAS template: ${templateKey}`);

  const map = registry.fieldMap(templateKey);
  if (!map) throw new Error(`No field map for WHODAS template: ${templateKey}`);
  if (map.templateSha256 !== template.sha256) {
    const err = new Error(
      `Field map for ${templateKey} was derived from a different document ` +
      `(${map.templateSha256} vs ${template.sha256}). Refusing to place marks with stale coordinates.`
    );
    err.code = 'FIELD_MAP_STALE';
    throw err;
  }

  // Re-hashed on read; throws if the template on disk has changed.
  const sourceBytes = registry.readTemplateBytes(templateKey);

  const pdf = await PDFDocument.load(sourceBytes);
  const pages = pdf.getPages();
  if (pages.length !== template.pageCount) {
    throw new Error(`${templateKey}: loaded ${pages.length} pages, manifest says ${template.pageCount}`);
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const skip = new Set(notApplicableItems);
  const warnings = [];
  let marksDrawn = 0;

  const ring = (page, mark) => {
    page.drawEllipse({
      x: mark.cx,
      y: mark.cy,
      xScale: mark.rx,
      yScale: mark.ry,
      borderColor: INK,
      borderWidth: RING_WIDTH,
      opacity: 0,
    });
    marksDrawn += 1;
  };

  for (const field of map.fields) {
    const page = pages[field.page - 1];
    if (!page) {
      warnings.push(`${field.field}: page ${field.page} not present`);
      continue;
    }

    if (field.type === 'radio-group') {
      // A legitimately skipped item is left blank, exactly as on paper.
      if (skip.has(field.field)) continue;

      const value = responses[field.field];
      if (value === undefined || value === null || value === '') continue;

      const option = field.options.find((o) => o.value === value);
      if (!option) {
        warnings.push(`${field.field}: no printed option for response ${JSON.stringify(value)}`);
        continue;
      }
      ring(page, option.mark);
      continue;
    }

    if (field.type === 'coded-radio') {
      const code = formData[field.field];
      if (code === undefined || code === null || code === '') continue;

      const option = field.options.find((o) => o.code === Number(code));
      if (!option) {
        warnings.push(`${field.field}: no printed option for code ${JSON.stringify(code)}`);
        continue;
      }
      ring(page, option.mark);
      continue;
    }

    if (field.type === 'text') {
      const raw = formData[field.field];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;

      const text = String(raw).trim();
      const { writeIn } = field;

      // Shrink rather than overflow: a value that runs past the printed rule
      // would collide with WHO text.
      let size = WRITE_IN_SIZE;
      while (size > 5 && font.widthOfTextAtSize(text, size) > writeIn.w) size -= 0.5;

      page.drawText(text, {
        x: writeIn.x,
        y: writeIn.y,
        size,
        font,
        color: INK,
        maxWidth: writeIn.w,
      });
      marksDrawn += 1;
      continue;
    }

    warnings.push(`${field.field}: unsupported field type ${field.type}`);
  }

  // No metadata of ours on a WHO document beyond fixed dates, which keep output
  // byte-reproducible for the same input.
  const epoch = new Date(0);
  pdf.setCreationDate(epoch);
  pdf.setModificationDate(epoch);

  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
  return { bytes, pageCount: pages.length, marksDrawn, warnings };
}

/** Prove the canonical template on disk is byte-identical after generation. */
function assertTemplateUnchanged(templateKey) {
  const template = registry.templateByKey(templateKey);
  const bytes = registry.readTemplateBytes(templateKey); // throws on mismatch
  return registry.sha256(bytes) === template.sha256;
}

module.exports = { generateCompletedPdf, assertTemplateUnchanged, INK };
