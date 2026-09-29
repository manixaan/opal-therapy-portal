'use strict';

/**
 * INVOICE PDF — a professional Opal Therapy tax invoice (pdf-lib, A4).
 *
 * Pure rendering: takes an invoice view model (already-calculated money as
 * strings) and returns PDF bytes. It performs no arithmetic beyond laying out
 * the stored figures, so the PDF can never disagree with the database.
 * The client-facing copy is concise — calculation detail stays in the portal.
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { toWinAnsi } = require('../interview-pdf');

const LOGO_PNG = path.join(__dirname, '..', 'assets', 'opal-therapy-logo.png');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;

const hex = h => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  band: hex('#0f7c6c'),
  ink: hex('#1f2a2e'),
  muted: hex('#5d6b70'),
  rule: hex('#d7dcdc'),
  heavy: hex('#1f2a2e'),
  soft: hex('#f3f6f5'),
  draft: hex('#c2412e'),
};

function money(v) {
  const n = String(v == null ? '0.00' : v);
  const [w, f = '00'] = n.replace('-', '').split('.');
  return `${n.startsWith('-') ? '-' : ''}${w.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(f + '00').slice(0, 2)}`;
}

function qty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  // Show 2 dp unless more precision is needed to reproduce the amount.
  const s4 = n.toFixed(4);
  return s4.endsWith('00') ? n.toFixed(2) : s4.replace(/0+$/, '');
}

function wrap(text, font, size, maxWidth) {
  const words = toWinAnsi(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) <= maxWidth) cur = t;
    else {
      if (cur) lines.push(cur);
      // hard-break a single over-long word
      let word = w;
      while (font.widthOfTextAtSize(word, size) > maxWidth && word.length > 1) {
        let k = word.length;
        while (k > 1 && font.widthOfTextAtSize(word.slice(0, k), size) > maxWidth) k--;
        lines.push(word.slice(0, k));
        word = word.slice(k);
      }
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/**
 * @param {object} vm
 * @param {object} vm.business   {name, abn, email, phone, address, paymentDetails, footer}
 * @param {object} vm.invoice    {invoiceNumber, status, issueDate, dueDate, clientName, ndisNumber,
 *                               payerName, payerReference, payerAddress, practitionerNames,
 *                               subtotal, gstTotal, total, amountPaid, outstanding, taxTreatment, notes}
 * @param {Array}  vm.lines      [{itemCode, description, unitPrice, quantity, gstRate, amount}]
 * @param {boolean} [vm.draft]   watermark "DRAFT"
 */
async function renderInvoicePdf(vm) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Tax Invoice ${vm.invoice.invoiceNumber}`);
  pdf.setAuthor(vm.business.name || 'Opal Therapy');
  pdf.setCreator('Opal Therapy Portal');
  const f = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  let logo = null;
  try { logo = await pdf.embedPng(fs.readFileSync(LOGO_PNG)); } catch (_) { logo = null; }

  const pages = [];
  let page, y;
  const text = (s, x, yy, { font = f.regular, size = 10, color = C.ink } = {}) =>
    page.drawText(toWinAnsi(s), { x, y: yy, size, font, color });
  const rightText = (s, xRight, yy, opts = {}) => {
    const font = opts.font || f.regular; const size = opts.size || 10;
    text(s, xRight - font.widthOfTextAtSize(toWinAnsi(s), size), yy, opts);
  };

  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE_H - 10, width: PAGE_W, height: 10, color: C.band });
    if (vm.draft) {
      page.drawText('DRAFT', { x: 150, y: 330, size: 120, font: f.bold, color: C.draft, opacity: 0.08, rotate: { type: 'degrees', angle: 35 } });
    }
    y = PAGE_H - MARGIN - 10;
  }

  // ── Header ──
  newPage();
  text('Tax Invoice', MARGIN, y - 22, { font: f.bold, size: 24 });
  if (logo) {
    const h = 70; const w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: PAGE_W - MARGIN - w, y: y - 62, width: w, height: h });
  }
  y -= 96;

  // ── Parties grid (3 columns) ──
  const colW = (PAGE_W - 2 * MARGIN) / 3;
  const inv = vm.invoice;
  const cols = [
    [
      ['Client', [inv.clientName || '—', inv.ndisNumber ? `NDIS Number: ${inv.ndisNumber}` : 'NDIS Number: not recorded']],
      ['Invoice to', [inv.payerName || 'Recipient not set', inv.payerReference ? `Ref: ${inv.payerReference}` : null, inv.payerAddress || null].filter(Boolean)],
    ],
    [
      ['From', [vm.business.name || 'Opal Therapy']],
      ['ABN', [vm.business.abn || 'ABN not set']],
      ['Provider', [inv.practitionerNames || '—']],
    ],
    [
      ['Invoice #', [inv.invoiceNumber]],
      ['Issue date', [inv.issueDate]],
      ['Due date', [inv.dueDate || '—']],
    ],
  ];
  let lowest = y;
  cols.forEach((blocks, ci) => {
    let cy = y;
    const x = MARGIN + ci * colW;
    for (const [label, values] of blocks) {
      text(label, x, cy, { font: f.bold, size: 10 });
      cy -= 14;
      for (const v of values) {
        for (const ln of wrap(v, f.regular, 10, colW - 12)) { text(ln, x, cy, { size: 10, color: C.ink }); cy -= 13; }
      }
      cy -= 10;
    }
    lowest = Math.min(lowest, cy);
  });
  y = lowest - 8;

  // ── Line table ──
  const X = { code: MARGIN, desc: MARGIN + 104, unitR: PAGE_W - MARGIN - 170, qtyR: PAGE_W - MARGIN - 110, gstR: PAGE_W - MARGIN - 70, amtR: PAGE_W - MARGIN };
  const descW = X.unitR - X.desc - 60;
  function tableHeader() {
    text('Item code', X.code, y, { font: f.bold, size: 9 });
    text('Description', X.desc, y, { font: f.bold, size: 9 });
    rightText('Unit price', X.unitR, y, { font: f.bold, size: 9 });
    rightText('Quantity', X.qtyR, y, { font: f.bold, size: 9 });
    rightText('GST', X.gstR, y, { font: f.bold, size: 9 });
    rightText('Amount AUD', X.amtR, y, { font: f.bold, size: 9 });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.2, color: C.heavy });
    y -= 16;
  }
  tableHeader();
  for (const l of vm.lines) {
    const descLines = wrap(l.description, f.regular, 9, descW);
    const codeLines = wrap(l.itemCode || '', f.regular, 8, X.desc - X.code - 6);
    const rowH = Math.max(descLines.length, codeLines.length) * 12 + 10;
    if (y - rowH < MARGIN + 150) { newPage(); tableHeader(); }
    codeLines.forEach((ln, i) => text(ln, X.code, y - i * 12, { size: 8, color: C.muted }));
    descLines.forEach((ln, i) => text(ln, X.desc, y - i * 12, { size: 9 }));
    rightText(money(l.unitPrice), X.unitR, y, { size: 9 });
    rightText(qty(l.quantity), X.qtyR, y, { size: 9 });
    rightText(`${Math.round(Number(l.gstRate || 0) * 100)}%`, X.gstR, y, { size: 9 });
    rightText(money(l.amount), X.amtR, y, { size: 9, font: f.bold });
    y -= rowH - 4;
    page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: PAGE_W - MARGIN, y: y + 6 }, thickness: 0.5, color: C.rule });
    y -= 8;
  }

  // ── Totals ──
  if (y < MARGIN + 170) newPage();
  const totals = [
    ['Subtotal', money(inv.subtotal)],
    [inv.taxTreatment === 'GST_10_EXCLUSIVE' ? 'GST 10%' : 'GST (GST-free supply)', money(inv.gstTotal)],
    ['Total AUD', money(inv.total)],
    ['Amount paid', money(inv.amountPaid)],
    ['Amount due AUD', money(inv.outstanding)],
  ];
  y -= 6;
  for (const [label, val] of totals) {
    const strong = label.startsWith('Total') || label.startsWith('Amount due');
    rightText(label, X.gstR, y, { font: strong ? f.bold : f.regular, size: strong ? 11 : 10 });
    rightText(val, X.amtR, y, { font: strong ? f.bold : f.regular, size: strong ? 11 : 10 });
    y -= strong ? 18 : 15;
  }

  // ── Payment details / notes ──
  y -= 10;
  const blocks = [];
  if (vm.business.paymentDetails) blocks.push(['Payment details', vm.business.paymentDetails]);
  if (inv.notes) blocks.push(['Notes', inv.notes]);
  for (const [label, body] of blocks) {
    if (y < MARGIN + 80) newPage();
    text(label, MARGIN, y, { font: f.bold, size: 10 });
    y -= 14;
    for (const para of String(body).split('\n')) {
      for (const ln of wrap(para, f.regular, 9, PAGE_W - 2 * MARGIN)) {
        if (y < MARGIN + 40) newPage();
        text(ln, MARGIN, y, { size: 9, color: C.muted }); y -= 12;
      }
    }
    y -= 8;
  }

  // ── Footer on every page ──
  const contact = [vm.business.name, vm.business.abn ? `ABN ${vm.business.abn}` : null, vm.business.phone, vm.business.email, vm.business.address]
    .filter(Boolean).join('  ·  ');
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 18 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 18 }, thickness: 0.5, color: C.rule });
    const foot = wrap(vm.business.footer || contact, f.regular, 7.5, PAGE_W - 2 * MARGIN - 70)[0];
    p.drawText(foot, { x: MARGIN, y: MARGIN + 6, size: 7.5, font: f.regular, color: C.muted });
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pg, { x: PAGE_W - MARGIN - f.regular.widthOfTextAtSize(pg, 7.5), y: MARGIN + 6, size: 7.5, font: f.regular, color: C.muted });
  });

  return Buffer.from(await pdf.save());
}

module.exports = { renderInvoicePdf };
