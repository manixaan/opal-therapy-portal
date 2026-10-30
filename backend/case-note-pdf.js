'use strict';

/**
 * CASE NOTE PDF — the therapist's saved note on Opal Therapy letterhead
 * (pdf-lib, A4). Same idiom as billing/invoice-pdf.js.
 *
 * Pure rendering: takes the stored header snapshot and the stored note text
 * and returns PDF bytes. The note text is the therapist's own wording — this
 * file only lays it out, it never rewrites or adds clinical content:
 *   - the leading client name / address lines become the letterhead block
 *   - "Therapy Session" becomes the title, "Service: …" the service line
 *   - a short line ending in ":" ("Identify:", "Plan:") becomes a heading
 *   - "- " / "• " lines become bullets; a short "Label:" lead is set in bold
 *   - everything else is a wrapped paragraph
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { toWinAnsi } = require('./interview-pdf');

const LOGO_PNG = path.join(__dirname, 'assets', 'opal-therapy-logo.png');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 52;
const BOTTOM = 64;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const hex = h => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  band: hex('#0f7c6c'),
  ink: hex('#1f2a2e'),
  heading: hex('#0f5f54'),
  muted: hex('#5d6b70'),
  rule: hex('#d7dcdc'),
};

const BODY = 10.5;
const LEADING = 14.5;

function wrap(text, font, size, maxWidth) {
  const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) <= maxWidth) cur = t;
    else {
      if (cur) lines.push(cur);
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

const isHeading = line => /^[A-Za-z][^.!?:]{0,40}:$/.test(line);
const BULLET_RE = /^\s*(?:[-•*]|\d+[.)])\s+/;
/** A short "Label:" lead (≤ 60 chars, no sentence stop) is bolded in the PDF. */
function splitLead(text) {
  const m = /^([^.!?:]{2,60}:)\s+(.*)$/.exec(text);
  return m ? { lead: m[1], rest: m[2] } : { lead: '', rest: text };
}

/**
 * Turn stored note text into blocks. Exported for tests.
 * @returns {{name, addressLines, title, service, blocks: Array<{type, text}>}}
 */
function parseNote(noteBody, header = {}) {
  const lines = String(noteBody || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, ''));
  let i = 0;
  const skipBlank = () => { while (i < lines.length && !lines[i].trim()) i++; };
  const out = { name: header.clientName || '', addressLines: [], title: 'Therapy Session', service: '', blocks: [] };

  skipBlank();
  if (header.clientName && lines[i] && lines[i].trim() === String(header.clientName).trim()) { i++; }
  if (header.clientAddress && lines[i] && lines[i].trim() === String(header.clientAddress).trim()) { i++; }
  if (header.clientAddress) {
    // "13 Lecania St, Seville Grove WA 6112" → street / suburb on two lines
    const a = String(header.clientAddress).trim();
    const k = a.indexOf(',');
    out.addressLines = k > 0 ? [a.slice(0, k).trim(), a.slice(k + 1).trim()] : [a];
  }
  skipBlank();
  if (lines[i] && /^therapy session$/i.test(lines[i].trim())) { out.title = lines[i].trim(); i++; }
  skipBlank();
  if (lines[i] && /^service:/i.test(lines[i].trim())) {
    out.service = lines[i].trim().replace(/^service:\s*/i, '');
    i++;
  } else if (header.serviceLine) {
    out.service = header.serviceLine;
  }

  for (; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) { out.blocks.push({ type: 'gap' }); continue; }
    if (isHeading(t)) { out.blocks.push({ type: 'heading', text: t.replace(/:$/, '') }); continue; }
    if (BULLET_RE.test(t)) { out.blocks.push({ type: 'bullet', text: t.replace(BULLET_RE, '') }); continue; }
    out.blocks.push({ type: 'para', text: t });
  }
  // collapse runs of gaps and trim them from the ends
  out.blocks = out.blocks.filter((b, k, arr) => b.type !== 'gap' || (k > 0 && arr[k - 1].type !== 'gap'));
  while (out.blocks.length && out.blocks[0].type === 'gap') out.blocks.shift();
  while (out.blocks.length && out.blocks[out.blocks.length - 1].type === 'gap') out.blocks.pop();
  return out;
}

/**
 * @param {object} vm
 * @param {object} vm.header     stored header snapshot {clientName, clientAddress, serviceLine}
 * @param {string} vm.noteBody   the stored, therapist-edited note text
 * @param {string} [vm.practiceName]
 */
async function renderCaseNotePdf(vm) {
  const header = vm.header || {};
  const note = parseNote(vm.noteBody, header);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${note.title}${note.name ? ` — ${toWinAnsi(note.name)}` : ''}`);
  pdf.setAuthor(vm.practiceName || 'Opal Therapy');
  pdf.setCreator('Opal Therapy Portal');
  const f = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  let logo = null;
  try { logo = await pdf.embedPng(fs.readFileSync(LOGO_PNG)); } catch (_) { logo = null; }

  const pages = [];
  let page, y;
  const text = (s, x, yy, { font = f.regular, size = BODY, color = C.ink } = {}) =>
    page.drawText(toWinAnsi(s), { x, y: yy, size, font, color });

  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: C.band });
    y = PAGE_H - MARGIN;
    if (pages.length > 1) {
      // continuation pages carry a slim running head
      text(note.name || note.title, MARGIN, y - 4, { size: 8.5, color: C.muted });
      y -= 24;
    }
  }
  const ensure = (h) => { if (y - h < BOTTOM) newPage(); };

  // ── Letterhead ──
  newPage();
  const topY = y;
  if (logo) {
    const h = 78; const w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: PAGE_W - MARGIN - w, y: topY - h + 6, width: w, height: h });
  }
  let ly = topY - 12;
  if (note.name) { text(note.name, MARGIN, ly, { size: 15 }); ly -= 18; }
  for (const a of note.addressLines) { text(a, MARGIN, ly, { size: 9.5, color: C.muted }); ly -= 12.5; }
  y = Math.min(ly, topY - 78) - 22;

  text(note.title, MARGIN, y, { font: f.bold, size: 18 });
  y -= 22;
  if (note.service) {
    const label = 'Service: ';
    const lw = f.bold.widthOfTextAtSize(label, 9.5);
    const sl = wrap(note.service, f.regular, 9.5, CONTENT_W - lw);
    sl.forEach((ln, k) => {
      if (k === 0) text(label, MARGIN, y, { font: f.bold, size: 9.5 });
      text(ln, MARGIN + lw, y, { size: 9.5 });
      y -= 13;
    });
  }
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: C.rule });
  y -= 22;

  // ── Body ──
  for (const b of note.blocks) {
    if (b.type === 'gap') { y -= 6; continue; }
    if (b.type === 'heading') {
      ensure(48);
      y -= 6;
      text(b.text, MARGIN, y, { size: 14, color: C.heading });
      y -= 20;
      continue;
    }
    const indent = b.type === 'bullet' ? 14 : 0;
    const x0 = MARGIN + indent;
    const width = CONTENT_W - indent;
    const { lead, rest } = splitLead(b.text);
    // Lay the bold lead and the body out as one flowing run of words.
    const words = [
      ...(lead ? toWinAnsi(lead).split(/\s+/).map(w => ({ w, bold: true })) : []),
      ...toWinAnsi(rest).split(/\s+/).filter(Boolean).map(w => ({ w, bold: false })),
    ];
    const lines = [];
    let cur = []; let curW = 0;
    const space = f.regular.widthOfTextAtSize(' ', BODY);
    for (const wd of words) {
      const fw = (wd.bold ? f.bold : f.regular).widthOfTextAtSize(wd.w, BODY);
      if (cur.length && curW + space + fw > width) { lines.push(cur); cur = []; curW = 0; }
      if (!cur.length && fw > width) {
        for (const piece of wrap(wd.w, wd.bold ? f.bold : f.regular, BODY, width)) lines.push([{ w: piece, bold: wd.bold }]);
        continue;
      }
      curW += (cur.length ? space : 0) + fw;
      cur.push(wd);
    }
    if (cur.length) lines.push(cur);
    lines.forEach((ln, k) => {
      ensure(LEADING);
      if (k === 0 && b.type === 'bullet') text('•', MARGIN + 3, y, { font: f.bold, size: BODY });
      let x = x0;
      for (const wd of ln) {
        const font = wd.bold ? f.bold : f.regular;
        text(wd.w, x, y, { font });
        x += font.widthOfTextAtSize(wd.w, BODY) + space;
      }
      y -= LEADING;
    });
    y -= 4;
  }

  // ── Footer on every page ──
  pages.forEach((p, k) => {
    p.drawLine({ start: { x: MARGIN, y: 44 }, end: { x: PAGE_W - MARGIN, y: 44 }, thickness: 0.5, color: C.rule });
    p.drawText(toWinAnsi(vm.practiceName || 'Opal Therapy'), { x: MARGIN, y: 30, size: 8.5, font: f.regular, color: C.muted });
    const num = `${k + 1}/${pages.length}`;
    p.drawText(num, { x: PAGE_W - MARGIN - f.regular.widthOfTextAtSize(num, 8.5), y: 30, size: 8.5, font: f.regular, color: C.muted });
  });

  return pdf.save();
}

/** "Therapy Session - Noah Mathew - 29-10-2026.pdf", filesystem-safe. */
function caseNotePdfFilename(header = {}) {
  const parts = ['Therapy Session', header.clientName, header.sessionDateLabel && String(header.sessionDateLabel).replace(/\//g, '-')]
    .filter(Boolean)
    .map(s => toWinAnsi(s).replace(/[^A-Za-z0-9 ._-]/g, '').trim())
    .filter(Boolean);
  return `${parts.join(' - ') || 'Therapy Session'}.pdf`;
}

module.exports = { renderCaseNotePdf, parseNote, caseNotePdfFilename };
