'use strict';

/**
 * PDF EXPORT — render a severed document as a standalone, fillable PDF.
 *
 *   renderTemplatePdf({ model, title, footer }) → Promise<Buffer>
 *
 * ── Same document, second format ────────────────────────────────────────────
 * The input is the model read back out of the SEVERED .docx
 * (templates/document-model.js), never the portal draft. So the PDF cannot
 * disagree with the Word file about what the document says: same resolved
 * values, same user-entered values, same fields still outstanding, because it
 * is the same severed bytes being read a second time.
 *
 * ── Unfinished fields are real form fields ──────────────────────────────────
 * Every `{ type: 'field' }` segment becomes an AcroForm text field, named from
 * the human label the export boundary put on the Word control. That is what
 * makes the PDF independently completable: it opens in Preview, Acrobat or
 * Edge and accepts typing, with no connection to Opal and nothing to resolve.
 * `NeedAppearances` is set so a viewer that declines to trust our appearance
 * streams still draws the typed value.
 *
 * Fields carry a thin border and a white ground — visible enough to find, and
 * deliberately NOT yellow: a highlighted field reads as a defect or a
 * redaction on a document a participant may be handed or may print.
 *
 * ── Fidelity, honestly ──────────────────────────────────────────────────────
 * This is a faithful rendering of the document's CONTENT and STRUCTURE —
 * headings, body, bullets, tables, page breaks, in order, in the Opal palette.
 * It is not a Word layout engine: line breaking is computed here, so pagination
 * will not match Word's page-for-page. The document state is identical; the
 * page geometry is this renderer's own. The Word file remains the master for
 * layout and accessibility, exactly as it is elsewhere in Opal.
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { PALETTE } = require('../opal-document-builder');
const { toWinAnsi } = require('../interview-pdf');

// ── Geometry, matching backend/opal-document-builder.js ──────────────────────
const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;
const CONTENT_W = A4.w - MARGIN * 2;

const FIELD_H = 14;
const FIELD_MIN_W = 70;
const FIELD_MAX_W = 200;
const CELL_PAD = 4;

function hexToRgb(hex) {
  return rgb(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255
  );
}

const INK = () => hexToRgb(PALETTE.ink);
const PRIMARY = () => hexToRgb(PALETTE.primary);
const SECONDARY = () => hexToRgb(PALETTE.secondary);
const MINT = () => hexToRgb(PALETTE.softMint);
const WHITE = rgb(1, 1, 1);

/**
 * How each role prints. `before`/`after` are the vertical gaps in points; they
 * mirror the DOCX styles' w:spacing so the two documents read the same way.
 */
const ROLES = {
  title:    { size: 20, bold: true,  colour: PRIMARY,   before: 0,  after: 8,  leading: 1.25 },
  subtitle: { size: 10, italic: true, colour: SECONDARY, before: 0,  after: 10, leading: 1.35 },
  h1:       { size: 14, bold: true,  colour: PRIMARY,   before: 14, after: 6,  leading: 1.25 },
  h2:       { size: 12, bold: true,  colour: SECONDARY, before: 11, after: 5,  leading: 1.25 },
  h3:       { size: 11, bold: true,  colour: SECONDARY, before: 9,  after: 4,  leading: 1.25 },
  body:     { size: 10, colour: INK,       before: 0, after: 5, leading: 1.4 },
  emphasis: { size: 10, bold: true, colour: INK,        before: 0, after: 5, leading: 1.4 },
  guidance: { size: 9,  italic: true, colour: SECONDARY, before: 0, after: 5, leading: 1.4 },
  list:     { size: 10, colour: INK,       before: 0, after: 3, leading: 1.4, bullet: true },
};

/** AcroForm names are a flat namespace; '.' would create a hierarchy. */
function fieldName(label, used) {
  const base = String(label || 'Field').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 70) || 'Field';
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base} ${n++}`;
  used.add(name);
  return name;
}

// ── The flowing document ─────────────────────────────────────────────────────

class Flow {
  constructor(pdf, fonts, footer) {
    this.pdf = pdf;
    this.form = pdf.getForm();
    this.fonts = fonts;
    this.footer = footer;
    this.used = new Set();
    this.pages = [];
    this.page = null;
    this.y = 0;
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([A4.w, A4.h]);
    this.pages.push(this.page);
    this.y = A4.h - MARGIN;
  }

  need(height) {
    if (this.y - height < MARGIN + 24) this.newPage();
  }

  font(bold, italic) {
    if (bold) return this.fonts.bold;
    if (italic) return this.fonts.italic;
    return this.fonts.regular;
  }

  text(str, x, size, font, colour) {
    this.page.drawText(toWinAnsi(str), { x, y: this.y, size, font, color: colour });
  }

  /** One AcroForm text field, drawn on the current line. */
  field(label, x, width) {
    const f = this.form.createTextField(fieldName(label, this.used));
    f.addToPage(this.page, {
      x,
      y: this.y - 3,
      width,
      height: FIELD_H,
      borderColor: SECONDARY(),
      borderWidth: 0.6,
      backgroundColor: WHITE,
      textColor: INK(),
      font: this.fonts.regular,
    });
    // After addToPage: the /DA a font size is written into does not exist until
    // the widget does.
    f.setFontSize(9);
    return f;
  }

  stampFooters() {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      const line = `${this.footer}${this.footer ? '   ·   ' : ''}Page ${i + 1} of ${total}`;
      page.drawText(toWinAnsi(line), {
        x: MARGIN,
        y: MARGIN - 14,
        size: 7.5,
        font: this.fonts.regular,
        color: SECONDARY(),
      });
    });
  }
}

// ── Inline layout ────────────────────────────────────────────────────────────

/**
 * Break a paragraph's segments into words and field tokens, so a paragraph
 * that mixes literal text and a standalone input lays out as one flowing line
 * rather than as two separate blocks.
 */
function tokenise(segments) {
  const tokens = [];
  for (const seg of segments) {
    if (seg.type === 'field') { tokens.push({ kind: 'field', label: seg.label }); continue; }
    if (seg.type === 'break') { tokens.push({ kind: 'break' }); continue; }
    if (seg.type !== 'text') continue;
    const parts = toWinAnsi(seg.text).split(/(\s+)/);
    for (const p of parts) {
      if (p === '') continue;
      if (/^\s+$/.test(p)) { tokens.push({ kind: 'space', bold: seg.bold, italic: seg.italic }); continue; }
      tokens.push({ kind: 'word', text: p, bold: seg.bold, italic: seg.italic });
    }
  }
  return tokens;
}

/**
 * Lay out tokens inside [x, x+width], starting at flow.y, and advance flow.y.
 * Returns the height consumed.
 */
function layoutTokens(flow, tokens, x, width, role) {
  const spec = ROLES[role] || ROLES.body;
  const size = spec.size;
  const lineH = size * spec.leading;
  const colour = spec.colour();

  let cursor = x;
  let lineStart = true;
  const startY = flow.y;

  const wrap = () => {
    flow.y -= lineH;
    flow.need(lineH);
    cursor = x;
    lineStart = true;
  };

  flow.need(lineH);

  for (const t of tokens) {
    if (t.kind === 'break') { wrap(); continue; }

    if (t.kind === 'space') {
      if (lineStart) continue;
      const f = flow.font(t.bold, t.italic);
      const w = f.widthOfTextAtSize(' ', size);
      if (cursor + w <= x + width) { cursor += w; }
      continue;
    }

    if (t.kind === 'field') {
      const remaining = x + width - cursor;
      let fw = Math.min(FIELD_MAX_W, remaining);
      if (fw < FIELD_MIN_W) { wrap(); fw = Math.min(FIELD_MAX_W, width); }
      fw = Math.max(24, Math.min(fw, x + width - cursor));
      flow.field(t.label, cursor, fw);
      cursor += fw;
      lineStart = false;
      continue;
    }

    const f = flow.font(t.bold, t.italic);
    let word = t.text;
    let w = f.widthOfTextAtSize(word, size);

    // A single token wider than the column would loop forever; break it.
    if (w > width) {
      while (word.length > 1 && f.widthOfTextAtSize(word, size) > width) {
        const cut = Math.max(1, Math.floor(word.length * (width / f.widthOfTextAtSize(word, size))));
        const head = word.slice(0, cut);
        if (!lineStart) wrap();
        flow.text(head, cursor, size, f, colour);
        wrap();
        word = word.slice(cut);
      }
      w = f.widthOfTextAtSize(word, size);
    }

    if (!lineStart && cursor + w > x + width) wrap();
    flow.text(word, cursor, size, f, colour);
    cursor += w;
    lineStart = false;
  }

  flow.y -= lineH;
  return startY - flow.y;
}

/** Measure without drawing, so a table row can size itself before it commits. */
function measureTokens(flow, tokens, width, role) {
  const spec = ROLES[role] || ROLES.body;
  const size = spec.size;
  const lineH = size * spec.leading;
  let cursor = 0;
  let lines = 1;
  let lineStart = true;

  for (const t of tokens) {
    if (t.kind === 'break') { lines += 1; cursor = 0; lineStart = true; continue; }
    if (t.kind === 'space') {
      if (lineStart) continue;
      cursor += flow.font(t.bold, t.italic).widthOfTextAtSize(' ', size);
      continue;
    }
    if (t.kind === 'field') {
      const remaining = width - cursor;
      let fw = Math.min(FIELD_MAX_W, remaining);
      if (fw < FIELD_MIN_W) { lines += 1; cursor = 0; fw = Math.min(FIELD_MAX_W, width); }
      cursor += fw;
      lineStart = false;
      continue;
    }
    const w = flow.font(t.bold, t.italic).widthOfTextAtSize(t.text, size);
    if (!lineStart && cursor + w > width) { lines += 1; cursor = 0; }
    cursor += w;
    lineStart = false;
  }
  return lines * lineH;
}

// ── Blocks ───────────────────────────────────────────────────────────────────

function renderParagraph(flow, block) {
  const spec = ROLES[block.role] || ROLES.body;

  if (block.pageBreakBefore && flow.y < A4.h - MARGIN - 1) flow.newPage();

  if (!block.segments.length) { flow.y -= spec.size * 0.6; return; }

  flow.y -= spec.before;
  flow.need(spec.size * spec.leading);

  let x = MARGIN;
  let width = CONTENT_W;
  if (spec.bullet) {
    flow.need(spec.size * spec.leading);
    flow.page.drawText('•', {
      x: MARGIN, y: flow.y, size: spec.size, font: flow.fonts.regular, color: SECONDARY(),
    });
    x = MARGIN + 14;
    width = CONTENT_W - 14;
  }

  layoutTokens(flow, tokenise(block.segments), x, width, block.role);
  flow.y -= spec.after;
}

function renderTable(flow, block) {
  const rows = block.rows.filter((r) => r.cells.length);
  if (!rows.length) return;

  const cols = Math.max(...rows.map((r) => r.cells.length));
  const colW = CONTENT_W / cols;

  for (const row of rows) {
    // Every cell's tokens, and the height the tallest one needs.
    const cells = [];
    let rowH = 0;
    for (let i = 0; i < cols; i++) {
      const paras = row.cells[i] || [];
      const toks = paras.map((segs) => tokenise(segs));
      const h = toks.reduce(
        (acc, t) => acc + measureTokens(flow, t, colW - CELL_PAD * 2, 'body'), 0
      );
      cells.push(toks);
      rowH = Math.max(rowH, h);
    }
    rowH = Math.max(rowH + CELL_PAD * 2, 18);

    // A row is never split across a page: half a table row is unreadable.
    if (flow.y - rowH < MARGIN + 24) flow.newPage();

    const top = flow.y;
    if (row.header) {
      flow.page.drawRectangle({
        x: MARGIN, y: top - rowH, width: CONTENT_W, height: rowH, color: MINT(),
      });
    }

    for (let i = 0; i < cols; i++) {
      const cx = MARGIN + colW * i;
      flow.page.drawRectangle({
        x: cx, y: top - rowH, width: colW, height: rowH,
        borderColor: SECONDARY(), borderWidth: 0.5,
      });
      flow.y = top - CELL_PAD - 8;
      for (const toks of cells[i]) {
        layoutTokens(flow, toks, cx + CELL_PAD, colW - CELL_PAD * 2, row.header ? 'emphasis' : 'body');
      }
    }

    flow.y = top - rowH;
  }
  flow.y -= 8;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * @param {object} model   from templates/document-model.js
 * @param {string} title   the PDF's own title metadata
 * @param {string} footer  the line stamped on every page, before the page number
 */
async function renderTemplatePdf({ model, title = 'Document', footer = '' } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor('Opal Therapy');
  pdf.setProducer('Opal Therapy Portal');
  pdf.setLanguage('en-AU');

  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };

  const flow = new Flow(pdf, fonts, footer);

  for (const block of model.blocks) {
    if (block.type === 'paragraph') renderParagraph(flow, block);
    else if (block.type === 'table') renderTable(flow, block);
  }

  flow.stampFooters();

  // A viewer that will not trust our appearance streams still has to draw what
  // the user types, so the document asks it to generate its own.
  flow.form.acroForm.dict.set(
    require('pdf-lib').PDFName.of('NeedAppearances'),
    require('pdf-lib').PDFBool.True
  );
  try { flow.form.updateFieldAppearances(fonts.regular); } catch (_) { /* appearances stay as built */ }

  return Buffer.from(await pdf.save({ updateFieldAppearances: false }));
}

module.exports = { renderTemplatePdf, ROLES, A4, MARGIN, CONTENT_W };
