'use strict';

/**
 * PROGRESS NOTE LETTER — the thin, document-type-specific layer that sits on
 * top of the shared DOCX engine.
 *
 *   generateLetterDocx({ templateBuffer, manifest }) → Promise<Buffer>
 *
 * There is NO second engine here. Scalar population across every part,
 * nesting-aware w:sdt removal by direct-child tag, sibling ordering, custom
 * content at an anchor, repackaging and package validation are all
 * docx-engine.js, unchanged and shared with the FCA report. This file supplies
 * only the three things a letter genuinely does differently:
 *
 *   1. CUSTOM BLOCKS are prose, not report sections. A block is an optional
 *      short label styled OPAL–BodyEmphasis followed by an OPAL–Body paragraph.
 *      There is no outline level and no heading style, because this document
 *      has no headings and no table of contents — a heading would look wrong on
 *      the page and there is nothing for it to be collected into.
 *   2. MULTILINE VALUES. A recipient address, a CC list, the letterhead address
 *      and a qualifications line are all genuinely multi-line, and the template
 *      declares those controls w:text multiLine="1". The engine writes them as
 *      real w:br elements between runs inside the control's own w:r, so the
 *      template's run properties apply to every line.
 *   3. OPTIONAL-LINE CLEANUP. Six controls sit alone in a paragraph, three of
 *      them behind a literal label. When the value is absent the ENTIRE w:p is
 *      deleted, so no letter ever ships with a naked "CC:" or a stray
 *      "[PORTAL — RECIPIENT ROLE]".
 *
 * TOC rebuilding is switched OFF: this template has no TOC field at all, and
 * saying so explicitly is better than relying on the rebuild happening to find
 * nothing to do.
 */

const { composeDocx, _internals } = require('./docx-engine');
const {
  STYLE,
  LETTER_CONTROL_PARTS,
  LETTER_CUSTOM_SECTION_ANCHOR,
  LETTER_MULTILINE_TAGS,
  LETTER_OPTIONAL_LINE_TAGS,
} = require('./letter-template-map');

const { el, styledParagraph } = _internals;

/**
 * One custom letter block.
 *
 * The label paragraph is omitted entirely when there is no label — an empty
 * bold paragraph would show up as a blank line in the middle of a letter. The
 * body paragraph is always emitted, even when empty, because it is what the
 * therapist types into: the block must stay editable in Word.
 *
 * `section` comes straight from the manifest and already carries the tag the
 * server minted for it.
 */
function buildLetterCustomSection(doc, section, id) {
  const sdt = el(doc, 'w:sdt');

  const pr = el(doc, 'w:sdtPr');
  pr.appendChild(el(doc, 'w:alias', {
    'w:val': `PORTAL LETTER SECTION — ${section.title || 'Custom content'} — CUSTOM`,
  }));
  pr.appendChild(el(doc, 'w:tag', { 'w:val': section.tag }));
  pr.appendChild(el(doc, 'w:id', { 'w:val': String(id) }));
  // Deliberately NO w:lock: a generated block is a starting point the therapist
  // finishes in Word, so it must remain fully editable and deletable.
  sdt.appendChild(pr);

  const content = el(doc, 'w:sdtContent');
  if (section.title) {
    content.appendChild(styledParagraph(doc, STYLE.BODY_EMPHASIS, section.title));
  }
  content.appendChild(styledParagraph(doc, STYLE.BODY, section.guidance || ''));
  sdt.appendChild(content);

  return sdt;
}

/** The progress-note letter's composition options. */
const LETTER_OPTIONS = {
  label: 'Letter engine',
  controlParts: LETTER_CONTROL_PARTS,
  customSectionAnchor: LETTER_CUSTOM_SECTION_ANCHOR,
  buildCustomSection: buildLetterCustomSection,
  multilineTags: new Set(LETTER_MULTILINE_TAGS),
  dropParagraphWhenEmpty: new Set(LETTER_OPTIONAL_LINE_TAGS),
  rebuildToc: false,
};

/**
 * @param {Buffer} templateBuffer  the raw progress-note-letter-v1.docx bytes
 * @param {object} manifest        the frozen composition manifest
 * @returns {Promise<Buffer>}
 */
function generateLetterDocx({ templateBuffer, manifest }) {
  return composeDocx({ templateBuffer, manifest, options: LETTER_OPTIONS });
}

/**
 * The last line of defence: no generated letter may contain an unresolved
 * "[PORTAL — …]" placeholder.
 *
 * The route already refuses to generate when a required value is missing, and
 * the engine already deletes the paragraph behind every optional one, so this
 * should never fire. It is here because those two rules are enforced in two
 * different files against two different lists, and the promise made to the
 * therapist is about the BYTES that reach the recipient. Checking the finished
 * package is the only check that is actually about that.
 *
 * Drafting guidance in the template's own blocks — "[State the purpose of the
 * letter…]" — is deliberately NOT matched: it is prose the therapist replaces
 * in Word, not an unpopulated control.
 *
 * @throws {Error} listing the offending parts
 */
async function assertNoPortalPlaceholders(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);

  const offenders = [];
  for (const name of LETTER_CONTROL_PARTS) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async('string');
    // The placeholders are written with an EM DASH in the template.
    if (/\[PORTAL\s+[—–-]/.test(xml)) offenders.push(name);
  }

  if (offenders.length) {
    throw new Error(
      `Letter engine: unresolved portal placeholders remain in ${offenders.join(', ')}.`
    );
  }
}

module.exports = {
  generateLetterDocx,
  buildLetterCustomSection,
  assertNoPortalPlaceholders,
  LETTER_OPTIONS,
};
