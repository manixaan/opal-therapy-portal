'use strict';

/**
 * WHODAS 2.0 — TEMPLATE EXTRACTION (provenance script)
 *
 * The three official 36-item instruments were never supplied as standalone
 * files. They exist only as page ranges inside the single WHO manual PDF
 * (`Measuring Health and Disability: Manual for WHO Disability Assessment
 * Schedule (WHODAS 2.0)`, WHO 2010). This script is the recorded, repeatable
 * process that turns that one hashed source into the immutable per-method
 * templates the assessment module renders and overlays.
 *
 * WHY pdf-lib copyPages AND NOT A RE-RENDER
 * copyPages lifts the page dictionary and its content streams, fonts and
 * boxes across verbatim. Nothing is rasterised, re-typeset, re-flowed or
 * re-encoded, so the instrument itself is untouched — which is both the
 * brief's hard requirement and manual §5.1's "no substantive changes"
 * condition. The output differs from the source only in which pages it
 * contains.
 *
 * WHY THE PAGES LOOK CLEAN
 * Every page in the manual carries MediaBox [0 0 567 780] — a print sheet
 * including registration/crop marks and the `WHODAS-03(23Nov09).book Page n`
 * running head — plus CropBox [41.76 41.76 523.8 735.0], which trims to the
 * finished 482.04 x 693.24 pt page. Viewers honour CropBox, so the marks never
 * show. Both boxes are carried over unchanged; the field maps are expressed
 * relative to the CropBox origin.
 *
 * RUN
 *   node backend/whodas/extract-templates.js --source "/path/to/manual.pdf"
 *   node backend/whodas/extract-templates.js --verify     (no writes)
 *
 * The generated PDFs and manifest.json are committed. `--verify` re-derives
 * every hash and fails if anything drifted.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const MANIFEST_PATH = path.join(TEMPLATES_DIR, 'manifest.json');

/**
 * SHA-256 of the one authoritative source. Pinned so an extraction can never
 * be run against a different edition of the manual without it being obvious.
 */
const SOURCE_SHA256 =
  'a78fcb2503c726c84be7e74361aa225d0e2a34de7ecd4cbecac4e4d1ec22da6d';

const SOURCE_TITLE =
  'Measuring Health and Disability: Manual for WHO Disability Assessment ' +
  'Schedule (WHODAS 2.0). Geneva: World Health Organization; 2010. ' +
  'ISBN 978 92 4 154759 8.';

/**
 * Page ranges are 1-indexed and inclusive, as printed in the manual's Part 3.
 * Verified page-by-page during the source audit (docs/whodas/02_WHO_SOURCE_AUDIT.md).
 */
const TEMPLATES = [
  {
    key: 'whodas-36-interviewer',
    method: 'interviewer',
    name: 'WHODAS 2.0 — 36-item version, interviewer-administered',
    filename: 'whodas-36-interviewer.pdf',
    pages: [[99, 108]],
    expectedPageCount: 10,
  },
  {
    key: 'whodas-36-self',
    method: 'self',
    name: 'WHODAS 2.0 — 36-item version, self-administered',
    filename: 'whodas-36-self.pdf',
    pages: [[113, 116]],
    expectedPageCount: 4,
  },
  {
    key: 'whodas-36-proxy',
    method: 'proxy',
    name: 'WHODAS 2.0 — 36-item version, proxy-administered',
    filename: 'whodas-36-proxy.pdf',
    pages: [[117, 121]],
    expectedPageCount: 5,
  },
  {
    // Interviewer flashcards #1 and #2. Not an instrument and never scored,
    // but "Show flashcards #1 and #2" is printed above every domain block of
    // the interviewer form, so correct administration depends on them.
    key: 'whodas-36-flashcards',
    method: 'interviewer',
    name: 'WHODAS 2.0 — interviewer flashcards #1 and #2',
    filename: 'whodas-36-flashcards.pdf',
    pages: [[109, 109], [111, 111]],
    expectedPageCount: 2,
  },
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function expandPages(ranges) {
  const out = [];
  for (const [from, to] of ranges) {
    for (let p = from; p <= to; p += 1) out.push(p);
  }
  return out;
}

/** Rounded to 2dp: PDF box values are floats and we compare them across runs. */
function boxOf(page) {
  const m = page.getMediaBox();
  const c = page.getCropBox();
  const r = (n) => Math.round(n * 100) / 100;
  return {
    mediaBox: [r(m.x), r(m.y), r(m.width), r(m.height)],
    cropBox: [r(c.x), r(c.y), r(c.width), r(c.height)],
  };
}

async function buildTemplate(sourceDoc, spec) {
  const pageNumbers = expandPages(spec.pages);
  if (pageNumbers.length !== spec.expectedPageCount) {
    throw new Error(
      `${spec.key}: page ranges yield ${pageNumbers.length} pages, expected ${spec.expectedPageCount}`
    );
  }

  const out = await PDFDocument.create();
  const copied = await out.copyPages(sourceDoc, pageNumbers.map((n) => n - 1));
  copied.forEach((p) => out.addPage(p));

  // Deliberately no title/author/producer of ours: adding Opal metadata to a
  // WHO instrument is exactly the branding the brief forbids. Fixed creation
  // dates keep the output byte-reproducible across runs.
  const epoch = new Date(0);
  out.setCreationDate(epoch);
  out.setModificationDate(epoch);

  const bytes = Buffer.from(await out.save({ useObjectStreams: false }));

  const check = await PDFDocument.load(bytes);
  const pages = check.getPages();
  if (pages.length !== spec.expectedPageCount) {
    throw new Error(`${spec.key}: wrote ${pages.length} pages, expected ${spec.expectedPageCount}`);
  }

  const geometry = pages.map(boxOf);
  const first = JSON.stringify(geometry[0]);
  const uniform = geometry.every((g) => JSON.stringify(g) === first);

  return {
    bytes,
    entry: {
      key: spec.key,
      method: spec.method,
      name: spec.name,
      filename: spec.filename,
      version: '1.0.0',
      instrument: 'WHODAS-2.0',
      itemSet: '36-item',
      sourcePages: spec.pages.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(','),
      pageCount: pages.length,
      uniformGeometry: uniform,
      mediaBox: geometry[0].mediaBox,
      cropBox: geometry[0].cropBox,
      byteSize: bytes.length,
      sha256: sha256(bytes),
      active: true,
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const verifyOnly = argv.includes('--verify');
  const sourceIdx = argv.indexOf('--source');
  const sourcePath = sourceIdx !== -1 ? argv[sourceIdx + 1] : process.env.WHODAS_MANUAL_PDF;

  if (verifyOnly) return verify();

  if (!sourcePath) {
    console.error(
      'ERROR: pass --source "/path/to/WHO Disability Assessment Manual.pdf"\n' +
      '       (or set WHODAS_MANUAL_PDF). The manual is a WHO publication and\n' +
      '       is deliberately not committed to this repository.'
    );
    process.exit(1);
  }

  const sourceBytes = fs.readFileSync(sourcePath);
  const actual = sha256(sourceBytes);
  if (actual !== SOURCE_SHA256) {
    console.error(
      `ERROR: source manual hash mismatch.\n  expected ${SOURCE_SHA256}\n  actual   ${actual}\n` +
      'Refusing to extract: the templates must be traceable to the audited edition.'
    );
    process.exit(1);
  }

  const sourceDoc = await PDFDocument.load(sourceBytes);
  const sourcePageCount = sourceDoc.getPageCount();
  if (sourcePageCount !== 152) {
    console.error(`ERROR: expected a 152-page manual, got ${sourcePageCount}`);
    process.exit(1);
  }

  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

  const entries = [];
  for (const spec of TEMPLATES) {
    const { bytes, entry } = await buildTemplate(sourceDoc, spec);
    fs.writeFileSync(path.join(TEMPLATES_DIR, spec.filename), bytes);
    entries.push(entry);
    console.log(
      `  ${entry.filename.padEnd(30)} pages=${String(entry.pageCount).padStart(2)} ` +
      `crop=${entry.cropBox[2]}x${entry.cropBox[3]} ${entry.byteSize} bytes  ${entry.sha256}`
    );
  }

  const manifest = {
    generatedBy: 'backend/whodas/extract-templates.js',
    source: {
      title: SOURCE_TITLE,
      copyright: '© World Health Organization 2010',
      sha256: SOURCE_SHA256,
      pageCount: sourcePageCount,
      note:
        'Instrument placed in the public domain by WHO (manual §5.1), subject ' +
        'to registration on the WHODAS 2.0 web site and to no substantive ' +
        'changes. See docs/whodas/03_LICENSING_COMPLIANCE.md.',
    },
    extraction: {
      method: 'pdf-lib copyPages — content streams, fonts and page boxes copied verbatim',
      modifications: 'none to page content',
    },
    templates: entries,
  };

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nWrote ${entries.length} templates + manifest.json`);
}

/** Re-derive every committed hash. Used by tests and by the boot-time check. */
function verify() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('ERROR: manifest.json missing — run extraction first.');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  let failed = 0;
  for (const t of manifest.templates) {
    const file = path.join(TEMPLATES_DIR, t.filename);
    if (!fs.existsSync(file)) {
      console.error(`  MISSING  ${t.filename}`);
      failed += 1;
      continue;
    }
    const actual = sha256(fs.readFileSync(file));
    if (actual !== t.sha256) {
      console.error(`  CHANGED  ${t.filename}\n    expected ${t.sha256}\n    actual   ${actual}`);
      failed += 1;
    } else {
      console.log(`  ok       ${t.filename}  ${t.sha256.slice(0, 16)}…`);
    }
  }
  if (failed) {
    console.error(`\n${failed} template(s) failed verification.`);
    process.exit(1);
  }
  console.log(`\nAll ${manifest.templates.length} templates verified.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { TEMPLATES, SOURCE_SHA256, TEMPLATES_DIR, MANIFEST_PATH, sha256, verify };
