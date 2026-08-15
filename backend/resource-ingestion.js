'use strict';

/**
 * Pure decision logic for ingesting the `7 Resources` catalogue.
 *
 * Everything here is a pure function of catalogue metadata. Nothing in this
 * file opens, reads, hashes, copies or stats a source file — the catalogue was
 * produced by a separate audit and is the only input. That matters most for the
 * 94 private records: the safest way to guarantee a client file is never opened
 * is for the ingestion path to have no file-reading code in it at all.
 *
 * The database enforces the privacy rule too (see migration 030). This module
 * is the first of the two layers, not the only one.
 */

// ── Lifecycle vocabulary ────────────────────────────────────────────────────
// Mirrors valid_ingestion_treatment in migration 030.

const TREATMENTS = [
  'reconciled-existing',
  'live-official-link',
  'live-vendor-link',
  'controlled-register',
  'staff-only',
  'opal-original-draft',
  'rights-review',
  'privacy-excluded',
  'duplicate-archived',
  'unavailable-placeholder',
  'rejected-quality',
  'superseded',
];

/**
 * The catalogue's recommendation → this application's lifecycle value.
 *
 * Note that the two official-link groups converge. The catalogue distinguishes
 * confirmed government material from nonprofit material whose licence is still
 * unchecked, but both are delivered the same way — as an attributed link to the
 * publisher — and both must survive the same verification gate before going
 * live. The distinction is preserved in `source_class`, where it belongs.
 */
const TREATMENT_BY_PORTAL_ACTION = {
  'link-to-current-official-source-preferred': 'live-official-link',
  'official-link-preferred-pending-rights-check': 'live-official-link',
  'keep-reference-only-or-link-to-vendor': 'live-vendor-link',
  'controlled-register-or-official-link-only': 'controlled-register',
  'review-for-opal-internal-library': 'staff-only',
  'candidate-for-new-opal-original': 'opal-original-draft',
  'hold-for-rights-review': 'rights-review',
  'exclude-from-resource-hub': 'privacy-excluded',
  'archive-exact-duplicate': 'duplicate-archived',
  'download-from-icloud-before-review': 'unavailable-placeholder',
};

/**
 * Vault roots that are excluded no matter what the catalogue says about an
 * individual file.
 *
 * This is a belt-and-braces rule. The catalogue already marks this material
 * private, but a classifier that mislabelled one file would otherwise be enough
 * to pull a client record into the portal. A whole-subtree ban cannot be
 * defeated by one bad row, so the subtree wins over the per-record judgement.
 *
 * The catalogue rewrites the private roots to '[PRIVATE-REDACTED]', so that
 * marker is banned too. Note it redacts only the FIRST path segment — the
 * remaining subdirectories, `source_filename` and `display_title` still hold
 * real, frequently client-named values. Nothing downstream may assume the
 * catalogue arrived sanitised; `redactedIdentity` is what actually strips them.
 */
const FORBIDDEN_PATH_PREFIXES = [
  'CLIENTS/',
  'paediatrics resources/',
  '[PRIVATE-REDACTED]/',
];

/**
 * Privacy classifications that force exclusion regardless of portal_action.
 *
 * The first three are the external audit's vocabulary. The last two are the
 * content scanner's (setup/scan-resource-source.js privacyFromEvidence):
 * before 2026-08-15 a scanner-produced catalogue used values this list did not
 * contain, so a file the scanner flagged could sail through the decision
 * layer unexcluded. 'privacy-review' (weak evidence only) also excludes —
 * uncertain defaults to quarantine, and a human can re-treat the register row.
 */
const PRIVATE_PRIVACY_CLASSES = [
  'client-identifiable',
  'potentially-client-identifiable',
  'potentially-client-derived',
  'client-confidential',
  'privacy-review',
];

function underForbiddenRoot(relativePath) {
  if (!relativePath) return false;
  const p = String(relativePath);
  return FORBIDDEN_PATH_PREFIXES.some(
    (prefix) => p === prefix.slice(0, -1) || p.startsWith(prefix));
}

/**
 * Decide the treatment for one catalogue record.
 *
 * Exclusion is checked first and overrides everything. A record can be pulled
 * into exclusion by any of three independent signals — its vault location, its
 * privacy classification, or its recommended action — and it only takes one.
 */
function treatmentFor(record) {
  if (underForbiddenRoot(record.source_relative_path)) return 'privacy-excluded';
  if (PRIVATE_PRIVACY_CLASSES.includes(record.privacy_class)) return 'privacy-excluded';
  const mapped = TREATMENT_BY_PORTAL_ACTION[record.portal_action];
  if (!mapped) {
    throw new Error(
      `Unmapped portal_action "${record.portal_action}" on ${record.id}. `
      + 'Refusing to guess a treatment — add an explicit mapping.');
  }
  return mapped;
}

function isPrivate(record) {
  return treatmentFor(record) === 'privacy-excluded';
}

// ── Redaction ───────────────────────────────────────────────────────────────

/**
 * Reduce a vault-relative path to the directory that contained it.
 *
 * The filename is the identifying part — these files are frequently named after
 * the person they concern — so it is dropped even for non-private records,
 * where the folder alone is enough for a human to find the original. Private
 * records get nothing at all.
 */
function redactSourceReference(record) {
  if (isPrivate(record)) return null;
  const rel = String(record.source_relative_path || '');
  const cut = rel.lastIndexOf('/');
  if (cut === -1) return '(vault root)';
  const dir = rel.slice(0, cut);
  // Defensive: the CHECK constraint rejects all of these, so never emit one —
  // otherwise a single oddly-shaped path aborts the whole import transaction.
  // The drive-letter case is easy to forget because the vault is on macOS, but
  // catalogue paths are data and need not be well formed.
  if (!dir || dir.startsWith('/') || dir.startsWith('~')
      || dir.includes('..') || /^[A-Za-z]:/.test(dir)) {
    return '(vault root)';
  }
  return dir.slice(0, 300);
}

/**
 * Build the register row's identifying fields, with everything stripped for a
 * private record. Returning explicit nulls (rather than omitting keys) keeps
 * the upsert statement uniform and makes the redaction visible at the call site.
 */
function redactedIdentity(record) {
  if (isPrivate(record)) {
    return {
      source_reference: null,
      source_filename: null,
      proposed_title: null,
      checksum_sha256: null,
      extension: null,
      size_bytes: null,
      page_or_slide_count: null,
    };
  }
  return {
    source_reference: redactSourceReference(record),
    source_filename: record.source_filename || null,
    proposed_title: record.display_title || null,
    checksum_sha256: record.sha256 || null,
    extension: record.extension || null,
    size_bytes: record.size_bytes ?? null,
    page_or_slide_count: record.page_or_slide_count ?? null,
  };
}

// ── Normalisation for reconciliation ────────────────────────────────────────

/** Noise that varies between copies of the same document and means nothing. */
const TITLE_NOISE = /\b(?:v|ver|version|rev|draft|final|copy|updated?|new)\s*\d*(?:\.\d+)?\b/gi;

function normalizeTitle(value) {
  if (!value) return '';
  return String(value)
    .replace(/\.(pdf|docx?|pptx?|jpe?g|png|zip|icloud)$/i, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Punctuation is flattened BEFORE noise is stripped, so that separators the
    // vault actually uses — 'report_ver_1', 'report-v2' — expose the version
    // marker to the word-boundary match instead of hiding it inside a token.
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(TITLE_NOISE, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Organisation names collapse harder — punctuation and legal suffixes vary. */
function normalizeOrganisation(value) {
  if (!value) return '';
  const n = normalizeTitle(value)
    .replace(/\b(?:pty|ltd|limited|inc|incorporated|the|australia|australian)\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  // Values that assert nothing should never be treated as agreement.
  if (['not yet confirmed', 'unknown', 'unverified', 'n a', ''].includes(n)) return '';
  return n;
}

// ── Reconciliation ──────────────────────────────────────────────────────────

/**
 * Compare catalogue records against what the portal already holds.
 *
 * Only a checksum produces an automatic match. The brief is explicit that a
 * title match alone must not create — or collapse — a record, and the reason is
 * visible in this catalogue: it contains several distinct documents sharing a
 * title, and duplicate titles across different publishers. Title evidence
 * therefore routes to a human queue instead of deciding anything.
 *
 * @param {object[]} records   catalogue records
 * @param {object[]} existing  { id, title, source_publisher, checksums: string[], filenames: string[] }
 */
function reconcile(records, existing) {
  const byChecksum = new Map();
  const byTitle = new Map();

  for (const row of existing) {
    for (const sum of row.checksums || []) {
      if (sum) byChecksum.set(String(sum).toLowerCase(), row);
    }
    const t = normalizeTitle(row.title);
    if (t) {
      if (!byTitle.has(t)) byTitle.set(t, []);
      byTitle.get(t).push(row);
    }
  }

  const results = [];
  for (const record of records) {
    const treatment = treatmentFor(record);

    // A private record is never reconciled against portal content. Even a
    // checksum comparison is reported separately rather than creating a link,
    // because the correct outcome for a client file already sitting in the hub
    // is an alert, not a tidy cross-reference.
    if (treatment === 'privacy-excluded') {
      const leak = record.sha256
        ? byChecksum.get(String(record.sha256).toLowerCase())
        : undefined;
      results.push({
        record,
        treatment,
        match: null,
        matchMethod: 'none',
        matchConfidence: 'none',
        privateChecksumCollision: leak ? leak.id : null,
      });
      continue;
    }

    const sum = record.sha256 ? String(record.sha256).toLowerCase() : null;
    const exact = sum ? byChecksum.get(sum) : undefined;
    if (exact) {
      results.push({
        record,
        treatment: 'reconciled-existing',
        match: exact,
        matchMethod: 'sha256',
        matchConfidence: 'exact',
        privateChecksumCollision: null,
      });
      continue;
    }

    const titleKey = normalizeTitle(record.display_title);
    const candidates = titleKey ? (byTitle.get(titleKey) || []) : [];
    if (candidates.length) {
      const org = normalizeOrganisation(record.source_organisation);
      const sameOrg = org
        ? candidates.find((c) => normalizeOrganisation(c.source_publisher) === org)
        : null;
      results.push({
        record,
        treatment,                       // unchanged — a human decides, not this
        match: sameOrg || candidates[0],
        matchMethod: sameOrg ? 'title-and-organisation' : 'normalized-title',
        matchConfidence: sameOrg ? 'probable' : 'possible',
        privateChecksumCollision: null,
      });
      continue;
    }

    results.push({
      record,
      treatment,
      match: null,
      matchMethod: 'none',
      matchConfidence: 'none',
      privateChecksumCollision: null,
    });
  }

  return results;
}

// ── Derived workflow state ──────────────────────────────────────────────────

const INGESTION_STATUS_BY_TREATMENT = {
  'reconciled-existing': 'imported',
  'live-official-link': 'needs-link-verification',
  'live-vendor-link': 'needs-link-verification',
  'controlled-register': 'registered',
  'staff-only': 'needs-human-review',
  'opal-original-draft': 'registered',
  'rights-review': 'held',
  'privacy-excluded': 'excluded',
  'duplicate-archived': 'archived',
  'unavailable-placeholder': 'blocked',
  'rejected-quality': 'blocked',
  superseded: 'archived',
};

/**
 * Whether a file-quality assessment is even meaningful.
 *
 * 'not-applicable' is used where no file will ever be hosted — a link record, a
 * register entry, an archived duplicate — so that a quality dashboard shows
 * genuine gaps rather than hundreds of items that were never going to be
 * assessed. Private records are 'not-applicable' because assessing them would
 * require opening them.
 */
const QUALITY_STATUS_BY_TREATMENT = {
  'reconciled-existing': 'not-assessed',
  'live-official-link': 'not-assessed',
  'live-vendor-link': 'not-assessed',
  'controlled-register': 'not-applicable',
  'staff-only': 'pending-human',
  'opal-original-draft': 'pending-human',
  'rights-review': 'not-applicable',
  'privacy-excluded': 'not-applicable',
  'duplicate-archived': 'not-applicable',
  'unavailable-placeholder': 'not-applicable',
  'rejected-quality': 'failed',
  superseded: 'not-applicable',
};

const NEXT_ACTION_BY_TREATMENT = {
  'reconciled-existing': 'Already held by the portal. Confirm the existing record is current.',
  'live-official-link': 'Verify the current canonical publisher page, then approve for staff.',
  'live-vendor-link': 'Verify the vendor product page before any staff-facing link is shown.',
  'controlled-register': 'Confirm licence and permitted use on the instrument register entry.',
  'staff-only': 'Confirm Opal ownership and absence of client content before import.',
  'opal-original-draft': 'Clean-room authoring: design from first principles, then clinical review.',
  'rights-review': 'Human rights review required. Metadata only until authorship is evidenced.',
  'privacy-excluded': 'None. Permanently excluded from the Resource Hub.',
  'duplicate-archived': 'None. Redundant copy; the master record carries its own rights status.',
  'unavailable-placeholder': 'Download the real file from iCloud before any review is possible.',
  'rejected-quality': 'Failed a quality gate. Re-source or remediate before reconsidering.',
  superseded: 'Superseded by a newer record.',
};

function ingestionStatusFor(treatment) {
  return INGESTION_STATUS_BY_TREATMENT[treatment] || 'registered';
}
function qualityStatusFor(treatment) {
  return QUALITY_STATUS_BY_TREATMENT[treatment] || 'not-assessed';
}
function nextActionFor(treatment) {
  return NEXT_ACTION_BY_TREATMENT[treatment] || null;
}

/**
 * Whether this treatment permits a file to be copied into governed storage.
 *
 * Consulted before any write. Default deny: an unrecognised treatment hosts
 * nothing.
 */
function permitsFileHosting(treatment) {
  return treatment === 'staff-only' || treatment === 'opal-original-draft';
}

/** Whether the treatment is delivered as an outward link rather than a file. */
function isLinkTreatment(treatment) {
  return treatment === 'live-official-link' || treatment === 'live-vendor-link';
}

/** Tally treatments, for the reconciliation total that must equal the catalogue. */
function summarise(results) {
  const byTreatment = {};
  for (const t of TREATMENTS) byTreatment[t] = 0;
  let matched = 0;
  let possible = 0;
  const collisions = [];
  for (const r of results) {
    byTreatment[r.treatment] = (byTreatment[r.treatment] || 0) + 1;
    if (r.matchConfidence === 'exact') matched += 1;
    else if (r.matchConfidence !== 'none') possible += 1;
    if (r.privateChecksumCollision) collisions.push(r.record.id);
  }
  return {
    total: results.length,
    byTreatment,
    matchedExisting: matched,
    possibleMatches: possible,
    newRecords: results.length - matched,
    willReceiveFiles: results.filter((r) => permitsFileHosting(r.treatment)).length,
    willBecomeLinks: results.filter((r) => isLinkTreatment(r.treatment)).length,
    excludedPrivate: byTreatment['privacy-excluded'],
    duplicates: byTreatment['duplicate-archived'],
    privateChecksumCollisions: collisions,
  };
}

module.exports = {
  TREATMENTS,
  TREATMENT_BY_PORTAL_ACTION,
  FORBIDDEN_PATH_PREFIXES,
  PRIVATE_PRIVACY_CLASSES,
  underForbiddenRoot,
  treatmentFor,
  isPrivate,
  redactSourceReference,
  redactedIdentity,
  normalizeTitle,
  normalizeOrganisation,
  reconcile,
  ingestionStatusFor,
  qualityStatusFor,
  nextActionFor,
  permitsFileHosting,
  isLinkTreatment,
  summarise,
};
