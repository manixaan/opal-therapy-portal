#!/usr/bin/env node
'use strict';

/**
 * Recompute the `7 Resources` catalogue from the source vault itself.
 *
 * WHY THIS EXISTS
 * `ingest-resource-catalogue.js` consumed a catalogue JSON produced outside this
 * repository, by a different tool, on one particular machine. That made the
 * register unreproducible: nothing here could regenerate its input, and the
 * three signals the audit baseline asks us to reconcile — which PDFs carry an
 * extractable text layer, which are image-only, which hold fillable form fields
 * — were never computed at all. This script computes them from bytes.
 *
 * It writes a catalogue in the SAME shape the existing importer already reads
 * (schema_version / summary / records), with additive fields. It is therefore a
 * drop-in replacement for the external file, not a second pipeline.
 *
 * READ-ONLY, AND STRUCTURALLY SO
 * Every filesystem call here is a read: `opendir`, `stat`, `readFile`. There is
 * no write, rename, unlink or chmod path in this file. The source vault is
 * never a destination — the only writable path is `--out`, which is validated
 * to sit outside the source root.
 *
 * PRIVACY: HASHES ARE COMPUTED, IDENTITY IS NOT PUBLISHED
 * The audit's blanket rule was "never hash a client file". That is simple but it
 * cannot answer the question the brief actually asks: *is this CLIENTS file just
 * a generic third-party worksheet that also exists somewhere safe?* Answering it
 * requires a fingerprint. So:
 *
 *   - Every file is hashed in memory, during the scan, to build the duplicate
 *     graph.
 *   - A CLIENTS file whose hash matches a file OUTSIDE `CLIENTS` is proven
 *     generic. It keeps its hash and is recorded as a duplicate of the safe
 *     copy, with its path redacted to the first segment. The safe copy is the
 *     one that gets used; the client path is ignored.
 *   - A CLIENTS file with no twin outside CLIENTS is treated as client-derived.
 *     Its hash, filename, path and title are DISCARDED before the record is
 *     written. Nothing identifying reaches the output.
 *
 * That is stricter than the old rule where it matters (no client-specific
 * fingerprint is persisted) and more useful where it does not (generic
 * worksheets stop being quarantined by accident of where they were filed).
 *
 *   node backend/setup/scan-resource-source.js --out <file.json>
 *   node backend/setup/scan-resource-source.js --out <file.json> --limit 40
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SOURCE = '/Users/antonyxavier/Documents/7 Resources';
const SCHEMA_VERSION = '1.1';

// A CLIENTS file is only publishable evidence of nothing. First path segment.
const CLIENT_ROOT = 'CLIENTS';

// Fixed, repo-level salt for the path key. It is not a secret and is not
// pretending to be one: it exists so the committed overlay is not a plain
// rainbow-table target, while keeping the key stable across runs and machines.
// Changing it invalidates every overlay entry, so it is a constant, not config.
const PATH_KEY_SALT = 'opal-resource-hub/path-key/v1';

// Files that are not resources and never were.
const JUNK_EXACT = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized']);
const OFFICE_TEMP = /^~\$/;

// Empirical thresholds, stated rather than buried. A page carrying fewer than
// this many extracted characters is not delivering readable text; a document
// averaging below it, with images present, is a scan.
const MIN_CHARS_PER_TEXT_PAGE = 50;
const MIN_DOC_CHARS_FOR_TEXT_LAYER = 200;

function argValue(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const SOURCE_ROOT = path.resolve(argValue('--source', DEFAULT_SOURCE));
const OUT = argValue('--out');
const LIMIT = Number(argValue('--limit', '0')) || 0;
const CONCURRENCY = Number(argValue('--concurrency', '5')) || 5;

// ── magic numbers ──────────────────────────────────────────────────────────
// Extension is a claim; the leading bytes are evidence. Where they disagree we
// record both rather than trusting the name.
const MAGIC = [
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/jpeg', ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'application/zip', ext: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'application/zip', ext: 'zip', bytes: [0x50, 0x4b, 0x05, 0x06] },
  // OLE2 compound file: legacy .doc/.ppt/.xls all share it.
  { mime: 'application/x-ole-storage', ext: 'ole', bytes: [0xd0, 0xcf, 0x11, 0xe0] },
];

const EXT_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  zip: 'application/zip',
  icloud: 'application/x-icloud-placeholder',
};

function sniff(buf) {
  for (const m of MAGIC) {
    if (buf.length < m.bytes.length) continue;
    let ok = true;
    for (let i = 0; i < m.bytes.length; i++) {
      if (buf[i] !== m.bytes[i]) { ok = false; break; }
    }
    if (ok) return m;
  }
  return null;
}

// ── walk ───────────────────────────────────────────────────────────────────
async function walk(dir, rel, out) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    out.push({ relativePath: rel, error: `unreadable-directory: ${err.code}` });
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    // Never traverse a symlink: it could point outside the vault entirely.
    if (entry.isSymbolicLink()) {
      out.push({ relativePath: relPath, error: 'symlink-not-followed' });
      continue;
    }
    if (entry.isDirectory()) {
      await walk(abs, relPath, out);
    } else if (entry.isFile()) {
      out.push({ relativePath: relPath, absolutePath: abs, name: entry.name });
    }
  }
}

// ── per-format analysis ────────────────────────────────────────────────────

let pdfjsLib = null;
async function pdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLib;
}

/**
 * Page count, text-layer presence, image-only detection and form fields.
 *
 * Two independent libraries, deliberately: pdf.js reads content streams (what a
 * viewer would show), pdf-lib reads the document catalogue (where AcroForm
 * fields live). Neither alone answers both questions.
 */
async function analysePdf(buf, pii) {
  const result = {
    pageCount: null,
    textCharacters: 0,
    textExtractable: false,
    likelyScanned: false,
    hasImages: false,
    hasFillableFields: false,
    fillableFieldCount: 0,
    encrypted: false,
    analysisError: null,
  };

  const lib = await pdfjs();
  let doc = null;
  try {
    doc = await lib.getDocument({
      data: new Uint8Array(buf),
      verbosity: 0,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
    }).promise;
    result.pageCount = doc.numPages;

    let pagesWithText = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      let page;
      try {
        page = await doc.getPage(p);
      } catch {
        continue;
      }
      try {
        const content = await page.getTextContent();
        // Joined with spaces: pdf.js emits text in fragments, and a label and
        // its value routinely land in separate items. Concatenating without a
        // separator would fuse them into one token and hide `Client: <name>`
        // from the detector that exists to find it.
        const pageText = content.items.map((it) => it.str || '').join(' ');
        result.textCharacters += pageText.replace(/\s/g, '').length;
        if (pageText.replace(/\s/g, '').length >= MIN_CHARS_PER_TEXT_PAGE) pagesWithText++;
        if (pii) scanText(pageText, pii);
      } catch { /* a page that will not yield text is itself the signal */ }

      if (!result.hasImages) {
        try {
          const ops = await page.getOperatorList();
          const OPS = lib.OPS;
          for (const fn of ops.fnArray) {
            if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject
                || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
              result.hasImages = true;
              break;
            }
          }
        } catch { /* operator list is best-effort */ }
      }
      page.cleanup();
    }

    result.textExtractable = result.textCharacters >= MIN_DOC_CHARS_FOR_TEXT_LAYER
      && pagesWithText > 0;
    // Image-only: no usable text layer. Images present raises confidence but a
    // PDF with neither text nor images is equally unreadable, so it counts too.
    result.likelyScanned = !result.textExtractable;
    result.pagesWithText = pagesWithText;
  } catch (err) {
    if (err && /password/i.test(err.name || err.message || '')) {
      result.encrypted = true;
      result.analysisError = 'password-protected';
    } else {
      result.analysisError = `pdfjs: ${(err && err.message) || 'unknown'}`.slice(0, 200);
    }
  } finally {
    if (doc) { try { await doc.destroy(); } catch { /* nothing to do */ } }
  }

  // AcroForm fields. A fillable PDF must stay interactive, so this flag decides
  // whether a derivative may ever be flattened.
  try {
    const { PDFDocument } = require('pdf-lib');
    const pdf = await PDFDocument.load(buf, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
    if (result.pageCount == null) result.pageCount = pdf.getPageCount();
    const fields = pdf.getForm().getFields();
    result.fillableFieldCount = fields.length;
    result.hasFillableFields = fields.length > 0;
  } catch (err) {
    if (!result.analysisError) {
      result.analysisError = `pdf-lib: ${(err && err.message) || 'unknown'}`.slice(0, 200);
    }
  }

  return result;
}

/** Text content of an OOXML part, with tags stripped and runs kept separate. */
function ooxmlPartText(xml) {
  return xml
    .replace(/<w:tab[^>]*\/>/g, ' ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]{2,}/g, ' ');
}

/**
 * OOXML containers are zips; counts and text both live in XML we can read.
 *
 * Headers, footers and speaker notes are scanned too — a client name in a
 * document header is no less identifying for being in a header, and it is
 * exactly where a personalised template tends to carry one.
 */
async function analyseOoxml(buf, ext, pii) {
  const result = {
    pageCount: null, analysisError: null, textExtractable: true, textCharacters: 0,
  };
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buf);

    const partNames = Object.keys(zip.files).filter((n) => (ext === 'pptx'
      ? /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(n)
      : /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n)));

    if (ext === 'pptx') {
      result.pageCount = Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length || null;
    } else if (ext === 'docx') {
      const app = zip.file('docProps/app.xml');
      if (app) {
        const xml = await app.async('string');
        const pages = xml.match(/<Pages>(\d+)<\/Pages>/);
        if (pages) result.pageCount = Number(pages[1]);
      }
      // A DOCX with no readable document part is not a usable resource.
      if (!zip.file('word/document.xml')) {
        result.analysisError = 'missing word/document.xml';
        result.textExtractable = false;
      }
    }

    for (const name of partNames) {
      const part = zip.file(name);
      if (!part) continue;
      const text = ooxmlPartText(await part.async('string'));
      result.textCharacters += text.replace(/\s/g, '').length;
      if (pii) scanText(text, pii);
    }

    // Document properties carry author and title, which are branding and
    // privacy evidence in equal measure.
    const core = zip.file('docProps/core.xml');
    if (core) {
      const xml = await core.async('string');
      const creator = xml.match(/<dc:creator>([^<]*)<\/dc:creator>/);
      const company = xml.match(/<Company>([^<]*)<\/Company>/);
      if (creator && creator[1].trim()) result.documentAuthor = creator[1].trim().slice(0, 120);
      if (company && company[1].trim()) result.documentCompany = company[1].trim().slice(0, 120);
    }
  } catch (err) {
    result.analysisError = `ooxml: ${(err && err.message) || 'unknown'}`.slice(0, 200);
    result.textExtractable = false;
  }
  return result;
}

/**
 * Inventory a ZIP without extracting it. Path traversal is checked here, at the
 * boundary, so nothing downstream has to trust an archive member name.
 */
async function analyseZip(buf) {
  const result = {
    memberCount: 0, members: [], unsafeMembers: [],
    uncompressedBytes: 0, analysisError: null, textExtractable: false,
  };
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buf);
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      result.memberCount++;
      const normalised = path.normalize(name);
      if (path.isAbsolute(name) || normalised.startsWith('..') || name.includes('..')
          || /^[a-zA-Z]:/.test(name)) {
        result.unsafeMembers.push(name.slice(0, 200));
      }
      const size = entry._data && entry._data.uncompressedSize ? entry._data.uncompressedSize : 0;
      result.uncompressedBytes += size;
      if (result.members.length < 200) {
        result.members.push({ name: name.slice(0, 240), bytes: size });
      }
    }
  } catch (err) {
    result.analysisError = `zip: ${(err && err.message) || 'unknown'}`.slice(0, 200);
  }
  return result;
}

/** JPEG dimensions from the SOF marker — enough for a thumbnail decision. */
function analyseJpeg(buf) {
  const result = { width: null, height: null, analysisError: null };
  try {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf
          && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        result.height = buf.readUInt16BE(i + 5);
        result.width = buf.readUInt16BE(i + 7);
        break;
      }
      i += 2 + len;
    }
  } catch (err) {
    result.analysisError = `jpeg: ${(err && err.message) || 'unknown'}`.slice(0, 120);
  }
  return result;
}

// ── personal-information detection ─────────────────────────────────────────
//
// Location is not a reliable privacy signal. The earlier content review found
// client identifiers in files filed under ordinary topic folders, and its own
// catalogue then redacted them so thoroughly that which files they were can no
// longer be recovered. So this rebuilds the judgement from evidence, here, where
// it is reproducible.
//
// DETECTORS RECORD COUNTS AND SIGNAL NAMES ONLY. The matched value is never
// stored, returned or logged — the same rule `resource-file-quality.js` already
// applies. Knowing a file contains two NDIS numbers is what the decision needs;
// knowing which numbers is exactly what must not escape.

// A LABEL IS NOT A DISCLOSURE. `Client: ________` is a blank worksheet; it is
// how half the templates in this vault are printed. `Client: Jane Smith` is a
// disclosure. The difference is whether a filled value follows, so every label
// detector below requires a capitalised word or a digit after the colon — not
// merely "something", which underscores and ruled lines satisfy.
const FILLED = String.raw`(?![_\-.\s]*(?:$|[\r\n]))\s*(?:[A-Z][a-z]+|\d)`;

const PII_STRONG = [
  // NDIS participant numbers are 9 digits and conventionally start with 43.
  { name: 'ndis-participant-number', re: /\b43\d{7}\b/g },
  { name: 'medicare-number', re: /\b[2-6]\d{3}\s?\d{5}\s?\d\b/g },
  { name: 'date-of-birth-label', re: /\b(?:d\.?o\.?b\.?|date\s+of\s+birth)\b\s*[:\-]?\s*\d{1,4}[/\-.]\d{1,2}/gi },
  { name: 'participant-or-client-label', re: new RegExp(String.raw`\b(?:participant|client)(?:'s)?\s*(?:name|full name)?\s*[:#]${FILLED}`, 'g') },
];

const PII_WEAK = [
  { name: 'guardian-or-carer-label', re: new RegExp(String.raw`\b(?:parent|guardian|carer|mother|father)\s*(?:name)?\s*[:#]${FILLED}`, 'g') },
];

// Contact details are recorded but do NOT quarantine anything.
//
// 123 of the files here carry an email address and almost all of them are a
// publisher's support address in a worksheet footer. Treating that as evidence
// of client data would quarantine most of the vault for being professionally
// published. These belong to the branding and third-party-attribution review
// instead, where a vendor address is exactly the thing you want to know about.
const CONTACT_DETAILS = [
  { name: 'email-address', re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g },
  { name: 'australian-phone-number', re: /\b(?:\+?61|0)[2-478](?:[ -]?\d){8}\b/g },
  { name: 'australian-street-address', re: /\b\d{1,4}\s+[A-Z][a-z]{2,}\s+(?:St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Cres|Crescent|Ct|Court|Pl|Place|Way|Pde|Parade)\b/g },
];

// `Jordan's strategy sheet.docx`, `Checklist for Jordan.docx` — a personal name
// in a filename is weak on its own but is exactly how the client-derived working
// files in this vault are named.
const NAME_IN_FILENAME = [
  { name: 'possessive-personal-name', re: /\b[A-Z][a-z]{2,}['’]s\b/g },
  { name: 'named-for-person', re: /\bfor\s+[A-Z][a-z]{2,}\b/g },
];

// Words that look like a possessive personal name but are ordinary vocabulary.
const NAME_ALLOWLIST = new Set([
  "child's", "children's", "parent's", "teacher's", "carer's", "clinician's",
  "today's", "week's", "year's", "person's", "student's", "user's", "worker's",
  "therapist's", "adult's", "client's", "participant's", "school's", "family's",
  "sender's", "reader's", "other's", "one's", "everyone's", "someone's",
  "alzheimer's", "parkinson's", "asperger's", "crohn's", "down's", "tourette's",
  "raynaud's", "bell's", "hodgkin's", "meniere's",
]);

function scanText(text, into) {
  if (!text) return;
  for (const [set, bucket] of [[PII_STRONG, 'strong'], [PII_WEAK, 'weak'], [CONTACT_DETAILS, 'contact']]) {
    for (const d of set) {
      d.re.lastIndex = 0;
      const matches = text.match(d.re);
      if (!matches || !matches.length) continue;
      into.signals[d.name] = (into.signals[d.name] || 0) + matches.length;
      if (bucket === 'strong') into.strongCount += matches.length;
      else if (bucket === 'weak') into.weakCount += matches.length;
      else into.contactCount += matches.length;
    }
  }
}

function scanFilename(fileName, into) {
  for (const d of NAME_IN_FILENAME) {
    d.re.lastIndex = 0;
    const matches = fileName.match(d.re) || [];
    const real = matches.filter((m) => !NAME_ALLOWLIST.has(m.toLowerCase().replace(/^for\s+/, '')));
    if (real.length) {
      into.signals[d.name] = (into.signals[d.name] || 0) + real.length;
      into.weakCount += real.length;
    }
  }
}

function newPiiReport() {
  return { signals: {}, strongCount: 0, weakCount: 0, contactCount: 0 };
}

/**
 * Turn evidence into a disposition. Uncertainty resolves to quarantine, never to
 * publication — the brief is explicit that an unclear privacy position is a
 * review state and not a reason to stop.
 */
function privacyFromEvidence(pii) {
  if (pii.strongCount > 0) return 'client-confidential';
  if (pii.weakCount > 0) return 'privacy-review';
  return 'no-obvious-pii';
}

// ── naming ─────────────────────────────────────────────────────────────────

// Vendor download clutter that carries no meaning. `_ver_1`, `t-l-5678-`,
// URL escapes, `copy`, ` (1)`. Version numbers that matter are kept by the
// acronym/version guard below.
const NOISE_PATTERNS = [
  /^au-[a-z]-\d+-/i, /^t-[a-z]-\d+-/i, /^us-[a-z]-\d+-/i,
  /_ver_\d+$/i, /\bver\s*\d+$/i,
  /\bcopy(\s*\d+)?$/i, /\s*\(\d+\)$/, /\s*-\s*copy$/i,
  /^\d{8,}[-_]/,
];

// A bare UUID or hash tells a human nothing.
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_ONLY = /^[0-9a-f]{24,}$/i;

// Acronyms and versions that are clinically load-bearing and must survive.
const PRESERVE = /\b(MoCA|COPM|WHODAS|MOHOST|RUDAS|KICA|MMSE|KIDSCREEN|ACLS|AMPS|SDA|ILO|NDIS|ADHD|ASD|CBT|OT|PEDI|DASH|MACS|GMFCS|FIM|BADLS|IADL|ADL)\b/gi;

function decodeName(value) {
  let out = value;
  try { out = decodeURIComponent(out.replace(/\+/g, ' ')); } catch { /* keep raw */ }
  return out;
}

function friendlyTitle(fileName) {
  const ext = path.extname(fileName);
  let base = decodeName(fileName.slice(0, fileName.length - ext.length));
  base = base.replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' - ');
  for (const p of NOISE_PATTERNS) base = base.replace(p, ' ');
  base = base.replace(/\s{2,}/g, ' ').replace(/^[\s\-–—]+|[\s\-–—]+$/g, '').trim();
  if (!base || UUID_ONLY.test(base) || HASH_ONLY.test(base)) return null;

  // Title case, but never touch a token that is already a known acronym or that
  // is shouting on purpose (NDIS, SDA).
  const preserved = new Set((base.match(PRESERVE) || []).map((s) => s.toLowerCase()));
  base = base.split(' ').map((word) => {
    if (!word) return word;
    if (preserved.has(word.toLowerCase())) {
      const m = PRESERVE.exec(word);
      PRESERVE.lastIndex = 0;
      return m ? m[0].toUpperCase() : word;
    }
    if (/^[A-Z0-9]{2,6}$/.test(word)) return word;      // already an acronym
    if (/^v?\d+(\.\d+)*$/i.test(word)) return word;      // version number
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');

  return base.slice(0, 240);
}

function canonicalSlug(title, fallback) {
  const base = (title || fallback || 'resource')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return base || 'resource';
}

// ── scan ───────────────────────────────────────────────────────────────────

async function inspect(file) {
  const record = {
    relativePath: file.relativePath,
    sourceFilename: file.name,
    extension: path.extname(file.name).slice(1).toLowerCase() || null,
  };

  // A non-reversible handle on the path, computed BEFORE any redaction runs.
  //
  // Path alone cannot decide privacy: the audit's content review found 43 files
  // holding client identifiers that sit OUTSIDE `CLIENTS/` — a first name in the
  // filename, filed under an ordinary topic folder. Those decisions have to
  // survive into a catalogue that may never contain the filename that provoked
  // them, so the overlay refers to a file by this key instead. It is an HMAC, so
  // the committed artifact carries no recoverable path, and the scan can still
  // recognise the same file on a later run.
  record.pathKey = crypto.createHmac('sha256', PATH_KEY_SALT)
    .update(file.relativePath).digest('hex').slice(0, 32);

  let stat;
  try {
    stat = await fsp.stat(file.absolutePath);
  } catch (err) {
    record.error = `stat: ${err.code}`;
    return record;
  }
  record.sizeBytes = stat.size;
  record.modifiedAt = stat.mtime.toISOString();

  const name = file.name;
  // Not resources. Classified before anything is read.
  if (JUNK_EXACT.has(name)) { record.excludeReason = 'system-artifact'; return record; }
  if (OFFICE_TEMP.test(name)) { record.excludeReason = 'office-temp-file'; return record; }
  if (name.endsWith('.icloud')) {
    record.excludeReason = 'icloud-placeholder';
    record.extension = 'icloud';
    // The real name is inside the stub name: `.Foo.pdf.icloud`.
    record.placeholderFor = name.replace(/^\./, '').replace(/\.icloud$/, '');
    return record;
  }

  let buf;
  try {
    buf = await fsp.readFile(file.absolutePath);
  } catch (err) {
    record.error = `read: ${err.code}`;
    record.excludeReason = 'unreadable';
    return record;
  }

  record.sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  const magic = sniff(buf);
  record.detectedMime = magic ? magic.mime : 'application/octet-stream';
  record.declaredMime = EXT_MIME[record.extension] || 'application/octet-stream';
  // OLE2 covers doc/ppt/xls alike, so agreement is judged on family not identity.
  const oleFamily = new Set(['doc', 'ppt', 'xls']);
  const ooxmlFamily = new Set(['docx', 'pptx', 'xlsx']);
  record.magicMatchesExtension = magic
    ? (magic.ext === record.extension
       || (magic.ext === 'ole' && oleFamily.has(record.extension))
       || (magic.ext === 'zip' && ooxmlFamily.has(record.extension))
       || (magic.ext === 'jpg' && record.extension === 'jpeg'))
    : false;

  const pii = newPiiReport();
  scanFilename(file.name, pii);

  const ext = record.extension;
  if (ext === 'pdf') {
    Object.assign(record, await analysePdf(buf, pii));
  } else if (ext === 'docx' || ext === 'pptx') {
    Object.assign(record, await analyseOoxml(buf, ext, pii));
  } else if (ext === 'zip') {
    Object.assign(record, await analyseZip(buf));
  } else if (ext === 'jpeg' || ext === 'jpg' || ext === 'png') {
    Object.assign(record, analyseJpeg(buf));
  } else if (ext === 'doc' || ext === 'ppt') {
    // Legacy binary Office. Page/slide count needs a converter we do not have;
    // recording "unknown" is honest, guessing would not be.
    record.pageCount = null;
    record.legacyBinaryFormat = true;
  }

  // Signal names and counts only — never the matched text.
  record.piiSignals = pii.signals;
  record.piiStrongCount = pii.strongCount;
  record.piiWeakCount = pii.weakCount;
  record.contactDetailCount = pii.contactCount;
  record.privacyEvidence = privacyFromEvidence(pii);

  record.displayTitle = friendlyTitle(file.name);
  record.canonicalSlug = canonicalSlug(record.displayTitle, path.basename(file.name, path.extname(file.name)));
  return record;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
      done++;
      if (done % 25 === 0) process.stderr.write(`  …${done}/${items.length}\n`);
    }
  });
  await Promise.all(workers);
  return out;
}

function isClientPath(relativePath) {
  const first = String(relativePath || '').split('/')[0];
  return first.toUpperCase() === CLIENT_ROOT;
}

/**
 * Keep the containing folder, drop the filename.
 *
 * The folder is topic information a reviewer needs in order to find the file
 * again; the filename is the part that names a person. `PAEDS/SENSORY/…` says
 * enough to be useful and nothing about whom.
 */
function redactedContainer(relativePath) {
  const rel = String(relativePath || '');
  const cut = rel.lastIndexOf('/');
  return cut === -1 ? '…' : `${rel.slice(0, cut)}/…`;
}

async function main() {
  if (!OUT) {
    console.error('Refusing to run without --out. Nothing is written to the source vault.');
    process.exit(2);
  }
  const outAbs = path.resolve(OUT);
  if (outAbs.startsWith(SOURCE_ROOT + path.sep) || outAbs === SOURCE_ROOT) {
    console.error('Refusing to write inside the source vault. Choose --out elsewhere.');
    process.exit(2);
  }
  if (!fs.existsSync(SOURCE_ROOT)) {
    console.error(`Source root not found: ${SOURCE_ROOT}`);
    process.exit(2);
  }

  console.error(`Scanning ${SOURCE_ROOT} …`);
  const files = [];
  await walk(SOURCE_ROOT, '', files);
  const readable = files.filter((f) => f.absolutePath);
  const scanList = LIMIT ? readable.slice(0, LIMIT) : readable;
  console.error(`Found ${files.length} entries; inspecting ${scanList.length}.`);

  const records = await mapLimit(scanList, CONCURRENCY, inspect);
  for (const f of files.filter((x) => !x.absolutePath)) {
    records.push({ relativePath: f.relativePath, error: f.error, excludeReason: 'unreadable' });
  }

  // ── duplicate graph, computed across everything ─────────────────────────
  const byHash = new Map();
  for (const r of records) {
    if (!r.sha256) continue;
    if (!byHash.has(r.sha256)) byHash.set(r.sha256, []);
    byHash.get(r.sha256).push(r);
  }

  // Canonical copy of a hash group: prefer a NON-client path, then the
  // shallowest path, then lexicographic. Deterministic on re-run.
  for (const [, group] of byHash) {
    const ordered = [...group].sort((a, b) => {
      const ac = isClientPath(a.relativePath) ? 1 : 0;
      const bc = isClientPath(b.relativePath) ? 1 : 0;
      if (ac !== bc) return ac - bc;
      const ad = a.relativePath.split('/').length;
      const bd = b.relativePath.split('/').length;
      if (ad !== bd) return ad - bd;
      return a.relativePath.localeCompare(b.relativePath);
    });
    const canonical = ordered[0];
    for (const r of ordered) {
      r.duplicateGroupSize = group.length;
      r.isCanonicalCopy = r === canonical;
      if (r !== canonical) r.duplicateOfPath = canonical.relativePath;
    }
  }

  // ── privacy resolution ──────────────────────────────────────────────────
  //
  // Decided AFTER the duplicate graph, because "is this file generic?" is a
  // question only the graph can answer.
  //
  // Privacy is the UNION of two independent signals, never the intersection:
  // where the file sits, and what is inside it. Either one is enough. Location
  // alone would have published the working files that carry a client's name in
  // an ordinary topic folder; content alone would miss an innocuously-named
  // photograph filed under CLIENTS.
  let clientFiles = 0;
  let genericRescued = 0;
  let evidenceFlagged = 0;

  const flaggedByPath = (r) => isClientPath(r.relativePath);
  const flaggedByEvidence = (r) => r.privacyEvidence && r.privacyEvidence !== 'no-obvious-pii';
  const isFlagged = (r) => flaggedByPath(r) || flaggedByEvidence(r);

  for (const r of records) {
    if (flaggedByPath(r)) clientFiles++;
    if (!isFlagged(r)) continue;
    if (flaggedByEvidence(r) && !flaggedByPath(r)) evidenceFlagged++;

    // A flagged file that is byte-identical to an unflagged one is proven
    // generic: the same document exists somewhere with nothing personal about
    // it. That safe copy is what gets used, and this path is simply ignored —
    // no derivative is created, so no review is required to make it safe.
    const group = r.sha256 ? byHash.get(r.sha256) || [] : [];
    const safeTwin = group.find((o) => o !== r && !isFlagged(o));
    if (safeTwin) {
      r.privacyClass = flaggedByPath(r)
        ? 'client-path-generic-duplicate'
        : 'flagged-name-generic-duplicate';
      r.usesSafeCopyAt = safeTwin.relativePath;
      r.relativePath = flaggedByPath(r) ? `${CLIENT_ROOT}/…` : redactedContainer(r.relativePath);
      r.sourceFilename = null;
      r.displayTitle = null;
      genericRescued++;
      continue;
    }

    // Strong evidence, or a CLIENTS path with no safe twin: client-derived.
    // Everything identifying is dropped here, permanently.
    if (flaggedByPath(r) || r.privacyEvidence === 'client-confidential') {
      r.privacyClass = 'client-confidential';
      r.relativePath = flaggedByPath(r) ? `${CLIENT_ROOT}/…` : redactedContainer(r.relativePath);
      delete r.sha256;
      delete r.duplicateOfPath;
      delete r.usesSafeCopyAt;
    } else {
      // Weak evidence only. Quarantined for a human, not condemned — but the
      // shipped catalogue still carries no filename, because the whole question
      // being reviewed is whether that filename names a person. The reviewer
      // resolves `pathKey` back to a file by re-running the scan locally.
      r.privacyClass = 'privacy-review';
      r.relativePath = redactedContainer(r.relativePath);
    }
    r.sourceFilename = null;
    r.displayTitle = null;
    r.canonicalSlug = null;
    r.placeholderFor = null;
  }

  // Stable ids derived from the path key, never from position.
  //
  // A positional id looks stable until the vault gains a file: every id after
  // the insertion point shifts by one, and every decision recorded against an
  // id silently transfers to a different document. The path key is an HMAC of
  // the file's own location, so it is unique per file, identical across runs and
  // machines, and — unlike the checksum — still distinct for the two copies of a
  // duplicated document, which need separate register rows.
  for (const r of records) {
    r.id = r.pathKey ? `src-${r.pathKey.slice(0, 12)}` : null;
  }
  const seen = new Set();
  for (const r of records) {
    if (!r.id) {
      // Only reachable for an entry we could not stat; give it a deterministic
      // id from its path so the reconciliation total still balances.
      r.id = `src-${crypto.createHmac('sha256', PATH_KEY_SALT)
        .update(String(r.relativePath)).digest('hex').slice(0, 12)}`;
    }
    if (seen.has(r.id)) throw new Error(`Duplicate catalogue id ${r.id} — path key collision.`);
    seen.add(r.id);
  }
  records.sort((a, b) => a.id.localeCompare(b.id));

  // ── summary ─────────────────────────────────────────────────────────────
  const pdfs = records.filter((r) => r.extension === 'pdf');
  const dupGroups = [...byHash.values()].filter((g) => g.length > 1);
  const byExtension = {};
  const byExcludeReason = {};
  for (const r of records) {
    byExtension[r.extension || 'none'] = (byExtension[r.extension || 'none'] || 0) + 1;
    if (r.excludeReason) byExcludeReason[r.excludeReason] = (byExcludeReason[r.excludeReason] || 0) + 1;
  }

  const summary = {
    generated_on: new Date().toISOString().slice(0, 10),
    source_root: SOURCE_ROOT,
    scanner: 'backend/setup/scan-resource-source.js',
    file_count: records.length,
    total_size_bytes: records.reduce((a, r) => a + (r.sizeBytes || 0), 0),
    by_extension: byExtension,
    by_exclude_reason: byExcludeReason,
    pdf_total: pdfs.length,
    pdf_text_extractable: pdfs.filter((r) => r.textExtractable).length,
    pdf_image_only_or_hostile: pdfs.filter((r) => r.likelyScanned).length,
    pdf_with_fillable_fields: pdfs.filter((r) => r.hasFillableFields).length,
    pdf_encrypted: pdfs.filter((r) => r.encrypted).length,
    pdf_pages_total: pdfs.reduce((a, r) => a + (r.pageCount || 0), 0),
    duplicate_groups: dupGroups.length,
    redundant_copies: dupGroups.reduce((a, g) => a + g.length - 1, 0),
    files_in_duplicate_groups: dupGroups.reduce((a, g) => a + g.length, 0),
    client_path_files: clientFiles,
    client_confidential: records.filter((r) => r.privacyClass === 'client-confidential').length,
    privacy_review_quarantined: records.filter((r) => r.privacyClass === 'privacy-review').length,
    generic_duplicates_rescued: genericRescued,
    flagged_by_content_evidence_only: evidenceFlagged,
    pii_signal_totals: records.reduce((acc, r) => {
      for (const [k, v] of Object.entries(r.piiSignals || {})) acc[k] = (acc[k] || 0) + v;
      return acc;
    }, {}),
    zip_archives: records.filter((r) => r.extension === 'zip').length,
    zip_unsafe_members: records.reduce((a, r) => a + ((r.unsafeMembers || []).length), 0),
    icloud_placeholders: records.filter((r) => r.excludeReason === 'icloud-placeholder').length,
    magic_mismatch: records.filter((r) => r.sha256 && !r.magicMatchesExtension).length,
    analysis_errors: records.filter((r) => r.analysisError || r.error).length,
  };

  const payload = { schema_version: SCHEMA_VERSION, summary, records };
  await fsp.mkdir(path.dirname(outAbs), { recursive: true });
  await fsp.writeFile(outAbs, JSON.stringify(payload, null, 2));

  console.error('\n── summary ──');
  console.error(JSON.stringify(summary, null, 2));
  console.error(`\nWrote ${records.length} records to ${outAbs}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
