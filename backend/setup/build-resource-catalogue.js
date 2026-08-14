#!/usr/bin/env node
'use strict';

/**
 * Translate a source scan into the catalogue the ingestion importer reads.
 *
 * WHY THIS EXISTS
 * The chain that produces the ingestion register had a hole in the middle.
 * `scan-resource-source.js` computes the facts from the vault's own bytes;
 * `ingest-resource-catalogue.js` writes the register. Nothing joined them: the
 * scanner emits camelCase in its own vocabulary, the importer reads snake_case
 * in the vocabulary of `resource-ingestion.js`, and the file that bridged the
 * two was produced once, by another tool, on one machine, outside this
 * repository. The register was therefore unreproducible — not because the
 * decisions were wrong, but because nobody else could regenerate their input.
 *
 * This is the missing joint, and it lives in the repo so the whole chain runs
 * from a clean checkout:
 *
 *   scan-resource-source.js → build-resource-catalogue.js → ingest-resource-catalogue.js
 *
 * WHAT IT REFUSES TO DO
 * A scanner reads bytes. Bytes do not say who published a document, whether
 * Opal may redistribute it, or which clinical topic it serves. Those are human
 * judgements, so this translator does not make them. `topic`, `resource_type`,
 * `source_class` and `source_organisation` are emitted NULL, `rights_status` is
 * emitted as the literal 'not-reviewed', and every record that is not already
 * excluded, duplicated or missing gets `hold-for-rights-review`.
 *
 * That is deliberately the least convenient answer. A record arrives in the
 * register as unreviewed — which is true — rather than as an invented rights
 * position a later reviewer would have to disprove. Nothing here ever emits an
 * authorship claim, and nothing becomes publishable by passing through it.
 * Document metadata that names an author is dropped rather than promoted into
 * `source_organisation`, because a `dc:creator` value is evidence, not a
 * licence, and because on a personal file it is frequently a person.
 *
 * PRIVACY
 * The scanner already redacts a flagged record before it writes its output. This
 * translator redacts again — filename, title, checksum and the basename of the
 * path — instead of trusting that it did. The two passes exist for the same
 * reason `resource-ingestion.js` re-checks the forbidden roots that the
 * catalogue is supposed to have already excluded: a single mislabelled record
 * must not be enough to carry a client's name forward.
 *
 * Both of the scanner's flagged classes land on a privacy class that
 * `resource-ingestion.js` treats as private, so both are excluded by
 * `treatmentFor()`. Uncertainty resolves to quarantine, never to publication.
 *
 * THE OUTPUT IS A BUILD ARTIFACT, NOT A COMMITTED ONE
 * The catalogue carries vault-relative paths and the vault root it was built
 * from. It belongs in a build directory, and `resource-privacy-leak.test.js`
 * will fail if a copy is left anywhere the repository ships from.
 *
 *   node backend/setup/build-resource-catalogue.js --scan <scan.json> --out <catalogue.json>
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ing = require('../resource-ingestion');

const SCHEMA_VERSION = '1.0';
const BUILDER = 'backend/setup/build-resource-catalogue.js';

/**
 * Salt for the fallback id only.
 *
 * The scanner already derives a stable id per file and this normally just
 * passes it through. The fallback covers a scan record that arrived without
 * one — a hand-written fixture, or an older scan schema — and it must still be
 * deterministic, because an id that moved between runs would silently transfer
 * a recorded decision from one document to another.
 */
const ID_SALT = 'opal-resource-hub/catalogue-id/v1';

/** Mirrors resource_ingestion_register.catalogue_id in migration 030. */
const MAX_CATALOGUE_ID_LENGTH = 20;

// ── Vocabulary translation ──────────────────────────────────────────────────
//
// The scanner names privacy states after the EVIDENCE it found; the importer
// names them after the RISK they carry. Both of the scanner's flagged states
// have to land inside PRIVATE_PRIVACY_CLASSES, because that list is what
// `treatmentFor()` consults, and anything outside it is publishable material as
// far as the register is concerned.

const PRIVACY_CLASS_BY_SCAN_CLASS = {
  // Strong evidence, or a client-root path with no generic twin.
  'client-confidential': 'client-identifiable',
  // Weak evidence only. Quarantined for a human, not condemned — but private
  // until that human says otherwise.
  'privacy-review': 'potentially-client-identifiable',
  // Proven generic by a byte-identical copy sitting outside the flagged area.
  // The safe copy is catalogued separately and is the one that gets used, so
  // this path is excluded rather than reviewed: it has already lost its
  // identity, there is nothing left to review, and the useful copy is elsewhere.
  'client-path-generic-duplicate': 'potentially-client-derived',
  'flagged-name-generic-duplicate': 'potentially-client-derived',
};

/** Used when the scan carried no resolved class, only the raw evidence verdict. */
const PRIVACY_CLASS_BY_EVIDENCE = {
  'client-confidential': 'client-identifiable',
  'privacy-review': 'potentially-client-identifiable',
  'no-obvious-pii': 'no-obvious-pii-from-file-level-review',
};

/**
 * A record the scanner never got far enough to assess: a system artifact, an
 * iCloud stub, an unreadable file. It is not evidence of safety and must not be
 * written as though a review had happened.
 */
const PRIVACY_CLASS_UNASSESSED = 'not-assessed';

// Portal actions. Every one of these is a key of TREATMENT_BY_PORTAL_ACTION;
// `assertTranslatable()` proves it against the real map rather than trusting
// this comment.
const ACTION_REVIEW = 'hold-for-rights-review';
const ACTION_EXCLUDE = 'exclude-from-resource-hub';
const ACTION_ICLOUD = 'download-from-icloud-before-review';
const ACTION_DUPLICATE = 'archive-exact-duplicate';

/**
 * Not a rights status. The absence of one, stated.
 *
 * `normalizeOrganisation()` already refuses to treat 'unknown' or 'unverified'
 * as agreement between two records; this is the same idea for rights. It must
 * never be read as a permission, which is why it is a negation rather than a
 * category like 'public-domain' that a hurried reviewer could mistake for a
 * finding.
 */
const RIGHTS_NOT_REVIEWED = 'not-reviewed';

/** The scanner's redaction marker, kept identical so redaction is idempotent. */
const REDACTION_MARKER = '…';

// ── Helpers ─────────────────────────────────────────────────────────────────

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function catalogueIdFor(scanRecord) {
  if (scanRecord.id) return String(scanRecord.id);
  if (scanRecord.pathKey) return `src-${String(scanRecord.pathKey).slice(0, 12)}`;
  // Deterministic in the path, so a rebuild of the same scan yields the same id.
  return `src-${crypto.createHmac('sha256', ID_SALT)
    .update(String(scanRecord.relativePath || '')).digest('hex').slice(0, 12)}`;
}

/**
 * Which importer privacy class this scan record belongs to.
 *
 * Resolved class first, then the raw evidence verdict, then 'not-assessed'.
 * There is no branch that returns a safe-looking value for an input it did not
 * recognise: an unknown scanner class falls through to 'not-assessed', which is
 * honest, and a record already sitting under a forbidden root is excluded by
 * `treatmentFor()` regardless of what this returns.
 */
function privacyClassFor(scanRecord) {
  const mapped = PRIVACY_CLASS_BY_SCAN_CLASS[scanRecord.privacyClass];
  if (mapped) return mapped;
  const fromEvidence = PRIVACY_CLASS_BY_EVIDENCE[scanRecord.privacyEvidence];
  if (fromEvidence) return fromEvidence;
  return PRIVACY_CLASS_UNASSESSED;
}

/**
 * Keep the containing directory, replace the basename with the marker.
 *
 * The directory is topic information a reviewer needs to find the file again;
 * the basename is the part that names a person. Idempotent, so re-redacting a
 * path the scanner already redacted changes nothing.
 */
function redactPath(relativePath) {
  const rel = String(relativePath || '');
  if (!rel) return null;
  const cut = rel.lastIndexOf('/');
  if (cut === -1) return REDACTION_MARKER;
  return `${rel.slice(0, cut)}/${REDACTION_MARKER}`;
}

/**
 * The action this record should arrive in the register with.
 *
 * Order is the point. Privacy outranks everything, then an absent file, then a
 * redundant copy, and anything still standing goes to a human. There is no
 * branch that publishes.
 */
function portalActionFor(scanRecord, { isPrivate, duplicateOf }) {
  if (isPrivate) return ACTION_EXCLUDE;
  if (scanRecord.excludeReason === 'icloud-placeholder') return ACTION_ICLOUD;
  // A duplicate is only archivable if the master it defers to is itself in the
  // catalogue. Without a resolvable master the record would claim a reference
  // that does not exist, so it goes to review instead.
  if (duplicateOf) return ACTION_DUPLICATE;
  return ACTION_REVIEW;
}

/**
 * Technical facts a reviewer needs and no identity.
 *
 * Counts and signal NAMES only, never a matched value — the same rule the
 * scanner's detectors already follow. Two fields could name a person and are
 * handled explicitly: the document author the scanner reads from OOXML
 * properties is never carried at all (it is not in this object), and the real
 * filename behind an iCloud stub is carried only for a record that is not
 * private — the same boundary the importer's own redactedIdentity() draws for
 * source_filename, which the stub name is just another spelling of. The
 * analysis error string is dropped for a private record because a library
 * message is not a field this file controls the contents of.
 */
function scanEvidenceFor(scanRecord, isPrivate) {
  const evidence = {
    path_key: scanRecord.pathKey || null,
    exclude_reason: scanRecord.excludeReason || null,
    detected_mime: scanRecord.detectedMime || null,
    declared_mime: scanRecord.declaredMime || null,
    magic_matches_extension: scanRecord.magicMatchesExtension ?? null,
    text_extractable: scanRecord.textExtractable ?? null,
    likely_scanned: scanRecord.likelyScanned ?? null,
    has_fillable_fields: scanRecord.hasFillableFields ?? null,
    fillable_field_count: scanRecord.fillableFieldCount ?? null,
    encrypted: scanRecord.encrypted ?? null,
    legacy_binary_format: scanRecord.legacyBinaryFormat ?? null,
    duplicate_group_size: scanRecord.duplicateGroupSize ?? null,
    is_canonical_copy: scanRecord.isCanonicalCopy ?? null,
    pii_signals: scanRecord.piiSignals || {},
    pii_strong_count: scanRecord.piiStrongCount ?? null,
    pii_weak_count: scanRecord.piiWeakCount ?? null,
    contact_detail_count: scanRecord.contactDetailCount ?? null,
    analysis_error: isPrivate ? null : (scanRecord.analysisError || scanRecord.error || null),
    placeholder_for: isPrivate ? null : (scanRecord.placeholderFor || null),
    uses_safe_copy_at: null,
  };

  // Only a *-generic-duplicate record may carry this, and only because the
  // scanner picks the safe twin from the files it did NOT flag — so the path is
  // non-client by construction. It is the one thing that makes a rescued
  // duplicate actionable: it says where the usable copy is.
  if (/-generic-duplicate$/.test(String(scanRecord.privacyClass || ''))
      && scanRecord.usesSafeCopyAt) {
    evidence.uses_safe_copy_at = scanRecord.usesSafeCopyAt;
  }

  return evidence;
}

/**
 * Address every non-redacted path to its catalogue id, so `duplicate_of` can
 * name a master rather than repeat a path.
 *
 * A path that appears twice is dropped rather than resolved to whichever record
 * happened to be scanned first — an ambiguous master is worse than none, and
 * `portalActionFor()` sends a duplicate with no master to review.
 */
function buildPathIndex(scanRecords) {
  const index = new Map();
  const ambiguous = new Set();
  for (const r of scanRecords) {
    const rel = r.relativePath;
    if (!rel || rel.endsWith(REDACTION_MARKER)) continue;
    // A master must survive its own translation. The path being unredacted is
    // not enough: a record this build will itself exclude — a privacy class the
    // importer treats as private, an iCloud stub, an unreadable file — cannot
    // anchor anyone's `duplicate_of`, or a legitimate resource would be
    // archived against a reference that resolves to nothing. Such duplicates
    // fall through to review instead, which is the honest place for them.
    const privacyClass = privacyClassFor(r);
    if (ing.PRIVATE_PRIVACY_CLASSES.includes(privacyClass)) continue;
    if (ing.underForbiddenRoot(rel)) continue;
    if (r.excludeReason) continue;
    if (index.has(rel)) { ambiguous.add(rel); continue; }
    index.set(rel, catalogueIdFor(r));
  }
  for (const rel of ambiguous) index.delete(rel);
  return index;
}

// ── Translation ─────────────────────────────────────────────────────────────

function translate(scanRecord, pathIndex) {
  const privacyClass = privacyClassFor(scanRecord);
  // Either signal is enough, and the path check is repeated here so a record
  // whose class was mislabelled is still caught by where it sits.
  const isPrivate = ing.PRIVATE_PRIVACY_CLASSES.includes(privacyClass)
    || ing.underForbiddenRoot(scanRecord.relativePath);

  const duplicateOf = (scanRecord.isCanonicalCopy === false && scanRecord.duplicateOfPath)
    ? (pathIndex.get(scanRecord.duplicateOfPath) || null)
    : null;

  const sourcePath = isPrivate
    ? redactPath(scanRecord.relativePath)
    : (scanRecord.relativePath || null);

  return {
    id: catalogueIdFor(scanRecord),

    // Identity. Stripped for a private record, whether or not the scanner
    // already stripped it.
    source_relative_path: sourcePath,
    source_filename: isPrivate ? null : (scanRecord.sourceFilename || null),
    display_title: isPrivate ? null : (scanRecord.displayTitle || null),
    sha256: isPrivate ? null : (scanRecord.sha256 || null),

    // Measurements. Aggregate, and useful for reconciling counts.
    extension: scanRecord.extension || null,
    size_bytes: Number.isFinite(scanRecord.sizeBytes) ? scanRecord.sizeBytes : null,
    page_or_slide_count: Number.isFinite(scanRecord.pageCount) ? scanRecord.pageCount : null,

    // Human judgements the scanner cannot make. NULL is the honest value.
    topic: null,
    resource_type: null,
    source_class: null,
    source_organisation: null,

    privacy_class: privacyClass,
    rights_status: isPrivate ? null : RIGHTS_NOT_REVIEWED,
    portal_action: portalActionFor(scanRecord, { isPrivate, duplicateOf }),
    duplicate_of: duplicateOf,

    scan_evidence: scanEvidenceFor(scanRecord, isPrivate),
  };
}

/**
 * Prove the output before it is written.
 *
 * `treatmentFor()` throws on an unmapped portal_action, and it is the real
 * function rather than a copy of its table, so a vocabulary change in
 * `resource-ingestion.js` fails the build here instead of half way through an
 * import. The id checks match migration 030's column, so a catalogue that could
 * not be stored never reaches the importer.
 */
function assertTranslatable(records) {
  const seen = new Set();
  for (const record of records) {
    ing.treatmentFor(record);                        // throws if unmapped
    if (!record.id) throw new Error('A catalogue record has no id.');
    if (record.id.length > MAX_CATALOGUE_ID_LENGTH) {
      throw new Error(`Catalogue id ${record.id} exceeds ${MAX_CATALOGUE_ID_LENGTH} characters.`);
    }
    if (seen.has(record.id)) throw new Error(`Duplicate catalogue id ${record.id}.`);
    seen.add(record.id);
  }

  // Belt and braces on the redaction, asserted rather than assumed.
  const leaking = records.filter((r) => ing.isPrivate(r))
    .filter((r) => r.source_filename || r.display_title || r.sha256);
  if (leaking.length) {
    throw new Error(`${leaking.length} private record(s) still carry an identifying field.`);
  }
}

function summarise(records, scan) {
  const tally = (key) => records.reduce((acc, r) => {
    const k = r[key] || 'none';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const scanSummary = (scan && scan.summary) || {};
  return {
    generated_on: new Date().toISOString().slice(0, 10),
    builder: BUILDER,
    built_from: {
      scanner: scanSummary.scanner || null,
      scan_schema_version: scan ? scan.schema_version || null : null,
      scan_generated_on: scanSummary.generated_on || null,
      scan_file_count: scanSummary.file_count ?? null,
      source_root: scanSummary.source_root || null,
    },
    // The importer compares this with its own record count and refuses a
    // catalogue that disagrees with itself, so it must be derived, never typed.
    file_count: records.length,
    by_portal_action: tally('portal_action'),
    by_privacy_class: tally('privacy_class'),
    by_extension: tally('extension'),
    private_records: records.filter((r) => ing.isPrivate(r)).length,
    duplicates_with_master: records.filter((r) => r.duplicate_of).length,
    unresolved_duplicates: records.filter(
      (r) => !r.duplicate_of && r.scan_evidence.is_canonical_copy === false).length,
    icloud_placeholders: records.filter(
      (r) => r.scan_evidence.exclude_reason === 'icloud-placeholder').length,
    rights_unreviewed: records.filter((r) => r.rights_status === RIGHTS_NOT_REVIEWED).length,
  };
}

/**
 * Scan payload → catalogue payload. Pure: no filesystem, no clock beyond the
 * summary's generated_on, no network.
 */
function buildCatalogue(scan) {
  if (!scan || !Array.isArray(scan.records)) {
    throw new Error('Scan file has no records array. Run scan-resource-source.js first.');
  }
  if (!scan.records.length) throw new Error('Scan file contains no records.');

  const pathIndex = buildPathIndex(scan.records);
  const records = scan.records.map((r) => translate(r, pathIndex));
  // Sorted by id so two builds of one scan are byte-identical.
  records.sort((a, b) => a.id.localeCompare(b.id));
  assertTranslatable(records);

  return { schema_version: SCHEMA_VERSION, summary: summarise(records, scan), records };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main() {
  const scanPath = argValue('--scan');
  const outPath = argValue('--out');
  if (!scanPath || !outPath) {
    console.error('Usage: node backend/setup/build-resource-catalogue.js --scan <scan.json> --out <catalogue.json>');
    process.exit(2);
  }

  const scan = JSON.parse(fs.readFileSync(path.resolve(scanPath), 'utf8'));
  const outAbs = path.resolve(outPath);

  // The vault is a source and never a destination. The scanner enforces this
  // for its own output; the same rule applies to anything derived from it.
  const sourceRoot = scan.summary && scan.summary.source_root;
  if (sourceRoot && (outAbs === sourceRoot || outAbs.startsWith(sourceRoot + path.sep))) {
    console.error('Refusing to write inside the scanned source vault. Choose --out elsewhere.');
    process.exit(2);
  }

  const catalogue = buildCatalogue(scan);

  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(catalogue, null, 2));

  console.error('\n── catalogue ──');
  console.error(JSON.stringify(catalogue.summary, null, 2));
  console.error(`\nWrote ${catalogue.records.length} records to ${outAbs}`);
  console.error('This is a build artifact. Do not commit it: it carries vault paths.');
}

if (require.main === module) main();

module.exports = {
  SCHEMA_VERSION,
  PRIVACY_CLASS_BY_SCAN_CLASS,
  PRIVACY_CLASS_BY_EVIDENCE,
  PRIVACY_CLASS_UNASSESSED,
  RIGHTS_NOT_REVIEWED,
  ACTION_REVIEW,
  ACTION_EXCLUDE,
  ACTION_ICLOUD,
  ACTION_DUPLICATE,
  catalogueIdFor,
  privacyClassFor,
  redactPath,
  portalActionFor,
  buildPathIndex,
  translate,
  assertTranslatable,
  buildCatalogue,
};
