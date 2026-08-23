'use strict';

/**
 * SERVICE AGREEMENT — DOCX → OUTLINE
 *
 * Reads a COMPOSED service agreement .docx and returns a flat, renderable
 * outline: headings, paragraphs, list items and tables, with every content
 * control resolved either to the text it holds or to a FIELD the reader must
 * complete.
 *
 * ── WHY THE PDF IS BUILT FROM THE WORD DOCUMENT, NOT BESIDE IT ─────────────
 * The obvious design is the one opal-document-builder.js uses: one spec, two
 * renderers, DOCX and PDF built in parallel. That works when the portal
 * authors the content. It does not work here, because the content is not the
 * portal's — it is the OWNER'S master Word document, and the owner edits it in
 * Word. A parallel PDF renderer would need its own copy of every clause, and
 * the first time an owner reworded the cancellation clause in Word the two
 * documents would start saying different things about money.
 *
 * There is also no DOCX→PDF converter available: no LibreOffice, no soffice,
 * no headless Word, and the staging runtime is a plain Node image. So the PDF
 * is composed with pdf-lib — but from THIS outline, taken from the finished
 * Word bytes. One document, read twice.
 *
 * A useful consequence: everything the engine already did is simply true by
 * the time this runs. Internal blocks are gone, clauses are ordered and
 * filtered, custom clauses are inserted, support rows are cloned, scalars are
 * populated. This file has no opinion about any of it.
 *
 * ── FIELDS ARE EMPTY CONTROLS ──────────────────────────────────────────────
 * A control holding text is text. A control holding NOTHING is a field: the
 * manifest deliberately wrote '' into every scalar it had no value for, so an
 * empty control is a positive statement that this is a blank to be completed,
 * not an accident. That is the whole detection rule, and it is why the PDF
 * cannot disagree with the Word document about which fields are open.
 *
 * ── FIELD NAMING ───────────────────────────────────────────────────────────
 * A tag that appears in several places outside the support table — the
 * participant's name appears twice — yields ONE field with several widgets, so
 * typing the name once fills both. A tag inside a cloned support row is
 * indexed per row, because those are genuinely different values. `occurrence`
 * and `rowIndex` here carry what the renderer needs to make that distinction;
 * it does not re-derive it.
 */

const JSZip = require('jszip');

const map = require('./template-map');

const HEADING_LEVEL = new Map([
  ['OPAL–DocumentTitle', 0],
  ['OPAL–Heading1', 1],
  ['OPAL–Heading2', 2],
  ['OPAL–Heading3', 3],
  ['OPAL–Heading4', 4],
]);

const EMPHASIS_STYLES = new Set(['OPAL–BodyEmphasis', 'OPAL–KeyFinding', 'OPAL–Recommendation']);
const LIST_STYLES = new Set(['OPAL–Bullet', 'OPAL–NumberedList']);
const SMALL_STYLES = new Set(['OPAL–Caption', 'OPAL–DocumentControl', 'OPAL–ClinicalPrompt']);

/**
 * @param {Buffer} docxBuffer  a COMPOSED agreement, not the raw template
 * @returns {Promise<{blocks: Array, fields: Array, warnings: string[]}>}
 */
async function outlineFromDocx(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('Service agreement outline: the package has no word/document.xml.');
  const xml = await file.async('string');

  const body = sliceBody(xml);
  const state = {
    blocks: [],
    fields: [],
    warnings: [],
    // How many times each tag has been seen, so repeated controls can share a
    // field while cloned rows get their own.
    seen: Object.create(null),
    rowIndex: 0,
    inSupportRow: false,
  };

  walkBlocks(body, state);

  return { blocks: state.blocks, fields: state.fields, warnings: state.warnings };
}

/** The contents of w:body, without the trailing sectPr. */
function sliceBody(xml) {
  const start = xml.indexOf('<w:body>');
  const end = xml.lastIndexOf('</w:body>');
  if (start === -1 || end === -1) return xml;
  return xml.slice(start + 8, end).replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, '');
}

/**
 * Split a chunk of body XML into its top-level elements.
 *
 * Depth-aware on purpose: a w:tbl contains w:p elements, and a w:sdt may wrap
 * either. Matching with a regex alone would return a table's paragraphs as
 * siblings of the table.
 */
function topLevelElements(xml) {
  const out = [];
  const re = /<(w:p|w:tbl|w:sdt)(\s[^>]*)?(\/?)>/g;
  let m;
  let i = 0;
  while ((m = re.exec(xml))) {
    if (m.index < i) continue;
    const name = m[1];
    if (m[3] === '/') { i = re.lastIndex; continue; }   // self-closing <w:p/>
    const close = findClose(xml, name, m.index);
    if (close === -1) { i = re.lastIndex; continue; }
    out.push({ name, xml: xml.slice(m.index, close) });
    i = close;
    re.lastIndex = close;
  }
  return out;
}

/** Index just past the matching close tag for the element starting at `from`. */
function findClose(xml, name, from) {
  const open = new RegExp(`<${name}(\\s[^>]*)?>`, 'g');
  const close = new RegExp(`</${name}>`, 'g');
  open.lastIndex = from + 1;
  close.lastIndex = from + 1;
  let depth = 1;
  while (depth > 0) {
    const o = open.exec(xml);
    const c = close.exec(xml);
    if (!c) return -1;
    if (o && o.index < c.index) {
      depth += 1;
      close.lastIndex = c.index;
    } else {
      depth -= 1;
      if (depth === 0) return c.index + c[0].length;
      open.lastIndex = c.index;
    }
  }
  return -1;
}

function walkBlocks(xml, state) {
  for (const elem of topLevelElements(xml)) {
    if (elem.name === 'w:p') emitParagraph(elem.xml, state);
    else if (elem.name === 'w:tbl') emitTable(elem.xml, state);
    else if (elem.name === 'w:sdt') emitSdtBlock(elem.xml, state);
  }
}

/**
 * A block-level control. Its own tag decides only ONE thing here — whether we
 * are inside a cloned support row, which changes how its descendant fields are
 * named. Everything else recurses.
 */
function emitSdtBlock(xml, state) {
  const tag = ownTagOf(xml);
  const content = innerContent(xml);

  if (tag === map.REPEAT_SUPPORT_ROW) {
    state.rowIndex += 1;
    state.inSupportRow = true;
    walkBlocks(content, state);
    state.inSupportRow = false;
    return;
  }

  // An inline control that wraps runs rather than blocks — treat as a
  // paragraph so its text is not lost.
  if (!/<w:p[\s>]|<w:tbl[\s>]|<w:sdt>/.test(content)) {
    emitParagraph(`<w:p>${content}</w:p>`, state);
    return;
  }

  walkBlocks(content, state);
}

function emitParagraph(xml, state) {
  const style = (xml.match(/<w:pStyle w:val="([^"]*)"\/>/) || [])[1] || null;
  const runs = collectRuns(xml, state);
  const text = runs.map((r) => (r.type === 'text' ? r.text : '')).join('');

  const hasField = runs.some((r) => r.type === 'field');
  if (!text.trim() && !hasField) {
    state.blocks.push({ type: 'spacer' });
    return;
  }

  const level = HEADING_LEVEL.get(style);
  if (level !== undefined) {
    state.blocks.push({ type: 'heading', level, runs, text });
    return;
  }
  if (LIST_STYLES.has(style) || /<w:numPr>/.test(xml)) {
    state.blocks.push({
      type: 'list',
      ordered: style === 'OPAL–NumberedList',
      runs,
      text,
    });
    return;
  }
  state.blocks.push({
    type: 'paragraph',
    emphasis: EMPHASIS_STYLES.has(style),
    small: SMALL_STYLES.has(style),
    runs,
    text,
  });
}

function emitTable(xml, state) {
  // A repeatable support row is a w:sdt WRAPPING a w:tr, so the clones sit
  // inside the table rather than beside it. Their character ranges are found
  // first: without this, a cloned row's fields would be indistinguishable from
  // an ordinary cell's and three supports would collapse onto one field name.
  const repeatRanges = repeatRowRanges(xml);

  const rows = [];
  const rowRe = /<w:tr(?:\s[^>]*)?>/g;
  let m;
  while ((m = rowRe.exec(xml))) {
    const close = findClose(xml, 'w:tr', m.index);
    if (close === -1) break;
    const rowXml = xml.slice(m.index, close);
    rowRe.lastIndex = close;

    const inRepeat = repeatRanges.findIndex((r) => m.index >= r.start && close <= r.end);
    const wasInRow = state.inSupportRow;
    const wasRowIndex = state.rowIndex;
    if (inRepeat !== -1) {
      state.inSupportRow = true;
      state.rowIndex = inRepeat + 1;
    }

    const isHeader = /<w:tblHeader\/>/.test(rowXml) || /<w:pStyle w:val="OPAL–TableHeader"\/>/.test(rowXml);
    const cells = [];
    const cellRe = /<w:tc(?:\s[^>]*)?>/g;
    let c;
    while ((c = cellRe.exec(rowXml))) {
      const cellClose = findClose(rowXml, 'w:tc', c.index);
      if (cellClose === -1) break;
      const cellXml = rowXml.slice(c.index, cellClose);
      cellRe.lastIndex = cellClose;
      // A cell may hold several paragraphs; join them with newlines so the
      // renderer wraps them as one block of text rather than losing the break.
      const paras = [];
      for (const p of topLevelElements(cellXml)) {
        if (p.name === 'w:p') paras.push(collectRuns(p.xml, state));
        else if (p.name === 'w:sdt') paras.push(collectRuns(`<w:p>${innerContent(p.xml)}</w:p>`, state));
      }
      cells.push({ paragraphs: paras.length ? paras : [[]] });
    }
    if (cells.length) {
      rows.push({ header: isHeader, cells, supportRow: inRepeat === -1 ? null : inRepeat + 1 });
    }

    state.inSupportRow = wasInRow;
    state.rowIndex = wasRowIndex;
  }
  if (rows.length) state.blocks.push({ type: 'table', rows });
}

/**
 * Character ranges of every w:sdt in this table whose OWN tag is the repeat
 * row, in document order. Index 0 is support 1.
 */
function repeatRowRanges(xml) {
  const ranges = [];
  const re = /<w:sdt>/g;
  let m;
  while ((m = re.exec(xml))) {
    const close = findClose(xml, 'w:sdt', m.index);
    if (close === -1) break;
    if (ownTagOf(xml.slice(m.index, close)) === map.REPEAT_SUPPORT_ROW) {
      ranges.push({ start: m.index, end: close });
    }
    re.lastIndex = m.index + 1;
  }
  return ranges;
}

/**
 * Runs of a paragraph, with content controls resolved.
 *
 * Returns `{type:'text', text, bold, italic}` and `{type:'field', ...}`. The
 * field entries are ALSO pushed onto `state.fields` in document order, which
 * is what gives the PDF its tab order for free: the order a reader meets the
 * fields on the page is the order they were written.
 */
function collectRuns(xml, state) {
  const out = [];
  // Walk the paragraph as a token stream so a control's boundaries are
  // respected without a full DOM parse.
  const re = /<w:sdt>|<\/w:sdt>|<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  let m;
  const stack = [];
  let cursor = 0;

  while ((m = re.exec(xml))) {
    if (m.index < cursor) continue;
    if (m[0] === '<w:sdt>') {
      const close = findClose(xml, 'w:sdt', m.index);
      if (close === -1) { cursor = re.lastIndex; continue; }
      const seg = xml.slice(m.index, close);
      resolveControl(seg, state, out);
      cursor = close;
      re.lastIndex = close;
      continue;
    }
    if (m[0] === '</w:sdt>') { cursor = re.lastIndex; continue; }

    const runXml = m[0];
    const text = runText(runXml);
    if (text) {
      out.push({
        type: 'text',
        text,
        bold: /<w:b\/>|<w:b\s/.test(runXml),
        italic: /<w:i\/>|<w:i\s/.test(runXml),
      });
    }
    cursor = re.lastIndex;
  }
  void stack;
  return out;
}

/** A control: either the text it holds, or a field. */
function resolveControl(sdtXml, state, out) {
  const tag = ownTagOf(sdtXml);
  const content = innerContent(sdtXml);

  // Nested controls inside an inline control — recurse so their text and
  // fields are collected in order.
  const inner = collectRuns(`<w:p>${content}</w:p>`, state);

  const field = tag ? map.SCALAR_BY_TAG[tag] : null;
  if (!field) {
    for (const r of inner) out.push(r);
    return;
  }

  const text = inner.filter((r) => r.type === 'text').map((r) => r.text).join('');

  if (text.trim()) {
    // The control holds a value: it is text, not a field.
    out.push({ type: 'text', text, bold: false, italic: false, tag });
    return;
  }

  // Empty control → a field the reader completes.
  state.seen[tag] = (state.seen[tag] || 0) + 1;
  const occurrence = state.seen[tag];
  const inRow = state.inSupportRow && field.repeatRow;

  const entry = {
    type: 'field',
    tag,
    kind: field.kind,
    authority: field.authority,
    prompt: field.prompt,
    choices: field.choices,
    participantEditable: field.participantEditable,
    group: field.group,
    occurrence,
    rowIndex: inRow ? state.rowIndex : null,
    // One field, many widgets, when the same tag legitimately appears twice
    // outside the support table. A cloned row's field is its own.
    name: inRow ? `${field.pdfName} — support ${state.rowIndex}` : field.pdfName,
    index: state.fields.length,
  };
  state.fields.push(entry);
  out.push(entry);
}

function runText(runXml) {
  let text = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/>|<w:tab\s*\/>/g;
  let m;
  while ((m = re.exec(runXml))) {
    if (m[1] !== undefined) text += decode(m[1]);
    else if (m[0].startsWith('<w:br')) text += '\n';
    else text += '\t';
  }
  return text;
}

function decode(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The tag on this control's OWN sdtPr, ignoring any nested one. */
function ownTagOf(sdtXml) {
  const prStart = sdtXml.indexOf('<w:sdtPr>');
  if (prStart === -1) return null;
  const prEnd = sdtXml.indexOf('</w:sdtPr>', prStart);
  if (prEnd === -1) return null;
  const pr = sdtXml.slice(prStart, prEnd);
  return (pr.match(/<w:tag w:val="([^"]*)"\/>/) || [])[1] || null;
}

/** The contents of this control's own sdtContent. */
function innerContent(sdtXml) {
  const start = sdtXml.indexOf('<w:sdtContent>');
  if (start === -1) return '';
  const end = sdtXml.lastIndexOf('</w:sdtContent>');
  if (end === -1) return '';
  return sdtXml.slice(start + 14, end);
}

module.exports = {
  outlineFromDocx,
  _internals: { topLevelElements, findClose, ownTagOf, innerContent, runText, sliceBody },
};
