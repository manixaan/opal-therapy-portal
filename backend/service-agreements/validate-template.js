'use strict';

/**
 * SERVICE AGREEMENT — MASTER TEMPLATE VALIDATOR
 *
 * One function, `validateMaster(buffer)`, answers one question: may these
 * bytes become a published master? It is pure — no database, no network, no
 * filesystem — so the same code validates the vendored v1.0 seed, a Word file
 * an owner has just uploaded, and a fixture in a test.
 *
 * ── WHY IT IS STRUCTURAL, NOT A HASH CHECK ─────────────────────────────────
 * A hash tells you the file is byte-identical to one specific file. That is
 * the wrong question for an owner who has legitimately opened the master in
 * Word, edited a clause and saved it: Word rewrites the package on every save,
 * so the hash changes even when nothing that matters changed. What must hold
 * is the CONTRACT — the tags, their counts, the nesting, the repeat row, the
 * anchor, the internal blocks, the page fields — and that is what this checks.
 *
 * The seed hash is still recorded (template-map.SEED_TEMPLATE_SHA256) and
 * reported, so a reviewer can see whether the bytes on disk are the reviewed
 * bytes. It is evidence, not a gate.
 *
 * ── TWO SEVERITIES ─────────────────────────────────────────────────────────
 *   errors    the file may not be published. Missing tags, duplicate control
 *             ids, macros, external relationships, a broken repeat row.
 *   warnings  worth telling the owner, but not disqualifying. An extra tag
 *             the portal does not know how to populate is a warning: it will
 *             render as a blank editable control, which is safe.
 *
 * ── WHAT IS DELIBERATELY REFUSED ───────────────────────────────────────────
 * Macros, OLE objects, embedded executables, external template references,
 * remote images and any relationship with TargetMode="External" are hard
 * errors. An uploaded .docx is untrusted input that will later be opened by a
 * participant, and "it came from the owner" is not a security control — the
 * owner's machine is exactly where a macro-bearing document would come from.
 */

const JSZip = require('jszip');
const crypto = require('crypto');
const { DOMParser } = require('@xmldom/xmldom');

const map = require('./template-map');

/** 25 MB. The v1.0 master is ~66 KB; this is three orders of magnitude of headroom. */
const MAX_BYTES = 25 * 1024 * 1024;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Package parts that are, by their content type or extension, executable or
 * embedded-object payloads. Word has no legitimate reason to carry any of
 * these in a service agreement template.
 */
const FORBIDDEN_PART_PATTERNS = [
  { name: 'VBA macro project', re: /^word\/vbaProject\.bin$/i },
  { name: 'VBA macro data', re: /^word\/vbaData\.xml$/i },
  { name: 'embedded OLE object', re: /^word\/embeddings\//i },
  { name: 'ActiveX control', re: /^word\/activeX\//i },
  { name: 'executable payload', re: /\.(exe|dll|scr|com|bat|cmd|ps1|vbs|js|jar|msi|sh)$/i },
];

/** Relationship types that reach outside the package. */
const FORBIDDEN_REL_TYPES = [
  { name: 'attached template', re: /\/attachedTemplate$/i },
  { name: 'external OLE object', re: /\/oleObject$/i },
  { name: 'remote package', re: /\/package$/i },
  { name: 'frame', re: /\/frame$/i },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Zip entry names must be plain relative paths. A name containing "..", a
 * leading slash, a drive letter or a NUL byte is a path-traversal attempt: the
 * package is never extracted to disk here, but it may be elsewhere, and a
 * template that carries one is not a template anybody should publish.
 */
function unsafeEntryName(name) {
  if (/\0/.test(name)) return 'contains a NUL byte';
  if (name.startsWith('/') || name.startsWith('\\')) return 'is absolute';
  if (/^[A-Za-z]:/.test(name)) return 'carries a drive letter';
  if (name.split(/[\\/]/).some((seg) => seg === '..')) return 'escapes the package root';
  return null;
}

/** Parse a part, returning `{ doc }` or throwing with the part named. */
function parsePart(xml, partName) {
  const errors = [];
  const doc = new DOMParser({
    onError: (level, msg) => { if (level !== 'warning') errors.push(msg); },
  }).parseFromString(xml, 'text/xml');
  if (errors.length) {
    throw new Error(`${partName} is not well-formed XML — ${errors[0]}`);
  }
  return doc;
}

/**
 * Every w:sdt in a part, with its OWN tag, its own w:id, and its nesting depth.
 *
 * "Own" matters more than it looks: 81 of this template's controls are nested
 * inside another, so an implementation that read the first descendant w:tag
 * would attribute a child's tag to its parent and then delete the parent when
 * asked to remove the child.
 */
function walkControls(xml) {
  const out = [];
  const stack = [];
  const re = /<w:sdt>|<\/w:sdt>|<w:sdtPr>|<\/w:sdtPr>|<w:tag\s+w:val="([^"]*)"\s*\/>|<w:id\s+w:val="(-?\d+)"\s*\/>/g;
  let m;
  let inPr = 0;
  while ((m = re.exec(xml))) {
    if (m[0] === '<w:sdt>') {
      stack.push({ tag: null, id: null, depth: stack.length + 1, index: m.index, prSeen: false });
    } else if (m[0] === '</w:sdt>') {
      const done = stack.pop();
      if (done) out.push(done);
    } else if (m[0] === '<w:sdtPr>') {
      inPr += 1;
      const top = stack[stack.length - 1];
      // Only the FIRST sdtPr encountered inside this sdt is its own.
      if (top && !top.prSeen) { top.prSeen = true; top.ownPr = inPr; }
    } else if (m[0] === '</w:sdtPr>') {
      inPr -= 1;
    } else if (m[1] !== undefined) {
      const top = stack[stack.length - 1];
      if (top && top.tag === null && top.ownPr === inPr) top.tag = m[1];
    } else if (m[2] !== undefined) {
      const top = stack[stack.length - 1];
      if (top && top.id === null && top.ownPr === inPr) top.id = m[2];
    }
  }
  // Unbalanced tags leave entries on the stack — report them as controls with
  // no closing element so the caller can fail rather than silently ignore.
  for (const leftover of stack) out.push({ ...leftover, unclosed: true });
  return out;
}

/** All visible text of a part, runs joined so a split placeholder still matches. */
function extractText(xml) {
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml))) {
    parts.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }
  return parts.join('');
}

function countPageFields(xml) {
  const instr = [...xml.matchAll(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g)].map((x) => x[1]).join(' ');
  const fldSimple = [...xml.matchAll(/<w:fldSimple[^>]*w:instr="([^"]*)"/g)].map((x) => x[1]).join(' ');
  const all = `${instr} ${fldSimple}`;
  return {
    page: (all.match(/\bPAGE\b/g) || []).length - (all.match(/\bNUMPAGES\b/g) || []).length >= 0
      ? (all.match(/(?<!NUM)\bPAGE\b/g) || []).length
      : 0,
    numPages: (all.match(/\bNUMPAGES\b/g) || []).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  The validator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Buffer} buffer            the candidate .docx bytes
 * @param {object} [opts]
 * @param {string} [opts.declaredMime]  the upload's Content-Type, if any
 * @param {boolean} [opts.strictCounts] require the EXACT measured occurrence
 *        counts. True for the vendored seed; false for an owner's revision,
 *        where adding a second copy of a scalar is unusual but not unsafe.
 * @returns {Promise<object>} a report — never throws for a merely invalid file
 */
async function validateMaster(buffer, opts = {}) {
  const errors = [];
  const warnings = [];
  const report = {
    ok: false,
    sha256: null,
    byteSize: 0,
    tagManifest: null,
    counts: {},
    errors,
    warnings,
  };

  // ── Bytes ────────────────────────────────────────────────────────────────
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    errors.push({ code: 'empty', message: 'The uploaded file is empty.' });
    return report;
  }
  report.byteSize = buffer.length;
  report.sha256 = sha256(buffer);
  report.matchesSeedHash = report.sha256 === map.SEED_TEMPLATE_SHA256;

  if (buffer.length > MAX_BYTES) {
    errors.push({
      code: 'too_large',
      message: `The file is ${Math.round(buffer.length / 1024 / 1024)} MB. The maximum is 25 MB.`,
    });
    return report;
  }
  // A .docx is a zip: "PK\x03\x04". Checking the magic bytes catches a renamed
  // .doc or PDF before JSZip produces a less legible error.
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    errors.push({ code: 'not_a_zip', message: 'The file is not a Word .docx package.' });
    return report;
  }
  if (opts.declaredMime && opts.declaredMime !== DOCX_MIME
      && opts.declaredMime !== 'application/octet-stream') {
    warnings.push({
      code: 'unexpected_mime',
      message: `The upload declared "${opts.declaredMime}" rather than a Word document type.`,
    });
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    errors.push({ code: 'unreadable_zip', message: `The .docx package could not be opened — ${err.message}` });
    return report;
  }

  const names = Object.keys(zip.files);

  // ── Package safety ───────────────────────────────────────────────────────
  for (const name of names) {
    const why = unsafeEntryName(name);
    if (why) errors.push({ code: 'unsafe_entry', message: `Package entry "${name}" ${why}.` });
    for (const f of FORBIDDEN_PART_PATTERNS) {
      if (f.re.test(name)) {
        errors.push({ code: 'forbidden_part', message: `The document contains a ${f.name} ("${name}").` });
      }
    }
  }
  if (!zip.file('word/document.xml')) {
    errors.push({ code: 'no_document', message: 'The package has no word/document.xml.' });
    return report;
  }
  // A macro-enabled document declares itself in [Content_Types].xml even when
  // the vbaProject part has been stripped.
  const ct = zip.file('[Content_Types].xml') ? await zip.file('[Content_Types].xml').async('string') : '';
  if (/macroEnabled/i.test(ct)) {
    errors.push({ code: 'macro_enabled', message: 'The document is macro-enabled.' });
  }

  // ── Relationships ────────────────────────────────────────────────────────
  for (const name of names.filter((n) => /_rels\/.*\.rels$/.test(n))) {
    const xml = await zip.file(name).async('string');
    const rels = [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]);
    for (const rel of rels) {
      const type = (rel.match(/Type="([^"]*)"/) || [])[1] || '';
      const target = (rel.match(/Target="([^"]*)"/) || [])[1] || '';
      const external = /TargetMode="External"/i.test(rel);

      for (const f of FORBIDDEN_REL_TYPES) {
        if (f.re.test(type)) {
          errors.push({ code: 'forbidden_relationship', message: `${name} declares a ${f.name} relationship.` });
        }
      }
      if (external) {
        // A hyperlink to a public page is normal in a service agreement (the
        // NDIS Commission, the practice's own site). Anything else reaching
        // out of the package — an image, a template, a subdocument — is not.
        if (/\/hyperlink$/i.test(type)) {
          if (!/^https?:\/\//i.test(target) && !/^mailto:/i.test(target)) {
            errors.push({
              code: 'unsafe_hyperlink',
              message: `${name} has an external hyperlink that is not http(s) or mailto: "${target}".`,
            });
          }
        } else {
          errors.push({
            code: 'external_relationship',
            message: `${name} references external content (${type.split('/').pop()}: "${target}").`,
          });
        }
      }
      if (/\/image$/i.test(type) && /^https?:\/\//i.test(target)) {
        errors.push({ code: 'remote_image', message: `${name} loads an image from the network: "${target}".` });
      }
    }
  }

  // ── Control-bearing parts ────────────────────────────────────────────────
  const partXml = new Map();
  for (const name of map.CONTROL_PARTS) {
    const file = zip.file(name);
    if (!file) {
      errors.push({ code: 'missing_part', message: `The template has no ${name}.` });
      continue;
    }
    const xml = await file.async('string');
    try {
      parsePart(xml, name);
    } catch (err) {
      errors.push({ code: 'malformed_part', message: err.message });
      continue;
    }
    partXml.set(name, xml);
  }
  if (!partXml.has('word/document.xml')) return report;

  // ── Content controls ─────────────────────────────────────────────────────
  const controls = [];
  for (const [name, xml] of partXml) {
    for (const c of walkControls(xml)) controls.push({ ...c, part: name });
  }

  const unclosed = controls.filter((c) => c.unclosed);
  if (unclosed.length) {
    errors.push({
      code: 'unbalanced_controls',
      message: `${unclosed.length} content control(s) are not closed.`,
    });
  }
  const untagged = controls.filter((c) => !c.unclosed && !c.tag);
  if (untagged.length) {
    errors.push({
      code: 'untagged_control',
      message: `${untagged.length} content control(s) carry no w:tag and cannot be addressed.`,
    });
  }

  const tagged = controls.filter((c) => c.tag);
  const byPart = {};
  for (const c of tagged) byPart[c.part] = (byPart[c.part] || 0) + 1;

  const occurrences = {};
  for (const c of tagged) occurrences[c.tag] = (occurrences[c.tag] || 0) + 1;

  const uniqueTags = Object.keys(occurrences);
  const scalarsFound = uniqueTags.filter((t) => map.SCALAR_BY_TAG[t]);
  const blocksFound = uniqueTags.filter((t) => map.BLOCK_BY_TAG[t]);
  const customFound = uniqueTags.filter((t) => map.CUSTOM_CLAUSE_PATTERN.test(t));
  const unknown = uniqueTags.filter(
    (t) => !map.SCALAR_BY_TAG[t] && !map.BLOCK_BY_TAG[t] && !map.CUSTOM_CLAUSE_PATTERN.test(t)
  );

  report.counts = {
    totalOccurrences: tagged.length,
    byPart,
    uniqueTags: uniqueTags.length,
    scalarTags: scalarsFound.length,
    blockTags: blocksFound.length,
    customClauses: customFound.length,
    nested: tagged.filter((c) => c.depth > 1).length,
  };

  // ── w:id uniqueness ──────────────────────────────────────────────────────
  // Word tolerates duplicates; the cloning code does not. Two controls sharing
  // an id is exactly the state a naive repeat-row implementation leaves behind,
  // and it is why cloned rows are given freshly allocated ids.
  const idCounts = {};
  for (const c of tagged) {
    if (c.id === null) {
      errors.push({ code: 'control_without_id', message: `Control "${c.tag}" has no w:id.` });
      continue;
    }
    idCounts[c.id] = (idCounts[c.id] || 0) + 1;
  }
  const dupIds = Object.entries(idCounts).filter(([, n]) => n > 1);
  if (dupIds.length) {
    errors.push({
      code: 'duplicate_control_ids',
      message: `${dupIds.length} content-control id(s) are used more than once `
        + `(${dupIds.slice(0, 5).map(([id, n]) => `${id}×${n}`).join(', ')}).`,
    });
  }

  // ── Required tags ────────────────────────────────────────────────────────
  const missingScalars = map.SCALAR_TAGS.filter((t) => !occurrences[t]);
  if (missingScalars.length) {
    errors.push({
      code: 'missing_scalar_tags',
      message: `${missingScalars.length} required field tag(s) are absent: ${missingScalars.join(', ')}.`,
    });
  }
  const missingBlocks = map.BLOCK_TAGS.filter((t) => !occurrences[t]);
  if (missingBlocks.length) {
    errors.push({
      code: 'missing_block_tags',
      message: `${missingBlocks.length} required block tag(s) are absent: ${missingBlocks.join(', ')}.`,
    });
  }
  if (unknown.length) {
    warnings.push({
      code: 'unknown_tags',
      message: `${unknown.length} tag(s) are not in the portal's field manifest and will render as `
        + `blank editable controls: ${unknown.slice(0, 10).join(', ')}.`,
    });
  }

  // ── Occurrence counts ────────────────────────────────────────────────────
  const countMismatches = [];
  for (const f of map.SCALARS) {
    const got = occurrences[f.tag] || 0;
    if (got !== f.occurrences) countMismatches.push(`${f.tag} ×${got} (expected ×${f.occurrences})`);
  }
  for (const t of map.BLOCK_TAGS) {
    const got = occurrences[t] || 0;
    if (got !== 1) countMismatches.push(`${t} ×${got} (expected ×1)`);
  }
  if (countMismatches.length) {
    (opts.strictCounts === false ? warnings : errors).push({
      code: 'occurrence_mismatch',
      message: `${countMismatches.length} tag(s) appear a different number of times than the `
        + `contract records: ${countMismatches.slice(0, 8).join('; ')}.`,
    });
  }

  // ── Single-control parts ─────────────────────────────────────────────────
  for (const [part, wantTag] of Object.entries(map.EXPECTED.partTags)) {
    const here = tagged.filter((c) => c.part === part);
    if (here.length !== 1 || here[0].tag !== wantTag) {
      errors.push({
        code: 'part_control_mismatch',
        message: `${part} must carry exactly one control tagged ${wantTag} `
          + `(found ${here.length}: ${here.map((c) => c.tag).join(', ') || 'none'}).`,
      });
    }
  }

  // ── Nesting ──────────────────────────────────────────────────────────────
  // The support row's twelve scalars must genuinely be INSIDE the repeat
  // control. If Word has flattened them out, cloning the row would produce
  // rows that share one set of fields.
  const bodyXml = partXml.get('word/document.xml');
  const repeat = tagged.find((c) => c.tag === map.REPEAT_SUPPORT_ROW && c.part === 'word/document.xml');
  if (!repeat) {
    errors.push({
      code: 'no_repeat_row',
      message: `The repeatable support row (${map.REPEAT_SUPPORT_ROW}) is missing.`,
    });
  } else {
    const nestedInRepeat = nestedTagsUnder(bodyXml, map.REPEAT_SUPPORT_ROW);
    const missingInRow = map.REPEAT_ROW_TAGS.filter((t) => !nestedInRepeat.includes(t));
    if (missingInRow.length) {
      errors.push({
        code: 'repeat_row_incomplete',
        message: `The support row does not contain ${missingInRow.length} of its field(s): `
          + `${missingInRow.join(', ')}.`,
      });
    }
    // Anything EXTRA inside the row would be cloned too, so an unexpected
    // control there is a contract change, not a detail.
    const strayInRow = nestedInRepeat.filter((t) => !map.REPEAT_ROW_TAGS.includes(t));
    if (strayInRow.length) {
      warnings.push({
        code: 'repeat_row_extra_controls',
        message: `The support row contains ${strayInRow.length} control(s) the contract does not `
          + `record and which will be cloned with every support: ${strayInRow.join(', ')}.`,
      });
    }

    // The seven detail fields must sit in Schedule A but OUTSIDE the row —
    // inside it they would be cloned, and the template gives each only one
    // control, so a clone would duplicate w:ids.
    const insideButShouldNotBe = map.SUPPORT_DETAIL_TAGS.filter((t) => nestedInRepeat.includes(t));
    if (insideButShouldNotBe.length) {
      errors.push({
        code: 'detail_field_inside_repeat_row',
        message: `${insideButShouldNotBe.length} support-detail field(s) are inside the repeatable `
          + `row and would be duplicated on every clone: ${insideButShouldNotBe.join(', ')}.`,
      });
    }

    // The row control must wrap a table row, or cloning it produces prose
    // where a row should be.
    if (!/<w:tr[\s>]/.test(sliceControl(bodyXml, map.REPEAT_SUPPORT_ROW))) {
      errors.push({
        code: 'repeat_row_not_a_row',
        message: 'The repeatable support control does not wrap a table row.',
      });
    }
  }

  if (!occurrences[map.CUSTOM_CLAUSE_ANCHOR]) {
    errors.push({
      code: 'no_custom_anchor',
      message: `The custom-clause anchor (${map.CUSTOM_CLAUSE_ANCHOR}) is missing.`,
    });
  }
  for (const t of map.INTERNAL_BLOCK_TAGS) {
    if (!occurrences[t]) {
      errors.push({
        code: 'no_internal_block',
        message: `The internal governance block ${t} is missing. It must exist so it can be removed `
          + 'from participant copies.',
      });
    }
  }

  report.counts.nestedInRepeatRow = repeat ? nestedTagsUnder(bodyXml, map.REPEAT_SUPPORT_ROW).length : 0;

  // ── Styles ───────────────────────────────────────────────────────────────
  const stylesFile = zip.file('word/styles.xml');
  if (!stylesFile) {
    errors.push({ code: 'no_styles', message: 'The package has no word/styles.xml.' });
  } else {
    const stylesXml = await stylesFile.async('string');
    const defined = new Set(
      [...stylesXml.matchAll(/w:styleId="([^"]*)"/g)].map((x) => x[1])
    );
    const missingStyles = map.EXPECTED.requiredStyles.filter((s) => !defined.has(s));
    if (missingStyles.length) {
      errors.push({
        code: 'missing_styles',
        message: `The template does not define ${missingStyles.length} required Opal style(s): `
          + `${missingStyles.join(', ')}.`,
      });
    }
  }

  // ── Header / footer presence and page fields ─────────────────────────────
  if (!zip.file('word/header6.xml')) {
    errors.push({ code: 'no_header', message: 'The template has no header part.' });
  }
  const footer = zip.file('word/footer6.xml');
  if (!footer) {
    errors.push({ code: 'no_footer', message: 'The template has no footer part.' });
  } else {
    const fields = countPageFields(await footer.async('string'));
    report.counts.footerPageFields = fields;
    const want = map.EXPECTED.footerPageFields;
    if (fields.page !== want.page || fields.numPages !== want.numPages) {
      warnings.push({
        code: 'page_field_drift',
        message: `The footer has ${fields.page} PAGE and ${fields.numPages} NUMPAGES field(s); `
          + `the contract records ${want.page} and ${want.numPages}. Page numbering may differ.`,
      });
    }
  }

  // ── Forbidden text outside controls ──────────────────────────────────────
  // A bracketed placeholder INSIDE a control is the template working as
  // designed — it is the prompt the portal replaces. The same string sitting
  // in ordinary body text is drafting debris that no code path would ever
  // clear, so it would reach a participant.
  const outside = textOutsideControls(bodyXml);
  for (const f of map.FORBIDDEN_TEXT_PATTERNS) {
    const hit = outside.match(f.re);
    if (hit) {
      errors.push({
        code: 'placeholder_outside_control',
        message: `A ${f.name} appears in body text that is not inside a content control `
          + `("${String(hit[0]).slice(0, 60)}"). It would reach a participant.`,
      });
    }
  }

  // ── Manifest ─────────────────────────────────────────────────────────────
  report.tagManifest = {
    scalars: Object.fromEntries(map.SCALAR_TAGS.map((t) => [t, occurrences[t] || 0])),
    blocks: Object.fromEntries(map.BLOCK_TAGS.map((t) => [t, occurrences[t] || 0])),
    custom: customFound.sort(),
    unknown: unknown.sort(),
  };

  report.ok = errors.length === 0;
  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Structural slicing helpers
// ─────────────────────────────────────────────────────────────────────────────

/** The full XML of the w:sdt whose OWN tag is `tag`, or ''. */
function sliceControl(xml, tag) {
  const toks = [...xml.matchAll(/<w:sdt>|<\/w:sdt>/g)];
  const stack = [];
  for (const t of toks) {
    if (t[0] === '<w:sdt>') stack.push(t.index);
    else {
      const start = stack.pop();
      if (start === undefined) continue;
      const seg = xml.slice(start, t.index + t[0].length);
      const prEnd = seg.indexOf('</w:sdtPr>');
      const own = prEnd === -1 ? '' : seg.slice(0, prEnd);
      if ((own.match(/<w:tag w:val="([^"]*)"\/>/) || [])[1] === tag) return seg;
    }
  }
  return '';
}

/** Tags of every control nested anywhere inside the control tagged `tag`. */
function nestedTagsUnder(xml, tag) {
  const seg = sliceControl(xml, tag);
  if (!seg) return [];
  // Skip the wrapper's own sdtPr so the parent does not count itself.
  const inner = seg.slice(seg.indexOf('</w:sdtPr>') + 10);
  return [...inner.matchAll(/<w:tag w:val="([^"]*)"\/>/g)].map((x) => x[1]);
}

/**
 * Visible text with every content control's contents removed, so what remains
 * is the template's own prose.
 */
function textOutsideControls(xml) {
  let out = xml;
  // Repeatedly strip the innermost controls until none remain. Doing it
  // innermost-first is what makes nesting safe: stripping outermost-first
  // would remove a parent and never look at its children, which is correct
  // here, but the loop form also terminates cleanly on malformed input.
  let guard = 0;
  while (/<w:sdt>(?:(?!<w:sdt>)[\s\S])*?<\/w:sdt>/.test(out) && guard < 500) {
    out = out.replace(/<w:sdt>(?:(?!<w:sdt>)[\s\S])*?<\/w:sdt>/g, '');
    guard += 1;
  }
  return extractText(out);
}

module.exports = {
  validateMaster,
  MAX_BYTES,
  DOCX_MIME,
  // Exported for focused unit tests.
  _internals: { walkControls, sliceControl, nestedTagsUnder, textOutsideControls, extractText, countPageFields, unsafeEntryName, sha256 },
};
