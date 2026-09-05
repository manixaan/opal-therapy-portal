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
 * out of those bytes means the two downloads cannot disagree — an edited
 * clause, a removed condition, a changed closing date all reach the PDF
 * because they are in the file it was read from.
 *
 * ── How it renders ──────────────────────────────────────────────────────────
 * This is the letter's own design, not a generic export: the logo embedded in
 * the .docx, the letterhead rule, the Opal green headings, the particulars
 * table with its dark label column and banded rows, numbered conditions with
 * their bold leads, justified body text, the running header on the pages after
 * the first and the confidential footer. Colours, sizes and spacing are read
 * from the letter's styles where they are stated and mirrored from the
 * template where they are not. Word remains the master for exact pagination.
 *
 * The acceptance block at the end is a form: every empty cell beside a label
 * (Full Name, Signature, Date, …) becomes a real PDF text field, so the
 * candidate can type into the PDF and return it without printing.
 */

const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const { PDFDocument, StandardFonts, rgb, PDFName, PDFBool } = require('pdf-lib');
const { toWinAnsi } = require('./interview-pdf');

const PDF_FOOTER = 'Opal Therapy | Confidential | Letter of Offer';
const PDF_MIME = 'application/pdf';

/** The letter's paragraph styles → what they are. */
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
  OPALTableHeader: 'th',
  OPALTableBody: 'td',
};

// ── The Opal letter palette (from the template's styles) ────────────────────
const C = {
  green: '2F5651', ink: '263633', soft: '566E70', footer: '62716E', rule: 'BFCDCE', grid: 'D9E2DE',
  band: 'F4F7F5', white: 'FFFFFF', headerText: '2F5550',
};
const hex = (h) => rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);

/** How each role prints: size in pt, gaps in pt (from the styles' w:spacing). */
const ROLES = {
  title:    { size: 30, bold: true, colour: C.green, before: 0, after: 8, leading: 1.2, align: 'center' },
  subtitle: { size: 13, colour: C.soft, before: 0, after: 12, leading: 1.2, align: 'center' },
  h1:       { size: 19, bold: true, colour: C.green, before: 16, after: 8, leading: 1.15 },
  h2:       { size: 14, bold: true, colour: C.green, before: 11, after: 4, leading: 1.2 },
  h3:       { size: 11.5, bold: true, colour: C.soft, before: 10, after: 3, leading: 1.2 },
  body:     { size: 10.5, colour: C.ink, before: 0, after: 5, leading: 1.15 },
  emphasis: { size: 10.5, bold: true, colour: C.green, before: 0, after: 5, leading: 1.15 },
  list:     { size: 10, colour: C.ink, before: 0, after: 2.5, leading: 1.15, indent: 27, hang: 13, bullet: true },
  numbered: { size: 10, colour: C.ink, before: 0, after: 2.5, leading: 1.15, indent: 27, hang: 13 },
  th:       { size: 9, bold: true, colour: C.white, before: 0, after: 0, leading: 1.2 },
  td:       { size: 9, colour: C.ink, before: 0, after: 0, leading: 1.25 },
};

// ── Reading the .docx ────────────────────────────────────────────────────────

function kids(el, name) {
  const out = [];
  for (let n = el && el.firstChild; n; n = n.nextSibling) if (!name || n.nodeName === name) out.push(n);
  return out;
}
const kid = (el, name) => kids(el, name)[0] || null;
const attr = (el, name) => (el ? el.getAttribute(name) : null);
const twips = (v) => (v == null || v === '' ? null : Number(v) / 20);

function readRuns(container, segments, inherited) {
  for (const n of kids(container)) {
    if (n.nodeName === 'w:r') {
      const rPr = kid(n, 'w:rPr');
      const fmt = {
        bold: inherited.bold || Boolean(rPr && kid(rPr, 'w:b')),
        italic: inherited.italic || Boolean(rPr && kid(rPr, 'w:i')),
        underline: Boolean(rPr && kid(rPr, 'w:u')),
        colour: attr(kid(rPr, 'w:color'), 'w:val'),
      };
      let text = '';
      for (const c of kids(n)) {
        if (c.nodeName === 'w:t') text += c.textContent || '';
        else if (c.nodeName === 'w:tab') text += '  ';
        else if (c.nodeName === 'w:br') { push(segments, { type: 'text', text, ...fmt }); push(segments, { type: 'break' }); text = ''; }
        else if (c.nodeName === 'w:drawing') segments.image = readImage(c);
      }
      push(segments, { type: 'text', text, ...fmt });
    } else if (n.nodeName === 'w:sdt') {
      // A filled control reads as the text it holds.
      const content = kid(n, 'w:sdtContent');
      if (content) readRuns(content, segments, inherited);
    } else if (n.nodeName === 'w:hyperlink' || n.nodeName === 'w:smartTag' || n.nodeName === 'w:ins') {
      readRuns(n, segments, inherited);
    }
  }
}
function push(segments, seg) {
  if (seg.type === 'text' && !seg.text) return;
  const last = segments[segments.length - 1];
  if (seg.type === 'text' && last && last.type === 'text' && last.bold === seg.bold && last.italic === seg.italic && last.underline === seg.underline && last.colour === seg.colour) { last.text += seg.text; return; }
  segments.push(seg);
}
function readImage(drawing) {
  const blip = drawing.getElementsByTagName('a:blip')[0];
  const extent = drawing.getElementsByTagName('wp:extent')[0];
  if (!blip) return null;
  return { rId: attr(blip, 'r:embed'), w: extent ? Number(attr(extent, 'cx')) / 12700 : 72, h: extent ? Number(attr(extent, 'cy')) / 12700 : 72 };
}

function readParagraph(p) {
  const pPr = kid(p, 'w:pPr');
  const style = attr(kid(pPr, 'w:pStyle'), 'w:val') || '';
  const jc = attr(kid(pPr, 'w:jc'), 'w:val') || null;
  const numPr = kid(pPr, 'w:numPr');
  const pBdr = kid(pPr, 'w:pBdr');
  const bottom = pBdr && kid(pBdr, 'w:bottom');
  const spacing = kid(pPr, 'w:spacing');
  const segments = [];
  readRuns(p, segments, {});
  return {
    type: 'paragraph', style, segments, jc,
    numbered: Boolean(numPr) || STYLE_ROLES[style] === 'numbered',
    image: segments.image || null,
    ruleBelow: bottom ? { colour: attr(bottom, 'w:color') || C.rule, space: Number(attr(bottom, 'w:space') || 0) } : null,
    after: twips(attr(spacing, 'w:after')),
    pageBreakBefore: Boolean(pPr && kid(pPr, 'w:pageBreakBefore')),
  };
}

function readTable(tbl) {
  const grid = kid(tbl, 'w:tblGrid');
  const widths = kids(grid, 'w:gridCol').map((g) => Number(attr(g, 'w:w') || 0));
  const rows = [];
  for (const tr of kids(tbl, 'w:tr')) {
    const trPr = kid(tr, 'w:trPr');
    const header = Boolean(trPr && kid(trPr, 'w:tblHeader'));
    const cells = []; const props = [];
    for (const tc of kids(tr, 'w:tc')) {
      const tcPr = kid(tc, 'w:tcPr');
      const fill = attr(kid(tcPr, 'w:shd'), 'w:fill');
      const paras = [];
      for (const b of kids(tc)) {
        if (b.nodeName === 'w:p') paras.push(readParagraph(b));
        else if (b.nodeName === 'w:sdt') { const c = kid(b, 'w:sdtContent'); if (c) for (const p of kids(c, 'w:p')) paras.push(readParagraph(p)); }
      }
      props.push({ fill: fill && fill !== 'auto' ? fill : null, width: Number(attr(kid(tcPr, 'w:tcW'), 'w:w') || 0) });
      cells.push(paras.map((p) => p.segments));
      if (!cells.paras) cells.paras = [];
      cells.paras.push(paras);
    }
    if (cells.length) rows.push({ header, cells, props, paras: cells.paras });
  }
  return { type: 'table', rows, widths };
}

function readHeaderText(xml) {
  if (!xml) return '';
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const segs = [];
  for (const p of Array.from(doc.getElementsByTagName('w:p'))) readRuns(p, segs, {});
  return segs.filter((s) => s.type === 'text').map((s) => s.text).join('').trim();
}

const hasText = (b) => b.type === 'table' || b.segments.some((s) => s.type === 'text' && s.text.trim() !== '');

/** The document model the PDF is rendered from. */
async function offerPdfModel(docxBytes) {
  const zip = await JSZip.loadAsync(docxBytes);
  const part = zip.file('word/document.xml');
  if (!part) throw new Error('letter pdf: word/document.xml is missing');
  const doc = new DOMParser().parseFromString(await part.async('string'), 'text/xml');
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) throw new Error('letter pdf: the document has no body');

  // Page geometry from the section properties.
  const sectPr = kid(body, 'w:sectPr');
  const pgSz = kid(sectPr, 'w:pgSz'); const pgMar = kid(sectPr, 'w:pgMar');
  const page = {
    w: twips(attr(pgSz, 'w:w')) || 595.28, h: twips(attr(pgSz, 'w:h')) || 841.89,
    top: twips(attr(pgMar, 'w:top')) || 52, bottom: twips(attr(pgMar, 'w:bottom')) || 49,
    left: twips(attr(pgMar, 'w:left')) || 58, right: twips(attr(pgMar, 'w:right')) || 58,
  };

  // Images referenced from the body, by relationship id.
  const images = {};
  const rels = await zip.file('word/_rels/document.xml.rels')?.async('string');
  if (rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = (m[0].match(/\bId="([^"]+)"/) || [])[1];
      const target = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
      if (id && target && /\.(png|jpe?g)$/i.test(target)) {
        const file = zip.file('word/' + target.replace(/^\/?word\//, '').replace(/^\//, ''));
        if (file) images[id] = { bytes: await file.async('nodebuffer'), png: /\.png$/i.test(target) };
      }
    }
  }

  // The running header: the default one (pages after the first when titlePg is set).
  let header = '';
  const headerRefs = kids(sectPr, 'w:headerReference');
  const def = headerRefs.find((h) => attr(h, 'w:type') === 'default');
  if (def && rels) {
    const target = (rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${attr(def, 'r:id')}"[^>]*>`)) || [''])[0].match(/\bTarget="([^"]+)"/);
    if (target) header = readHeaderText(await zip.file('word/' + target[1])?.async('string'));
  }

  const blocks = [];
  let counter = 0;
  for (const el of kids(body)) {
    if (el.nodeName === 'w:tbl') { blocks.push(readTable(el)); counter = 0; continue; }
    if (el.nodeName !== 'w:p') continue;
    const block = readParagraph(el);
    const role = STYLE_ROLES[block.style] || 'body';
    if (role === 'numbered') {
      if (!hasText(block)) continue; // a dropped condition leaves no gap in the numbering
      counter += 1;
      const first = block.segments.find((s) => s.type === 'text');
      block.segments.splice(block.segments.indexOf(first), 0, { type: 'text', text: `${counter}.  `, bold: false, italic: false, underline: false, colour: C.green, marker: true });
      blocks.push({ ...block, role: 'numbered' });
      continue;
    }
    counter = 0;
    blocks.push({ ...block, role });
  }
  while (blocks.length && blocks[0].type === 'paragraph' && !hasText(blocks[0]) && !blocks[0].image) blocks.shift();
  return { blocks, fields: [], page, images, header };
}

// ── Rendering ────────────────────────────────────────────────────────────────

class Flow {
  constructor(pdf, fonts, model, footer) {
    this.pdf = pdf; this.fonts = fonts; this.model = model; this.footer = footer;
    this.pg = model.page; this.pages = []; this.page = null; this.y = 0;
    this.contentW = this.pg.w - this.pg.left - this.pg.right;
    this.form = pdf.getForm(); this.fieldNames = new Set();
    this.newPage();
  }
  /** A fillable text field sized to a table cell. */
  field(label, x, y, width, height) {
    const base = String(label || 'Field').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 60) || 'Field';
    let name = base; let n = 2;
    while (this.fieldNames.has(name)) name = `${base} ${n++}`;
    this.fieldNames.add(name);
    const f = this.form.createTextField(name);
    f.addToPage(this.page, { x, y, width, height, borderWidth: 0, backgroundColor: hex(C.white), textColor: hex(C.ink), font: this.fonts.regular });
    f.setFontSize(10);
    return f;
  }
  newPage() {
    this.page = this.pdf.addPage([this.pg.w, this.pg.h]);
    this.pages.push(this.page);
    this.y = this.pg.h - this.pg.top;
    if (this.pages.length > 1 && this.model.header) {
      const f = this.fonts.regular; const size = 7.5;
      const w = f.widthOfTextAtSize(toWinAnsi(this.model.header), size);
      this.page.drawText(toWinAnsi(this.model.header), { x: this.pg.w - this.pg.right - w, y: this.pg.h - 24, size, font: f, color: hex(C.headerText) });
      this.y -= 6;
    }
  }
  need(h) { if (this.y - h < this.pg.bottom + 14) this.newPage(); }
  font(bold, italic) {
    if (bold && italic) return this.fonts.boldItalic;
    if (bold) return this.fonts.bold;
    if (italic) return this.fonts.italic;
    return this.fonts.regular;
  }
  stampFooters() {
    const total = this.pages.length; const size = 7.5; const f = this.fonts.regular;
    this.pages.forEach((page, i) => {
      const y = this.pg.bottom - 18;
      page.drawLine({ start: { x: this.pg.left, y: y + 12 }, end: { x: this.pg.w - this.pg.right, y: y + 12 }, thickness: 0.5, color: hex(C.rule) });
      page.drawText(toWinAnsi(this.footer), { x: this.pg.left, y, size, font: f, color: hex(C.footer) });
      const pn = `Page ${i + 1} of ${total}`;
      page.drawText(pn, { x: this.pg.w - this.pg.right - f.widthOfTextAtSize(pn, size), y, size, font: f, color: hex(C.footer) });
    });
  }
}

/** Words with their formatting, so a bold lead and its plain tail share a line. */
function tokenise(segments) {
  const out = [];
  for (const seg of segments) {
    if (seg.type === 'break') { out.push({ kind: 'break' }); continue; }
    if (seg.type !== 'text') continue;
    for (const part of toWinAnsi(seg.text).split(/(\s+)/)) {
      if (part === '') continue;
      out.push({ kind: /^\s+$/.test(part) ? 'space' : 'word', text: part, bold: seg.bold, italic: seg.italic, underline: seg.underline, colour: seg.colour, marker: seg.marker });
    }
  }
  return out;
}

/** Lay tokens into lines of at most `width`. Returns [{ tokens, width }]. */
function breakLines(flow, tokens, width, size) {
  const lines = []; let line = []; let lineW = 0;
  const w = (t) => flow.font(t.bold, t.italic).widthOfTextAtSize(t.text, size);
  const flush = () => { while (line.length && line[line.length - 1].kind === 'space') { lineW -= w(line.pop()); } lines.push({ tokens: line, width: lineW }); line = []; lineW = 0; };
  for (const t of tokens) {
    if (t.kind === 'break') { flush(); continue; }
    if (t.kind === 'space') { if (line.length) { line.push(t); lineW += w(t); } continue; }
    const tw = w(t);
    if (line.length && lineW + tw > width) flush();
    line.push(t); lineW += tw;
  }
  if (line.length) flush();
  return lines;
}

function drawLines(flow, lines, x, width, size, spec, opts = {}) {
  const lineH = size * spec.leading;
  const justify = opts.align === 'both';
  lines.forEach((ln, i) => {
    flow.need(lineH);
    let cx = x;
    if (spec.align === 'center' || opts.align === 'center') cx = x + (width - ln.width) / 2;
    else if (opts.align === 'right') cx = x + width - ln.width;
    const spaces = ln.tokens.filter((t) => t.kind === 'space').length;
    const extra = justify && i < lines.length - 1 && spaces ? (width - ln.width) / spaces : 0;
    const baseline = flow.y - size;
    for (const t of ln.tokens) {
      const f = flow.font(spec.bold || t.bold, t.italic);
      const tw = f.widthOfTextAtSize(t.text, size) + (t.kind === 'space' ? extra : 0);
      if (t.kind === 'word') {
        const colour = t.marker ? hex(C.green) : hex(spec.colour);
        flow.page.drawText(t.text, { x: cx, y: baseline, size, font: f, color: colour });
        if (t.underline) flow.page.drawLine({ start: { x: cx, y: baseline - 1.5 }, end: { x: cx + tw, y: baseline - 1.5 }, thickness: 0.6, color: colour });
      }
      cx += tw;
    }
    flow.y -= lineH;
  });
}

function renderParagraph(flow, block) {
  const spec = ROLES[block.role] || ROLES.body;
  const pg = flow.pg;
  if (block.pageBreakBefore && flow.y < pg.h - pg.top - 1) flow.newPage();

  if (block.image) {
    const img = flow.model.images[block.image.rId];
    if (img) {
      const embedded = flow.model.embedded[block.image.rId];
      const w = block.image.w, h = block.image.h;
      flow.need(h + 6);
      flow.page.drawImage(embedded, { x: pg.left, y: flow.y - h, width: w, height: h });
      flow.y -= h + (block.after != null ? block.after : 3);
    }
    if (!hasText(block)) return;
  }

  if (!hasText(block)) { flow.y -= spec.size * 0.7; return; }

  flow.y -= spec.before;
  const isLetterhead = block.ruleBelow && block.role === 'body';
  const size = isLetterhead ? 11 : spec.size;
  const drawSpec = isLetterhead ? { ...spec, bold: true, colour: C.green } : spec;

  let x = pg.left; let width = flow.contentW;
  if (spec.indent) {
    flow.need(size * spec.leading);
    x = pg.left + spec.indent; width = flow.contentW - spec.indent;
    if (spec.bullet) flow.page.drawText('•', { x: pg.left + spec.indent - spec.hang, y: flow.y - size, size, font: flow.fonts.regular, color: hex(C.green) });
  }
  const tokens = tokenise(block.segments);
  if (block.role === 'numbered' && tokens[0] && tokens[0].marker) {
    // The number hangs in the margin; the text starts at the indent.
    const m = tokens.shift(); if (tokens[0] && tokens[0].kind === 'space') tokens.shift();
    flow.page.drawText(m.text.trim(), { x: pg.left + spec.indent - spec.hang, y: flow.y - size, size, font: flow.fonts.regular, color: hex(C.green) });
  }
  const lines = breakLines(flow, tokens, width, size);
  drawLines(flow, lines, x, width, size, drawSpec, { align: block.jc });

  if (block.ruleBelow) {
    const y = flow.y - (block.ruleBelow.space || 0) * 0.75;
    flow.page.drawLine({ start: { x: pg.left, y }, end: { x: pg.w - pg.right, y }, thickness: 0.75, color: hex(block.ruleBelow.colour) });
    flow.y = y - 2;
  }
  flow.y -= block.after != null ? block.after : spec.after;
}

const CELL_PAD_X = 6; const CELL_PAD_Y = 5;

function renderTable(flow, block) {
  const rows = block.rows.filter((r) => r.cells.length);
  if (!rows.length) return;
  const pg = flow.pg;
  const cols = Math.max(...rows.map((r) => r.cells.length));
  const total = block.widths.reduce((a, b) => a + b, 0);
  const colW = block.widths.length === cols && total ? block.widths.map((w) => (w / total) * flow.contentW) : Array(cols).fill(flow.contentW / cols);

  flow.y -= 4;
  rows.forEach((row, ri) => {
    const laid = []; let rowH = 0;
    for (let i = 0; i < cols; i++) {
      const paras = row.paras[i] || [];
      const cellLines = paras.map((p) => {
        const role = STYLE_ROLES[p.style] === 'th' ? 'th' : 'td';
        const spec = ROLES[role];
        return { spec, lines: breakLines(flow, tokenise(p.segments), colW[i] - CELL_PAD_X * 2, spec.size), jc: p.jc };
      });
      const h = cellLines.reduce((acc, c) => acc + c.lines.length * c.spec.size * c.spec.leading, 0);
      laid.push(cellLines); rowH = Math.max(rowH, h);
    }
    rowH = Math.max(rowH + CELL_PAD_Y * 2, 20);
    // A fill-in row (label + empty cell) gets room to write in.
    if (row.paras.length > 1 && !row.paras.slice(1).some((paras) => paras.some((p) => p.segments.some((s) => s.type === 'text' && s.text.trim())))) rowH = Math.max(rowH, 26);
    if (flow.y - rowH < pg.bottom + 14) flow.newPage();
    const top = flow.y;
    let cx = pg.left;
    for (let i = 0; i < cols; i++) {
      const props = (row.props || [])[i] || {};
      const fill = props.fill || (ri % 2 === 1 ? C.band : null);
      if (fill) flow.page.drawRectangle({ x: cx, y: top - rowH, width: colW[i], height: rowH, color: hex(fill) });
      flow.page.drawRectangle({ x: cx, y: top - rowH, width: colW[i], height: rowH, borderColor: hex(C.grid), borderWidth: 0.5 });
      // Text sits vertically centred in the row, as the template's cells do.
      const textH = laid[i].reduce((acc, c) => acc + c.lines.length * c.spec.size * c.spec.leading, 0);
      const empty = !laid[i].some((c) => c.lines.some((ln) => ln.tokens.some((t) => t.kind === 'word')));
      const labelText = i > 0 ? (row.paras[0] || []).map((p) => p.segments.filter((s) => s.type === 'text').map((s) => s.text).join('')).join(' ').trim() : '';
      if (empty && i > 0 && labelText) {
        // An empty cell beside a label is for the candidate to fill in.
        flow.field(labelText, cx + 2, top - rowH + 2, colW[i] - 4, rowH - 4);
      } else {
        flow.y = top - (rowH - textH) / 2;
        for (const c of laid[i]) drawLines(flow, c.lines, cx + CELL_PAD_X, colW[i] - CELL_PAD_X * 2, c.spec.size, c.spec, { align: c.jc });
      }
      cx += colW[i];
    }
    flow.y = top - rowH;
  });
  flow.page.drawRectangle({ x: pg.left, y: flow.y, width: flow.contentW, height: 0, borderColor: hex(C.rule), borderWidth: 0.75 });
  flow.y -= 10;
}

async function renderLetterPdf({ model, title, footer }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title); pdf.setAuthor('Opal Therapy'); pdf.setProducer('Opal Therapy Portal'); pdf.setLanguage('en-AU');
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  model.embedded = {};
  for (const [id, img] of Object.entries(model.images)) {
    try { model.embedded[id] = img.png ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes); } catch (_) { delete model.images[id]; }
  }
  const flow = new Flow(pdf, fonts, model, footer);
  for (const block of model.blocks) {
    if (block.type === 'paragraph') renderParagraph(flow, block);
    else if (block.type === 'table') renderTable(flow, block);
  }
  flow.stampFooters();
  if (flow.fieldNames.size) {
    // A viewer that will not trust our appearance streams still has to draw
    // what the candidate types, so the document asks it to generate its own.
    flow.form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
    try { flow.form.updateFieldAppearances(fonts.regular); } catch (_) { /* appearances stay as built */ }
  }
  return Buffer.from(await pdf.save({ updateFieldAppearances: false }));
}

/**
 * @param {Buffer} docxBytes  the letter — generated or uploaded
 * @param {{ title?: string, footer?: string }} [opts]
 */
async function offerPdfFromDocx(docxBytes, { title = 'Letter of Offer', footer = PDF_FOOTER } = {}) {
  const model = await offerPdfModel(docxBytes);
  return renderLetterPdf({ model, title, footer });
}

/** `Letter of Offer - Jane Smith - Opal Therapy - 2026-09-03.docx` → the same name, `.pdf`. */
function pdfFileName(docxName) {
  return String(docxName || 'Letter of Offer').replace(/\.docx$/i, '') + '.pdf';
}

module.exports = { offerPdfFromDocx, offerPdfModel, pdfFileName, STYLE_ROLES, PDF_FOOTER, PDF_MIME };
