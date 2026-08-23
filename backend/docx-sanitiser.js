'use strict';

/**
 * OPAL DOCX DISTRIBUTION SANITISER — the last thing that touches a Word file
 * before Opal stores, issues or serves it.
 *
 *   sanitizeDocxForDistribution(buffer, opts) → Promise<Buffer>  (throws if unsafe)
 *   auditDocx(buffer)                         → Promise<report>  (never throws)
 *
 * Pure: no database, no network, no filesystem, no clock.
 *
 * ── THE PROBLEM THIS EXISTS TO FIX ─────────────────────────────────────────
 * Every Opal master inherited `<w:updateFields w:val="true"/>` in
 * word/settings.xml from the original FCA master. That setting tells Word to
 * recalculate every field the moment the document opens, and Word for Mac
 * announces it:
 *
 *   "This document contains fields that may refer to other files.
 *    Do you want to update the fields in this document?"
 *
 * The warning is about what Word is ABOUT to do, not about what the document
 * contains. Measured across all three masters, the only fields present are
 * TOC, PAGE and NUMPAGES — every one of them local — and there is not a single
 * external relationship anywhere in any of them. So a participant was being
 * shown a security prompt about a document that had nothing to fetch.
 *
 * Removing the setting removes the prompt. Nothing else needs to change, and
 * in particular NO field is unlinked: page numbers keep working and the FCA
 * table of contents keeps its rendered result.
 *
 * ── WHY THE TOC IS NOT FORCE-UPDATED ───────────────────────────────────────
 * A table of contents a therapist can refresh in Word with one keystroke, on
 * the rare occasion they have edited the report enough to move a page
 * boundary, is a far better trade than a security prompt on every open for
 * every reader. So neither mechanism Word offers for refreshing it on open is
 * used:
 *
 *   w:updateFields   document-wide, and the one that produces the warning.
 *   w:dirty="true"   per field. The FCA master carries it on its TOC. It does
 *                    not raise the same prompt, but it does make Word
 *                    recalculate that field on open — which is the behaviour
 *                    being removed, and which then leaves the reader with an
 *                    unexpected "save changes?" on close.
 *
 * The field itself and its CACHED RESULT are preserved in both cases, so the
 * reader still sees a populated table of contents.
 *
 * ── REMOVE VERSUS REFUSE ───────────────────────────────────────────────────
 * Two different things happen here, and the difference is deliberate:
 *
 *   REMOVED   settings whose only effect is to trigger the behaviour we are
 *             eliminating, and which carry no content: `w:updateFields`, and a
 *             mail-merge data source. Both are unambiguous and safe to drop.
 *   REFUSED   anything that means the document genuinely depends on another
 *             file — an attached template, a linked image, a linked OLE
 *             object, an INCLUDETEXT/LINK/DDE field, a macro. Opal documents
 *             have none of these. If one appears, it arrived by a route nobody
 *             designed, and quietly stripping it would hide that. Generation
 *             fails and the audit says exactly what was found.
 *
 * ── WHAT IS DELIBERATELY LEFT ALONE ────────────────────────────────────────
 * Ordinary hyperlinks. A service agreement links to the NDIS Commission and to
 * the practice's own complaints address, and those relationships are
 * `TargetMode="External"` because that is simply how Word stores a hyperlink.
 * An external hyperlink is a place the READER may choose to go; an external
 * template is content Word fetches on the reader's behalf. Only the second is
 * a dependency. http, https and mailto pass; anything else does not.
 *
 * Content controls, `OPAL_*` tags, aliases, control ids, nesting, repeated
 * rows, custom-clause anchors, styles, numbering, headers, footers, embedded
 * media and document protection are never touched.
 */

const JSZip = require('jszip');

/** Parts that may carry field codes or content, in the order they are checked. */
const CONTENT_PART_PATTERNS = [
  /^word\/document\.xml$/,
  /^word\/header\d*\.xml$/,
  /^word\/footer\d*\.xml$/,
  /^word\/footnotes\.xml$/,
  /^word\/endnotes\.xml$/,
  /^word\/comments\.xml$/,
  /^word\/glossary\/document\.xml$/,
];

const isContentPart = (name) => CONTENT_PART_PATTERNS.some((re) => re.test(name));
const isRelsPart = (name) => /_rels\/[^/]*\.rels$/.test(name);

/**
 * Field codes that make Word fetch or refresh content from somewhere else.
 *
 * INCLUDEPICTURE is absent on purpose: it is only a dependency when its target
 * is external, which is checked separately against the argument rather than
 * the keyword, so an embedded picture field is not condemned by its name.
 */
const UNSAFE_FIELD_KEYWORDS = [
  { code: 'INCLUDETEXT', re: /(^|\s)INCLUDETEXT(\s|$)/i },
  { code: 'LINK', re: /(^|\s)LINK(\s|$)/i },
  { code: 'DDE', re: /(^|\s)DDE(\s|$)/i },
  { code: 'DDEAUTO', re: /(^|\s)DDEAUTO(\s|$)/i },
  { code: 'DATABASE', re: /(^|\s)DATABASE(\s|$)/i },
  { code: 'RD', re: /(^|\s)RD(\s|$)/i },
  { code: 'AUTOTEXTLIST', re: /(^|\s)AUTOTEXTLIST(\s|$)/i },
];

/** Local fields that must survive, recorded so a test can prove they did. */
const LOCAL_FIELD_KEYWORDS = ['PAGE', 'NUMPAGES', 'TOC', 'REF', 'PAGEREF', 'SEQ', 'HYPERLINK', 'STYLEREF'];

/** Relationship types that reach outside the package for CONTENT. */
const DEPENDENCY_REL_TYPES = [
  { code: 'attached_template', re: /\/attachedTemplate$/i },
  { code: 'linked_ole_object', re: /\/oleObject$/i },
  { code: 'external_package', re: /\/package$/i },
  { code: 'frame', re: /\/frame$/i },
  { code: 'subdocument', re: /\/subDocument$/i },
  { code: 'mail_merge_source', re: /\/mailMergeSource$/i },
];

/** Protocols a reader-facing hyperlink may use. */
const SAFE_HYPERLINK_PROTOCOLS = /^(https?:|mailto:)/i;

const FORBIDDEN_PARTS = [
  { code: 'vba_macro', re: /^word\/vbaProject\.bin$/i },
  { code: 'vba_data', re: /^word\/vbaData\.xml$/i },
  { code: 'active_x', re: /^word\/activeX\//i },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Audit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inspect a .docx and report what a reader's Word would do with it.
 *
 * Never throws for a merely unsafe document — it reports. The caller decides
 * whether to refuse, which is what lets a test assert on the findings and a
 * route refuse on them with one implementation.
 *
 * @returns {Promise<object>} { ok, updateFields, findings[], fields{}, parts{}, hyperlinks[] }
 */
async function auditDocx(buffer) {
  const report = {
    ok: false,
    updateFields: null,
    findings: [],
    fields: { local: [], unsafe: [] },
    hyperlinks: [],
    parts: { total: 0, content: [], rels: [] },
    contentControls: 0,
    dirtyFields: 0,
  };

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    report.findings.push({ code: 'empty', detail: 'The document is empty.' });
    return report;
  }
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    report.findings.push({ code: 'not_a_zip', detail: 'The document is not a .docx package.' });
    return report;
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    report.findings.push({ code: 'unreadable_zip', detail: err.message });
    return report;
  }

  const names = Object.keys(zip.files);
  report.parts.total = names.length;

  if (!zip.file('word/document.xml')) {
    report.findings.push({ code: 'no_document', detail: 'The package has no word/document.xml.' });
    return report;
  }

  // ── Forbidden parts ──────────────────────────────────────────────────────
  for (const name of names) {
    for (const f of FORBIDDEN_PARTS) {
      if (f.re.test(name)) {
        report.findings.push({ code: f.code, detail: `Package contains ${name}.` });
      }
    }
  }
  const contentTypes = zip.file('[Content_Types].xml')
    ? await zip.file('[Content_Types].xml').async('string') : '';
  if (/macroEnabled/i.test(contentTypes)) {
    report.findings.push({ code: 'macro_enabled', detail: 'The document declares a macro-enabled type.' });
  }

  // ── settings.xml ─────────────────────────────────────────────────────────
  const settings = zip.file('word/settings.xml');
  if (settings) {
    const xml = await settings.async('string');
    report.updateFields = readUpdateFields(xml);
    if (report.updateFields === true) {
      report.findings.push({
        code: 'update_fields_enabled',
        detail: 'word/settings.xml enables w:updateFields, which makes Word prompt on open.',
      });
    }
    if (/<w:mailMerge[\s>]/.test(xml)) {
      report.findings.push({
        code: 'mail_merge_source',
        detail: 'word/settings.xml declares a mail-merge data source.',
      });
    }
    if (/<w:attachedTemplate\b[^>]*r:id=/.test(xml)) {
      report.findings.push({
        code: 'attached_template',
        detail: 'word/settings.xml references an attached template.',
      });
    }
  }

  // ── Relationships ────────────────────────────────────────────────────────
  for (const name of names.filter(isRelsPart)) {
    report.parts.rels.push(name);
    const xml = await zip.file(name).async('string');
    for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const rel = m[0];
      const type = (rel.match(/Type="([^"]*)"/) || [])[1] || '';
      const target = (rel.match(/Target="([^"]*)"/) || [])[1] || '';
      const external = /TargetMode="External"/i.test(rel);

      for (const d of DEPENDENCY_REL_TYPES) {
        if (d.re.test(type)) {
          report.findings.push({ code: d.code, detail: `${name}: ${type.split('/').pop()} → ${target}` });
        }
      }

      if (!external) continue;

      if (/\/hyperlink$/i.test(type)) {
        // A place the reader may choose to go, not content Word fetches.
        report.hyperlinks.push(target);
        if (!SAFE_HYPERLINK_PROTOCOLS.test(target)) {
          report.findings.push({
            code: 'unsafe_hyperlink_protocol',
            detail: `${name}: hyperlink to "${target.slice(0, 80)}" is not http(s) or mailto.`,
          });
        }
        continue;
      }

      if (/\/image$/i.test(type)) {
        report.findings.push({
          code: 'external_image',
          detail: `${name}: image loaded from outside the package → ${target.slice(0, 80)}`,
        });
        continue;
      }

      // Anything else reaching outside the package is a content dependency.
      report.findings.push({
        code: 'external_relationship',
        detail: `${name}: ${type.split('/').pop() || 'relationship'} → ${target.slice(0, 80)}`,
      });
    }
  }

  // ── Field codes, across every content part ───────────────────────────────
  for (const name of names.filter(isContentPart)) {
    report.parts.content.push(name);
    const xml = await zip.file(name).async('string');

    for (const code of fieldCodesIn(xml)) {
      const keyword = (code.trim().split(/\s+/)[0] || '').toUpperCase();

      const unsafe = UNSAFE_FIELD_KEYWORDS.find((u) => u.re.test(code));
      if (unsafe) {
        report.fields.unsafe.push({ part: name, code: code.slice(0, 120) });
        report.findings.push({
          code: 'unsafe_field',
          detail: `${name}: ${unsafe.code} field — "${code.slice(0, 80)}"`,
        });
        continue;
      }

      // INCLUDEPICTURE is a dependency only when it points somewhere.
      if (/(^|\s)INCLUDEPICTURE(\s|$)/i.test(code)) {
        const arg = (code.match(/INCLUDEPICTURE\s+"?([^"\s]+)"?/i) || [])[1] || '';
        if (/^(https?:|\\\\|[A-Za-z]:|file:)/i.test(arg)) {
          report.fields.unsafe.push({ part: name, code: code.slice(0, 120) });
          report.findings.push({
            code: 'unsafe_field',
            detail: `${name}: INCLUDEPICTURE from outside the package — "${arg.slice(0, 80)}"`,
          });
          continue;
        }
      }

      if (LOCAL_FIELD_KEYWORDS.includes(keyword)) {
        report.fields.local.push({ part: name, keyword, code: code.slice(0, 80) });
      }
    }

    const dirty = (xml.match(/w:dirty="(?:true|1|on)"/g) || []).length;
    if (dirty) {
      report.dirtyFields += dirty;
      report.findings.push({
        code: 'dirty_field',
        detail: `${name}: ${dirty} field(s) marked w:dirty, which Word recalculates on open.`,
      });
    }

    report.contentControls += (xml.match(/<w:tag\s+w:val=/g) || []).length;
  }

  report.ok = report.findings.length === 0;
  return report;
}

/**
 * Is `w:updateFields` enabled?
 *
 * Word treats the element as a boolean property: present with no value, or
 * with "1", "on" or "true", all mean ON. Only an explicit off value is off.
 * Returns null when the element is absent, which is the state Opal wants.
 */
function readUpdateFields(settingsXml) {
  const m = settingsXml.match(/<w:updateFields\b([^>]*)\/?>/);
  if (!m) return null;
  const attrs = m[1] || '';
  const val = (attrs.match(/w:val="([^"]*)"/) || [])[1];
  if (val === undefined) return true;                       // bare element = on
  return !['0', 'off', 'false'].includes(String(val).toLowerCase());
}

/** Every field code in a part: both the run-split and the simple-field forms. */
function fieldCodesIn(xml) {
  const out = [];
  for (const m of xml.matchAll(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g)) {
    const t = decodeXml(m[1]).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  for (const m of xml.matchAll(/<w:fldSimple[^>]*w:instr="([^"]*)"/g)) {
    const t = decodeXml(m[1]).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sanitise
// ─────────────────────────────────────────────────────────────────────────────

/** Findings this function knows how to fix rather than refuse. */
const REPAIRABLE = new Set(['update_fields_enabled', 'mail_merge_source', 'dirty_field']);

/**
 * Make a .docx safe to distribute, or refuse to distribute it.
 *
 * Removes `w:updateFields` and any mail-merge data source, then re-audits. If
 * anything unsafe remains the document is NOT returned: an Opal document has
 * no legitimate external dependency, so one appearing means something upstream
 * changed in a way nobody reviewed.
 *
 * @param {Buffer} buffer
 * @param {object} [opts]
 * @param {string} [opts.label]  prefix for the thrown message
 * @param {string[]} [opts.requiredTags]  content-control tags that must survive
 * @returns {Promise<Buffer>} the sanitised bytes, with `.docxAudit` attached
 * @throws {Error} with `.audit` when the document cannot be made safe
 */
async function sanitizeDocxForDistribution(buffer, opts = {}) {
  const label = opts.label || 'Opal DOCX';

  const before = await auditDocx(buffer);

  // A structurally broken package is refused outright — there is nothing to
  // repair and nothing safe to serve.
  const fatal = before.findings.filter((f) =>
    ['empty', 'not_a_zip', 'unreadable_zip', 'no_document'].includes(f.code));
  if (fatal.length) {
    throw refusal(label, before, fatal);
  }

  let out = buffer;
  const repaired = [];

  const needsRepair = before.findings.some((f) => REPAIRABLE.has(f.code));
  if (needsRepair) {
    const zip = await JSZip.loadAsync(buffer);

    // Per-field forced updates, wherever they are. The attribute is removed;
    // the field, its instruction and its cached result are left alone.
    for (const name of Object.keys(zip.files).filter(isContentPart)) {
      const xml = await zip.file(name).async('string');
      const cleared = xml.replace(/\s*w:dirty="(?:true|1|on)"/g, '');
      if (cleared !== xml) {
        zip.file(name, cleared, { createFolders: false });
        if (!repaired.includes('w:dirty')) repaired.push('w:dirty');
      }
    }

    const settingsFile = zip.file('word/settings.xml');
    if (settingsFile) {
      let xml = await settingsFile.async('string');
      const cleaned = stripUnsafeSettings(xml);
      if (cleaned.xml !== xml) {
        // createFolders:false — JSZip otherwise adds directory entries the
        // template does not have, and the produced package should differ from
        // its input only where we meant it to.
        zip.file('word/settings.xml', cleaned.xml, { createFolders: false });
        repaired.push(...cleaned.removed);
        xml = cleaned.xml;
      }
    }
    out = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  const after = await auditDocx(out);

  // Required content controls must have survived. This is the guard against a
  // sanitiser that "succeeds" by damaging the document.
  const missingTags = [];
  if (Array.isArray(opts.requiredTags) && opts.requiredTags.length) {
    const zip = await JSZip.loadAsync(out);
    const seen = new Set();
    for (const name of Object.keys(zip.files).filter(isContentPart)) {
      const xml = await zip.file(name).async('string');
      for (const m of xml.matchAll(/<w:tag w:val="([^"]*)"\/>/g)) seen.add(m[1]);
    }
    for (const tag of opts.requiredTags) if (!seen.has(tag)) missingTags.push(tag);
  }

  if (!after.ok || missingTags.length) {
    const remaining = [...after.findings];
    for (const tag of missingTags) {
      remaining.push({ code: 'missing_content_control', detail: `Required control ${tag} is absent.` });
    }
    throw refusal(label, after, remaining);
  }

  const result = Buffer.isBuffer(out) ? out : Buffer.from(out);
  result.docxAudit = {
    ok: true,
    repaired,
    updateFieldsBefore: before.updateFields,
    updateFieldsAfter: after.updateFields,
    localFields: after.fields.local.map((f) => f.keyword),
    hyperlinks: after.hyperlinks,
    contentControls: after.contentControls,
    partsInspected: after.parts.content.length + after.parts.rels.length,
  };
  return result;
}

/**
 * Remove the two settings that are safe to drop.
 *
 * `w:updateFields` is OMITTED rather than written as false: absent is Word's
 * default and leaves the smallest possible difference from the input.
 */
function stripUnsafeSettings(xml) {
  const removed = [];
  let out = xml;

  const before = out;
  out = out.replace(/<w:updateFields\b[^>]*\/>\s*/g, '')
    .replace(/<w:updateFields\b[^>]*>[\s\S]*?<\/w:updateFields>\s*/g, '');
  if (out !== before) removed.push('w:updateFields');

  const beforeMerge = out;
  out = out.replace(/<w:mailMerge\b[\s\S]*?<\/w:mailMerge>\s*/g, '')
    .replace(/<w:mailMerge\b[^>]*\/>\s*/g, '');
  if (out !== beforeMerge) removed.push('w:mailMerge');

  return { xml: out, removed };
}

/**
 * The refusal.
 *
 * Carries the full audit for the log and a deliberately bland `message` for
 * anything a user might see — a participant reading a failure has no use for a
 * relationship type, and an attacker probing one has every use for it.
 */
function refusal(label, audit, findings) {
  const err = new Error(
    `${label}: refused to release the document — ${findings.map((f) => f.code).join(', ')}.`
  );
  err.audit = audit;
  err.findings = findings;
  err.userMessage = 'This document could not be produced safely. Please contact Opal Therapy.';
  err.isDocxSafetyRefusal = true;
  return err;
}

module.exports = {
  sanitizeDocxForDistribution,
  auditDocx,
  readUpdateFields,
  stripUnsafeSettings,
  fieldCodesIn,
  isContentPart,
  isRelsPart,
  UNSAFE_FIELD_KEYWORDS,
  LOCAL_FIELD_KEYWORDS,
  DEPENDENCY_REL_TYPES,
  SAFE_HYPERLINK_PROTOCOLS,
};
