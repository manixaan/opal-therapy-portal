'use strict';

/**
 * OPAL DOCX ENGINE — pure document composition. No database, no network, no
 * filesystem, no clock, no randomness beyond the ids the caller supplies in
 * the manifest.
 *
 *   generateFcaDocx({ templateBuffer, manifest })    → Promise<Buffer>
 *   composeDocx({ templateBuffer, manifest, options }) → Promise<Buffer>
 *
 * composeDocx is the engine. generateFcaDocx is composeDocx pinned to the
 * Functional Assessment Report's options, and is byte-for-byte the behaviour it
 * always had. A SECOND document type (the progress-note letter) is a second
 * OPTIONS OBJECT, never a second engine — see fca/letter-blocks.js.
 *
 * ── What the options carry ──────────────────────────────────────────────────
 *   controlParts            parts that may hold content controls
 *   customSectionAnchor     tag replaced by the therapist's custom blocks
 *   buildCustomSection      (doc, section, id) → w:sdt — the ONLY document-type
 *                           specific piece of composition
 *   multilineTags           tags whose value renders as real w:br line breaks
 *                           instead of one flat run (empty for the FCA)
 *   dropParagraphWhenEmpty  tags whose ENTIRE enclosing w:p is deleted when the
 *                           value is absent, so a label like "CC: " can never
 *                           ship naked (empty for the FCA)
 *   rebuildToc              whether to regenerate the cached contents list
 *   label                   prefix used in thrown messages
 *
 * THE MANIFEST IS THE ONLY INPUT. The engine never resolves a value, never
 * consults Splose, never decides whether a section belongs — it renders
 * exactly what the manifest says, so the preview the therapist approved and
 * the document that lands on disk are composed from the same object.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 * 1. SCALARS. Every occurrence of every scalar tag is populated, in
 *    word/document.xml AND in the header/footer parts (OPAL_CLIENT_PREFERRED_NAME
 *    and OPAL_CLIENT_NDIS_NUMBER live in word/header6.xml;
 *    OPAL_REPORT_DOCUMENT_ID lives in word/footer6.xml). A body-only
 *    implementation would ship blank headers, which is why parts are walked
 *    generically rather than hard-coded to the document part.
 *    Run properties are preserved: the value is written into the FIRST w:t of
 *    the control and the remaining w:t nodes are blanked, so every w:rPr in
 *    the template survives untouched. A null value is left completely alone —
 *    the template's own placeholder stays, and the string 'null'/'undefined'
 *    can never reach the page.
 *
 * 1a. EXCLUDED TAGS (manifest.excludedTags). A therapist may say outright that
 *    a field does not apply, which is a different statement from "we could not
 *    find a value". A missing value keeps the template's own
 *    "[PORTAL — …]" placeholder, because that is a visible prompt to finish
 *    the job in Word. An EXCLUDED tag must leave nothing at all, and takes one
 *    of exactly two shapes, chosen by the TEMPLATE'S own declaration rather
 *    than by the caller:
 *      - a tag listed in dropParagraphWhenEmpty owns a whole optional line, so
 *        its entire w:p goes, exactly as an absent value already does — a
 *        naked "CC:" is as much a failure when it was excluded as when it was
 *        blank;
 *      - every other tag is written as an EMPTY string. The control survives,
 *        blank and still typeable in Word, and the placeholder text is gone.
 *    Nothing else in the pipeline special-cases exclusion; it is one option in
 *    one place.
 *
 * 2. SECTIONS. An unselected optional section is removed by deleting exactly
 *    the w:sdt whose OWN w:sdtPr/w:tag carries that tag. "Own" is the whole
 *    point: optional controls are NESTED inside required parents (five
 *    assessment tools inside ASSESSMENT_METHOD, nine domains plus the custom
 *    anchor inside ASSESSMENT_RESULTS, two recommendation groups inside
 *    SUMMARY_RECOMMENDATIONS), so a descendant-matching implementation would
 *    delete the parent and take the whole report with it. Lookups are strictly
 *    direct-child, which makes required ancestors structurally safe.
 *
 * 3. ORDER. Included sections are reordered among their own siblings according
 *    to the manifest, in place: the DOM slots the section controls occupied
 *    are rewritten in the new order, so the parent's own intro paragraphs and
 *    guidance blocks stay exactly where the template put them.
 *
 * 4. CUSTOM SECTIONS. OPAL_ANCHOR_CUSTOM_SECTIONS is replaced by one w:sdt per
 *    custom section — unique w:id, tag OPAL_SECTION_CUSTOM_{SLUG}_{UUID}, a
 *    heading paragraph styled OPAL–Heading2 with an explicit w:outlineLvl so
 *    it reaches the table of contents, an optional guidance paragraph, and an
 *    empty OPAL–Body paragraph to type into. With no custom sections the
 *    anchor is removed entirely, leaving no trace of the placeholder prose.
 *
 * 5. TABLE OF CONTENTS. See rebuildToc() for the honest limits.
 *
 * 6. VALIDATION. The finished package is re-opened and checked before a single
 *    byte is returned: zip integrity, every original part still present, every
 *    modified part well-formed XML, no relationship id left dangling, and the
 *    footer PAGE/NUMPAGES fields byte-identical to the template's.
 */

const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const {
  STYLE,
  CONTROL_PARTS,
  CUSTOM_SECTION_ANCHOR,
} = require('./template-map');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ── Small DOM helpers ────────────────────────────────────────────────────────

/** Direct element children with the given qualified name. */
function directChildren(el, name) {
  const out = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && n.nodeName === name) out.push(n);
  }
  return out;
}

function directChild(el, name) {
  return directChildren(el, name)[0] || null;
}

/** True when `node` is `ancestor` or sits inside it. (xmldom has no .contains) */
function isSelfOrAncestorOf(ancestor, node) {
  for (let n = node; n; n = n.parentNode) if (n === ancestor) return true;
  return false;
}

/**
 * Descendants with `name`, WITHOUT descending into nested w:sdt elements.
 * Everything that touches a control's content uses this so a parent control
 * can never reach into a child control's runs.
 */
function ownDescendants(root, name) {
  const out = [];
  (function walk(node) {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      if (n.nodeName === name) out.push(n);
      if (n.nodeName === 'w:sdt') continue; // nested control — not ours
      walk(n);
    }
  }(root));
  return out;
}

/** Every w:sdt in the part, outermost first (document order). */
function allSdts(doc) {
  return Array.from(doc.getElementsByTagName('w:sdt'));
}

/** The tag a control carries on its OWN sdtPr — never a descendant's. */
function ownTag(sdt) {
  const pr = directChild(sdt, 'w:sdtPr');
  if (!pr) return null;
  const tag = directChild(pr, 'w:tag');
  return tag ? tag.getAttribute('w:val') : null;
}

function paragraphStyle(p) {
  const pPr = directChild(p, 'w:pPr');
  if (!pPr) return null;
  const st = directChild(pPr, 'w:pStyle');
  return st ? st.getAttribute('w:val') : null;
}

/** Concatenated visible text of a paragraph, excluding field instructions. */
function paragraphText(p) {
  let out = '';
  (function walk(node) {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      if (n.nodeName === 'w:instrText' || n.nodeName === 'w:fldChar') continue;
      if (n.nodeName === 'w:t') out += n.textContent || '';
      else walk(n);
    }
  }(p));
  return out.trim();
}

function setTextNode(t, value) {
  while (t.firstChild) t.removeChild(t.firstChild);
  if (value !== '') {
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(t.ownerDocument.createTextNode(value));
  }
}

/**
 * Write a value that may contain line breaks into the control's first w:t.
 *
 * A raw "\n" inside a w:t is NOT a line break in WordprocessingML — Word
 * renders it as a space (or drops it), so a three-line recipient address would
 * arrive as one run-on line. The only correct representation is a w:br element
 * between runs of text, and it must live inside the SAME w:r so the template's
 * own w:rPr (font, size, colour, spacing) applies to every line rather than
 * only the first.
 *
 * The extra w:t/w:br nodes are inserted immediately after the anchor text node,
 * in order, so the surrounding literal text of the paragraph is untouched.
 */
function setMultilineTextNode(t, value) {
  const lines = String(value).split(/\r\n|\r|\n/);
  setTextNode(t, lines[0]);
  if (lines.length === 1) return;

  const doc = t.ownerDocument;
  const parent = t.parentNode;
  let after = t;
  for (let i = 1; i < lines.length; i++) {
    const br = el(doc, 'w:br');
    parent.insertBefore(br, after.nextSibling);
    const next = el(doc, 'w:t');
    setTextNode(next, lines[i]);
    parent.insertBefore(next, br.nextSibling);
    after = next;
  }
}

function el(doc, name, attrs) {
  const node = doc.createElementNS(W, name);
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// ── 1. Scalars ───────────────────────────────────────────────────────────────

/**
 * Populate every occurrence of every scalar tag in one part.
 * Returns the number of occurrences written.
 */
function populateScalars(doc, scalarData, warnings, partName, multilineTags) {
  let written = 0;

  for (const sdt of allSdts(doc)) {
    const tag = ownTag(sdt);
    if (!tag || !Object.prototype.hasOwnProperty.call(scalarData, tag)) continue;

    const raw = scalarData[tag];
    // A null/undefined value leaves the template's own placeholder in place.
    // This is the rule that stops 'null' and 'undefined' ever being printed.
    if (raw === null || raw === undefined) continue;
    const value = String(raw);

    const content = directChild(sdt, 'w:sdtContent');
    if (!content) {
      warnings.push(`Control ${tag} in ${partName} has no w:sdtContent; left unpopulated.`);
      continue;
    }

    let texts = ownDescendants(content, 'w:t');

    if (texts.length === 0) {
      // No text node to write into — add one to an existing run if we can, so
      // we still inherit that run's properties rather than inventing styling.
      const run = ownDescendants(content, 'w:r')[0];
      if (run) {
        const t = el(doc, 'w:t');
        run.appendChild(t);
        texts = [t];
      } else {
        const para = ownDescendants(content, 'w:p')[0];
        if (!para) {
          warnings.push(`Control ${tag} in ${partName} has no run to populate; left unpopulated.`);
          continue;
        }
        const r = el(doc, 'w:r');
        const t = el(doc, 'w:t');
        r.appendChild(t);
        para.appendChild(r);
        texts = [t];
      }
    }

    // Blank the trailing text nodes BEFORE writing, so a multiline write's own
    // freshly inserted w:t siblings are never mistaken for template leftovers.
    for (let i = 1; i < texts.length; i++) setTextNode(texts[i], '');
    if (multilineTags && multilineTags.has(tag)) setMultilineTextNode(texts[0], value);
    else setTextNode(texts[0], value);

    // The control now holds real content, so it is no longer showing Word's
    // placeholder. Leaving this in makes Word re-substitute the placeholder.
    const pr = directChild(sdt, 'w:sdtPr');
    if (pr) {
      for (const ph of directChildren(pr, 'w:showingPlcHdr')) pr.removeChild(ph);
    }

    written += 1;
  }

  return written;
}

// ── 2. Section removal ───────────────────────────────────────────────────────

/**
 * Delete every control whose OWN tag is in `removeTags`.
 * Direct-child tag lookup means a nested optional can be removed without ever
 * touching its required ancestor.
 */
function removeSections(doc, removeTags, removed) {
  if (removeTags.size === 0) return;

  // Snapshot first: removing nodes while iterating a live NodeList skips nodes.
  for (const sdt of allSdts(doc)) {
    const tag = ownTag(sdt);
    if (!tag || !removeTags.has(tag)) continue;
    // A parent may already have taken this node with it.
    if (!sdt.parentNode) continue;
    sdt.parentNode.removeChild(sdt);
    removed.push(tag);
  }
}

/**
 * Delete the ENTIRE paragraph that carries a control, not just the control.
 *
 * Some optional values sit inside a paragraph that also holds a literal label:
 * "CC: [control]" and "AHPRA registration: [control]". Removing only the
 * control leaves a naked "CC:" on the page, which reads as an unfinished
 * document — so when such a value is absent the whole w:p goes.
 *
 * Returns the tags whose paragraph was actually removed.
 */
function removeParagraphsContaining(doc, tags, removed) {
  if (!tags || tags.size === 0) return;

  for (const sdt of allSdts(doc)) {
    const tag = ownTag(sdt);
    if (!tag || !tags.has(tag)) continue;
    if (!sdt.parentNode) continue; // an earlier removal already took it

    let para = null;
    for (let n = sdt.parentNode; n; n = n.parentNode) {
      if (n.nodeName === 'w:p') { para = n; break; }
      if (n.nodeName === 'w:body' || n.nodeName === 'w:tc') break;
    }

    // No enclosing paragraph (a control wrapping whole blocks) — drop the
    // control itself rather than reaching further up and taking a table cell.
    const target = para && para.parentNode ? para : sdt;
    target.parentNode.removeChild(target);
    removed.push(tag);
  }
}

// ── 3. Sibling ordering ──────────────────────────────────────────────────────

/**
 * Reorder included section controls among their own siblings.
 * Only the slots the controls already occupy are rewritten, so the template's
 * own paragraphs keep their positions relative to everything else.
 */
function applySectionOrder(doc, orderByTag) {
  const groups = new Map(); // parentNode → [{ node, order }]

  for (const sdt of allSdts(doc)) {
    const tag = ownTag(sdt);
    if (!tag || !orderByTag.has(tag)) continue;
    const parent = sdt.parentNode;
    if (!parent) continue;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push({ node: sdt, order: orderByTag.get(tag) });
  }

  for (const [parent, items] of groups) {
    if (items.length < 2) continue;

    // Mark each slot with a throwaway node FIRST. Using the controls' own
    // next-siblings as anchors does not work: adjacent controls anchor on each
    // other, and once those are detached the anchors are stale and the nodes
    // land at the end of the parent in the wrong order. Markers are stable
    // because they are never part of the moving set.
    const doc = parent.ownerDocument;
    const markers = items.map((it) => parent.insertBefore(doc.createTextNode(''), it.node));

    const sorted = items.slice().sort((a, b) => a.order - b.order);
    for (const it of items) parent.removeChild(it.node);
    for (let i = 0; i < sorted.length; i++) parent.insertBefore(sorted[i].node, markers[i]);
    for (const m of markers) parent.removeChild(m);
  }
}

// ── 4. Custom sections ───────────────────────────────────────────────────────

/** Every w:id already used by a content control, so new ones cannot collide. */
function usedSdtIds(docs) {
  const used = new Set();
  for (const doc of docs) {
    for (const idEl of Array.from(doc.getElementsByTagName('w:id'))) {
      const v = parseInt(idEl.getAttribute('w:val'), 10);
      if (Number.isFinite(v)) used.add(v);
    }
  }
  return used;
}

function styledParagraph(doc, styleId, text, outlineLvl) {
  const p = el(doc, 'w:p');
  const pPr = el(doc, 'w:pPr');
  pPr.appendChild(el(doc, 'w:pStyle', { 'w:val': styleId }));
  // The style already carries an outline level, but stating it on the
  // paragraph makes the TOC membership of a generated heading explicit and
  // survives a style being edited later.
  if (outlineLvl !== undefined) {
    pPr.appendChild(el(doc, 'w:outlineLvl', { 'w:val': String(outlineLvl) }));
  }
  p.appendChild(pPr);

  const r = el(doc, 'w:r');
  const t = el(doc, 'w:t');
  if (text) setTextNode(t, text);
  r.appendChild(t);
  p.appendChild(r);
  return p;
}

/**
 * Build one custom-section control. `section` comes straight from the manifest
 * and already carries the tag the server minted for it.
 */
function buildCustomSection(doc, section, id) {
  const sdt = el(doc, 'w:sdt');
  const pr = el(doc, 'w:sdtPr');
  pr.appendChild(el(doc, 'w:alias', { 'w:val': `PORTAL SECTION — ${section.title} — CUSTOM` }));
  pr.appendChild(el(doc, 'w:tag', { 'w:val': section.tag }));
  pr.appendChild(el(doc, 'w:id', { 'w:val': String(id) }));
  sdt.appendChild(pr);

  const content = el(doc, 'w:sdtContent');
  content.appendChild(styledParagraph(doc, STYLE.HEADING2, section.title, 1));
  if (section.guidance) {
    content.appendChild(styledParagraph(doc, STYLE.PLACEHOLDER, section.guidance));
  }
  content.appendChild(styledParagraph(doc, STYLE.BODY, ''));
  sdt.appendChild(content);

  return sdt;
}

/**
 * Replace the anchor control with the custom sections, or remove it outright.
 * `builder` is the document type's own section constructor — the only piece of
 * composition that differs between an FCA report and a progress-note letter.
 * Returns the number of custom sections written.
 */
function applyCustomSections(doc, customSections, idAllocator, warnings, anchorTag, builder) {
  if (!anchorTag) return 0;

  const anchor = allSdts(doc).find((s) => ownTag(s) === anchorTag);
  if (!anchor) {
    if (customSections.length > 0) {
      warnings.push(`Custom sections were requested but ${anchorTag} is not present in this template.`);
    }
    return 0;
  }

  const parent = anchor.parentNode;
  for (const section of customSections) {
    parent.insertBefore(builder(doc, section, idAllocator()), anchor);
  }
  parent.removeChild(anchor); // no custom sections → the anchor simply goes
  return customSections.length;
}

// ── 5. Table of contents ─────────────────────────────────────────────────────

const TOC_LEVEL_BY_STYLE = new Map([
  [STYLE.HEADING1, 1],
  [STYLE.HEADING2, 2],
  [STYLE.HEADING3, 3],
]);

/**
 * Word's own "exclude from table of contents" marker: a heading whose
 * paragraph sets `w:outlineLvl w:val="9"` (Body Text level) is styled as a
 * heading but deliberately kept out of the TOC. The FCA master uses it on its
 * template-guide heading; honouring it is what Word itself does.
 */
function excludedFromToc(p) {
  const pPr = directChild(p, 'w:pPr');
  if (!pPr) return false;
  const lvl = directChild(pPr, 'w:outlineLvl');
  return Boolean(lvl && lvl.getAttribute('w:val') === '9');
}

function runsWithFieldChars(p) {
  return ownDescendants(p, 'w:r').filter((r) => (
    directChild(r, 'w:fldChar') || directChild(r, 'w:instrText')
  ));
}

/**
 * Rebuild the cached TOC result so the contents list matches the document that
 * was actually composed.
 *
 * WHAT THIS DOES: the real TOC field and w:updateFields are both preserved, and
 * the cached entries are regenerated from the FINAL body — after unselected
 * sections have been removed and custom sections inserted. Entry paragraphs are
 * cloned from the template's own cached entries, so TOC1/TOC2/TOC3 styling,
 * fonts, colours and dot leaders are the template's, not ours.
 *
 * WHAT IS HONESTLY IMPOSSIBLE WITHOUT WORD: page numbers. Pagination depends on
 * a layout engine — line breaking, widow/orphan control, table row splitting,
 * the actual rendered height of every block. Nothing in this process can know
 * which page a heading lands on, and a plausible-looking guess in a clinical
 * document is worse than no number at all. So rebuilt entries carry the correct
 * titles, in the correct order, at the correct level, with an EMPTY page-number
 * slot. w:updateFields="true" is kept, so Word fills the numbers in the moment
 * the document is opened, and the template's own reminder to update the field
 * before issue is left in place. The document is therefore never stale in its
 * entry list — only in its page numbers, and visibly so rather than wrongly.
 */
/**
 * Remove table rows that belonged to an excluded section.
 *
 * Structural: the whole <w:tr> element is detached from its parent. The row is
 * IDENTIFIED by the exact text of its first cell, matched against labels the
 * manifest supplies from an explicit declaration — this is a lookup, not a
 * search-and-replace over the document body, and it can only ever remove a
 * whole row that the map named.
 *
 * A label that matches nothing is reported. Silence there would mean a template
 * edit could quietly sever the dependency and put a MoCA row back into a report
 * that excluded MoCA.
 */
function removeDependentRows(doc, labels, warnings, removed) {
  if (!labels || !labels.length) return;
  const wanted = new Set(labels.map((l) => String(l).trim()));
  const found = new Set();

  const rows = Array.from(doc.getElementsByTagName('w:tr'));
  for (const tr of rows) {
    const cells = tr.getElementsByTagName('w:tc');
    if (!cells || cells.length === 0) continue;
    // First cell only: a tool name appearing in a later column is data, not
    // the row's identity.
    const texts = cells[0].getElementsByTagName('w:t');
    let label = '';
    for (let i = 0; i < texts.length; i++) label += texts[i].textContent || '';
    label = label.trim();
    if (!wanted.has(label)) continue;
    found.add(label);
    if (tr.parentNode) {
      tr.parentNode.removeChild(tr);
      removed.push(label);
    }
  }

  for (const l of wanted) {
    if (!found.has(l)) {
      warnings.push(`Dependent row "${l}" was not found in the template; the section was excluded but no matching results row was removed.`);
    }
  }
}

function rebuildToc(doc, warnings) {
  const body = directChild(doc.documentElement, 'w:body');
  if (!body) return { entries: 0 };

  // Locate the TOC field: begin → separate → cached result → end.
  let beginRun = null;
  let beginPara = null;
  for (const p of Array.from(body.getElementsByTagName('w:p'))) {
    for (const r of ownDescendants(p, 'w:r')) {
      const instr = directChild(r, 'w:instrText');
      if (instr && /\bTOC\b/.test(instr.textContent || '')) {
        beginRun = r;
        beginPara = p;
        break;
      }
    }
    if (beginRun) break;
  }
  if (!beginRun) return { entries: 0 }; // no TOC in this template — nothing to do

  // Walk top-level body children to find the paragraph range of the field.
  const topLevel = Array.from(body.childNodes).filter((n) => n.nodeType === 1);
  const startIdx = topLevel.findIndex((n) => isSelfOrAncestorOf(n, beginPara));
  if (startIdx < 0) {
    warnings.push('TOC field is not a direct child of the body; cached entries left untouched.');
    return { entries: 0 };
  }

  let depth = 0;
  let endIdx = -1;
  let endRun = null;
  for (let i = startIdx; i < topLevel.length; i++) {
    const node = topLevel[i];
    if (node.nodeName !== 'w:p') continue;
    for (const r of ownDescendants(node, 'w:r')) {
      const fc = directChild(r, 'w:fldChar');
      if (!fc) continue;
      const type = fc.getAttribute('w:fldCharType');
      if (type === 'begin') depth += 1;
      else if (type === 'end') {
        depth -= 1;
        if (depth === 0) { endIdx = i; endRun = r; break; }
      }
    }
    if (endIdx >= 0) break;
  }
  if (endIdx < 0) {
    warnings.push('TOC field has no matching end; cached entries left untouched.');
    return { entries: 0 };
  }

  const cached = topLevel.slice(startIdx, endIdx + 1);

  // Entry templates, one per level, taken from the template's own cache with
  // the field runs stripped so only formatting is inherited.
  const entryTemplate = new Map();
  for (const p of cached) {
    const style = paragraphStyle(p);
    const level = style && /^TOC([123])$/.test(style) ? Number(style.slice(3)) : null;
    if (!level || entryTemplate.has(level)) continue;
    const clone = p.cloneNode(true);
    for (const r of runsWithFieldChars(clone)) r.parentNode.removeChild(r);
    if (ownDescendants(clone, 'w:t').length >= 1) entryTemplate.set(level, clone);
  }
  if (entryTemplate.size === 0) {
    warnings.push('No reusable TOC entry paragraph found; cached entries left untouched.');
    return { entries: 0 };
  }

  // Headings of the FINAL document, in document order, skipping the TOC itself.
  const inToc = new Set();
  for (const p of cached) {
    inToc.add(p);
    for (const inner of Array.from(p.getElementsByTagName('w:p'))) inToc.add(inner);
  }

  const headings = [];
  for (const p of Array.from(body.getElementsByTagName('w:p'))) {
    if (inToc.has(p)) continue;
    const level = TOC_LEVEL_BY_STYLE.get(paragraphStyle(p));
    if (!level) continue;
    if (excludedFromToc(p)) continue;
    const text = paragraphText(p);
    if (text) headings.push({ level, text });
  }

  // Build the replacement paragraphs.
  const built = headings.map(({ level, text }) => {
    const tpl = entryTemplate.get(level) || entryTemplate.get(1) || entryTemplate.values().next().value;
    const p = tpl.cloneNode(true);
    const pPr = directChild(p, 'w:pPr');
    const pStyle = pPr && directChild(pPr, 'w:pStyle');
    if (pStyle) pStyle.setAttribute('w:val', `TOC${level}`);
    const texts = ownDescendants(p, 'w:t');
    setTextNode(texts[0], text);
    // Page numbers cannot be computed outside Word — see the block comment.
    for (let i = 1; i < texts.length; i++) setTextNode(texts[i], '');
    return p;
  });

  if (built.length === 0) {
    // Keep a valid, empty field rather than emitting a broken one.
    built.push(el(doc, 'w:p'));
  }

  // Re-attach the field structure: begin+instr+separate at the very front of
  // the first paragraph, end at the very back of the last.
  const firstPara = built[0];
  const firstPPr = directChild(firstPara, 'w:pPr');
  firstPara.insertBefore(beginRun, firstPPr ? firstPPr.nextSibling : firstPara.firstChild);
  built[built.length - 1].appendChild(endRun);

  const anchorNode = cached[cached.length - 1].nextSibling;
  for (const p of cached) body.removeChild(p);
  for (const p of built) {
    if (anchorNode && anchorNode.parentNode === body) body.insertBefore(p, anchorNode);
    else body.appendChild(p);
  }

  return { entries: headings.length };
}

// ── 6. Validation ────────────────────────────────────────────────────────────

function parsePart(xml, partName, label = 'FCA engine') {
  const errors = [];
  const doc = new DOMParser({
    onError: (level, msg) => { if (level === 'error' || level === 'fatalError') errors.push(String(msg)); },
  }).parseFromString(xml, 'text/xml');

  if (errors.length) {
    throw new Error(`${label}: ${partName} is not well-formed XML — ${errors[0]}`);
  }
  if (!doc || !doc.documentElement) {
    throw new Error(`${label}: ${partName} could not be parsed.`);
  }
  return doc;
}

/** Count of PAGE / NUMPAGES field instructions in a part. */
function countPageFields(xml) {
  const instr = xml.match(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g) || [];
  let page = 0;
  let numPages = 0;
  for (const chunk of instr) {
    if (/\bNUMPAGES\b/.test(chunk)) numPages += 1;
    else if (/\bPAGE\b/.test(chunk)) page += 1;
  }
  return { page, numPages };
}

/** Relationship ids referenced by a part, and the ids its .rels actually defines. */
async function checkRelationships(zip, partName, xml, label = 'FCA engine') {
  const referenced = new Set();
  const re = /\s(?:r:id|r:embed|r:link|r:pict|r:dm|r:lo|r:qs|r:cs)="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml))) referenced.add(m[1]);
  if (referenced.size === 0) return;

  const relsName = partName.replace(/([^/]+)$/, '_rels/$1.rels');
  const relsFile = zip.file(relsName);
  const defined = new Set();
  if (relsFile) {
    const relsXml = await relsFile.async('string');
    const rre = /\sId="([^"]+)"/g;
    let rm;
    while ((rm = rre.exec(relsXml))) defined.add(rm[1]);
  }

  for (const id of referenced) {
    if (!defined.has(id)) {
      throw new Error(`${label}: ${partName} references relationship ${id}, which ${relsFile ? 'is not defined in' : 'has no'} ${relsName}.`);
    }
  }
}

async function validatePackage(buffer, originalNames, originalPageFields, modifiedParts, label = 'FCA engine') {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new Error(`${label}: produced package is not a readable zip — ${err.message}`);
  }

  const names = new Set(Object.keys(zip.files));
  for (const name of originalNames) {
    if (!names.has(name)) throw new Error(`${label}: part ${name} is missing from the produced package.`);
  }
  const original = new Set(originalNames);
  for (const name of names) {
    if (!original.has(name)) throw new Error(`${label}: unexpected part ${name} appeared in the produced package.`);
  }

  for (const name of modifiedParts) {
    const xml = await zip.file(name).async('string');
    parsePart(xml, name, label); // throws on malformed XML
    await checkRelationships(zip, name, xml, label);
  }

  // The footer page fields are load-bearing and must never be collateral damage.
  for (const [name, expected] of Object.entries(originalPageFields)) {
    const xml = await zip.file(name).async('string');
    const actual = countPageFields(xml);
    if (actual.page !== expected.page || actual.numPages !== expected.numPages) {
      throw new Error(
        `${label}: ${name} PAGE/NUMPAGES fields changed `
        + `(expected PAGE=${expected.page} NUMPAGES=${expected.numPages}, `
        + `got PAGE=${actual.page} NUMPAGES=${actual.numPages}).`
      );
    }
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** The Functional Assessment Report's composition options. */
const FCA_OPTIONS = {
  label: 'FCA engine',
  controlParts: CONTROL_PARTS,
  customSectionAnchor: CUSTOM_SECTION_ANCHOR,
  buildCustomSection,
  multilineTags: null,
  dropParagraphWhenEmpty: null,
  rebuildToc: true,
};

/**
 * Compose a document from a template and a manifest.
 *
 * @param {Buffer} templateBuffer  the raw .docx bytes
 * @param {object} manifest        the frozen composition manifest:
 *   { scalarData:   { TAG: value|null },
 *     excludedTags: [TAG],
 *     sections:     [{ tag, kind: 'required'|'optional'|'custom', title,
 *                      guidance?, included, order }] }
 * @param {object} options         see the file header; defaults to FCA_OPTIONS
 * @returns {Promise<Buffer>}
 */
async function composeDocx({ templateBuffer, manifest, options = FCA_OPTIONS }) {
  const opts = { ...FCA_OPTIONS, ...(options || {}) };
  const { label } = opts;

  if (!Buffer.isBuffer(templateBuffer) || templateBuffer.length === 0) {
    throw new Error(`${label}: templateBuffer must be a non-empty Buffer.`);
  }
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`${label}: a manifest is required.`);
  }

  const scalarData = manifest.scalarData || {};
  const sections = Array.isArray(manifest.sections) ? manifest.sections : [];

  // ── Exclusions ────────────────────────────────────────────────────────────
  // A tag the therapist has excluded contributes NOTHING to the document. The
  // template decides which of the two shapes that takes: a tag that owns a
  // whole optional line loses its paragraph (handled with the absent-value
  // cleanup below), and every other tag is written as an EMPTY string so the
  // control survives — blank and still editable in Word — with no
  // "[PORTAL — …]" placeholder left in it.
  const excludedTags = new Set(
    Array.isArray(manifest.excludedTags) ? manifest.excludedTags.map(String) : []
  );
  const optionalLineTags = opts.dropParagraphWhenEmpty
    ? new Set(opts.dropParagraphWhenEmpty)
    : new Set();

  const renderedScalars = { ...scalarData };
  for (const tag of excludedTags) {
    if (!optionalLineTags.has(tag)) renderedScalars[tag] = '';
  }

  const warnings = [];
  const removedTags = [];
  const removedParagraphTags = [];

  let zip;
  try {
    zip = await JSZip.loadAsync(templateBuffer);
  } catch (err) {
    throw new Error(`${label}: template is not a readable .docx — ${err.message}`);
  }

  const originalNames = Object.keys(zip.files);

  // Footer page-field baseline, captured before anything is touched.
  const originalPageFields = {};
  for (const name of originalNames.filter((n) => /^word\/footer\d*\.xml$/.test(n))) {
    originalPageFields[name] = countPageFields(await zip.file(name).async('string'));
  }

  // Parse every control-bearing part that this template actually has.
  const parts = new Map(); // name → { doc }
  for (const name of opts.controlParts) {
    const file = zip.file(name);
    if (!file) continue;
    parts.set(name, parsePart(await file.async('string'), name, label));
  }
  if (!parts.has('word/document.xml')) {
    throw new Error(`${label}: template has no word/document.xml.`);
  }

  // ── Sections: what to drop, what order to keep ────────────────────────────
  const removeTags = new Set();
  const orderByTag = new Map();
  const customSections = [];

  for (const s of sections) {
    if (!s || !s.tag) continue;
    if (s.kind === 'custom') {
      if (s.included !== false) customSections.push(s);
      continue;
    }
    if (s.included === false) removeTags.add(s.tag);
    else if (Number.isFinite(s.order)) orderByTag.set(s.tag, s.order);
  }
  customSections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const docDoc = parts.get('word/document.xml');

  // ── Optional-line cleanup, BEFORE anything is populated ───────────────────
  // A tag listed here takes its whole paragraph with it, label and all, when
  // its value is absent OR when the therapist has excluded it — a naked "CC:"
  // reads as an unfinished letter either way. Done first so the scalar pass
  // never writes into a paragraph that is about to be deleted, and never
  // counts it as written.
  const dropTags = new Set();
  for (const tag of optionalLineTags) {
    const v = scalarData[tag];
    if (excludedTags.has(tag) || v === null || v === undefined || String(v).trim() === '') {
      dropTags.add(tag);
    }
  }
  for (const [, doc] of parts) removeParagraphsContaining(doc, dropTags, removedParagraphTags);

  for (const [, doc] of parts) removeSections(doc, removeTags, removedTags);

  // Dependent content travels with its section: a results row whose assessment
  // was excluded goes with it, so the table cannot contradict the report.
  const removedRows = [];
  const dependentRows = Array.isArray(manifest.dependentRows) ? manifest.dependentRows : [];
  for (const [, doc] of parts) removeDependentRows(doc, dependentRows, warnings, removedRows);

  applySectionOrder(docDoc, orderByTag);

  // ── Custom sections ───────────────────────────────────────────────────────
  const used = usedSdtIds(Array.from(parts.values()));
  let nextId = 90000;
  const idAllocator = () => {
    while (used.has(nextId)) nextId += 1;
    used.add(nextId);
    return nextId++;
  };
  const customWritten = applyCustomSections(
    docDoc, customSections, idAllocator, warnings,
    opts.customSectionAnchor, opts.buildCustomSection
  );

  // ── Scalars, across every part that carries controls ──────────────────────
  // Deliberately BEFORE the TOC rebuild: the cover-page title is a heading
  // whose text is a content control, so a TOC built first would list the
  // template placeholder instead of the participant's name.
  const multilineTags = opts.multilineTags instanceof Set
    ? opts.multilineTags
    : (Array.isArray(opts.multilineTags) ? new Set(opts.multilineTags) : null);

  let scalarsWritten = 0;
  for (const [name, doc] of parts) {
    scalarsWritten += populateScalars(doc, renderedScalars, warnings, name, multilineTags);
  }

  // ── Table of contents (last: the body must be final) ──────────────────────
  const toc = opts.rebuildToc ? rebuildToc(docDoc, warnings) : { entries: 0 };

  // ── Serialise and repackage ───────────────────────────────────────────────
  const serializer = new XMLSerializer();
  for (const [name, doc] of parts) {
    // createFolders:false — JSZip otherwise adds an implicit "word/" directory
    // entry that the template does not have. Word tolerates it, but the
    // produced package should differ from the template only where we meant it to.
    zip.file(name, serializer.serializeToString(doc), { createFolders: false });
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  await validatePackage(buffer, originalNames, originalPageFields, Array.from(parts.keys()), label);

  // Attached for tests and for the generate route's warning channel; the
  // buffer is what callers actually consume. `fcaStats` is the historical name
  // and stays for the FCA routes and their tests; `docxStats` is the same
  // object under a document-type-neutral name.
  const stats = {
    scalarsWritten,
    removedSections: removedTags,
    removedParagraphs: removedParagraphTags,
    // Results-table rows deleted because their assessment section was excluded.
    removedDependentRows: removedRows,
    // What the therapist excluded, split by what actually happened to it, so a
    // test — and the generate route's warning channel — can tell an emptied
    // control from a deleted line without re-deriving the rule.
    excludedTags: Array.from(excludedTags),
    excludedAsEmptyControl: Array.from(excludedTags).filter((t) => !optionalLineTags.has(t)),
    excludedAsRemovedLine: Array.from(excludedTags).filter((t) => optionalLineTags.has(t)),
    customSections: customWritten,
    tocEntries: toc.entries,
    warnings,
  };
  buffer.fcaStats = stats;
  buffer.docxStats = stats;

  return buffer;
}

/** The FCA report, pinned to its own options. Behaviour is unchanged. */
function generateFcaDocx({ templateBuffer, manifest }) {
  return composeDocx({ templateBuffer, manifest, options: FCA_OPTIONS });
}

module.exports = {
  generateFcaDocx,
  composeDocx,
  FCA_OPTIONS,
  // Exported for focused unit tests only.
  _internals: {
    ownTag, directChild, ownDescendants, countPageFields, paragraphStyle, paragraphText,
    setMultilineTextNode, removeParagraphsContaining, styledParagraph, el, allSdts,
  },
};
