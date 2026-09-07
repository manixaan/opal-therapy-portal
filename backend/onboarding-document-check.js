'use strict';

/**
 * ONBOARDING DOCUMENT CHECK — the portal reads a document before it counts.
 *
 * Deterministic, no model: the fillable parts of a returned document are read
 * and the blank ones named, so an incomplete signed letter or form is flagged
 * before the Owner submits it.
 *
 *   PDF   — the AcroForm fields (what a candidate typed into the fillable
 *           letter or form) and, failing those, the text beside the labels a
 *           document is expected to carry (a flattened or printed-and-scanned
 *           PDF with a text layer).
 *   DOCX  — the content controls and the value cell beside each label cell.
 *   Image — cannot be read here (no OCR): reported as such, never as fine.
 *
 *   checkDocument({ buffer, mime, expect, keepValues })
 *     → { status, method, fields: [{ label, filled, preview? }], issues: [{ code, message }], checkedAt }
 *
 *   status   ok          every field that was read is filled
 *            attention   something expected is blank, or a signature is missing
 *            unreadable  nothing could be read (an image, a scan without text)
 *            unchecked   readable, but nothing fillable to check
 *
 *   expect   [{ label, required, kind }] — for the letter of offer, the
 *            acceptance block. kind 'signature' accepts a typed name.
 */

const { PDFDocument } = require('pdf-lib');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SENSITIVE_LABEL = /tfn|tax file|account|bsb|passport|licen[cs]e|medicare|birth|password|pin\b/i;

/** The acceptance block of the letter of offer. */
const LETTER_OF_OFFER_EXPECT = [
  { label: 'Full Name', required: true },
  { label: 'Signature', required: true, kind: 'signature' },
  { label: 'Date', required: true, kind: 'date' },
  { label: 'Commencement Date Confirmed', required: false },
];

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const filled = (v) => /[A-Za-z0-9]{2,}|[0-9]/.test(norm(v));
const preview = (v) => { const t = norm(v); return t.length > 40 ? `${t.slice(0, 37)}…` : t; };
const labelKey = (s) => norm(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── PDF ───────────────────────────────────────────────────────────────────────

async function pdfFormFields(buffer) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const out = [];
  let form;
  try { form = pdf.getForm(); } catch (_) { return out; }
  for (const f of form.getFields()) {
    const name = f.getName();
    const type = f.constructor.name;
    let value = '';
    try {
      if (type === 'PDFTextField') value = f.getText() || '';
      else if (type === 'PDFCheckBox') value = f.isChecked() ? 'checked' : '';
      else if (type === 'PDFRadioGroup' || type === 'PDFDropdown') value = f.getSelected ? [].concat(f.getSelected() || []).join(', ') : '';
      else if (type === 'PDFOptionList') value = [].concat(f.getSelected() || []).join(', ');
      else if (type === 'PDFSignature') value = 'signature';
      else continue;
    } catch (_) { value = ''; }
    // "Full Name 2" — the second field of that label on the page.
    out.push({ label: name.replace(/\s+\d+$/, ''), name, value });
  }
  return out;
}

async function pdfItems(buffer) {
  const quality = require('./resource-file-quality');
  return quality.pdfPageItems(buffer);
}

// ── DOCX ──────────────────────────────────────────────────────────────────────

function textOf(el) {
  let t = '';
  const walk = (n) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeName === 'w:t') t += c.textContent || '';
      else if (c.nodeName === 'w:tab') t += ' ';
      else if (c.nodeName === 'w:br' || c.nodeName === 'w:p') { t += ' '; walk(c); }
      else if (c.nodeType === 1) walk(c);
    }
  };
  walk(el);
  return t;
}
const elements = (el, name) => { const out = []; const all = el.getElementsByTagName(name); for (let i = 0; i < all.length; i++) out.push(all[i]); return out; };

async function docxFields(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('word/document.xml');
  if (!entry) return { fields: [], text: '' };
  const doc = new DOMParser().parseFromString(await entry.async('string'), 'text/xml');
  const fields = [];
  // Content controls: a control still showing its placeholder is blank.
  for (const sdt of elements(doc, 'w:sdt')) {
    const pr = elements(sdt, 'w:sdtPr')[0];
    const alias = pr && elements(pr, 'w:alias')[0]; const tag = pr && elements(pr, 'w:tag')[0];
    const label = (alias && alias.getAttribute('w:val')) || (tag && tag.getAttribute('w:val')) || 'Field';
    if (/^OPAL_LOO_/.test(label)) continue; // the portal's own merge fields, filled before the letter went out
    const placeholder = !!(pr && elements(pr, 'w:showingPlcHdr').length);
    const content = elements(sdt, 'w:sdtContent')[0];
    fields.push({ label, value: placeholder ? '' : textOf(content || sdt) });
  }
  // Two-cell table rows: a label cell and the value beside it.
  for (const tr of elements(doc, 'w:tr')) {
    const cells = []; for (let c = tr.firstChild; c; c = c.nextSibling) if (c.nodeName === 'w:tc') cells.push(c);
    if (cells.length !== 2) continue;
    const label = norm(textOf(cells[0])); if (!label || label.length > 60) continue;
    if (elements(cells[1], 'w:sdt').length) continue; // already counted as a control
    fields.push({ label, value: textOf(cells[1]) });
  }
  return { fields, text: textOf(doc.documentElement) };
}

// ── Text beside a label (flattened or typed-over PDFs) ────────────────────────

/**
 * A flattened form draws its values wherever the fields were, so the text
 * layer does not put a value after its label. Read by position instead: the
 * value of a label is whatever text sits on the same line, to its right, up
 * to the next label. Labels are matched on their own item, last occurrence
 * first — an acceptance block sits at the end of a letter.
 */
function fieldsFromItems(pages, expect) {
  // Words → lines: items within a few points of the same baseline, left to right.
  const lines = [];
  pages.forEach((items) => {
    const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = null;
    for (const it of sorted) {
      if (cur && Math.abs(cur.y - it.y) <= Math.max(3, (it.h || 10) * 0.4)) cur.words.push(it);
      else { cur = { y: it.y, words: [it] }; lines.push(cur); }
    }
  });
  lines.forEach((l) => { l.words.sort((a, b) => a.x - b.x); l.keys = l.words.map((w) => labelKey(w.str)); });
  const labelWords = (label) => labelKey(label).split(' ');
  const allLabels = expect.map((e) => labelWords(e.label));
  const startsWith = (keys, words) => words.length <= keys.length && words.every((w, i) => keys[i] === w);
  return expect.map((e) => {
    const words = labelWords(e.label);
    // Last occurrence: an acceptance block sits at the end of a letter.
    let hit = null;
    for (const l of lines) if (startsWith(l.keys, words)) hit = l;
    if (!hit) return { label: e.label, value: '', absent: true };
    let rest = hit.words.slice(words.length);
    // Up to the next label on the same line (a two-column form).
    for (let i = 0; i < rest.length; i++) { if (allLabels.some((lw) => startsWith(rest.slice(i).map((w) => labelKey(w.str)), lw))) { rest = rest.slice(0, i); break; } }
    return { label: e.label, value: rest.map((w) => w.str).join(' ') };
  });
}

function pagesText(pages) { return pages.map((items) => items.map((o) => o.str).join(' ')).join('\n'); }

/** The Word fallback, where paragraphs do keep their order: the text after a label up to the next label. */
function fieldsFromText(text, expect) {
  const flat = norm(text);
  const labels = expect.map((e) => e.label);
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return expect.map((e) => {
    const re = new RegExp(`${escapeRe(e.label)}\\s*:?\\s*`, 'i');
    const m = re.exec(flat);
    if (!m) return { label: e.label, value: '', absent: true };
    let rest = flat.slice(m.index + m[0].length, m.index + m[0].length + 120);
    for (const other of labels) { if (other === e.label) continue; const i = rest.search(new RegExp(`\\b${escapeRe(other)}\\b`, 'i')); if (i >= 0) rest = rest.slice(0, i); }
    return { label: e.label, value: rest.trim() };
  });
}

// ── The check ─────────────────────────────────────────────────────────────────

function assess(rawFields, { expect, keepValues, method }) {
  const fields = rawFields.map((f) => ({
    label: norm(f.label) || 'Field', filled: filled(f.value),
    ...(keepValues && !SENSITIVE_LABEL.test(f.label) && filled(f.value) ? { preview: preview(f.value) } : {}),
  }));
  const issues = [];
  const byKey = new Map(fields.map((f) => [labelKey(f.label), f]));
  for (const e of expect || []) {
    const f = byKey.get(labelKey(e.label));
    if (!f) { if (e.required) issues.push({ code: 'missing', message: `${e.label} could not be found in the document` }); continue; }
    if (!f.filled && e.required) issues.push({ code: e.kind === 'signature' ? 'unsigned' : 'blank', message: e.kind === 'signature' ? 'The signature line is empty' : `${e.label} is blank` });
  }
  if (!expect || !expect.length) {
    for (const f of fields) if (!f.filled) issues.push({ code: 'blank', message: `${f.label} is blank` });
  }
  const status = issues.length ? 'attention' : fields.length ? 'ok' : 'unchecked';
  return { status, method, fields, issues, checkedAt: new Date().toISOString() };
}

async function checkDocument({ buffer, mime, expect = null, keepValues = false }) {
  const type = String(mime || '').toLowerCase();
  const unreadable = (message) => ({ status: 'unreadable', method: 'none', fields: [], issues: [{ code: 'unreadable', message }], checkedAt: new Date().toISOString() });
  try {
    if (type === 'application/pdf') {
      const form = await pdfFormFields(buffer).catch(() => []);
      if (form.length) return assess(form, { expect, keepValues, method: 'pdf_form' });
      let pages = [];
      try { pages = await pdfItems(buffer); } catch (_) { pages = []; }
      if (norm(pagesText(pages)).length < 40) return unreadable('This PDF has no readable text (a scan or photo) — check it by eye');
      if (expect && expect.length) return assess(fieldsFromItems(pages, expect), { expect, keepValues, method: 'pdf_text' });
      return { status: 'unchecked', method: 'pdf_text', fields: [], issues: [], checkedAt: new Date().toISOString() };
    }
    if (type === DOCX_MIME) {
      const { fields, text } = await docxFields(buffer);
      if (!fields.length && norm(text).length < 40) return unreadable('This document holds no readable text — check it by eye');
      if (!fields.length && expect && expect.length) return assess(fieldsFromText(text, expect).map((f) => ({ label: f.label, value: f.absent ? '' : f.value })), { expect, keepValues, method: 'docx_text' });
      return assess(fields, { expect, keepValues, method: 'docx' });
    }
    if (type.startsWith('image/')) return unreadable('A photo or image cannot be read automatically — check it by eye');
    if (type === 'text/plain') return { status: 'unchecked', method: 'text', fields: [], issues: [], checkedAt: new Date().toISOString() };
    return unreadable('This file type cannot be read automatically — check it by eye');
  } catch (err) {
    return unreadable('The document could not be opened — check it by eye');
  }
}

/** One line for a list: "3 fields read · Signature is blank". */
function summarise(check) {
  if (!check) return null;
  if (check.status === 'unreadable') return check.issues[0] ? check.issues[0].message : 'Could not be read';
  if (check.status === 'unchecked') return 'Nothing fillable to check — review by eye';
  const n = check.fields.length;
  const head = `${n} field${n === 1 ? '' : 's'} read`;
  return check.issues.length ? `${head} · ${check.issues.map((i) => i.message).join(' · ')}` : `${head}, all filled in`;
}

module.exports = { checkDocument, summarise, LETTER_OF_OFFER_EXPECT, _internals: { assess, fieldsFromText, fieldsFromItems, pdfFormFields, docxFields } };
