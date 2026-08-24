'use strict';

/**
 * DOCUMENT MODEL — read a SEVERED .docx back out as a linear sequence of
 * blocks. Pure: a Buffer in, a plain object out. No database, no network.
 *
 *   readDocumentModel(severedDocxBuffer) → { blocks, fields }
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The PDF export has to represent THE SAME document state as the Word export.
 * The only way to guarantee that rather than assert it is to stop composing the
 * two independently: the DOCX is severed first, and the PDF is then rendered
 * from what that severed DOCX actually contains. A value that reached the .docx
 * reaches the .pdf because it is literally the same bytes being read back; a
 * field left unfinished in one is unfinished in the other because it is the
 * same control being counted.
 *
 * That also means this module inherits the boundary for free. It runs AFTER
 * templates/export-boundary.js, so there is no OPAL_ tag and no "[PORTAL — …]"
 * prompt left to read — the only controls still standing are the neutral,
 * standalone text fields the boundary left behind, and they arrive here as
 * `{ type: 'field', label }` segments for pdf-lib to turn into real AcroForm
 * inputs.
 *
 * ── What is deliberately dropped ────────────────────────────────────────────
 * TOC paragraphs (styles TOC1/TOC2) and PAGE/NUMPAGES field runs. Both are
 * Word's own cached derivations of a layout the PDF does not share, so copying
 * them across would print page numbers that point at the wrong pages. They are
 * derived content, not document state: Word regenerates them, and the PDF
 * simply does not carry them.
 */

const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

/** Styles whose paragraphs are a cached table of contents, not content. */
const TOC_STYLES = /^TOC\d/;

/** How each master style renders. `list` prefixes a bullet. */
const STYLE_ROLES = {
  'OPAL–DocumentTitle': 'title',
  'OPAL–Subtitle': 'subtitle',
  'OPAL–Heading1': 'h1',
  'OPAL–Heading2': 'h2',
  'OPAL–Heading3': 'h3',
  'OPAL–Body': 'body',
  'OPAL–BodyEmphasis': 'emphasis',
  'OPAL–KeyFinding': 'emphasis',
  'OPAL–Recommendation': 'body',
  'OPAL–ClinicalPrompt': 'guidance',
  'OPAL–Placeholder': 'guidance',
  'OPAL–Bullet': 'list',
  'OPAL–NumberedList': 'list',
  'OPAL–TableHeader': 'body',
  'OPAL–TableBody': 'body',
};

const elems = (node, name) => Array.from(node.getElementsByTagName(name));

function directChildren(node, name) {
  const out = [];
  for (let n = node.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || n.nodeName === name)) out.push(n);
  }
  return out;
}

const directChild = (node, name) => directChildren(node, name)[0] || null;

function attrVal(node, name, attr) {
  const c = directChild(node, name);
  return c ? c.getAttribute(attr) : null;
}

function paragraphStyle(p) {
  const pPr = directChild(p, 'w:pPr');
  return pPr ? attrVal(pPr, 'w:pStyle', 'w:val') : null;
}

function hasPageBreakBefore(p) {
  const pPr = directChild(p, 'w:pPr');
  return Boolean(pPr && directChild(pPr, 'w:pageBreakBefore'));
}

/** The label a severed field carries. The boundary guarantees it is human. */
function fieldLabel(sdt) {
  const pr = directChild(sdt, 'w:sdtPr');
  const alias = pr ? directChild(pr, 'w:alias') : null;
  return alias ? (alias.getAttribute('w:val') || 'Field') : 'Field';
}

/**
 * Read one paragraph as an ordered list of segments. A paragraph may mix
 * literal text and standalone fields — "NDIS number: [field]" is one paragraph
 * with two segments, and flattening it to a string would lose the field.
 */
function readParagraph(p, fields) {
  const segments = [];
  let inFieldCode = false;

  const pushText = (text, bold, italic) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.type === 'text' && last.bold === bold && last.italic === italic) {
      last.text += text;
      return;
    }
    segments.push({ type: 'text', text, bold, italic });
  };

  (function walk(node) {
    for (const child of directChildren(node)) {
      const n = child.nodeName;

      if (n === 'w:sdt') {
        const content = directChild(child, 'w:sdtContent');
        // A control that survived severing is a standalone input. Its own
        // content is the fill rule, which the PDF replaces with a real field.
        const label = fieldLabel(child);
        segments.push({ type: 'field', label });
        fields.push(label);
        void content;
        continue;
      }

      if (n === 'w:r') {
        const rPr = directChild(child, 'w:rPr');
        const bold = Boolean(rPr && directChild(rPr, 'w:b'));
        const italic = Boolean(rPr && directChild(rPr, 'w:i'));

        for (const rc of directChildren(child)) {
          switch (rc.nodeName) {
            case 'w:fldChar': {
              const t = rc.getAttribute('w:fldCharType');
              // Between 'begin' and 'separate' lies the field CODE; between
              // 'separate' and 'end' lies Word's cached result. Both belong to
              // a layout this document does not share, so neither is read.
              if (t === 'begin') inFieldCode = true;
              if (t === 'end') inFieldCode = false;
              break;
            }
            case 'w:instrText':
              break;
            case 'w:t':
              if (!inFieldCode) pushText(rc.textContent || '', bold, italic);
              break;
            case 'w:br':
              if (!inFieldCode) segments.push({ type: 'break' });
              break;
            case 'w:tab':
              if (!inFieldCode) pushText('  ', bold, italic);
              break;
            default:
              break;
          }
        }
        continue;
      }

      // Hyperlinks and smart tags wrap runs without changing their meaning.
      if (n === 'w:hyperlink' || n === 'w:smartTag' || n === 'w:ins') walk(child);
    }
  }(p));

  return segments;
}

function readTable(tbl, fields) {
  const rows = [];
  for (const tr of directChildren(tbl, 'w:tr')) {
    const header = Boolean((() => {
      const trPr = directChild(tr, 'w:trPr');
      return trPr && directChild(trPr, 'w:tblHeader');
    })());
    const cells = [];
    for (const tc of directChildren(tr, 'w:tc')) {
      const paras = [];
      for (const block of directChildren(tc)) {
        if (block.nodeName === 'w:p') paras.push(readParagraph(block, fields));
        else if (block.nodeName === 'w:sdt') {
          const c = directChild(block, 'w:sdtContent');
          if (c) for (const p of directChildren(c, 'w:p')) paras.push(readParagraph(p, fields));
        }
      }
      cells.push(paras);
    }
    if (cells.length) rows.push({ header, cells });
  }
  return rows;
}

/**
 * @param {Buffer} buffer a SEVERED docx
 * @returns {{ blocks: Array, fields: string[] }}
 */
async function readDocumentModel(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('document model: word/document.xml is missing');

  const doc = new DOMParser().parseFromString(await file.async('string'), 'text/xml');
  const body = elems(doc, 'w:body')[0];
  if (!body) throw new Error('document model: w:body is missing');

  const blocks = [];
  const fields = [];

  (function walk(node) {
    for (const child of directChildren(node)) {
      const n = child.nodeName;

      if (n === 'w:p') {
        const style = paragraphStyle(child);
        if (style && TOC_STYLES.test(style)) continue;

        const segments = readParagraph(child, fields);
        const hasContent = segments.some(
          (s) => (s.type === 'text' && s.text.trim() !== '') || s.type === 'field'
        );
        blocks.push({
          type: 'paragraph',
          role: STYLE_ROLES[style] || 'body',
          style: style || null,
          pageBreakBefore: hasPageBreakBefore(child),
          segments: hasContent ? segments : [],
        });
        continue;
      }

      if (n === 'w:tbl') {
        blocks.push({ type: 'table', rows: readTable(child, fields) });
        continue;
      }

      // A block-level control contributes its children, in place.
      if (n === 'w:sdt') {
        const content = directChild(child, 'w:sdtContent');
        if (content) walk(content);
        continue;
      }
    }
  }(body));

  return { blocks, fields };
}

module.exports = { readDocumentModel, STYLE_ROLES, TOC_STYLES };
