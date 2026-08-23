'use strict';

/**
 * SERVICE AGREEMENT — the document-type layer on the shared DOCX engine.
 *
 *   generateAgreementDocx({ templateBuffer, manifest, audience }) → Promise<Buffer>
 *   assertNoForbiddenTokens(buffer)                               → Promise<void>
 *
 * There is NO third engine here. Scalar population across every part,
 * nesting-aware removal by direct-child tag, sibling ordering, custom content
 * at an anchor, repeat-row cloning, repackaging and package validation are all
 * fca/docx-engine.js — the same code that composes the FCA report and the
 * progress-note letter. This file supplies only what a service agreement
 * genuinely does differently.
 *
 * ── AUDIENCE IS THE ONE REAL BRANCH ────────────────────────────────────────
 * Two audiences, and the difference is not cosmetic:
 *
 *   'participant'  everything a participant, plan manager or NDIS auditor may
 *                  see. The two internal governance blocks are REMOVED, and
 *                  the finished bytes are scanned for forbidden tokens before
 *                  a single one is returned.
 *   'owner'        the master itself, downloaded by an owner to edit in Word.
 *                  The internal blocks stay — they are drafting instructions
 *                  addressed to the owner, and stripping them from the file
 *                  the owner is about to edit would delete the guidance and
 *                  then silently reintroduce it on the next upload.
 *
 * A caller must name the audience. There is no default: "which copy is this"
 * is exactly the question that must never be answered by accident, because
 * getting it wrong sends a participant Opal's internal governance notes.
 *
 * ── BLANK FIELDS ARE THE MANIFEST'S JOB, NOT THE ENGINE'S ──────────────────
 * The engine leaves a control alone when its value is null — which keeps the
 * template's own "[PORTAL — …]" placeholder, correct for the FCA report where
 * that placeholder is a prompt to finish the job in Word. It is WRONG here:
 * this document goes to a participant.
 *
 * So ./manifest.js gives every one of the 83 scalars a string, always. A field
 * with no value gets '' (a blank, still-editable control) or its human-readable
 * prompt, never the bracketed placeholder. By the time bytes reach this file
 * there is nothing left to strip — and assertNoForbiddenTokens() exists to
 * prove that, not to do it.
 */

const JSZip = require('jszip');

const { composeDocx, _internals } = require('../fca/docx-engine');
const map = require('./template-map');

const { el, styledParagraph } = _internals;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * One owner-authored custom clause.
 *
 * A clause is a heading plus one or more body paragraphs. Unlike the letter's
 * custom blocks, the heading is a real OPAL–Heading2 with an explicit outline
 * level: this document HAS a heading hierarchy, and a clause that does not
 * appear in it reads as an afterthought pasted onto the end.
 *
 * `w:lock` is deliberately absent. A generated clause must stay editable in
 * Word, because the owner's next revision is made by editing this very file.
 */
function buildCustomClause(doc, section, id) {
  const sdt = el(doc, 'w:sdt');

  const pr = el(doc, 'w:sdtPr');
  pr.appendChild(el(doc, 'w:alias', {
    'w:val': `OWNER CLAUSE — ${String(section.title || 'Custom clause').slice(0, 60)} — CUSTOM`,
  }));
  pr.appendChild(el(doc, 'w:tag', { 'w:val': section.tag }));
  pr.appendChild(el(doc, 'w:id', { 'w:val': String(id) }));
  sdt.appendChild(pr);

  const content = el(doc, 'w:sdtContent');
  if (section.title) {
    content.appendChild(styledParagraph(doc, map.STYLE.HEADING2, section.title, 1));
  }

  // Body is plain text with blank-line paragraph breaks. Rich formatting is
  // deliberately NOT accepted here — ./clause-sanitiser.js reduces the owner's
  // input to this shape before it is ever stored, so an unsafe run cannot
  // reach the document by reaching this function.
  const paragraphs = String(section.body || '')
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) paragraphs.push('');
  for (const text of paragraphs) {
    content.appendChild(styledParagraph(doc, map.STYLE.BODY, text));
  }

  sdt.appendChild(content);
  return sdt;
}

/** Composition options, per audience. */
function optionsFor(audience) {
  return {
    label: `Service agreement engine (${audience})`,
    controlParts: map.CONTROL_PARTS,
    customSectionAnchor: map.CUSTOM_CLAUSE_ANCHOR,
    buildCustomSection: buildCustomClause,
    multilineTags: new Set(map.MULTILINE_TAGS),
    // No tag here owns a whole optional line: every scalar sits in a table cell
    // or beside a label that must survive an empty value, because the blank
    // control IS the thing a participant writes in. Deleting the paragraph
    // would delete the field they were asked to complete.
    dropParagraphWhenEmpty: null,
    // The template has no TOC field. Saying so is better than relying on the
    // rebuild happening to find nothing.
    rebuildToc: false,
  };
}

/**
 * Compose one service agreement .docx.
 *
 * @param {Buffer} templateBuffer  the pinned master's bytes — NOT the current
 *        master. An issued agreement composes against the version it was
 *        issued with, which is the whole point of pinning.
 * @param {object} manifest        from ./manifest.js: scalarData, sections,
 *        repeatRows, excludedTags
 * @param {'participant'|'owner'} audience
 * @returns {Promise<Buffer>} with `.docxStats` attached by the engine
 */
async function generateAgreementDocx({ templateBuffer, manifest, audience }) {
  if (audience !== 'participant' && audience !== 'owner') {
    throw new Error(
      `Service agreement engine: audience must be 'participant' or 'owner', got ${JSON.stringify(audience)}.`
    );
  }

  const sections = Array.isArray(manifest.sections) ? [...manifest.sections] : [];

  // The internal blocks are removed for a participant by ADDING them to the
  // section list as excluded, so removal goes through the engine's one
  // nesting-aware path rather than a second bespoke deletion here.
  if (audience === 'participant') {
    for (const tag of map.INTERNAL_BLOCK_TAGS) {
      const existing = sections.find((s) => s && s.tag === tag);
      if (existing) existing.included = false;
      else sections.push({ tag, included: false });
    }
  }

  const buffer = await composeDocx({
    templateBuffer,
    manifest: { ...manifest, sections },
    options: optionsFor(audience),
  });

  if (audience === 'participant') {
    await assertNoForbiddenTokens(buffer);
    await assertNoInternalBlocks(buffer);
  }

  return buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
//  The last line of defence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * No participant-facing document may contain an internal placeholder or a raw
 * tag. Throws, listing what was found and where.
 *
 * This should never fire. The manifest gives every scalar a string, the engine
 * clears every placeholder it writes into, and the internal blocks are removed
 * before this runs. It exists anyway because those are three separate rules
 * enforced in three separate files, and the promise made to a participant is
 * about the BYTES. Checking the finished package is the only check that is
 * actually about the bytes.
 *
 * Text is compared with runs JOINED. Word splits a string across runs freely —
 * "[PORTAL — " and "PARTICIPANT NAME]" can be two w:t nodes — so a per-node
 * search would miss exactly the case that matters most.
 */
async function assertNoForbiddenTokens(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const offences = [];

  for (const name of map.CONTROL_PARTS) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async('string');
    const text = joinedText(xml);
    for (const f of map.FORBIDDEN_TEXT_PATTERNS) {
      const hit = text.match(f.re);
      if (hit) {
        offences.push(`${name}: ${f.name} — "${String(hit[0]).slice(0, 60)}"`);
      }
    }
  }

  if (offences.length) {
    throw new Error(
      `Service agreement engine: the generated document still contains internal content and `
      + `will not be released — ${offences.join('; ')}.`
    );
  }
}

/**
 * The two internal governance blocks must be gone from a participant copy,
 * structurally — not merely invisible.
 *
 * A separate check from the token scan because they fail differently: a block
 * whose prose happens to contain no bracketed placeholder would pass the token
 * scan while still shipping Opal's internal governance notes to a participant.
 */
async function assertNoInternalBlocks(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const present = [];

  for (const name of map.CONTROL_PARTS) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async('string');
    for (const tag of map.INTERNAL_BLOCK_TAGS) {
      if (xml.includes(`<w:tag w:val="${tag}"/>`)) present.push(`${tag} in ${name}`);
    }
  }

  if (present.length) {
    throw new Error(
      `Service agreement engine: internal governance content survived into a participant `
      + `document — ${present.join(', ')}.`
    );
  }
}

/** Visible text of a part with runs joined, entities decoded. */
function joinedText(xml) {
  const out = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml))) {
    out.push(m[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&'));
  }
  return out.join('');
}

module.exports = {
  generateAgreementDocx,
  buildCustomClause,
  assertNoForbiddenTokens,
  assertNoInternalBlocks,
  optionsFor,
  joinedText,
  DOCX_MIME,
};
