'use strict';

/**
 * PREVIEW PAGINATION — make the document's own page breaks visible to the
 * browser renderer. Pure: a Buffer in, a Buffer out, no I/O and no clock.
 *
 * ── The defect this exists for ──────────────────────────────────────────────
 * The Opal report template starts each major section on a new page the way
 * Word authors normally do it: `<w:pageBreakBefore/>` in the paragraph's
 * properties. The shipped template carries nineteen of them (Contents,
 * Referral Information, each functional domain, Summary and Recommendations,
 * the declaration, the appendices…).
 *
 * docx-preview 0.4.0 PARSES that property — `parseParagraphProperties` stores
 * it as `pageBreakBefore` — and then never reads it again. Its page grouping
 * (`splitBySection` / `groupByPageBreaks`) starts a new page element for
 * exactly two things: a `w:br w:type="page"` run, and a section break. The
 * FCA document has neither between its sections, so all nineteen breaks were
 * dropped and the whole report rendered as ONE page element: a single sheet
 * several metres long, with no page boundaries and nothing to space apart.
 *
 * ── Why this is the right layer ─────────────────────────────────────────────
 * The break information is already in the document and it is correct. Nothing
 * is invented here and no break is added between arbitrary paragraphs: every
 * inserted break stands where the template itself said "new page". This is a
 * renderer-input normalisation — the same instruction, restated in the one
 * form this renderer understands.
 *
 * It is applied to the PREVIEW STREAM ONLY. The downloaded .docx is composed
 * by the same helper and shipped untouched, because Word honours
 * `w:pageBreakBefore` natively and rewriting it would change the file the
 * therapist edits. Content and ordering are identical either way: this adds
 * break paragraphs and removes the property they replace, and touches nothing
 * else.
 *
 * ── The two rules that keep the page count honest ───────────────────────────
 * 1. A break is never inserted before the first element in the document —
 *    that would produce an empty leading page.
 * 2. A break is never inserted where the previous element ALREADY ends the
 *    page (a section break, or a page break run). Word collapses those; a
 *    second break here would render an empty page between the two.
 */

const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCUMENT_PART = 'word/document.xml';

/** Direct element child with the given qualified name. */
function directChild(el, name) {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && n.nodeName === name) return n;
  }
  return null;
}

/**
 * The body's flow in document order: paragraphs and tables, with content
 * controls flattened.
 *
 * Flattening matters. Every optional section in the Opal template is a w:sdt,
 * and docx-preview flattens sdt content into the body's element list before it
 * groups pages (`parseBodyElements` → `case "sdt"`). A walker that stopped at
 * the control would miss fourteen of the nineteen breaks.
 *
 * Table interiors are deliberately NOT walked: a `w:pageBreakBefore` on a
 * paragraph inside a cell does not start a page in Word either.
 */
function bodyFlow(el, out) {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    if (n.nodeName === 'w:p' || n.nodeName === 'w:tbl') out.push(n);
    else if (n.nodeName === 'w:sdt') {
      const content = directChild(n, 'w:sdtContent');
      if (content) bodyFlow(content, out);
    }
  }
  return out;
}

/** True when this paragraph already carries an explicit page-break run. */
function hasPageBreakRun(p) {
  const brs = p.getElementsByTagName('w:br');
  for (let i = 0; i < brs.length; i += 1) {
    if (brs[i].getAttribute('w:type') === 'page') return true;
  }
  return false;
}

/** `<w:val="0">` / `"false"` switch the property off; anything else is on. */
function propertyIsOn(node) {
  const val = node.getAttribute('w:val');
  return !(val === '0' || val === 'false');
}

function breakParagraph(doc) {
  const p = doc.createElementNS(W, 'w:p');
  const r = doc.createElementNS(W, 'w:r');
  const br = doc.createElementNS(W, 'w:br');
  br.setAttribute('w:type', 'page');
  r.appendChild(br);
  p.appendChild(r);
  return p;
}

/**
 * Rewrite one word/document.xml so every `w:pageBreakBefore` becomes the
 * explicit break run that precedes it.
 *
 * @returns {{ xml: string, inserted: number, found: number }}
 */
function paginateDocumentXml(xml) {
  const doc = new DOMParser().parseFromString(String(xml), 'text/xml');
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) return { xml: String(xml), inserted: 0, found: 0 };

  const flow = bodyFlow(body, []);
  let inserted = 0;
  let found = 0;
  // Nothing precedes the first element, so the document already "starts a
  // page" — rule 1 and rule 2 are the same guard, held in one variable.
  let alreadyBroken = true;

  for (const node of flow) {
    if (node.nodeName !== 'w:p') { alreadyBroken = false; continue; }

    const pPr = directChild(node, 'w:pPr');
    const pageBreakBefore = pPr ? directChild(pPr, 'w:pageBreakBefore') : null;

    if (pageBreakBefore) {
      found += 1;
      const on = propertyIsOn(pageBreakBefore);
      // Removed either way: the property has been expressed as a real break,
      // and leaving it would double the break if the renderer ever learns to
      // read it.
      pPr.removeChild(pageBreakBefore);
      if (on && !alreadyBroken) {
        node.parentNode.insertBefore(breakParagraph(doc), node);
        inserted += 1;
      }
    }

    alreadyBroken = !!(pPr && directChild(pPr, 'w:sectPr')) || hasPageBreakRun(node);
  }

  return { xml: new XMLSerializer().serializeToString(doc), inserted, found };
}

/**
 * The same, over a whole .docx package.
 *
 * Failure is not fatal: a package this cannot rewrite is returned exactly as
 * it arrived, so the worst case is the preview the therapist had before —
 * never a broken preview and never a broken download.
 *
 * @param {Buffer} buffer composed .docx
 * @returns {Promise<Buffer>}
 */
async function paginateForPreview(buffer) {
  if (!buffer || !buffer.length) return buffer;
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    return buffer;
  }
  const part = zip.file(DOCUMENT_PART);
  if (!part) return buffer;

  try {
    const xml = await part.async('string');
    const { xml: next, inserted } = paginateDocumentXml(xml);
    if (!inserted) return buffer;
    zip.file(DOCUMENT_PART, next);
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch (err) {
    return buffer;
  }
}

module.exports = {
  paginateForPreview,
  paginateDocumentXml,
  _internals: { bodyFlow, hasPageBreakRun, directChild },
};
