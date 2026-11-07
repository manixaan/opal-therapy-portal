'use strict';

/**
 * Builds the two clinical masters the Templates editor offers beside the FCA:
 *
 *   fca/templates/support-letter-v1.docx     Letter of Support
 *   fca/templates/progress-report-v1.docx    Occupational Therapy Progress Report
 *
 *   node scripts/build-clinical-templates.js        (from backend/)
 *
 * Every control's tag, alias and prompt, and every section's heading, order and
 * default, comes from templates/support-letter-map.js and
 * templates/progress-report-map.js — the same tables the portal resolves
 * against — so the map and the master cannot drift. The package shells are
 * existing Opal masters, so styling is shared exactly:
 *
 *   Support Letter   the progress-note letter's letterhead, styles and footer
 *   Progress Report  the FCA's cover band, logo, styles, running header/footer
 *
 * Re-run after changing either map, then re-pin TEMPLATE_SHA256 in that map
 * (the script prints both hashes). The output is deterministic: the zip entry
 * dates are fixed, so an unchanged map rebuilds byte-identical files.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const letterMap = require('../templates/support-letter-map');
const reportMap = require('../templates/progress-report-map');

const TEMPLATES_DIR = path.join(__dirname, '..', 'fca', 'templates');
const LETTER_SHELL = path.join(TEMPLATES_DIR, 'progress-note-letter-v1.docx');
const REPORT_SHELL = path.join(TEMPLATES_DIR, 'fca-v1.docx');

const FIXED_DATE = new Date('2026-11-07T00:00:00Z');

// ── Palette (the masters' own) ──────────────────────────────────────────────
const TEAL = '2F5651';
const INK = '263633';
const SLATE = '566E70';
const MINT = 'C5E1CC';
const MIST = 'E8F1EC';
const PAPER = 'F4F7F5';
const RULE = 'BFCDCE';
const HAIR = 'D9E2DE';

const S = (name) => `OPAL–${name}`;   // OPAL en-dash style ids

// ── A small WordprocessingML DSL ────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function rPr({ b, i, color, sz, caps, spacing } = {}) {
  const out = [];
  if (b === true) out.push('<w:b/><w:bCs/>');
  if (b === false) out.push('<w:b w:val="0"/>');
  if (i === true) out.push('<w:i/>');
  if (i === false) out.push('<w:i w:val="0"/>');
  if (caps) out.push('<w:caps/>');
  if (spacing) out.push(`<w:spacing w:val="${spacing}"/>`);
  if (color) out.push(`<w:color w:val="${color}"/>`);
  if (sz) out.push(`<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`);
  return out.length ? `<w:rPr>${out.join('')}</w:rPr>` : '';
}

const run = (text, fmt) => `<w:r>${rPr(fmt)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

function pPr({ style, jc, before, after, line, keepNext, pageBreakBefore, outline, ind, border, shade } = {}) {
  const out = [];
  if (style) out.push(`<w:pStyle w:val="${style}"/>`);
  if (keepNext) out.push('<w:keepNext/>');
  if (pageBreakBefore) out.push('<w:pageBreakBefore/>');
  if (border) out.push(`<w:pBdr>${border}</w:pBdr>`);
  if (shade) out.push(`<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`);
  if (before !== undefined || after !== undefined || line !== undefined) {
    out.push(`<w:spacing${before !== undefined ? ` w:before="${before}"` : ''}${after !== undefined ? ` w:after="${after}"` : ''}`
      + `${line !== undefined ? ` w:line="${line}" w:lineRule="auto"` : ''}/>`);
  }
  if (ind) out.push(ind);
  if (jc) out.push(`<w:jc w:val="${jc}"/>`);
  if (outline !== undefined) out.push(`<w:outlineLvl w:val="${outline}"/>`);
  return out.length ? `<w:pPr>${out.join('')}</w:pPr>` : '';
}

const para = (content, opts) => `<w:p>${pPr(opts)}${content}</w:p>`;

let sdtId = 52000;
const nextId = () => { sdtId += 1; return sdtId; };

/** An inline field: a plain-text control holding the map's own prompt. */
function field(map, tag, fmt) {
  const s = map.SCALAR_BY_TAG.get(tag);
  if (!s) throw new Error(`build: ${tag} is not in the map`);
  const kind = s.isDate ? '<w:text/>' : (s.multiline ? '<w:text w:multiLine="1"/>' : '<w:text/>');
  return `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/><w:alias w:val="PORTAL — ${esc(s.alias)}"/>${kind}</w:sdtPr>`
    + `<w:sdtContent>${run(map.promptFor(tag), fmt)}</w:sdtContent></w:sdt>`;
}

/**
 * A block narrative: a rich-text control wrapping ONE prototype paragraph. The
 * engine clones that paragraph once per line the clinician typed, so its
 * style (body text, or a bullet) is every paragraph's style.
 */
function blockField(map, tag, opts = {}, fmt) {
  const s = map.SCALAR_BY_TAG.get(tag);
  if (!s || !s.paragraphs) throw new Error(`build: ${tag} is not a paragraph field`);
  return `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/><w:alias w:val="PORTAL — ${esc(s.alias)}"/><w:id w:val="${nextId()}"/></w:sdtPr>`
    + `<w:sdtContent>${para(run(map.promptFor(tag), fmt), opts)}</w:sdtContent></w:sdt>`;
}

/** A section: a tagged block control, its heading first. */
function section(map, tag, inner) {
  const s = map.SECTION_BY_TAG.get(tag);
  if (!s) throw new Error(`build: section ${tag} is not in the map`);
  return `<w:sdt><w:sdtPr><w:alias w:val="PORTAL SECTION — ${esc(s.title)} — OPTIONAL"/><w:tag w:val="${tag}"/>`
    + `<w:id w:val="${nextId()}"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
}

function anchor(tag) {
  return `<w:sdt><w:sdtPr><w:alias w:val="PORTAL ANCHOR — Custom sections"/><w:tag w:val="${tag}"/><w:id w:val="${nextId()}"/></w:sdtPr>`
    + `<w:sdtContent>${para(run('[Optional custom content inserted here by the Opal Portal.]'), { style: S('Body') })}</w:sdtContent></w:sdt>`;
}

const heading = (level, content, opts = {}) => para(
  typeof content === 'string' ? run(content) : content.join(''),
  { style: S(`Heading${level}`), ...opts }
);

// ── Tables ──────────────────────────────────────────────────────────────────

const tcMar = (v, h) => `<w:tcMar><w:top w:w="${v}" w:type="dxa"/><w:bottom w:w="${v}" w:type="dxa"/>`
  + `<w:start w:w="${h}" w:type="dxa"/><w:end w:w="${h}" w:type="dxa"/></w:tcMar>`;

function cell(width, content, { fill, style = S('TableBody'), jc = 'left', v = 95, h = 120, borders = '', minHeight } = {}) {
  void minHeight;
  return `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${width}"/>${borders ? `<w:tcBorders>${borders}</w:tcBorders>` : ''}`
    + `<w:vAlign w:val="center"/>${fill ? `<w:shd w:val="clear" w:fill="${fill}"/>` : ''}${tcMar(v, h)}</w:tcPr>`
    + `${para(content, { style, jc })}</w:tc>`;
}

const row = (cells, { header = false, height } = {}) => `<w:tr><w:trPr><w:cantSplit w:val="true"/>`
  + `${header ? '<w:tblHeader w:val="true"/>' : ''}${height ? `<w:trHeight w:val="${height}" w:hRule="atLeast"/>` : ''}</w:trPr>`
  + `${cells.join('')}</w:tr>`;

function table(widths, rows, { style, ind = 120, borders } = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  const b = borders || `<w:top w:val="single" w:sz="6" w:color="${RULE}"/><w:left w:val="single" w:sz="6" w:color="${RULE}"/>`
    + `<w:bottom w:val="single" w:sz="6" w:color="${RULE}"/><w:right w:val="single" w:sz="6" w:color="${RULE}"/>`
    + `<w:insideH w:val="single" w:sz="4" w:color="${HAIR}"/><w:insideV w:val="single" w:sz="4" w:color="${HAIR}"/>`;
  return `<w:tbl><w:tblPr>${style ? `<w:tblStyle w:val="${style}"/>` : ''}<w:tblW w:type="dxa" w:w="${total}"/>`
    + `<w:jc w:val="left"/><w:tblLayout w:type="fixed"/>`
    + `<w:tblLook w:firstColumn="1" w:firstRow="0" w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="0480"/>`
    + `<w:tblInd w:type="dxa" w:w="${ind}"/><w:tblBorders>${b}</w:tblBorders></w:tblPr>`
    + `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

const spacer = (after = 120) => para('', { after, before: 0 });

// ═══════════════════════════════════════════════════════════════════════════
//  SUPPORT LETTER
// ═══════════════════════════════════════════════════════════════════════════

function letterBody() {
  const m = letterMap;
  const f = (tag, fmt) => field(m, tag, fmt);
  const label = { b: true, i: false, color: TEAL, sz: 14, spacing: 10 };
  const value = { b: false, i: false, color: INK, sz: 20 };
  const out = [];

  // Date, right-aligned.
  out.push(para(run('DATE   ', label) + f('OPAL_LETTER_DATE', value), { style: S('Body'), jc: 'right', before: 80, after: 320 }));

  // Recipient block.
  const line = { style: S('Body'), before: 0, after: 40, line: 240 };
  out.push(para(f('OPAL_LETTER_RECIPIENT_NAME', { b: true, i: false, color: TEAL, sz: 21 }), line));
  out.push(para(f('OPAL_LETTER_RECIPIENT_ROLE', value), line));
  out.push(para(f('OPAL_LETTER_RECIPIENT_ORGANISATION', value), line));
  out.push(para(f('OPAL_LETTER_RECIPIENT_ADDRESS', value), { ...line, after: 360 }));

  // Reference panel: what this letter is about, at a glance.
  const W = [2500, 6772];
  const panelBorders = `<w:top w:val="single" w:sz="6" w:color="${MINT}"/><w:left w:val="nil"/>`
    + `<w:bottom w:val="single" w:sz="6" w:color="${MINT}"/><w:right w:val="nil"/>`
    + `<w:insideH w:val="single" w:sz="4" w:color="${HAIR}"/><w:insideV w:val="nil"/>`;
  // The teal rule is the label column's own left edge, stated per cell so
  // every renderer draws it once, never between the columns.
  const ruleLeft = `<w:left w:val="single" w:sz="24" w:space="0" w:color="${TEAL}"/>`;
  const noLeft = '<w:left w:val="nil"/>';
  const refLabel = { b: true, i: false, color: TEAL, sz: 15, spacing: 10, caps: true };
  const refRow = (text, content) => row([
    cell(W[0], run(text, refLabel), { fill: MIST, v: 80, h: 160, borders: ruleLeft }),
    cell(W[1], content, { v: 80, h: 160, borders: noLeft }),
  ]);
  out.push(table(W, [
    refRow('Participant', f('OPAL_CLIENT_FULL_NAME', { b: true, i: false, color: INK, sz: 20 })),
    refRow('NDIS number', f('OPAL_CLIENT_NDIS_NUMBER', value)),
    refRow('Date of birth', f('OPAL_CLIENT_DATE_OF_BIRTH', value)),
    refRow('Subject', f('OPAL_LETTER_SUBJECT', { b: true, i: false, color: INK, sz: 20 })),
    refRow('Quote / reference', f('OPAL_LETTER_QUOTE_REFERENCE', value)),
  ], { ind: 0, borders: panelBorders }));

  // Greeting.
  const body = { b: false, i: false, color: INK, sz: 21 };
  out.push(para(f('OPAL_LETTER_GREETING', body) + run(',', body), { style: S('Body'), before: 360, after: 200 }));

  // Body sections.
  for (const s of m.SECTIONS) {
    out.push(section(m, s.tag,
      heading(3, s.title, { before: 200, after: 80 })
      + blockField(m, s.field, { style: S('Body'), jc: 'both', after: 180, line: 276 }, body)));
  }
  out.push(anchor(m.CUSTOM_SECTION_ANCHOR));

  // Closing and signature block.
  out.push(para(run('Please do not hesitate to contact me if you have any questions regarding this information.', body),
    { style: S('Body'), before: 120, after: 220 }));
  out.push(para(run('Kind regards,', body), { style: S('Body'), after: 720 }));
  out.push(para(f('OPAL_THERAPIST_FULL_NAME', { b: true, i: false, color: TEAL, sz: 22 }),
    { style: S('Body'), after: 20, border: `<w:top w:val="single" w:sz="6" w:space="6" w:color="${MINT}"/>`,
      ind: '<w:ind w:right="5400"/>' }));
  const small = { b: false, i: false, color: INK, sz: 18 };
  const smallLabel = { b: false, i: false, color: SLATE, sz: 18 };
  out.push(para(f('OPAL_THERAPIST_ROLE', small), { style: S('Body'), after: 20 }));
  out.push(para(f('OPAL_THERAPIST_QUALIFICATIONS', small), { style: S('Body'), after: 20 }));
  out.push(para(run('AHPRA registration: ', smallLabel) + f('OPAL_THERAPIST_AHPRA_NUMBER', small), { style: S('Body'), after: 20 }));
  out.push(para(run('Phone: ', smallLabel) + f('OPAL_THERAPIST_PHONE', small) + run('   |   Email: ', smallLabel)
    + f('OPAL_THERAPIST_EMAIL', small), { style: S('Body'), after: 200 }));

  const tail = { b: false, i: false, color: SLATE, sz: 17 };
  const tailLabel = { b: true, i: false, color: SLATE, sz: 17 };
  out.push(para(run('Enclosures: ', tailLabel) + f('OPAL_LETTER_ENCLOSURES', tail), { style: S('Body'), before: 80, after: 40 }));
  out.push(para(run('CC: ', tailLabel) + f('OPAL_LETTER_CC', tail), { style: S('Body'), before: 40, after: 0 }));

  return out.join('');
}

// ═══════════════════════════════════════════════════════════════════════════
//  PROGRESS REPORT
// ═══════════════════════════════════════════════════════════════════════════

const DETAIL_W = [2889, 6137];

function detailRow(map, labelText, content) {
  return row([
    cell(DETAIL_W[0], run(labelText), { fill: TEAL, style: S('TableHeader') }),
    cell(DETAIL_W[1], content, { fill: PAPER }),
  ]);
}

const detailsTable = (rows) => table(DETAIL_W, rows, { style: S('DetailsTable') });

function headerTable(widths, labels, bodyRows) {
  const head = row(labels.map((l, i) => cell(widths[i], run(l), {
    fill: TEAL, style: S('TableHeader'), jc: i === 0 ? 'left' : 'center', v: 110, h: 100,
  })), { header: true });
  return table(widths, [head, ...bodyRows], { style: S('Table'), ind: 100 });
}

function reportCover(fcaBody) {
  // The FCA cover, retitled. Everything up to and including the paragraph
  // that carries the cover section's own sectPr.
  const end = fcaBody.indexOf('</w:sectPr></w:pPr></w:p>') + '</w:sectPr></w:pPr></w:p>'.length;
  let cover = fcaBody.slice(0, end);
  const swap = (from, to) => {
    if (!cover.includes(from)) throw new Error(`build: cover no longer contains ${from}`);
    cover = cover.replace(from, to);
  };
  swap('<w:t>FUNCTIONAL ASSESSMENT REPORT</w:t>', '<w:t>OCCUPATIONAL THERAPY PROGRESS REPORT</w:t>');
  swap('<w:t>Occupational Therapy | NDIS</w:t>', '<w:t>NDIS Plan Review | Progress Against Goals</w:t>');
  swap('<w:tag w:val="OPAL_THERAPIST_CREDENTIALS"/><w:alias w:val="PORTAL — THERAPIST CREDENTIALS"/>',
    '<w:tag w:val="OPAL_THERAPIST_ROLE"/><w:alias w:val="PORTAL — THERAPIST ROLE"/>');
  swap('<w:t>[PORTAL — THERAPIST CREDENTIALS]</w:t>', '<w:t>[PORTAL — THERAPIST ROLE]</w:t>');
  return cover;
}

function tocBlock(fcaBody, sectionsForToc) {
  // The contents page: the FCA's title style and TOC field shape, with cached
  // entries for THIS report (the engine rebuilds them on every compose).
  const sectStart = fcaBody.indexOf('<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId23"/>');
  const sectEnd = fcaBody.indexOf('</w:sectPr></w:pPr></w:p>', sectStart) + '</w:sectPr></w:pPr></w:p>'.length;
  if (sectStart < 0) throw new Error('build: contents section break not found in the FCA shell');
  const sectPara = fcaBody.slice(sectStart, sectEnd);

  const tab = '<w:tabs><w:tab w:pos="9026" w:val="right" w:leader="dot"/></w:tabs>';
  const entry = (s, i) => {
    const lvl = s.level === 1 ? 1 : 2;
    const fmt = lvl === 1 ? { b: true, color: TEAL, sz: 22 } : { b: false, color: INK, sz: 20 };
    const begin = i === 0
      ? `<w:r>${rPr({ color: SLATE, sz: 22 })}<w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText><w:fldChar w:fldCharType="separate"/></w:r>`
      : '';
    const endRun = i === sectionsForToc.length - 1 ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : '';
    return `<w:p><w:pPr><w:pStyle w:val="TOC${lvl}"/>${tab}</w:pPr>${begin}${run(s.title, fmt)}`
      + `<w:r>${rPr({ color: fmt.color, sz: fmt.sz })}<w:tab/></w:r>${run(String(i + 1), fmt)}${endRun}</w:p>`;
  };

  return para(run('Contents'), { style: S('DocumentTitle'), jc: 'left' })
    + sectionsForToc.map(entry).join('')
    + sectPara;
}

function reportBody(fcaBody) {
  const m = reportMap;
  const f = (tag, fmt) => field(m, tag, fmt);
  const bf = (tag, opts) => blockField(m, tag, { style: S('Body'), jc: 'both', ...opts });
  const bullets = (tag) => blockField(m, tag, { style: S('Bullet') });
  const T = (key) => `OPAL_SECTION_REPORT_${key}`;
  const sub = (key, inner) => section(m, T(key), inner);
  const label = (text) => para(run(text), { style: S('BodyEmphasis'), keepNext: true, before: 120, after: 80 });

  const out = [];
  out.push(reportCover(fcaBody));
  out.push(tocBlock(fcaBody, m.SECTIONS.filter((s) => s.level <= 2 && s.defaultSelected)));

  // ── Participant Details ────────────────────────────────────────────────
  out.push(sub('PARTICIPANT_DETAILS',
    heading(1, 'Participant Details')
    + detailsTable([
      detailRow(m, 'Participant Name', f('OPAL_CLIENT_FULL_NAME')),
      detailRow(m, 'NDIS Participant Number', f('OPAL_CLIENT_NDIS_NUMBER')),
      detailRow(m, 'Date of Birth', f('OPAL_CLIENT_DATE_OF_BIRTH')),
      detailRow(m, 'Primary Disability', f('OPAL_CLIENT_PRIMARY_DISABILITY')),
      detailRow(m, 'NDIS Plan Dates', f('OPAL_CLIENT_NDIS_PLAN_START') + run(' – ') + f('OPAL_CLIENT_NDIS_PLAN_END')),
      detailRow(m, 'Reporting Period', f('OPAL_REPORT_PERIOD')),
      detailRow(m, 'Date of Report', f('OPAL_REPORT_DATE')),
    ])
    + spacer()
    + heading(2, 'Assessor Details')
    + detailsTable([
      detailRow(m, 'Name', f('OPAL_THERAPIST_FULL_NAME')),
      detailRow(m, 'Role', f('OPAL_THERAPIST_ROLE')),
      detailRow(m, 'Qualifications', f('OPAL_THERAPIST_QUALIFICATIONS')),
      detailRow(m, 'AHPRA Registration', f('OPAL_THERAPIST_AHPRA_NUMBER')),
      detailRow(m, 'Provider / Organisation', f('OPAL_THERAPIST_ORGANISATION')),
      detailRow(m, 'Contact', f('OPAL_THERAPIST_PHONE') + run('  |  ') + f('OPAL_THERAPIST_EMAIL')),
    ])
    + spacer()));

  // ── Participant Information ────────────────────────────────────────────
  const supportRows = [];
  for (let i = 1; i <= m.SUPPORT_ROWS; i++) {
    supportRows.push(row([
      cell(DETAIL_W[0], f(`OPAL_REPORT_SUPPORT_${i}_ROLE`), { fill: TEAL, style: S('TableHeader') }),
      cell(DETAIL_W[1], f(`OPAL_REPORT_SUPPORT_${i}_PROVIDER`), { fill: PAPER }),
    ]));
  }

  const RW = [3626, 1800, 1800, 1800];
  const resultRows = [];
  for (let i = 1; i <= m.RESULT_ROWS; i++) {
    resultRows.push(row([
      cell(RW[0], f(`OPAL_REPORT_RESULT_${i}_DOMAIN`, { b: true }), { fill: i % 2 ? PAPER : undefined, v: 90, h: 100 }),
      cell(RW[1], f(`OPAL_REPORT_RESULT_${i}_SCORE`), { fill: i % 2 ? PAPER : undefined, jc: 'center', v: 90, h: 100 }),
      cell(RW[2], f(`OPAL_REPORT_RESULT_${i}_PERCENTILE`), { fill: i % 2 ? PAPER : undefined, jc: 'center', v: 90, h: 100 }),
      cell(RW[3], f(`OPAL_REPORT_RESULT_${i}_CLASSIFICATION`), { fill: i % 2 ? PAPER : undefined, jc: 'center', v: 90, h: 100 }),
    ]));
  }

  out.push(sub('PARTICIPANT_INFORMATION',
    heading(1, 'Participant Information', { pageBreakBefore: true })
    + sub('BACKGROUND', heading(2, 'Background Information') + bf('OPAL_REPORT_BACKGROUND'))
    + sub('FORMAL_SUPPORTS', heading(2, 'Formal Supports funded by NDIS')
      + detailsTable(supportRows) + spacer(200) + bf('OPAL_REPORT_SUPPORTS_COMMENTARY'))
    + sub('PLAN_UTILISATION', heading(2, 'Plan Utilisation') + bf('OPAL_REPORT_PLAN_UTILISATION'))
    + sub('PARTICIPANT_GOALS', heading(2, 'Participant Goals')
      + para(f('OPAL_CLIENT_PREFERRED_NAME') + run('’s NDIS goals include the following:'), { style: S('Body'), after: 120 })
      + bullets('OPAL_REPORT_GOALS_LIST'))
    + sub('FORMAL_ASSESSMENT', heading(2, 'Formal Assessment')
      // Outline level 9 keeps it out of the contents list, as in the FCA cover.
      + heading(3, [f('OPAL_REPORT_ASSESSMENT_NAME')], { outline: 9 })
      + bf('OPAL_REPORT_ASSESSMENT_OVERVIEW')
      + label('Summary of results')
      + headerTable(RW, ['Domain / scale', 'Score', 'Percentile', 'Classification'], resultRows)
      + spacer(200)
      + bf('OPAL_REPORT_ASSESSMENT_INTERPRETATION'))));

  // ── Progress Towards NDIS Goals ────────────────────────────────────────
  const goals = [];
  for (let i = 1; i <= m.GOAL_SLOTS; i++) {
    goals.push(sub(`GOAL_${i}`,
      // The goals are listed under Participant Goals; the contents page stops
      // at Heading 2 so a long goal statement never crowds it.
      heading(3, [run(`NDIS Goal ${i}: `), f(`OPAL_REPORT_GOAL_${i}`)], { before: 360, outline: 9 })
      + para(run('Progress rating: ', { b: true, color: TEAL, sz: 19 }) + f(`OPAL_REPORT_GOAL_${i}_STATUS`, { b: false, color: INK, sz: 19 }),
        { style: S('Body'), after: 160, before: 0, shade: MIST, ind: '<w:ind w:left="0" w:right="0"/>',
          border: `<w:left w:val="single" w:sz="24" w:space="8" w:color="${TEAL}"/>` })
      + label('Relevant Occupational Therapy goals')
      + bullets(`OPAL_REPORT_GOAL_${i}_OT_GOALS`)
      + label('Progress over time')
      + bf(`OPAL_REPORT_GOAL_${i}_PROGRESS`)));
  }
  out.push(sub('PROGRESS',
    heading(1, 'Progress Towards NDIS Goals', { pageBreakBefore: true })
    + goals.join('')
    + anchor(m.CUSTOM_SECTION_ANCHOR)));

  // ── Summary ────────────────────────────────────────────────────────────
  out.push(sub('SUMMARY', heading(1, 'Overall Summary of Progress') + bf('OPAL_REPORT_SUMMARY')));

  // ── Recommendations ────────────────────────────────────────────────────
  const HW = [7026, 2000];
  const hoursRows = [];
  for (let i = 1; i <= m.HOURS_ROWS; i++) {
    hoursRows.push(row([
      cell(HW[0], f(`OPAL_REPORT_HOURS_${i}_ITEM`), { fill: i % 2 ? PAPER : undefined, v: 90, h: 120 }),
      cell(HW[1], f(`OPAL_REPORT_HOURS_${i}_HOURS`), { fill: i % 2 ? PAPER : undefined, jc: 'center', v: 90, h: 100 }),
    ]));
  }
  hoursRows.push(row([
    cell(HW[0], run('Total recommended', { b: true, color: TEAL }), { fill: MIST, v: 100, h: 120 }),
    cell(HW[1], f('OPAL_REPORT_HOURS_TOTAL', { b: true, color: TEAL }), { fill: MIST, jc: 'center', v: 100, h: 100 }),
  ]));

  out.push(sub('RECOMMENDATIONS',
    heading(1, 'Ongoing Recommendations', { pageBreakBefore: true })
    + sub('CORE_SUPPORTS', heading(2, 'Core Supports') + bf('OPAL_REPORT_CORE_SUPPORTS'))
    + sub('CAPACITY_BUILDING', heading(2, 'Capacity Building') + bf('OPAL_REPORT_CAPACITY_BUILDING')
      + label('Recommended Occupational Therapy hours')
      + headerTable(HW, ['Item', 'Hours'], hoursRows)
      + spacer(200))));

  // ── Declaration ────────────────────────────────────────────────────────
  out.push(sub('DECLARATION',
    heading(1, 'Professional Declaration')
    + para(run('I confirm that this Progress Report has been prepared within my professional scope, using the '
      + 'information and assessment evidence identified in the report, and reflects my occupational therapy '
      + 'opinion at the date of issue.'), { style: S('Body'), jc: 'both' })
    + detailsTable([
      detailRow(m, 'Occupational Therapist', f('OPAL_THERAPIST_FULL_NAME')),
      detailRow(m, 'Qualifications', f('OPAL_THERAPIST_QUALIFICATIONS')),
      detailRow(m, 'AHPRA Registration', f('OPAL_THERAPIST_AHPRA_NUMBER')),
      detailRow(m, 'Provider / Organisation', f('OPAL_THERAPIST_ORGANISATION')),
      detailRow(m, 'Contact', f('OPAL_THERAPIST_PHONE') + run('  |  ') + f('OPAL_THERAPIST_EMAIL')),
      row([
        cell(DETAIL_W[0], run('Signature'), { fill: TEAL, style: S('TableHeader') }),
        cell(DETAIL_W[1], '', { fill: PAPER }),
      ], { height: 900 }),
      detailRow(m, 'Date', f('OPAL_REPORT_DATE')),
    ])
    + spacer(40)));

  // ── Appendices (the FCA's tag, so attachments list here) ───────────────
  out.push(section(m, 'OPAL_SECTION_APPENDICES',
    heading(1, 'Appendices', { pageBreakBefore: true })
    + para(run('The following documents are attached to, and form part of, this report.'), { style: S('Body') })));

  return out.join('');
}

// ── Packaging ───────────────────────────────────────────────────────────────

function replaceBody(documentXml, bodyXml) {
  const open = documentXml.indexOf('<w:body>') + '<w:body>'.length;
  const finalSect = documentXml.lastIndexOf('<w:sectPr');
  if (open < 8 || finalSect < open) throw new Error('build: shell document has no body/final sectPr');
  return documentXml.slice(0, open) + bodyXml + documentXml.slice(finalSect);
}

function replaceAllStrict(xml, from, to, part) {
  if (!xml.includes(from)) throw new Error(`build: ${part} no longer contains "${from}"`);
  return xml.split(from).join(to);
}

function coreProps(title, subject, keywords) {
  return '<?xml version=\'1.0\' encoding=\'UTF-8\' standalone=\'yes\'?>\n'
    + '<coreProperties xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
    + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://schemas.openxmlformats.org/package/2006/metadata/core-properties">'
    + `<dc:title>${esc(title)}</dc:title><dc:subject>${esc(subject)}</dc:subject><dc:creator>Opal Therapy</dc:creator>`
    + `<keywords>${esc(keywords)}</keywords><lastModifiedBy>Opal Therapy</lastModifiedBy><revision>1</revision>`
    + '<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-07T00:00:00Z</dcterms:created>'
    + '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-07T00:00:00Z</dcterms:modified></coreProperties>';
}

async function rezip(zip) {
  // Fixed entry dates keep the output deterministic.
  const out = new JSZip();
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    out.file(name, await entry.async('nodebuffer'), { date: FIXED_DATE, createFolders: false });
  }
  return out.generateAsync({
    type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 },
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

async function buildLetter() {
  sdtId = 52000;                       // per-build, so each file is order-independent
  const zip = await JSZip.loadAsync(fs.readFileSync(LETTER_SHELL));
  const doc = await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml', replaceBody(doc, letterBody()));
  let header = await zip.file('word/header6.xml').async('string');
  header = replaceAllStrict(header, '<w:t>PROFESSIONAL CORRESPONDENCE</w:t>', '<w:t>LETTER OF SUPPORT</w:t>', 'header6');
  zip.file('word/header6.xml', header);
  zip.file('docProps/core.xml', coreProps(letterMap.TEMPLATE_NAME,
    'Opal Therapy letter of support for an NDIS participant',
    'Opal Therapy; letter of support; funding recommendation; NDIS; occupational therapy'));
  return rezip(zip);
}

async function buildReport() {
  sdtId = 62000;
  const zip = await JSZip.loadAsync(fs.readFileSync(REPORT_SHELL));
  const doc = await zip.file('word/document.xml').async('string');
  const fcaBody = doc.slice(doc.indexOf('<w:body>') + '<w:body>'.length);
  zip.file('word/document.xml', replaceBody(doc, reportBody(fcaBody)));

  const rewrite = async (part, pairs) => {
    let xml = await zip.file(part).async('string');
    for (const [from, to] of pairs) xml = replaceAllStrict(xml, from, to, part);
    zip.file(part, xml);
  };
  await rewrite('word/header5.xml', [
    ['FUNCTIONAL ASSESSMENT REPORT', 'PROGRESS REPORT'],
    ['TEMPLATE CONTROL | CONFIDENTIAL', 'CONFIDENTIAL'],
  ]);
  await rewrite('word/header6.xml', [['FUNCTIONAL ASSESSMENT REPORT', 'PROGRESS REPORT']]);
  await rewrite('word/footer5.xml', [[
    'Opal Therapy | Functional Assessment Report Template | Confidential',
    'Opal Therapy | Occupational Therapy Progress Report | Confidential',
  ]]);
  await rewrite('word/footer6.xml', [[
    'Opal Therapy | Functional Assessment Report', 'Opal Therapy | Occupational Therapy Progress Report',
  ]]);
  zip.file('docProps/core.xml', coreProps(reportMap.TEMPLATE_NAME,
    'Opal Therapy occupational therapy progress report for NDIS plan review',
    'Opal Therapy; progress report; NDIS; plan review; occupational therapy'));
  return rezip(zip);
}

async function main() {
  const outputs = [
    [path.join(TEMPLATES_DIR, letterMap.TEMPLATE_FILENAME), await buildLetter()],
    [path.join(TEMPLATES_DIR, reportMap.TEMPLATE_FILENAME), await buildReport()],
  ];
  for (const [file, buffer] of outputs) {
    fs.writeFileSync(file, buffer);
    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    console.log(`${path.relative(process.cwd(), file)}  ${buffer.length} bytes  sha256 ${sha}`);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { buildLetter, buildReport };
