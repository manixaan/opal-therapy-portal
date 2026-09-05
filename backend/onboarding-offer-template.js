'use strict';

/**
 * LETTER OF OFFER — the practice's own wording.
 *
 * The shipped template (onboarding-offer-docx.js) is the starting point. The
 * practice edits it paragraph by paragraph in the portal; each save writes a
 * complete .docx (the current template with the edits applied) as a new
 * version, and every letter generated after that is filled from it.
 *
 * A paragraph is shown as SEGMENTS: plain text, and the portal-filled
 * controls as {tag} tokens. Editing keeps the paragraph's style and the
 * formatting of its first run; a token that is deleted simply disappears
 * from the letter, and a token typed in is the matching control, cloned.
 *
 *   readParagraphs(buffer)            → [{ index, style, segments }]
 *   applyEdits(buffer, edits)         → Buffer (edits: [{ index, segments }])
 *   currentTemplateBuffer(orgId)      → the practice's template, or the shipped one
 */

const crypto = require('crypto');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const offerDocx = require('./onboarding-offer-docx');
const odb = require('./onboarding-db');

const { pool, isUuid } = odb;
const PART = 'word/document.xml';
const MAX_PARAGRAPH_CHARS = 4000;

/** What each control is, in the editor's words. */
const TAG_LABELS = {
  OPAL_LOO_DATE: 'Letter date',
  OPAL_LOO_CANDIDATE_FULL_NAME: 'Candidate full name',
  OPAL_LOO_CANDIDATE_FIRST_NAME: 'Candidate first name',
  OPAL_LOO_CANDIDATE_EMAIL: 'Candidate email',
  OPAL_LOO_CANDIDATE_MOBILE: 'Candidate mobile',
  OPAL_LOO_POSITION_TITLE: 'Position title',
  OPAL_LOO_EMPLOYMENT_BASIS: 'Employment basis',
  OPAL_LOO_EMPLOYMENT_BASIS_LOWER: 'employment basis',
  OPAL_LOO_COMMENCEMENT_DATE: 'Commencement date',
  OPAL_LOO_COMMENCEMENT_DATE_LONG: 'Commencement date (long)',
  OPAL_LOO_SIGNATORY_NAME: 'Signatory name',
  OPAL_LOO_SIGNATORY_FIRST_NAME: 'Signatory first name',
  OPAL_LOO_SIGNATORY_TITLE: 'Signatory title',
  OPAL_LOO_SIGNATORY_EMAIL: 'Signatory email',
  OPAL_LOO_SIGNATORY_PHONE: 'Signatory phone',
  OPAL_LOO_HOURS_DESCRIPTION: 'Hours of work',
  OPAL_LOO_AWARD: 'Modern award',
  OPAL_LOO_CLASSIFICATION: 'Classification',
  OPAL_LOO_REMUNERATION_LABEL: 'Remuneration label',
  OPAL_LOO_REMUNERATION: 'Remuneration',
  OPAL_LOO_SUPERANNUATION: 'Superannuation',
  OPAL_LOO_PAY_CYCLE: 'Pay cycle',
  OPAL_LOO_PROBATION: 'Probation',
  OPAL_LOO_OFFER_CLOSING_DATE: 'Offer closing date',
  OPAL_LOO_OFFER_CLOSING_DATE_LONG: 'Offer closing date (long)',
  OPAL_LOO_REGISTRATION_CONDITION: 'Registration condition',
};

// ── XML helpers ──────────────────────────────────────────────────────────────

function children(el, name) {
  const out = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeName === name) out.push(n);
  return out;
}
function child(el, name) { return children(el, name)[0] || null; }
function ownTag(sdt) {
  const pr = child(sdt, 'w:sdtPr');
  const tag = pr && child(pr, 'w:tag');
  return tag ? tag.getAttribute('w:val') : null;
}
function runText(r) {
  let t = '';
  for (let n = r.firstChild; n; n = n.nextSibling) {
    if (n.nodeName === 'w:t') t += n.textContent || '';
    else if (n.nodeName === 'w:tab') t += '\t';
    else if (n.nodeName === 'w:br') t += '\n';
  }
  return t;
}
function parse(xml) {
  const errors = [];
  const doc = new DOMParser({ onError: (level, msg) => { if (level !== 'warning') errors.push(String(msg)); } }).parseFromString(xml, 'text/xml');
  if (errors.length || !doc.documentElement) throw new Error(`Letter template: ${PART} is not well-formed XML`);
  return doc;
}
function bodyParagraphs(doc) {
  // Every paragraph in the part, document order — table cells included, the
  // running header excluded (it is another part).
  return Array.from(doc.getElementsByTagName('w:p'));
}

/** The paragraph as segments: text runs and {tag} controls, in order. */
function segmentsOf(p) {
  const segs = [];
  const push = (seg) => {
    const last = segs[segs.length - 1];
    if (seg.type === 'text' && last && last.type === 'text') last.text += seg.text;
    else segs.push(seg);
  };
  for (let n = p.firstChild; n; n = n.nextSibling) {
    if (n.nodeName === 'w:r') { const t = runText(n); if (t) push({ type: 'text', text: t }); }
    else if (n.nodeName === 'w:sdt') { const tag = ownTag(n); if (tag) push({ type: 'tag', tag }); else push({ type: 'text', text: sdtText(n) }); }
    else if (n.nodeName === 'w:hyperlink') { for (const r of children(n, 'w:r')) { const t = runText(r); if (t) push({ type: 'text', text: t }); } }
  }
  return segs;
}
function sdtText(sdt) {
  const c = child(sdt, 'w:sdtContent');
  return c ? children(c, 'w:r').map(runText).join('') : '';
}
function styleOf(p) {
  const pr = child(p, 'w:pPr');
  const st = pr && child(pr, 'w:pStyle');
  return st ? st.getAttribute('w:val') : '';
}
function firstRunProps(p) {
  for (let n = p.firstChild; n; n = n.nextSibling) {
    if (n.nodeName === 'w:r') { const pr = child(n, 'w:rPr'); if (pr) return pr; }
    if (n.nodeName === 'w:sdt') {
      const c = child(n, 'w:sdtContent');
      const r = c && child(c, 'w:r');
      const pr = r && child(r, 'w:rPr');
      if (pr) return pr;
    }
  }
  return null;
}

// ── Reading ──────────────────────────────────────────────────────────────────

async function readParagraphs(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const doc = parse(await zip.file(PART).async('string'));
  return bodyParagraphs(doc).map((p, index) => ({ index, style: styleOf(p), segments: segmentsOf(p) }));
}

// ── Writing ──────────────────────────────────────────────────────────────────

function cleanSegments(segs) {
  if (!Array.isArray(segs)) throw new Error('segments must be a list');
  const out = [];
  let chars = 0;
  for (const s of segs) {
    if (!s || typeof s !== 'object') continue;
    if (s.type === 'tag') {
      if (!TAG_LABELS[s.tag]) throw new Error(`Unknown control ${String(s.tag).slice(0, 40)}`);
      out.push({ type: 'tag', tag: s.tag });
    } else if (s.type === 'text') {
      const text = String(s.text == null ? '' : s.text).replace(/\r\n?/g, '\n');
      chars += text.length;
      if (text) out.push({ type: 'text', text });
    }
  }
  if (chars > MAX_PARAGRAPH_CHARS) throw new Error('A paragraph is too long');
  return out;
}

function makeRun(doc, rPr, text) {
  const r = doc.createElement('w:r');
  if (rPr) r.appendChild(rPr.cloneNode(true));
  const pieces = text.split('\n');
  pieces.forEach((piece, i) => {
    if (i) r.appendChild(doc.createElement('w:br'));
    if (!piece) return;
    const t = doc.createElement('w:t');
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(doc.createTextNode(piece));
    r.appendChild(t);
  });
  return r;
}

/** Rewrite one paragraph's content from segments, keeping pPr and run style. */
function rewriteParagraph(doc, p, segs, sdtByTagInDoc) {
  const rPr = firstRunProps(p);
  const pPr = child(p, 'w:pPr');
  const ownSdts = new Map();
  const old = [];
  for (let n = p.firstChild; n; n = n.nextSibling) old.push(n);
  for (const n of old) {
    if (n === pPr) continue;
    if (n.nodeName === 'w:sdt') { const tag = ownTag(n); if (tag && !ownSdts.has(tag)) ownSdts.set(tag, n); }
    p.removeChild(n);
  }
  for (const s of segs) {
    if (s.type === 'text') { p.appendChild(makeRun(doc, rPr, s.text)); continue; }
    let sdt = ownSdts.get(s.tag);
    if (sdt) ownSdts.delete(s.tag);
    else {
      const source = sdtByTagInDoc.get(s.tag);
      if (!source) throw new Error(`The letter has no control for ${s.tag}`);
      sdt = source.cloneNode(true);
      // A cloned control must not share the original's id.
      const pr = child(sdt, 'w:sdtPr');
      const id = pr && child(pr, 'w:id');
      if (id) pr.removeChild(id);
    }
    p.appendChild(sdt);
  }
}

/**
 * Apply paragraph edits to a template and return the new .docx. `edits` is
 * [{ index, segments }] against the paragraph order readParagraphs() gave.
 */
async function applyEdits(buffer, edits) {
  if (!Array.isArray(edits) || !edits.length) throw new Error('No edits');
  const zip = await JSZip.loadAsync(buffer);
  const doc = parse(await zip.file(PART).async('string'));
  const paras = bodyParagraphs(doc);
  const sdtByTag = new Map();
  for (const sdt of Array.from(doc.getElementsByTagName('w:sdt'))) {
    const tag = ownTag(sdt);
    if (tag && !sdtByTag.has(tag)) sdtByTag.set(tag, sdt);
  }
  for (const e of edits) {
    const index = Number(e && e.index);
    if (!Number.isInteger(index) || index < 0 || index >= paras.length) throw new Error('A paragraph edit points outside the letter');
    rewriteParagraph(doc, paras[index], cleanSegments(e.segments), sdtByTag);
  }
  zip.file(PART, new XMLSerializer().serializeToString(doc), { createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: offerDocx.DOCX_MIME });
}

/** Fill the candidate template with a sample so a bad edit fails here, not in front of a candidate. */
async function proveComposes(templateBuffer) {
  const start = new Date(); start.setDate(start.getDate() + 28);
  await offerDocx.buildOfferDocx({
    templateBuffer,
    terms: { positionTitle: 'Occupational Therapist', employmentType: 'full_time', startDate: start.toISOString().slice(0, 10), payBasis: 'annual', payRate: 90000, hoursPerWeek: 38, probationMonths: 6 },
    applicant: { name: 'Sample Employee', email: 'sample.employee@example.com', mobile: '0400 000 000' },
    signatory: offerDocx.DEFAULT_SIGNATORY, issuedAt: new Date(), isTreatingTherapist: true,
  });
}

// ── Storage ──────────────────────────────────────────────────────────────────

const SELECT = `
  SELECT t.id, t.organisation_id AS "organisationId", t.version, t.status, t.note, t.file_sha256 AS "sha256",
         t.created_at AS "createdAt", t.created_by AS "createdBy", u.name AS "createdByName"
    FROM onboarding_offer_templates t LEFT JOIN users u ON u.id = t.created_by`;

async function getCurrentTemplate(organisationId, q = pool) {
  if (!isUuid(organisationId)) return null;
  const { rows } = await q.query(`${SELECT} WHERE t.organisation_id = $1 AND t.status = 'active' ORDER BY t.version DESC LIMIT 1`, [organisationId]);
  return rows[0] || null;
}

async function readTemplateBytes(organisationId, id, q = pool) {
  const { rows } = await q.query('SELECT file_data FROM onboarding_offer_templates WHERE organisation_id = $1 AND id = $2', [organisationId, id]);
  return rows[0] ? Buffer.from(rows[0].file_data, 'base64') : null;
}

/** The practice's template if one has been saved, else the shipped one. */
async function currentTemplate(organisationId, q = pool) {
  const row = await getCurrentTemplate(organisationId, q);
  if (row) {
    const bytes = await readTemplateBytes(organisationId, row.id, q);
    if (bytes) return { buffer: bytes, source: 'practice', version: row.version, saved: row };
  }
  return { buffer: offerDocx.readTemplateBuffer(), source: 'built_in', version: 0, saved: null };
}

async function currentTemplateBuffer(organisationId, q = pool) {
  return (await currentTemplate(organisationId, q)).buffer;
}

async function saveTemplate({ organisationId, buffer, userId, note }) {
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  return odb.withTransaction(async (q) => {
    const { rows } = await q.query('SELECT COALESCE(MAX(version), 0) AS v FROM onboarding_offer_templates WHERE organisation_id = $1', [organisationId]);
    const version = Number(rows[0].v) + 1;
    await q.query(`UPDATE onboarding_offer_templates SET status = 'superseded', superseded_at = NOW() WHERE organisation_id = $1 AND status = 'active'`, [organisationId]);
    const ins = await q.query(
      `INSERT INTO onboarding_offer_templates (organisation_id, version, file_data, file_sha256, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [organisationId, version, buffer.toString('base64'), sha, note ? String(note).slice(0, 400) : null, userId || null],
    );
    const { rows: out } = await q.query(`${SELECT} WHERE t.id = $1`, [ins.rows[0].id]);
    return out[0];
  });
}

/** Back to the shipped letter: every saved version is superseded, none deleted. */
async function resetTemplate(organisationId, q = pool) {
  const r = await q.query(`UPDATE onboarding_offer_templates SET status = 'superseded', superseded_at = NOW() WHERE organisation_id = $1 AND status = 'active'`, [organisationId]);
  return r.rowCount;
}

/** Edit the current template and make the result the standard. */
async function saveEdits({ organisationId, userId, edits, note }) {
  const base = await currentTemplate(organisationId);
  const next = await applyEdits(base.buffer, edits);
  await proveComposes(next);
  return saveTemplate({ organisationId, buffer: next, userId, note });
}

module.exports = {
  TAG_LABELS, MAX_PARAGRAPH_CHARS,
  readParagraphs, applyEdits, proveComposes,
  getCurrentTemplate, currentTemplate, currentTemplateBuffer, saveTemplate, resetTemplate, saveEdits,
};
