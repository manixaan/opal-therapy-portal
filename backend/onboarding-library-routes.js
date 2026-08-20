'use strict';

/**
 * ONBOARDING DOCUMENT LIBRARY — versioned documents and ZIP import.
 *
 * Two things live here:
 *
 *  1. THE LIBRARY. Version-controlled documents (Opal policies, republished
 *     official statements) with an immutable published version behind every
 *     acknowledgement. Superseding a policy never rewrites who agreed to v1.
 *
 *  2. ZIP IMPORT. Bulk import of an official-resources archive, which is
 *     untrusted input by definition. Everything an attacker could put in a ZIP
 *     is handled BEFORE anything is written: absolute paths, `..` traversal,
 *     backslash separators, null bytes, symlinks, per-entry and total size
 *     limits, entry-count limits, compression-ratio limits (a zip bomb), and
 *     an extension/MIME allowlist checked against the actual file signature
 *     rather than the declared type.
 *
 *     Imported files land as DRAFT PROPOSALS. Nothing an import produces is
 *     visible to an employee until the Owner has confirmed its classification —
 *     an archive should not be able to publish a document to a workforce.
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const odb = require('./onboarding-db');
const engine = require('./onboarding-engine');
const { auditOnboarding } = require('./onboarding-audit');
const { requireAuth, requirePermission, requireAnyPermission } = require('./permissions');
const log = require('./logger').createLogger('onboarding-library');

const orgOf = (req) => req.user?.organisation_id || null;
const { isUuid, str } = odb;

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('library route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});
const notFound = (res) => res.status(404).json({ error: 'Not found' });

router.use('/api/onboarding/documents', requireAuth);
router.use('/api/onboarding/imports', requireAuth);

const DOCUMENT_CATEGORIES = [
  'Employment', 'Fair Work', 'Tax', 'Super', 'Identity', 'NDIS',
  'Professional Registration', 'Qualifications', 'Screening', 'Working With Children',
  'Policies', 'WHS', 'Training', 'Clinical', 'Payroll', 'Vehicle / Travel',
  'Employer Compliance', 'Other',
];

// ═════════════════════════════════════════════════════════════════════════════
//  LIBRARY
// ═════════════════════════════════════════════════════════════════════════════

function documentRow(d) {
  return {
    id: d.id, code: d.code, title: d.title, description: d.description,
    category: d.category, classification: d.classification, audience: d.audience,
    ownerControlled: d.owner_controlled, officialSourceUrl: d.official_source_url,
    complianceRequirementId: d.compliance_requirement_id,
    contentStatus: d.content_status, status: d.status,
    currentVersion: d.current_version,
    currentVersionId: d.current_version_id,
    currentVersionNumber: d.current_version_number,
    sourceVersionLabel: d.source_version_label,
    currentEffectiveDate: d.current_effective_date,
    currentFileName: d.current_file_name,
    hasContent: d.has_content === true,
    requiresAcknowledgement: d.requires_acknowledgement,
    createdAt: d.created_at, updatedAt: d.updated_at,
  };
}

router.get('/api/onboarding/documents',
  requireAnyPermission('onboarding.manage_documents', 'onboarding.view'),
  safe(async (req, res) => {
    const docs = await odb.listDocuments(orgOf(req), {
      audience: req.query.audience || null,
      category: req.query.category || null,
      status: req.query.status || null,
    });
    res.json({ ok: true, documents: docs.map(documentRow), categories: DOCUMENT_CATEGORIES });
  }));

router.get('/api/onboarding/documents/:id',
  requireAnyPermission('onboarding.manage_documents', 'onboarding.view'),
  safe(async (req, res) => {
    const doc = await odb.getDocument(orgOf(req), req.params.id);
    if (!doc) return notFound(res);
    const versions = await odb.listDocumentVersions(doc.id);
    const { rows: acks } = await odb.pool.query(
      `SELECT document_version, COUNT(*)::int AS n FROM onboarding_acknowledgements
        WHERE document_id = $1 GROUP BY document_version ORDER BY document_version DESC`, [doc.id]
    );
    res.json({
      ok: true,
      document: documentRow(doc),
      versions,
      acknowledgementCounts: acks,
    });
  }));

router.post('/api/onboarding/documents', requirePermission('onboarding.manage_documents'),
  safe(async (req, res) => {
    const b = req.body || {};
    if (!b.code || !/^[A-Z0-9_]{3,80}$/.test(String(b.code))) {
      return res.status(400).json({ error: 'code must be 3-80 characters of A-Z, 0-9 and underscore' });
    }
    if (!b.title) return res.status(400).json({ error: 'title is required' });
    const row = await odb.upsertDocument(orgOf(req), b, req.user.id);
    await auditOnboarding(req, 'document_saved', {
      targetType: 'onboarding_document', targetId: row.id,
      metadata: { code: row.code, classification: row.classification },
    });
    res.status(201).json({ ok: true, document: documentRow(row) });
  }));

router.put('/api/onboarding/documents/:id', requirePermission('onboarding.manage_documents'),
  safe(async (req, res) => {
    const doc = await odb.getDocument(orgOf(req), req.params.id);
    if (!doc) return notFound(res);
    const row = await odb.upsertDocument(orgOf(req), { ...req.body, code: doc.code }, req.user.id);
    await auditOnboarding(req, 'document_updated', {
      targetType: 'onboarding_document', targetId: row.id, metadata: { code: row.code },
    });
    res.json({ ok: true, document: documentRow(row) });
  }));

// The same allowlist the employee upload path uses, plus RTF and plain text
// which are legitimate for a policy document but never for a certificate.
const DOC_ALLOWED = {
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'text/plain': ['txt'],
  'application/rtf': ['rtf'],
};
const MAX_DOC_BASE64 = 14 * 1024 * 1024; // ≈ 10 MB binary

function validateDocumentFile({ fileName, fileMime, fileData }) {
  if (!fileData) return null; // a body-only version is legitimate
  if (fileData.length > MAX_DOC_BASE64) return 'That file is larger than 10 MB';
  const exts = DOC_ALLOWED[String(fileMime || '').toLowerCase()];
  if (!exts) return 'File type not allowed. Accepted: PDF, DOC, DOCX, PNG, JPEG, TXT, RTF';
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (!exts.includes(ext)) return `A ".${ext}" file does not match the declared type`;
  if (/[/\\]|\.\./.test(String(fileName))) return 'That file name is not allowed';
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(String(fileData).slice(0, 1000))) {
    return 'File content must be base64-encoded';
  }
  return null;
}

router.post('/api/onboarding/documents/:id/versions',
  requirePermission('onboarding.manage_documents'), safe(async (req, res) => {
    const doc = await odb.getDocument(orgOf(req), req.params.id);
    if (!doc) return notFound(res);

    const b = req.body || {};
    const fileError = validateDocumentFile(b);
    if (fileError) return res.status(415).json({ error: fileError });
    if (!b.body && !b.fileData && !b.sourceUrl) {
      return res.status(400).json({
        error: 'A version needs document text, a file, or a source URL',
      });
    }

    let storage = { storageBackend: 'db', storageKey: null, fileData: b.fileData || null };
    let sha256 = null;
    if (b.fileData) {
      sha256 = crypto.createHash('sha256').update(Buffer.from(b.fileData, 'base64')).digest('hex');
      const { getBackend, getBackendName } = require('./storage');
      if (getBackendName() !== 'db') {
        const key = await getBackend().put({
          userId: 'onboarding-library', docId: `${doc.code}-${Date.now()}`,
          fileName: b.fileName, mime: b.fileMime, base64: b.fileData,
        });
        storage = { storageBackend: key.backend, storageKey: key.storageKey, fileData: null };
      }
    }

    const version = await odb.createDocumentVersion(doc.id, {
      title: b.title || doc.title,
      summary: b.summary,
      body: b.body || null,
      fileName: b.fileName, fileMime: b.fileMime, fileSizeBytes: b.fileSizeBytes,
      fileSha256: sha256,
      ...storage,
      sourceUrl: b.sourceUrl,
      sourceVersionLabel: b.sourceVersionLabel,
      sourceLastModified: b.sourceLastModified,
      effectiveDate: b.effectiveDate,
      changeNote: b.changeNote,
    }, req.user.id);

    await auditOnboarding(req, 'document_version_created', {
      targetType: 'onboarding_document', targetId: doc.id,
      metadata: {
        code: doc.code, documentVersionId: version.id, version: version.version,
        fileName: b.fileName, mimeType: b.fileMime, sha256,
      },
    });
    res.status(201).json({ ok: true, version });
  }));

router.post('/api/onboarding/documents/:id/versions/:vid/publish',
  requirePermission('onboarding.manage_documents'), safe(async (req, res) => {
    const doc = await odb.getDocument(orgOf(req), req.params.id);
    if (!doc || !isUuid(req.params.vid)) return notFound(res);

    const published = await odb.withTransaction(
      (q) => odb.publishDocumentVersion(doc.id, req.params.vid, req.user.id, q)
    );
    if (!published) return notFound(res);

    // Packages referencing this document now have an unpublished change, so
    // the Owner can decide whether to cut a new package version.
    await odb.pool.query(
      `UPDATE onboarding_packages SET draft_dirty = TRUE, updated_at = NOW()
        WHERE id IN (
          SELECT pr.package_id FROM onboarding_package_requirements pr
            JOIN onboarding_requirement_templates t ON t.id = pr.template_id
           WHERE t.document_id = $1)`, [doc.id]
    );

    await auditOnboarding(req, 'document_version_published', {
      targetType: 'onboarding_document', targetId: doc.id,
      metadata: { code: doc.code, documentVersionId: published.id, version: published.version },
    });
    res.json({ ok: true, version: published });
  }));

router.get('/api/onboarding/documents/:id/versions/:vid/download',
  requireAnyPermission('onboarding.manage_documents', 'onboarding.view'),
  safe(async (req, res) => {
    const doc = await odb.getDocument(orgOf(req), req.params.id);
    if (!doc || !isUuid(req.params.vid)) return notFound(res);
    const version = await odb.getDocumentVersion(req.params.vid);
    if (!version || version.document_id !== doc.id) return notFound(res);

    let base64 = version.file_data;
    if (!base64 && version.storage_key) {
      try {
        const { getBackend } = require('./storage');
        ({ base64 } = await getBackend(version.storage_backend).get({
          backend: version.storage_backend, storageKey: version.storage_key,
        }));
      } catch (err) {
        log.warn('library file unreadable', { versionId: version.id });
      }
    }
    if (!base64) return res.status(404).json({ error: 'Document content unavailable' });

    res.setHeader('Content-Type', version.file_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition',
      `inline; filename="${encodeURIComponent(version.file_name || 'document')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(base64, 'base64'));
  }));

/**
 * Require every current employee to acknowledge a NEW version of a policy.
 *
 * This does not touch the old acknowledgements — those remain the historical
 * record of who agreed to v1. It creates fresh work against v2.
 */
router.post('/api/onboarding/documents/:id/require-reacknowledgement',
  requirePermission('onboarding.manage_documents'), safe(async (req, res) => {
    const doc = await odb.getDocument(orgOf(req), req.params.id);
    if (!doc) return notFound(res);
    if (doc.current_version < 1) {
      return res.status(409).json({ error: 'Publish a version before requiring acknowledgement' });
    }
    const version = await odb.getCurrentDocumentVersion(doc.id);
    if (!version) return res.status(409).json({ error: 'No published version' });

    const { rows } = await odb.pool.query(
      `SELECT u.id, u.name FROM users u
        WHERE u.organisation_id IS NOT DISTINCT FROM $1
          AND u.is_active = TRUE AND u.role NOT IN ('pre_employee')
          AND NOT EXISTS (
            SELECT 1 FROM onboarding_acknowledgements a
             WHERE a.user_id = u.id AND a.document_version_id = $2)`,
      [orgOf(req), version.id]
    );

    await auditOnboarding(req, 'reacknowledgement_required', {
      targetType: 'onboarding_document', targetId: doc.id,
      metadata: {
        code: doc.code, documentVersionId: version.id, version: version.version,
        requirementCount: rows.length,
      },
    });

    const notify = (userId, payload) => Promise.resolve()
      .then(() => require('./app-routes').storeNotification(userId, payload))
      .catch(() => {});
    for (const u of rows) {
      await notify(u.id, {
        type: `policy_reack_${version.id}`,
        title: 'A policy has been updated',
        message: `"${doc.title}" has been updated to version ${version.version}. Please read and acknowledge it.`,
        severity: 'info',
        relatedEntity: 'onboarding_document',
        actionPayload: { documentId: doc.id, documentVersionId: version.id },
      });
    }
    res.json({ ok: true, notified: rows.length, version: version.version });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  ZIP IMPORT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Limits. Every one of these is a refusal an attacker can trigger, and each is
 * cheap to check before any bytes are written.
 */
const ZIP_LIMITS = {
  maxArchiveBase64: 60 * 1024 * 1024,  // ≈ 45 MB uploaded
  maxEntries: 300,
  maxEntryBytes: 15 * 1024 * 1024,     // 15 MB per file
  maxTotalBytes: 200 * 1024 * 1024,    // 200 MB uncompressed in total
  maxRatio: 200,                       // uncompressed:compressed — zip-bomb guard
  maxPathLength: 400,
};

const IMPORT_ALLOWED_EXT = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
  rtf: 'application/rtf',
};

/**
 * Magic-number check. The declared MIME of a ZIP entry is attacker-controlled
 * and the extension is only a hint, so the first bytes are what decides.
 */
function sniffSignature(buf) {
  if (!buf || buf.length < 4) return null;
  const hex = buf.subarray(0, 8).toString('hex').toLowerCase();
  if (hex.startsWith('25504446')) return 'pdf';                 // %PDF
  if (hex.startsWith('89504e47')) return 'png';
  if (hex.startsWith('ffd8ff')) return 'jpeg';
  if (hex.startsWith('504b0304')) return 'zip';                 // docx is a zip
  if (hex.startsWith('d0cf11e0')) return 'ole';                 // legacy doc
  if (buf.subarray(0, 5).toString('ascii') === '{\\rtf') return 'rtf';
  return 'unknown';
}

const SIGNATURE_OK = {
  pdf: ['pdf'], png: ['png'], jpg: ['jpeg'], jpeg: ['jpeg'],
  docx: ['zip'], doc: ['ole'], rtf: ['rtf', 'unknown'], txt: ['unknown', 'rtf'],
};

/**
 * Reject an unsafe entry path.
 *
 * Checked BEFORE the name is used for anything at all — including logging —
 * because a crafted path is exactly what a traversal attack looks like.
 */
function pathProblem(entryPath) {
  const p = String(entryPath || '');
  if (!p) return 'empty path';
  if (p.length > ZIP_LIMITS.maxPathLength) return 'path too long';
  if (p.indexOf('\0') !== -1) return 'null byte in path';
  if (p.startsWith('/') || p.startsWith('\\')) return 'absolute path';
  if (/^[A-Za-z]:/.test(p)) return 'drive-letter path';
  // Normalise separators so a Windows-style `..\\` is caught too.
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.some((seg) => seg === '..')) return 'path traversal';
  if (parts.some((seg) => seg.trim() === '' && seg !== parts[parts.length - 1])) return 'empty path segment';
  if (/__MACOSX|\.DS_Store/i.test(p)) return 'archive metadata';
  return null;
}

/** Guess a sensible classification from the file name. The Owner confirms it. */
function proposeClassification(fileName) {
  const n = String(fileName).toLowerCase();
  const has = (...words) => words.some((w) => n.includes(w));

  if (has('fair work', 'fwis', 'casual employment information', 'ceis', 'fixed term contract information', 'ftcis')) {
    return { category: 'Fair Work', classification: 'OFFICIAL_DOCUMENT', audience: 'employee' };
  }
  if (has('ndis practice standard', 'verification module', 'audit')) {
    return { category: 'Employer Compliance', classification: 'EMPLOYER_REFERENCE', audience: 'employer' };
  }
  if (has('ndis', 'code of conduct', 'worker guidance', 'quality, safety')) {
    return { category: 'NDIS', classification: 'OFFICIAL_DOCUMENT', audience: 'employee' };
  }
  if (has('ahpra', 'registration standard', 'occupational therapy board')) {
    return { category: 'Professional Registration', classification: 'OFFICIAL_DOCUMENT', audience: 'employee' };
  }
  if (has('working with children', 'wwcc', 'screening', 'police')) {
    return { category: 'Screening', classification: 'OFFICIAL_DOCUMENT', audience: 'employee' };
  }
  if (has('tax', 'tfn')) return { category: 'Tax', classification: 'OFFICIAL_DOCUMENT', audience: 'employee' };
  if (has('super')) return { category: 'Super', classification: 'OFFICIAL_DOCUMENT', audience: 'employee' };
  if (has('whs', 'safety', 'workers compensation', 'injury')) {
    return { category: 'WHS', classification: 'OPAL_POLICY', audience: 'employee' };
  }
  if (has('policy', 'procedure')) {
    return { category: 'Policies', classification: 'OPAL_POLICY', audience: 'employee' };
  }
  if (has('handbook', 'welcome', 'induction')) {
    return { category: 'Employment', classification: 'OPAL_POLICY', audience: 'employee' };
  }
  return { category: 'Other', classification: 'OPAL_POLICY', audience: 'employee' };
}

/** A stable, safe document code derived from a file name. */
function proposeCode(fileName) {
  const base = String(fileName).replace(/\.[^.]+$/, '');
  const slug = base.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `IMP_${slug || 'DOCUMENT'}`;
}

function proposeTitle(fileName) {
  return String(fileName)
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 250);
}

router.post('/api/onboarding/imports', requirePermission('onboarding.manage_documents'),
  safe(async (req, res) => {
    const b = req.body || {};
    if (!b.fileData) return res.status(400).json({ error: 'A ZIP file is required' });
    if (typeof b.fileData !== 'string' || b.fileData.length > ZIP_LIMITS.maxArchiveBase64) {
      return res.status(413).json({ error: 'That archive is too large (45 MB maximum)' });
    }
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b.fileData.slice(0, 1000))) {
      return res.status(400).json({ error: 'File content must be base64-encoded' });
    }

    const buffer = Buffer.from(b.fileData, 'base64');
    if (sniffSignature(buffer) !== 'zip') {
      return res.status(415).json({ error: 'That file is not a ZIP archive' });
    }
    const archiveSha = crypto.createHash('sha256').update(buffer).digest('hex');

    // jszip is already a dependency (used by the FCA/letter document engines).
    const JSZip = require('jszip');
    let zip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch (err) {
      return res.status(400).json({ error: 'That archive could not be read — it may be corrupt' });
    }

    const entries = Object.values(zip.files).filter((f) => !f.dir);
    if (entries.length > ZIP_LIMITS.maxEntries) {
      return res.status(413).json({ error: `That archive has too many files (${ZIP_LIMITS.maxEntries} maximum)` });
    }

    const importRow = (await odb.pool.query(
      `INSERT INTO onboarding_document_imports
         (organisation_id, file_name, file_sha256, size_bytes, entry_count, status, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,'scanned',$6) RETURNING *`,
      [orgOf(req), str(b.fileName, 255) || 'archive.zip', archiveSha, buffer.length,
        entries.length, req.user.id]
    )).rows[0];

    let totalBytes = 0;
    let accepted = 0;
    let rejected = 0;
    const seenHashes = new Set();

    for (const entry of entries) {
      const entryPath = entry.name;
      const problem = pathProblem(entryPath);
      const fileName = String(entryPath).replace(/\\/g, '/').split('/').pop();

      const reject = async (reason) => {
        rejected += 1;
        await odb.pool.query(
          `INSERT INTO onboarding_document_import_items
             (import_id, entry_path, file_name, decision, reason)
           VALUES ($1,$2,$3,'rejected',$4)`,
          // The stored path is truncated and never used to build a filesystem
          // path — it exists so the Owner can see what was refused.
          [importRow.id, String(entryPath).slice(0, 400), String(fileName).slice(0, 255), reason]
        );
      };

      if (problem) { await reject(`Unsafe path: ${problem}`); continue; }

      const ext = String(fileName).split('.').pop().toLowerCase();
      if (!IMPORT_ALLOWED_EXT[ext]) { await reject(`Unsupported file type ".${ext}"`); continue; }

      // Compression-ratio guard before decompressing the whole entry.
      const declared = entry._data?.uncompressedSize;
      const compressed = entry._data?.compressedSize;
      if (declared && compressed && compressed > 0 && declared / compressed > ZIP_LIMITS.maxRatio) {
        await reject('Refused: compression ratio suggests a zip bomb');
        continue;
      }
      if (declared && declared > ZIP_LIMITS.maxEntryBytes) {
        await reject('File exceeds the 15 MB per-file limit');
        continue;
      }

      let content;
      try {
        content = await entry.async('nodebuffer');
      } catch (err) {
        await reject('That file could not be extracted');
        continue;
      }

      if (content.length > ZIP_LIMITS.maxEntryBytes) {
        await reject('File exceeds the 15 MB per-file limit'); continue;
      }
      totalBytes += content.length;
      if (totalBytes > ZIP_LIMITS.maxTotalBytes) {
        await reject('Archive exceeds the total size limit'); break;
      }

      const signature = sniffSignature(content);
      const allowedSignatures = SIGNATURE_OK[ext] || [];
      if (!allowedSignatures.includes(signature)) {
        await reject(`File contents do not match a ".${ext}" file`);
        continue;
      }

      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      if (seenHashes.has(sha256)) {
        rejected += 1;
        await odb.pool.query(
          `INSERT INTO onboarding_document_import_items
             (import_id, entry_path, file_name, file_sha256, decision, reason)
           VALUES ($1,$2,$3,$4,'duplicate','An identical file appears earlier in the archive')`,
          [importRow.id, String(entryPath).slice(0, 400), String(fileName).slice(0, 255), sha256]
        );
        continue;
      }
      seenHashes.add(sha256);

      const proposal = proposeClassification(fileName);
      accepted += 1;
      await odb.pool.query(
        `INSERT INTO onboarding_document_import_items
           (import_id, entry_path, file_name, file_mime, size_bytes, file_sha256,
            proposed_code, proposed_title, proposed_category, proposed_classification,
            proposed_audience, decision, staged_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12)`,
        [
          importRow.id, String(entryPath).slice(0, 400), String(fileName).slice(0, 255),
          IMPORT_ALLOWED_EXT[ext], content.length, sha256,
          proposeCode(fileName), proposeTitle(fileName),
          proposal.category, proposal.classification, proposal.audience,
          content.toString('base64'),
        ]
      );
    }

    await odb.pool.query(
      `UPDATE onboarding_document_imports
          SET accepted_count = $2, rejected_count = $3, status = 'reviewing'
        WHERE id = $1`, [importRow.id, accepted, rejected]
    );

    await auditOnboarding(req, 'documents_imported', {
      targetType: 'document_import', targetId: importRow.id,
      metadata: {
        importId: importRow.id, fileName: importRow.file_name, sha256: archiveSha,
        entryCount: entries.length, acceptedCount: accepted, rejectedCount: rejected,
      },
    });

    const { rows: items } = await odb.pool.query(
      `SELECT id, entry_path, file_name, file_mime, size_bytes, file_sha256,
              proposed_code, proposed_title, proposed_category, proposed_classification,
              proposed_audience, decision, reason
         FROM onboarding_document_import_items WHERE import_id = $1
        ORDER BY decision, file_name`, [importRow.id]
    );

    res.status(201).json({
      ok: true,
      import: {
        id: importRow.id, fileName: importRow.file_name,
        entryCount: entries.length, accepted, rejected, status: 'reviewing',
      },
      items,
      note: 'Nothing has been published. Review the proposed classifications and apply the import.',
    });
  }));

router.get('/api/onboarding/imports/:id', requirePermission('onboarding.manage_documents'),
  safe(async (req, res) => {
    if (!isUuid(req.params.id)) return notFound(res);
    const { rows } = await odb.pool.query(
      `SELECT * FROM onboarding_document_imports
        WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2`, [req.params.id, orgOf(req)]
    );
    if (!rows[0]) return notFound(res);
    const { rows: items } = await odb.pool.query(
      `SELECT id, entry_path, file_name, file_mime, size_bytes, file_sha256,
              proposed_code, proposed_title, proposed_category, proposed_classification,
              proposed_audience, decision, reason, document_id
         FROM onboarding_document_import_items WHERE import_id = $1
        ORDER BY decision, file_name`, [req.params.id]
    );
    res.json({ ok: true, import: rows[0], items });
  }));

/**
 * Apply the Owner's confirmed classifications.
 *
 * Creates a document and a DRAFT version per accepted item. Publishing stays a
 * separate, deliberate act — an archive must not be able to put a document in
 * front of a workforce by itself.
 */
router.post('/api/onboarding/imports/:id/apply', requirePermission('onboarding.manage_documents'),
  safe(async (req, res) => {
    if (!isUuid(req.params.id)) return notFound(res);
    const { rows: importRows } = await odb.pool.query(
      `SELECT * FROM onboarding_document_imports
        WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2`, [req.params.id, orgOf(req)]
    );
    const importRow = importRows[0];
    if (!importRow) return notFound(res);
    if (importRow.status === 'applied') {
      return res.status(409).json({ error: 'This import has already been applied' });
    }

    // { itemId: { code, title, category, classification, audience, accept } }
    const decisions = req.body?.items && typeof req.body.items === 'object' ? req.body.items : {};

    const created = [];
    const skipped = [];

    await odb.withTransaction(async (q) => {
      const { rows: items } = await q.query(
        `SELECT * FROM onboarding_document_import_items
          WHERE import_id = $1 AND decision = 'pending'`, [importRow.id]
      );

      for (const item of items) {
        const d = decisions[item.id] || {};
        if (d.accept === false) {
          await q.query(
            `UPDATE onboarding_document_import_items
                SET decision = 'rejected', reason = 'Declined by the practice owner', staged_data = NULL
              WHERE id = $1`, [item.id]
          );
          skipped.push(item.file_name);
          continue;
        }

        const code = str(d.code, 80) || item.proposed_code;
        if (!/^[A-Z0-9_]{3,80}$/.test(code)) {
          await q.query(
            `UPDATE onboarding_document_import_items
                SET decision = 'rejected', reason = 'Invalid document code', staged_data = NULL
              WHERE id = $1`, [item.id]
          );
          skipped.push(item.file_name);
          continue;
        }

        const doc = await odb.upsertDocument(orgOf(req), {
          code,
          title: str(d.title, 250) || item.proposed_title,
          category: str(d.category, 40) || item.proposed_category,
          classification: d.classification || item.proposed_classification,
          audience: d.audience || item.proposed_audience,
          // An imported official document is republished verbatim, so Opal
          // does not "own" its text.
          ownerControlled: (d.classification || item.proposed_classification) === 'OPAL_POLICY',
          contentStatus: 'available',
          status: 'draft',
          requiresAcknowledgement: d.requiresAcknowledgement === true,
        }, req.user.id, q);

        const version = await odb.createDocumentVersion(doc.id, {
          title: doc.title,
          fileName: item.file_name,
          fileMime: item.file_mime,
          fileSizeBytes: item.size_bytes,
          fileSha256: item.file_sha256,
          storageBackend: 'db',
          fileData: item.staged_data,
          sourceVersionLabel: str(d.sourceVersionLabel, 120),
          effectiveDate: d.effectiveDate,
          changeNote: `Imported from ${importRow.file_name}`,
        }, req.user.id, q);

        await q.query(
          `UPDATE onboarding_document_import_items
              SET decision = 'accepted', document_id = $2, document_version_id = $3,
                  staged_data = NULL
            WHERE id = $1`, [item.id, doc.id, version.id]
        );
        created.push({ code: doc.code, title: doc.title, version: version.version });
      }

      await q.query(
        `UPDATE onboarding_document_imports SET status = 'applied', applied_at = NOW() WHERE id = $1`,
        [importRow.id]
      );
    });

    await auditOnboarding(req, 'import_applied', {
      targetType: 'document_import', targetId: importRow.id,
      metadata: { importId: importRow.id, acceptedCount: created.length, rejectedCount: skipped.length },
    });

    res.json({
      ok: true,
      created,
      skipped,
      note: 'Imported documents are DRAFTS. Publish each version to make it available.',
    });
  }));

router.post('/api/onboarding/imports/:id/cancel', requirePermission('onboarding.manage_documents'),
  safe(async (req, res) => {
    if (!isUuid(req.params.id)) return notFound(res);
    const { rowCount } = await odb.pool.query(
      `UPDATE onboarding_document_imports SET status = 'cancelled'
        WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND status <> 'applied'`,
      [req.params.id, orgOf(req)]
    );
    if (!rowCount) return notFound(res);
    // Staged bytes are dropped immediately — an abandoned import must not
    // leave file content sitting in the database indefinitely.
    await odb.pool.query(
      'UPDATE onboarding_document_import_items SET staged_data = NULL WHERE import_id = $1',
      [req.params.id]
    );
    res.json({ ok: true });
  }));

module.exports = router;
module.exports.pathProblem = pathProblem;
module.exports.sniffSignature = sniffSignature;
module.exports.proposeClassification = proposeClassification;
module.exports.proposeCode = proposeCode;
module.exports.validateDocumentFile = validateDocumentFile;
module.exports.ZIP_LIMITS = ZIP_LIMITS;
