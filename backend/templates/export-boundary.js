'use strict';

/**
 * EXPORT BOUNDARY — the one place a portal document becomes an independent
 * document. Pure: a Buffer in, a Buffer out. No database, no network, no clock.
 *
 *   severDocx({ buffer, controlParts, fields, internalTags, anchorTags,
 *               documentTitle }) → { buffer, fields, report }
 *
 * ── What this exists for ────────────────────────────────────────────────────
 * Inside Opal, a template is bound to portal data. Every completable value
 * lives in a `w:sdt` content control whose `w:sdtPr/w:tag` names an Opal
 * binding — OPAL_CLIENT_NDIS_NUMBER, OPAL_PARTICIPANT_PLAN_END_DATE — and an
 * unresolved control still shows the master's own prompt, `[PORTAL — PLAN END
 * DATE]`. That is exactly right for the in-portal document: the tag is how the
 * value gets there, and the prompt tells a clinician what is still outstanding.
 *
 * It is exactly wrong for a document that has left the building. A downloaded
 * file carrying `OPAL_PARTICIPANT_PLAN_END_DATE` and `[PORTAL — PLAN END DATE]`
 * is not a document; it is a portal artefact that still needs Opal to finish
 * itself, and it publishes Opal's internal field names to whoever opens it.
 *
 * So export is a HARD BOUNDARY, and this module is the whole of it:
 *
 *   resolve current authorised data   (caller: resolveScalars)
 *   snapshot the document state       (caller: composeDocx)
 *   ─── this module ──────────────────────────────────────────────────────
 *   preserve populated values         → unwrap the control, keep the text
 *   replace unresolved portal inputs  → a plain-text Word control, no binding
 *   remove portal dependency          → no OPAL_ tag, no [PORTAL — …] prompt,
 *                                       no master-template metadata
 *   ──────────────────────────────────────────────────────────────────────
 *   generate DOCX / PDF
 *
 * After this runs, nothing in the file refers to Opal's data model, and no
 * later portal change is needed for the document to be completed in Word.
 *
 * ── The three fates of a control ────────────────────────────────────────────
 * 1. POPULATED → UNWRAPPED. The `w:sdt` is replaced by its own
 *    `w:sdtContent` children, spliced into the parent at the same position.
 *    Every run, every `w:rPr`, every table cell survives byte-identically; the
 *    only thing that disappears is the `w:sdtPr` that named the binding. The
 *    value stops being "a slot Opal filled" and becomes ordinary document text,
 *    which is precisely what a resolved value should be once it has left.
 *
 * 2. UNFINISHED → NEUTRALISED, NOT REMOVED. The control stays — a plain-text
 *    content control is Word's own standalone form field, and keeping it is how
 *    the exported document remains completable without Opal. What changes:
 *      · `w:tag` (the Opal binding) is deleted outright;
 *      · `w:alias` is rewritten to the human label, so Word and screen readers
 *        announce "Plan end date" rather than an identifier;
 *      · `<w:text/>` is asserted, making it unambiguously a text field — or,
 *        for a field the map declares `isDate`, `<w:date>` with an Australian
 *        format, so Word offers its own calendar picker;
 *      · `w:showingPlcHdr` goes, because it points at a glossary placeholder
 *        the exported package does not carry;
 *      · the `[PORTAL — …]` prompt is deleted: the field exports EMPTY. A
 *        printed document shows a clean blank, not a row of underscores that
 *        reads as a defect (the PDF's matching AcroForm field stays visible
 *        because it draws its own bordered box).
 *    The result is an ordinary Word field: click it, type, done. Deliberately
 *    NOT highlighted — see NO_HIGHLIGHT below.
 *
 * 3. INTERNAL / ANCHOR → REMOVED. Opal's own governance prose, the published
 *    master's SHA-256, and the owner's custom-clause insertion points are
 *    portal implementation metadata. They are deleted whole. The Service
 *    Agreement master states this requirement itself, in the block it applies
 *    to: the internal block must not reach a participant copy.
 *
 * Anything else (a published clause, a schedule) is unwrapped like case 1: its
 * wording is the agreement and must survive verbatim; only the identifier goes.
 *
 * ── Master language that is not document content ────────────────────────────
 * The masters also carry text addressed to the PORTAL or to the template's
 * maintainer rather than to the document's reader — the FCA's "Using this FCA
 * template" page, a "TEMPLATE CONTROL" header band, and sentences inside
 * published clauses that instruct the portal ("the portal repeats the
 * prototype row below"). A completed document that still explains how its own
 * template works is a template-engine artefact, so each catalogue entry may
 * declare:
 *
 *   internalBlocks     [{ startHeading, endHeading }] — every block-level
 *                      element from the paragraph whose text is startHeading
 *                      (inclusive) to the one whose text is endHeading
 *                      (exclusive) is removed from word/document.xml;
 *   internalSentences  exact sentences deleted wherever they appear in a run;
 *   textReplacements   [{ find, replace }] — exact in-run rewording, used to
 *                      turn template-facing header/footer wording into
 *                      document wording.
 *
 * All three are verified after the fact: a declared string that still appears
 * in the finished package fails the export rather than shipping.
 *
 * ── Word's "update fields?" prompt ──────────────────────────────────────────
 * The masters set `<w:updateFields w:val="true"/>` so Word refreshes their TOC
 * while the TEMPLATE is being maintained. On a downloaded document that flag
 * is what makes Word open with "This document contains fields that may refer
 * to other files…" — so it is stripped, along with any `w:attachedTemplate`,
 * from word/settings.xml. The TOC itself is a native Word field and stays.
 *
 * ── NO_HIGHLIGHT ────────────────────────────────────────────────────────────
 * An unfinished field is given no shading and no highlight. A yellow field
 * reads as a defect or a redaction in a document a participant may see, and it
 * survives printing — this is a document, not a form-filling UI.
 *
 * ── The sweep ───────────────────────────────────────────────────────────────
 * Control rewriting handles every control. A final pass over the raw text of
 * each part then catches bracketed master prompts that are NOT inside a control
 * (the masters carry a few as literal paragraph text) and any OPAL_ identifier
 * that survived in an attribute this module does not know about. verifySevered()
 * re-reads the finished package and throws if either is still present, so a
 * leak fails the export rather than shipping.
 */

const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Word's date-picker declaration for a neutralised date field. The format is
 * the Australian short date; Word shows its own calendar drop-down when the
 * control is clicked, which is the "proper date-entry mechanism" the exported
 * document owes its reader.
 */
const DATE_FORMAT = 'd/MM/yyyy';
const DATE_LID = 'en-AU';

/**
 * Bracketed prompts the masters use for values the portal, the owner, the
 * server or a signing flow was expected to supply. Every one of them is a
 * reference to something outside the document, so none may survive export.
 */
const MASTER_PROMPT_RE = /\[(?:PORTAL|OWNER|SERVER|E-SIGN|ESIGN)\b[^\]]*\]/g;

/** Any Opal binding identifier, wherever it appears. */
const OPAL_IDENTIFIER_RE = /OPAL_[A-Z0-9_]+/g;

// ── DOM helpers ──────────────────────────────────────────────────────────────

const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');
const serialise = (doc) => new XMLSerializer().serializeToString(doc);

function directChildren(node, name) {
  const out = [];
  for (let n = node.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && n.nodeName === name) out.push(n);
  }
  return out;
}

const directChild = (node, name) => directChildren(node, name)[0] || null;

/** Every w:sdt in the part, in document order. */
function allSdts(doc) {
  return Array.from(doc.getElementsByTagName('w:sdt'));
}

/**
 * A control's OWN tag — the one on its direct w:sdtPr child. Descendant
 * matching would attribute a nested control's tag to its parent, which is how
 * an unwrap turns into "delete the whole schedule".
 */
function ownTag(sdt) {
  const pr = directChild(sdt, 'w:sdtPr');
  if (!pr) return null;
  const tag = directChild(pr, 'w:tag');
  return tag ? tag.getAttribute('w:val') : null;
}

/** Still attached to the document? A node inside a removed control is not. */
function isAttached(node, doc) {
  for (let n = node; n; n = n.parentNode) if (n === doc) return true;
  return false;
}

function el(doc, name, attrs) {
  const node = doc.createElementNS(W, name);
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function setTextNode(t, value) {
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(t.ownerDocument.createTextNode(value));
  // Without this, Word eats a leading or trailing space — and a resolved or
  // reworded value that loses its spacing runs into the word beside it.
  t.setAttribute('xml:space', 'preserve');
}

/** Every w:t under a node that is not inside a NESTED w:sdt. */
function ownTexts(root) {
  const out = [];
  (function walk(n) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (c.nodeName === 'w:sdt') continue;      // belongs to the nested control
      if (c.nodeName === 'w:t') out.push(c);
      else walk(c);
    }
  }(root));
  return out;
}

// ── The three fates ──────────────────────────────────────────────────────────

/**
 * Replace a control with its own content, in place. The children move up into
 * the parent at the control's position, so ordering and structure are
 * unchanged and every run property survives.
 */
function unwrapSdt(sdt) {
  const content = directChild(sdt, 'w:sdtContent');
  const parent = sdt.parentNode;
  if (!parent) return false;
  if (content) {
    while (content.firstChild) parent.insertBefore(content.firstChild, sdt);
  }
  parent.removeChild(sdt);
  return true;
}

function removeSdt(sdt) {
  const parent = sdt.parentNode;
  if (!parent) return false;
  parent.removeChild(sdt);
  return true;
}

/**
 * Turn a bound, unresolved control into a standalone Word field — a text field
 * by default, a calendar date-picker when the map says the value is a date.
 * The master's prompt is deleted outright: the field exports EMPTY, so the
 * printed page shows a clean blank rather than an underline placeholder.
 * Returns the label it was given, for the PDF's matching field.
 */
function neutraliseSdt(doc, sdt, label, isDate) {
  const pr = directChild(sdt, 'w:sdtPr');
  if (pr) {
    // The binding itself.
    for (const t of directChildren(pr, 'w:tag')) pr.removeChild(t);
    // A placeholder that points into a glossary part the export does not carry.
    for (const p of directChildren(pr, 'w:showingPlcHdr')) pr.removeChild(p);
    for (const p of directChildren(pr, 'w:placeholder')) pr.removeChild(p);
    // A stale w:id can collide once controls are added or removed; Word
    // tolerates its absence and mints a fresh one.
    for (const i of directChildren(pr, 'w:id')) pr.removeChild(i);

    // The human name, replacing whatever authority label the master carried.
    for (const a of directChildren(pr, 'w:alias')) pr.removeChild(a);
    const alias = el(doc, 'w:alias', { 'w:val': label });
    pr.insertBefore(alias, pr.firstChild);

    // One control, one kind: whichever kind this field is, the other's
    // declaration must not survive alongside it.
    for (const t of directChildren(pr, 'w:text')) pr.removeChild(t);
    for (const d of directChildren(pr, 'w:date')) pr.removeChild(d);
    if (isDate) {
      const date = el(doc, 'w:date');
      date.appendChild(el(doc, 'w:dateFormat', { 'w:val': DATE_FORMAT }));
      date.appendChild(el(doc, 'w:lid', { 'w:val': DATE_LID }));
      date.appendChild(el(doc, 'w:calendar', { 'w:val': 'gregorian' }));
      pr.appendChild(date);
    } else {
      pr.appendChild(el(doc, 'w:text'));
    }
  }

  const content = directChild(sdt, 'w:sdtContent');
  if (!content) return label;

  const texts = ownTexts(content);
  if (texts.length === 0) {
    // No run at all: build the minimum empty one so the control has a place
    // for the reader's own value, inheriting nothing rather than inventing
    // styling.
    const para = content.getElementsByTagName('w:p')[0];
    const host = para || content;
    const r = el(doc, 'w:r');
    const t = el(doc, 'w:t');
    setTextNode(t, '');
    r.appendChild(t);
    host.appendChild(r);
    return label;
  }

  // Every text node is blanked, so no fragment of a multi-run prompt survives.
  for (const t of texts) setTextNode(t, '');
  return label;
}

// ── Part rewriting ───────────────────────────────────────────────────────────

/** A block-level element's visible text, whitespace-normalised. */
function blockText(node) {
  const texts = node.getElementsByTagName('w:t');
  let out = '';
  for (let i = 0; i < texts.length; i++) out += texts[i].textContent || '';
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Remove every direct child of w:body from the paragraph whose text equals
 * `startHeading` (inclusive) to the one whose text equals `endHeading`
 * (exclusive). A start that is never found removes nothing — and the
 * verification pass then fails the export, because the declared text is still
 * on the page.
 */
function removeInternalBlocks(doc, internalBlocks, report) {
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) return;

  for (const block of internalBlocks) {
    const doomed = [];
    let removing = false;
    for (let n = body.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const text = blockText(n);
      if (!removing && text === block.startHeading) removing = true;
      else if (removing && text === block.endHeading) break;
      if (removing) doomed.push(n);
    }
    for (const n of doomed) body.removeChild(n);
    if (doomed.length) report.removedBlocks.push(block.startHeading);
  }
}

/**
 * Delete declared internal sentences and apply declared rewordings, inside
 * text runs only. Exact string matching — a sentence that drifts in the master
 * stops matching, and the verifier then fails the export loudly rather than
 * shipping it.
 */
function scrubTexts(doc, internalSentences, textReplacements, report) {
  const texts = doc.getElementsByTagName('w:t');
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    let value = t.textContent || '';
    let changed = false;
    for (const sentence of internalSentences) {
      if (value.includes(sentence)) {
        value = value.split(sentence).join('');
        report.scrubbedSentences += 1;
        changed = true;
      }
    }
    for (const r of textReplacements) {
      if (value.includes(r.find)) {
        value = value.split(r.find).join(r.replace);
        report.reworded += 1;
        changed = true;
      }
    }
    if (changed) setTextNode(t, value.replace(/[ \t]{2,}/g, ' ').replace(/^ (?=\S)/, ''));
  }
}

/**
 * @param {string} xml           the part
 * @param {Map}    fields        tag → { label, resolved, isDate }
 * @param {Set}    internalTags
 * @param {Set}    anchorTags
 */
function severPart(xml, fields, internalTags, anchorTags, report, language) {
  const doc = parse(xml);

  // Snapshot before mutating: the live NodeList shifts under removal, and a
  // control nested inside a removed one must be skipped, not followed.
  const sdts = allSdts(doc);

  for (const sdt of sdts) {
    if (!isAttached(sdt, doc)) continue;          // its ancestor was removed
    const tag = ownTag(sdt);
    if (!tag) continue;                            // an untagged control: leave it

    if (internalTags.has(tag) || anchorTags.has(tag)) {
      if (removeSdt(sdt)) report.removed.push(tag);
      continue;
    }

    const field = fields.get(tag);
    if (field && !field.resolved) {
      neutraliseSdt(doc, sdt, field.label, Boolean(field.isDate));
      report.neutralised.push(tag);
      continue;
    }

    // Populated scalars, and every clause or schedule container: keep the
    // content, drop the identifier.
    if (unwrapSdt(sdt)) report.unwrapped.push(tag);
  }

  // Master language addressed to the portal or the template maintainer, not
  // to the document's reader.
  removeInternalBlocks(doc, language.internalBlocks, report);
  scrubTexts(doc, language.internalSentences, language.textReplacements, report);

  let out = serialise(doc);

  // Literal prompts the masters carry as ordinary paragraph text, outside any
  // control. There is nothing to neutralise here — no control means nothing to
  // type into — so the prompt is simply deleted and the space stays blank.
  out = out.replace(MASTER_PROMPT_RE, () => { report.sweptPrompts += 1; return ''; });

  return out;
}

/**
 * Replace the master's own document properties. The masters describe
 * themselves as controlled masters "not for participant issue"; that is a
 * statement about the TEMPLATE, and carrying it on a completed instance is
 * both wrong and an internal disclosure.
 */
function severCoreProps(xml, documentTitle) {
  const doc = parse(xml);
  const set = (name, value) => {
    const nodes = doc.getElementsByTagName(name);
    if (nodes.length) {
      const n = nodes[0];
      while (n.firstChild) n.removeChild(n.firstChild);
      if (value !== null) n.appendChild(doc.createTextNode(value));
    }
  };
  set('dc:title', documentTitle || 'Document');
  set('dc:subject', '');
  set('dc:description', '');
  set('keywords', '');
  set('category', '');
  set('cp:keywords', '');
  set('cp:category', '');
  set('cp:contentStatus', '');
  return serialise(doc);
}

// ── Verification ─────────────────────────────────────────────────────────────

/**
 * Re-open the finished package and prove the boundary held. This is the
 * assertion the whole feature rests on, so it runs on every export rather than
 * only in tests: a leak must fail the download, not reach the participant.
 *
 * TOC, PAGE and NUMPAGES field codes are native Word features that resolve
 * offline, so they are explicitly not portal dependencies and are left alone.
 */
async function verifySevered(buffer, forbiddenTexts = []) {
  const zip = await JSZip.loadAsync(buffer);
  const problems = [];

  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const xml = await zip.file(name).async('string');

    const ids = xml.match(OPAL_IDENTIFIER_RE);
    if (ids) problems.push(`${name}: Opal binding identifier(s) ${[...new Set(ids)].join(', ')}`);

    const prompts = xml.match(MASTER_PROMPT_RE);
    if (prompts) problems.push(`${name}: master prompt(s) ${[...new Set(prompts)].join(', ')}`);

    if (/MERGEFIELD|DOCVARIABLE|DATABASE\s/i.test(xml)) {
      problems.push(`${name}: a merge-source field code survived`);
    }
    if (/<w:dataBinding\b/.test(xml)) {
      problems.push(`${name}: an XML data binding survived`);
    }

    // The flag behind Word's "fields that may refer to other files" prompt,
    // and a template attachment neither of which a standalone document may
    // carry.
    if (/<w:updateFields\b/.test(xml)) {
      problems.push(`${name}: w:updateFields survived — Word would prompt to update fields on open`);
    }
    if (/<w:attachedTemplate\b/.test(xml)) {
      problems.push(`${name}: w:attachedTemplate survived`);
    }

    // Declared internal language: if any of it is still VISIBLE text, the
    // scrub missed and the export must not ship.
    if (forbiddenTexts.length && /^word\//.test(name)) {
      const visible = (xml.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || [])
        .map((t) => t.replace(/<[^>]+>/g, '')).join(' ').replace(/\s+/g, ' ');
      for (const text of forbiddenTexts) {
        if (visible.includes(text)) problems.push(`${name}: internal wording "${text.slice(0, 60)}" survived`);
      }
    }
  }

  if (problems.length) {
    const err = new Error(`export boundary breached — ${problems.join('; ')}`);
    err.exportBoundaryBreach = true;
    err.problems = problems;
    throw err;
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * @param {Buffer} buffer            a composed, portal-bound DOCX
 * @param {Array}  fields            [{ tag, label, resolved, isDate }] every mapped control
 * @param {Array}  controlParts      parts that may carry controls
 * @param {Array}  internalTags      controls removed outright
 * @param {Array}  anchorTags        insertion points removed outright
 * @param {Array}  internalBlocks    [{ startHeading, endHeading }] template-guide
 *                                   blocks removed whole from the body
 * @param {Array}  internalSentences exact sentences deleted wherever they appear
 * @param {Array}  textReplacements  [{ find, replace }] exact rewordings
 * @param {string} documentTitle     replaces the master's own title
 * @returns {{ buffer: Buffer, unfinished: Array, report: object }}
 */
async function severDocx({
  buffer,
  fields = [],
  controlParts = [],
  internalTags = [],
  anchorTags = [],
  internalBlocks = [],
  internalSentences = [],
  textReplacements = [],
  documentTitle = 'Document',
} = {}) {
  const zip = await JSZip.loadAsync(buffer);

  const byTag = new Map(fields.map((f) => [f.tag, f]));
  const internal = new Set(internalTags);
  const anchors = new Set(anchorTags);
  const language = { internalBlocks, internalSentences, textReplacements };

  const report = {
    unwrapped: [], neutralised: [], removed: [], removedBlocks: [],
    sweptPrompts: 0, scrubbedSentences: 0, reworded: 0,
  };

  for (const part of controlParts) {
    const file = zip.file(part);
    if (!file) continue;                       // a master may not carry every part
    const xml = await file.async('string');
    // createFolders:false throughout — JSZip otherwise adds implicit "word/"
    // and "docProps/" directory entries the master does not have, and the
    // exported package should differ from it only where we meant it to.
    zip.file(part, severPart(xml, byTag, internal, anchors, report, language), { createFolders: false });
  }

  // The settings flag behind Word's field-update prompt on open, and any
  // attached-template pointer. Both refer outside the document; neither may
  // travel with it.
  const settings = zip.file('word/settings.xml');
  if (settings) {
    const xml = await settings.async('string');
    zip.file('word/settings.xml', xml
      .replace(/<w:updateFields\b[^/>]*\/>/g, '')
      .replace(/<w:updateFields\b[^>]*>[\s\S]*?<\/w:updateFields>/g, '')
      .replace(/<w:attachedTemplate\b[^/>]*\/>/g, ''), { createFolders: false });
  }

  const core = zip.file('docProps/core.xml');
  if (core) {
    zip.file('docProps/core.xml', severCoreProps(await core.async('string'), documentTitle),
      { createFolders: false });
  }

  // app.xml carries the authoring application's own template name.
  const app = zip.file('docProps/app.xml');
  if (app) {
    const xml = await app.async('string');
    zip.file('docProps/app.xml', xml
      .replace(/<Template>[^<]*<\/Template>/, '<Template>Normal.dotm</Template>')
      .replace(MASTER_PROMPT_RE, ''), { createFolders: false });
  }

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  await verifySevered(out, [
    ...internalBlocks.map((b) => b.startHeading),
    ...internalSentences,
    ...textReplacements.map((r) => r.find),
  ]);

  // The order the fields appear in the map is the order the portal shows them,
  // which is the order the PDF's fields are laid out in.
  const unfinished = fields.filter((f) => !f.resolved).map((f) => ({ tag: f.tag, label: f.label }));

  return { buffer: out, unfinished, report };
}

module.exports = {
  severDocx,
  verifySevered,
  MASTER_PROMPT_RE,
  OPAL_IDENTIFIER_RE,
  _internals: {
    severPart, severCoreProps, unwrapSdt, neutraliseSdt, ownTag,
    removeInternalBlocks, scrubTexts,
  },
};
