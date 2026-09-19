'use strict';

/**
 * PREVIEW PAGINATION — make the document's own page breaks visible to the
 * browser renderer. Pure: a Buffer in, a Buffer out, no I/O and no clock.
 *
 * ── The defect this exists for ──────────────────────────────────────────────
 * docx-preview 0.4.0 starts a new page element for exactly two things: a
 * `w:br w:type="page"` run, and a section break. It never paginates by
 * content. An FCA report with neither between its sections therefore renders
 * as ONE page element: a single sheet several metres long, with no page
 * boundaries and nothing to space apart.
 *
 * ── The document carries NO page breaks, on purpose ─────────────────────────
 * The shipped template used to start each major section with
 * `w:pageBreakBefore`. Those flags were removed (18 Sep 2026, Antony's
 * instruction): the downloaded Word file must contain no page breaks of any
 * kind — headings never jump to a new page and Enter behaves; a therapist who
 * wants a new page presses Enter until there is one. So the break information
 * is no longer in the document, and the preview has to know the template's
 * structure instead.
 *
 * ── What the preview breaks on ──────────────────────────────────────────────
 * Every optional section of the report is a content control (`w:sdt`) whose
 * tag starts `OPAL_SECTION_`. The preview starts a new page at the first
 * paragraph of each such control — except the assessment-tool blocks
 * (`OPAL_SECTION_ASSESSMENT_TOOL_*`), which are sub-blocks of the Assessment
 * Method page — and at the Contents title. That reproduces the page plan the
 * template used to declare (Contents, each main heading, each functional
 * domain, each recommendation group) without a single break in the file.
 *
 * A `w:pageBreakBefore` property, if a template ever carries one again, is
 * still honoured the old way. Either way this is applied to the PREVIEW
 * STREAM ONLY: the download is composed by the same helper and shipped
 * untouched.
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

const SECTION_TAG = /^OPAL_SECTION_/;
const SUB_BLOCK_TAG = /^OPAL_SECTION_ASSESSMENT_TOOL_/;
const CONTENTS_STYLE = 'OPAL\u2013DocumentTitle';

/** The `w:tag` value of a content control, or null. */
function sdtTag(sdt) {
  const pr = directChild(sdt, 'w:sdtPr');
  const tag = pr ? directChild(pr, 'w:tag') : null;
  return tag ? tag.getAttribute('w:val') : null;
}

/** First paragraph in a content control's flow (nested controls flattened). */
function firstParagraph(sdt) {
  const content = directChild(sdt, 'w:sdtContent');
  if (!content) return null;
  const flow = bodyFlow(content, []);
  return flow.find((n) => n.nodeName === 'w:p') || null;
}

/**
 * Paragraphs that begin a report section: the first paragraph of every
 * `OPAL_SECTION_*` control that is not an assessment-tool sub-block, at any
 * nesting depth (the functional domains sit inside Assessment Results, the
 * recommendation groups inside Summary and Recommendations).
 */
function sectionStarts(el, out) {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    if (n.nodeName === 'w:sdt') {
      const tag = sdtTag(n) || '';
      if (SECTION_TAG.test(tag) && !SUB_BLOCK_TAG.test(tag)) {
        const p = firstParagraph(n);
        if (p) out.add(p);
      }
      const content = directChild(n, 'w:sdtContent');
      if (content) sectionStarts(content, out);
    }
  }
  return out;
}

/** The "Contents" title paragraph — a document title that is not the cover's. */
function isContentsTitle(p, text) {
  const pPr = directChild(p, 'w:pPr');
  const st = pPr ? directChild(pPr, 'w:pStyle') : null;
  return !!st && st.getAttribute('w:val') === CONTENTS_STYLE && /^contents$/i.test(text);
}

function paragraphText(p) {
  const ts = p.getElementsByTagName('w:t');
  let out = '';
  for (let i = 0; i < ts.length; i += 1) out += ts[i].textContent || '';
  return out.replace(/\s+/g, ' ').trim();
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
 * Does this paragraph's section break end the page? A `continuous` break does
 * not — the renderer keeps flowing on the same sheet (the FCA cover ends in
 * one, and the Contents title after it still needs its own page).
 */
function endsPageWithSection(pPr) {
  const sectPr = pPr ? directChild(pPr, 'w:sectPr') : null;
  if (!sectPr) return false;
  const type = directChild(sectPr, 'w:type');
  return !(type && type.getAttribute('w:val') === 'continuous');
}

/**
 * Rewrite one word/document.xml so the preview starts a new page at every
 * report section (and at the Contents title), and so any `w:pageBreakBefore`
 * a template still carries becomes the explicit break run that precedes it.
 *
 * @returns {{ xml: string, inserted: number, found: number, sections: number }}
 */
function paginateDocumentXml(xml) {
  const doc = new DOMParser().parseFromString(String(xml), 'text/xml');
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) return { xml: String(xml), inserted: 0, found: 0, sections: 0 };

  const flow = bodyFlow(body, []);
  const starts = sectionStarts(body, new Set());
  let inserted = 0;
  let found = 0;
  // Nothing precedes the first element, so the document already "starts a
  // page" — rule 1 and rule 2 are the same guard, held in one variable.
  let alreadyBroken = true;

  for (const node of flow) {
    if (node.nodeName !== 'w:p') { alreadyBroken = false; continue; }

    const pPr = directChild(node, 'w:pPr');
    const pageBreakBefore = pPr ? directChild(pPr, 'w:pageBreakBefore') : null;
    let wantsBreak = starts.has(node) || isContentsTitle(node, paragraphText(node));

    if (pageBreakBefore) {
      found += 1;
      // Removed either way: the property has been expressed as a real break,
      // and leaving it would double the break if the renderer ever learns to
      // read it.
      pPr.removeChild(pageBreakBefore);
      if (propertyIsOn(pageBreakBefore)) wantsBreak = true;
    }

    if (wantsBreak && !alreadyBroken) {
      node.parentNode.insertBefore(breakParagraph(doc), node);
      inserted += 1;
    }

    alreadyBroken = endsPageWithSection(pPr) || hasPageBreakRun(node);
  }

  return { xml: new XMLSerializer().serializeToString(doc), inserted, found, sections: starts.size };
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
  _internals: { bodyFlow, hasPageBreakRun, directChild, sectionStarts, sdtTag },
};
