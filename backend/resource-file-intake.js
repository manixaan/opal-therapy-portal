'use strict';

/**
 * TAKING A FILE IN — one gate, two doors.
 *
 * A document can arrive two ways now: attached to a resource record somebody
 * is editing in Admin, or dropped straight onto a folder in the Library. Those
 * are different journeys for a person and they must not be different journeys
 * for the bytes.
 *
 * So the checking, storing and recording all live here, and both routes call
 * it. The alternative — the second door reimplementing the first door's checks
 * — is how a privacy scan ends up applying to one upload path and not the
 * other, which is exactly the kind of gap nobody notices until it matters.
 *
 * ── WHAT IS CHECKED, AND WHAT IS NOT ──────────────────────────────────────
 * PDF and Word are read: structure, encryption, corruption, and a scan of the
 * TEXT for a person's completed details. A file that looks like somebody's
 * filled-in form is refused outright and never stored.
 *
 * Excel, PowerPoint and images get a magic-byte check only — the bytes must be
 * what the extension claims. There is no text extraction for them and
 * therefore no privacy scan, which is a real limitation rather than an
 * oversight: it is recorded on the result as `privacyScanned: false` so a
 * caller can say so honestly rather than implying a check that did not happen.
 */

const { pool } = require('./database');
const fileStorage = require('./resource-file-storage');
const qualityGate = require('./resource-file-quality');
const previewService = require('./resource-preview-service');
const { buildChecklist } = require('./resource-privacy-reasons');
const log = require('./logger').createLogger('resource-file-intake');

const MAX_BYTES = 25 * 1024 * 1024;

/** What may be uploaded at all. Extension, declared format and bytes must agree. */
const FORMATS = Object.freeze(['pdf', 'docx', 'pptx', 'xlsx', 'png', 'jpg']);

/** Formats whose text we can actually read, and therefore actually scan. */
const READABLE = Object.freeze(['pdf', 'docx']);

/** Extension → declared format, including the aliases people really type. */
const FORMAT_BY_EXT = Object.freeze({
  pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx',
  png: 'png', jpg: 'jpg', jpeg: 'jpg',
});

/** The magic each non-readable format must show. */
const EXPECTED_MAGIC = Object.freeze({ pptx: 'zip', xlsx: 'zip', png: 'png', jpg: 'jpeg' });

const fail = (status, error, code) => ({ ok: false, status, error, code });

/**
 * THE OVERRIDE — "it's not confidential, upload it anyway".
 *
 * The identifier check refuses ANY email address, dd/mm/yyyy date or phone
 * number, labelled or not, so a de-identified example report is refused for
 * the practice's own email or a session date. A person may confirm those
 * away — but only those:
 *
 *   - every item on the checklist must be a 'pattern' item. One client
 *     identifier (an NDIS or Medicare number, a filled-in name, date of
 *     birth, address, guardian or labelled phone) and nothing is overridable;
 *   - an empty checklist is not overridable either — a refusal nobody can
 *     explain is not one anybody can confirm away;
 *   - the person must acknowledge every item by id. The file is re-scanned
 *     on the upload that carries the acknowledgement, so a confirmation given
 *     for one file cannot carry a different file through.
 *
 * Only callers that pass ctx.privacyAcknowledged offer it (the Library's
 * owner/admin doors); everything else stays strict.
 */
function canOverride(reasons) {
  return reasons.length > 0 && reasons.every((r) => r.type === 'pattern');
}

function acknowledgesAll(reasons, acknowledged) {
  if (!Array.isArray(acknowledged) || !acknowledged.length) return false;
  const ack = new Set(acknowledged.slice(0, 50).map((a) => String(a)));
  return reasons.every((r) => ack.has(r.id));
}

/**
 * Check and store one uploaded file against an existing resource.
 *
 * Never throws for a bad file — a rejection is a result, not an exception, so
 * the caller can report it to a person. Genuine faults (storage down, database
 * unreachable) still throw.
 *
 * @param {object} resource   the resources row the file attaches to
 * @param {object} upload     { fileName, format, fileData (base64), isPrimary }
 * @param {object} ctx        { userId, onAudit, privacyAcknowledged }
 * @returns {Promise<{ok:true, file, warnings, privacyScanned}|{ok:false, status, error, code}>}
 */
async function storeFile(resource, upload, ctx = {}) {
  const fileName = String(upload.fileName || '').trim().slice(0, 300);
  const format = String(upload.format || '').toLowerCase();
  const fileData = upload.fileData;

  if (!fileName || !fileData || typeof fileData !== 'string') {
    return fail(400, 'fileName and base64 fileData are required.', 'missing_file');
  }
  if (!FORMATS.includes(format)) {
    return fail(415, 'That file type is not supported. Use PDF, Word, Excel, PowerPoint or an image.', 'unsupported_format');
  }
  // Size guard BEFORE decoding: base64 is 4/3 of binary, so the string length
  // bounds the payload without materialising it.
  if (fileData.length > (MAX_BYTES / 3) * 4 + 4) {
    return fail(413, 'File exceeds the 25 MB upload limit.', 'too_large');
  }

  let buffer;
  try {
    buffer = Buffer.from(fileData, 'base64');
  } catch (_) {
    return fail(400, 'fileData must be base64.', 'bad_encoding');
  }
  if (!buffer.length) return fail(400, 'That file is empty.', 'empty');
  if (buffer.length > MAX_BYTES) return fail(413, 'File exceeds the 25 MB upload limit.', 'too_large');

  // ── the gate ────────────────────────────────────────────────────────────
  let assessment = null;
  let privacyOverride = null;
  const privacyScanned = READABLE.includes(format);

  if (privacyScanned) {
    assessment = await qualityGate.assessFile(buffer, { declaredFormat: format, declaredName: fileName });

    const privacyBlocked = assessment.report.privacy
      && assessment.report.privacy.verdict !== 'no-obvious-pii';
    if (privacyBlocked || (assessment.report.identifierFindings || []).length) {
      // What to change, and on which pages — kinds, counts and page numbers
      // only, safe to hand back to the person uploading.
      const reasons = buildChecklist(assessment.report);
      const overridable = canOverride(reasons);
      if (overridable && acknowledgesAll(reasons, ctx.privacyAcknowledged)) {
        // Every finding is a bare pattern and the person confirmed, item by
        // item, that none of them is a client's. The caller audits this.
        privacyOverride = reasons;
      } else {
        return {
          ok: false, status: 422, code: 'privacy_rejected',
          error: 'This file appears to contain a person\'s completed details and was not stored. '
            + 'Remove client information and try again, or contact an administrator.',
          // Counts and kinds only — never content. The caller audits this.
          privacy: assessment.report.privacy,
          identifiers: assessment.report.identifierFindings,
          reasons,
          overridable,
        };
      }
    }
    // An image-only PDF is allowed through as a warning: plenty of legitimate
    // published worksheets are scans, and the privacy scan has nothing to read
    // either way. An overridden privacy finding is not a quality failure.
    const blocking = assessment.failures.filter((f) => !/text layer/i.test(f)
      && !(privacyOverride && /^Possible client identifiers detected/.test(f)));
    if (blocking.length) return fail(422, blocking.join(' '), 'quality_rejected');
  } else {
    const magic = qualityGate.sniffMagic(buffer);
    const expect = EXPECTED_MAGIC[format];
    if (expect && magic !== expect && !(expect === 'zip' && magic === 'ole')) {
      return fail(422,
        `The file's contents do not match the declared ${format.toUpperCase()} format.`,
        'quality_rejected');
    }
  }

  // ── store ───────────────────────────────────────────────────────────────
  const checksum = fileStorage.sha256(buffer);
  const storageKey = `resources/${checksum.slice(0, 2)}/${checksum}.${format}`;

  // Content-addressed dedupe: an identical blob is stored once, ever.
  const { rows: existingBlob } = await pool.query(
    'SELECT 1 FROM resource_files WHERE storage_key = $1 LIMIT 1', [storageKey]);
  if (!existingBlob.length || !(await fileStorage.existsBlob(storageKey))) {
    await fileStorage.putBuffer(storageKey, buffer);
  }

  /**
   * A new PRIMARY file is a new version of the document (migration 078).
   *
   * It goes live at once; the file it replaces is marked superseded — kept,
   * downloadable through the version history, but no longer listed as one of
   * the resource's files. Every primary upload records a version row, whichever
   * door it came through, so the history cannot have gaps. Attachments
   * (isPrimary false) are not versions and record nothing.
   */
  const wantPrimary = upload.isPrimary !== false;
  const client = await pool.connect();
  let fileRow;
  let versionNo = null;
  try {
    await client.query('BEGIN');
    if (wantPrimary) {
      // Serialise two replacements of the same document, so they cannot both
      // claim the same version number.
      await client.query('SELECT id FROM resources WHERE id = $1 FOR UPDATE', [resource.id]);
      await client.query(
        `UPDATE resource_files SET is_primary = FALSE, superseded_at = NOW()
          WHERE resource_id = $1 AND is_primary`,
        [resource.id]);
    }
    const { rows: created } = await client.query(
      `INSERT INTO resource_files
         (resource_id, file_name, file_mime, file_size_bytes, storage_backend,
          storage_key, checksum_sha256, is_primary, format, uploaded_by)
       VALUES ($1,$2,$3,$4,'rhub',$5,$6,$7,$8,$9)
       ON CONFLICT (resource_id, storage_key) WHERE storage_key IS NOT NULL DO UPDATE
         SET file_name = EXCLUDED.file_name, is_primary = EXCLUDED.is_primary,
             superseded_at = CASE WHEN EXCLUDED.is_primary THEN NULL
                                  ELSE resource_files.superseded_at END
       RETURNING id, file_name, format, file_size_bytes, checksum_sha256, is_primary, uploaded_at`,
      [resource.id, fileName, fileStorage.mimeForFormat(format), buffer.length,
        storageKey, checksum, wantPrimary, format, ctx.userId || null]);
    fileRow = created[0];
    if (wantPrimary) {
      const { rows: v } = await client.query(
        `INSERT INTO resource_file_versions
           (resource_id, organisation_id, version_no, file_id, file_name, format,
            file_size_bytes, checksum_sha256, action, created_by)
         SELECT $1, $2, COALESCE(MAX(version_no), 0) + 1, $3, $4, $5, $6, $7,
                CASE WHEN COUNT(*) = 0 THEN 'upload' ELSE 'replace' END, $8
           FROM resource_file_versions WHERE resource_id = $1
         RETURNING version_no`,
        [resource.id, resource.organisation_id || null, fileRow.id, fileName, format,
          buffer.length, checksum, ctx.userId || null]);
      versionNo = v[0].version_no;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  /**
   * Derivatives are best-effort: a missing renderer must never fail an upload.
   *
   * `deferDerivatives` also stops it BLOCKING one. Thumbnailing an Office file
   * shells out to an external renderer, and a person dropping twenty files
   * would otherwise wait for twenty of them in series. The cards lazy-load
   * thumbnails and fall back to a file-type glyph, so a thumbnail that arrives
   * a second later costs nothing.
   */
  const derive = () => previewService.ensureDerivatives(pool, {
    id: fileRow.id, storage_key: storageKey, format, checksum_sha256: checksum,
    access_tier: null, publication_state: resource.publication_state,
    archived_at: resource.archived_at,
  });

  let previews = null;
  if (ctx.deferDerivatives) {
    Promise.resolve().then(derive).catch((err) => {
      log.warn('deferred preview generation failed', { fileId: fileRow.id, reason: err && err.message });
    });
  } else {
    try {
      previews = await derive();
    } catch (err) {
      log.warn('preview generation failed after upload', { fileId: fileRow.id, reason: err.message });
    }
  }

  return {
    ok: true,
    checksum,
    storageKey,
    versionNo,
    sizeBytes: buffer.length,
    privacyScanned,
    privacyOverride,
    warnings: assessment ? assessment.warnings : [],
    previews: previews ? previews.results : null,
    file: {
      id: fileRow.id,
      fileName: fileRow.file_name,
      format: fileRow.format,
      sizeBytes: Number(fileRow.file_size_bytes),
      checksumSha256: fileRow.checksum_sha256,
      isPrimary: fileRow.is_primary,
      uploadedAt: fileRow.uploaded_at,
      downloadUrl: `/api/rh2/files/${fileRow.id}`,
    },
  };
}

/** The declared format for a filename, or null when we do not accept it. */
function formatForName(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return FORMAT_BY_EXT[ext] || null;
}

module.exports = {
  MAX_BYTES, FORMATS, READABLE, FORMAT_BY_EXT, EXPECTED_MAGIC,
  storeFile, formatForName,
};
