'use strict';

/**
 * PACKAGE DOCUMENTS — what the Owner actually manages.
 *
 * A package's requirement list is the machinery; its DOCUMENT list is the
 * thing an Owner opens a package to see. "What will Jane receive?" should be
 * answerable by clicking the package, not by reading a requirement builder and
 * mentally resolving which templates happen to reference a file.
 *
 * ── ADD / REPLACE / RENAME / REMOVE, HONESTLY ──────────────────────────────
 * Each of the four does something specific, and the differences are the point:
 *
 *   ADD      attaches an existing library document to this package's pack.
 *   REPLACE  publishes a NEW VERSION of the document itself, in the library.
 *            "Fair Work Information Statement 2026.pdf" is not a new document;
 *            it is the 2026 edition of one Opal has issued for years. Keeping
 *            it as a version is what lets a record from 2025 still say exactly
 *            which edition that employee received.
 *   RENAME   changes the DISPLAY TITLE for this package only. The library
 *            title, which every historical record and every other package
 *            sees, is untouched — so a rename can never rewrite the past.
 *   REMOVE   takes the document out of FUTURE packs. Nothing is deleted:
 *            previous versions keep it, previous starter packs keep their
 *            manifests, and the row that records the exclusion stays.
 *
 * None of these is destructive, which is the requirement an employment record
 * actually has. The one thing an Owner cannot do here is make evidence
 * disappear.
 *
 * ── DRAFT VERSUS PUBLISHED ─────────────────────────────────────────────────
 * Every change here edits the DRAFT. Onboardings already running keep the
 * version they were issued until the Owner publishes and deliberately moves
 * them. `draft_dirty` is what the UI reads to say "unpublished changes".
 */

const express = require('express');
const router = express.Router();

const odb = require('./onboarding-db');
const starterPack = require('./onboarding-starter-pack');
const { auditOnboarding } = require('./onboarding-audit');
const { requireAuth, requirePermission, requireAnyPermission } = require('./permissions');
const log = require('./logger').createLogger('onboarding-package-docs');

const { isUuid, str } = odb;
const orgOf = (req) => req.user?.organisation_id || null;

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('package docs route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});
const notFound = (res) => res.status(404).json({ error: 'Not found' });

router.use('/api/onboarding/packages', requireAuth);

async function loadPackage(req) {
  if (!isUuid(req.params.id)) return null;
  return odb.getPackage(orgOf(req), req.params.id);
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE STARTER PACK LIST
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/onboarding/packages/:id/documents',
  requireAnyPermission('onboarding.manage_packages', 'onboarding.manage_documents', 'onboarding.view'),
  safe(async (req, res) => {
    const pkg = await loadPackage(req);
    if (!pkg) return notFound(res);

    const entries = await starterPack.resolveDraft(orgOf(req), pkg, odb.pool);

    res.json({
      ok: true,
      package: {
        id: pkg.id,
        title: pkg.title,
        status: pkg.status,
        // The code is returned but never rendered as a subtitle: it is a stable
        // identifier for API callers and imports, not something an Owner needs
        // to read under a package's own name.
        code: pkg.code,
        hasUnpublishedChanges: pkg.draft_dirty === true && Number(pkg.current_version) > 0,
        isPublished: pkg.status === 'published' && Number(pkg.current_version) > 0,
      },
      documents: entries.map((e, i) => ({
        position: i + 1,
        documentId: e.documentId,
        title: e.title,
        libraryTitle: e.libraryTitle,
        renamed: !!e.displayTitle,
        category: e.category,
        classification: e.classification,
        // "Required" / "Provided for reference", never `blocking` — the raw
        // flag is a workflow mechanism and means nothing to an Owner.
        requirement: e.requirementCodes.length ? 'Must be completed or acknowledged' : 'Provided for reference',
        fromRequirement: e.source === 'requirement',
        inheritedFrom: e.inheritedFrom || null,
        excluded: e.excluded,
        sortOrder: e.sortOrder,
        version: e.documentVersion,
        publisherEdition: e.sourceVersionLabel || null,
        fileName: e.fileName,
        fileMime: e.fileMime,
        sizeBytes: e.fileSizeBytes,
        available: !e.unavailableReason,
        unavailableReason: e.unavailableReason,
        // Server-supplied so no client ever builds a document path itself.
        previewKind: e.fileMime === 'application/pdf' ? 'pdf'
          : String(e.fileMime || '').includes('wordprocessingml') ? 'docx' : null,
        previewUrl: e.documentVersionId
          ? `/api/onboarding/documents/${e.documentId}/versions/${e.documentVersionId}/download`
          : null,
        officialSourceUrl: e.officialSourceUrl || null,
      })),
      // Library documents not yet in this pack, so "Add document" is a choice
      // rather than a search.
      available: await availableDocuments(orgOf(req), entries.map((e) => e.documentId)),
    });
  }));

async function availableDocuments(orgId, excludeIds) {
  const { rows } = await odb.pool.query(
    `SELECT d.id, d.code, d.title, d.category, d.classification, d.content_status,
            d.status, d.current_version, v.file_mime, v.file_size_bytes,
            v.source_version_label
       FROM onboarding_documents d
       LEFT JOIN onboarding_document_versions v
              ON v.document_id = d.id AND v.version = d.current_version
      WHERE d.organisation_id IS NOT DISTINCT FROM $1
        AND d.status <> 'archived'
        AND NOT (d.id = ANY($2::uuid[]))
      ORDER BY d.category, d.title`,
    [orgId, excludeIds.length ? excludeIds : ['00000000-0000-0000-0000-000000000000']]
  );
  return rows.map((d) => ({
    documentId: d.id,
    title: d.title,
    category: d.category,
    classification: d.classification,
    version: d.current_version,
    publisherEdition: d.source_version_label || null,
    ready: d.content_status === 'available' && Number(d.current_version) > 0,
    readyReason: d.content_status === 'link_only' ? 'Published as an official link, not a file'
      : Number(d.current_version) > 0 ? null : 'No version published yet',
  }));
}

// ═════════════════════════════════════════════════════════════════════════════
//  ADD
// ═════════════════════════════════════════════════════════════════════════════

router.post('/api/onboarding/packages/:id/documents',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await loadPackage(req);
    if (!pkg) return notFound(res);
    if (pkg.status === 'archived') {
      return res.status(409).json({ error: 'This package is archived and cannot be edited.' });
    }

    const documentId = req.body?.documentId;
    if (!isUuid(documentId)) return res.status(400).json({ error: 'documentId is required' });

    const doc = await odb.getDocument(orgOf(req), documentId);
    if (!doc) return res.status(400).json({ error: 'Unknown document' });

    const { rows: existing } = await odb.pool.query(
      `SELECT sort_order FROM onboarding_package_documents
        WHERE package_id = $1 ORDER BY sort_order DESC LIMIT 1`, [pkg.id]
    );
    const nextOrder = Number(existing[0]?.sort_order || 0) + 10;

    const { rows } = await odb.pool.query(
      `INSERT INTO onboarding_package_documents
         (package_id, document_id, sort_order, display_title, excluded, note, added_by)
       VALUES ($1,$2,$3,$4,FALSE,$5,$6)
       ON CONFLICT (package_id, document_id) DO UPDATE SET
         excluded = FALSE, note = EXCLUDED.note, updated_at = NOW()
       RETURNING *`,
      [
        pkg.id, documentId, nextOrder, str(req.body?.displayTitle, 250),
        str(req.body?.note, 1000), req.user.id,
      ]
    );

    await odb.markPackageDirty(pkg.id);
    await auditOnboarding(req, 'package_document_added', {
      targetType: 'onboarding_package', targetId: pkg.id,
      metadata: {
        packageId: pkg.id, code: pkg.code, documentId,
        documentCode: doc.code, sortOrder: nextOrder,
      },
    });

    res.status(201).json({ ok: true, entry: rows[0], hasUnpublishedChanges: true });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  RENAME (this package only)
// ═════════════════════════════════════════════════════════════════════════════

router.patch('/api/onboarding/packages/:id/documents/:documentId',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await loadPackage(req);
    if (!pkg) return notFound(res);
    if (!isUuid(req.params.documentId)) return notFound(res);

    const doc = await odb.getDocument(orgOf(req), req.params.documentId);
    if (!doc) return notFound(res);

    // An empty string clears the override and restores the library title,
    // which is the only sensible meaning of "undo this rename".
    const raw = req.body?.displayTitle;
    const displayTitle = raw === null || raw === '' ? null : str(raw, 250);

    await odb.pool.query(
      `INSERT INTO onboarding_package_documents
         (package_id, document_id, sort_order, display_title, added_by)
       VALUES ($1,$2,COALESCE((SELECT MAX(sort_order) + 10 FROM onboarding_package_documents
                                WHERE package_id = $1), 10),$3,$4)
       ON CONFLICT (package_id, document_id) DO UPDATE SET
         display_title = $3, updated_at = NOW()`,
      [pkg.id, req.params.documentId, displayTitle, req.user.id]
    );

    await odb.markPackageDirty(pkg.id);
    await auditOnboarding(req, 'package_document_renamed', {
      targetType: 'onboarding_package', targetId: pkg.id,
      metadata: {
        packageId: pkg.id, documentId: req.params.documentId, documentCode: doc.code,
        // The titles themselves are Owner-authored labels, not employee data,
        // so recording that a rename happened is enough.
        displayTitleChanged: true,
      },
    });

    res.json({
      ok: true,
      displayTitle,
      libraryTitle: doc.title,
      hasUnpublishedChanges: true,
      message: displayTitle
        ? 'Renamed for this package. The document keeps its own title everywhere else.'
        : 'Restored the document\'s own title.',
    });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  REMOVE (from future packs)
// ═════════════════════════════════════════════════════════════════════════════

router.delete('/api/onboarding/packages/:id/documents/:documentId',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await loadPackage(req);
    if (!pkg) return notFound(res);
    if (!isUuid(req.params.documentId)) return notFound(res);

    const doc = await odb.getDocument(orgOf(req), req.params.documentId);
    if (!doc) return notFound(res);

    // A document a REQUIREMENT contributes is excluded from the emailed pack
    // rather than removed: the requirement still stands, and the employee still
    // reads and acknowledges the document in the portal. Deleting the
    // composition row instead would quietly drop a compliance obligation.
    await odb.pool.query(
      `INSERT INTO onboarding_package_documents
         (package_id, document_id, sort_order, excluded, note, added_by)
       VALUES ($1,$2,COALESCE((SELECT MAX(sort_order) + 10 FROM onboarding_package_documents
                                WHERE package_id = $1), 10),TRUE,$3,$4)
       ON CONFLICT (package_id, document_id) DO UPDATE SET
         excluded = TRUE, note = EXCLUDED.note, updated_at = NOW()`,
      [pkg.id, req.params.documentId, str(req.body?.reason, 1000), req.user.id]
    );

    await odb.markPackageDirty(pkg.id);
    await auditOnboarding(req, 'package_document_removed', {
      targetType: 'onboarding_package', targetId: pkg.id,
      metadata: {
        packageId: pkg.id, documentId: req.params.documentId,
        documentCode: doc.code, excluded: true, reason: str(req.body?.reason, 200),
      },
    });

    res.json({
      ok: true,
      hasUnpublishedChanges: true,
      message: 'Removed from future starter packs. '
        + 'Everyone already onboarding keeps the pack they were sent.',
    });
  }));

/** Undo a removal. */
router.post('/api/onboarding/packages/:id/documents/:documentId/restore',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await loadPackage(req);
    if (!pkg) return notFound(res);
    if (!isUuid(req.params.documentId)) return notFound(res);

    const { rowCount } = await odb.pool.query(
      `UPDATE onboarding_package_documents SET excluded = FALSE, updated_at = NOW()
        WHERE package_id = $1 AND document_id = $2`,
      [pkg.id, req.params.documentId]
    );
    if (!rowCount) return notFound(res);

    await odb.markPackageDirty(pkg.id);
    await auditOnboarding(req, 'package_document_restored', {
      targetType: 'onboarding_package', targetId: pkg.id,
      metadata: { packageId: pkg.id, documentId: req.params.documentId, excluded: false },
    });
    res.json({ ok: true, hasUnpublishedChanges: true });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  REORDER
// ═════════════════════════════════════════════════════════════════════════════

router.post('/api/onboarding/packages/:id/documents/reorder',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await loadPackage(req);
    if (!pkg) return notFound(res);

    const order = Array.isArray(req.body?.documentIds) ? req.body.documentIds : null;
    if (!order || !order.length) {
      return res.status(400).json({ error: 'documentIds must be a non-empty array' });
    }
    if (order.length > 200) return res.status(400).json({ error: 'Too many documents' });
    if (!order.every(isUuid)) return res.status(400).json({ error: 'documentIds must all be ids' });

    await odb.withTransaction(async (q) => {
      for (let i = 0; i < order.length; i += 1) {
        // Reordering a requirement-derived entry needs a row to hold the new
        // position, so an override is created for it. It carries no other
        // change: display_title and excluded keep whatever they had.
        await q.query(
          `INSERT INTO onboarding_package_documents
             (package_id, document_id, sort_order, added_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (package_id, document_id) DO UPDATE SET
             sort_order = EXCLUDED.sort_order, updated_at = NOW()`,
          [pkg.id, order[i], (i + 1) * 10, req.user.id]
        );
      }
    });

    await odb.markPackageDirty(pkg.id);
    await auditOnboarding(req, 'package_documents_reordered', {
      targetType: 'onboarding_package', targetId: pkg.id,
      metadata: { packageId: pkg.id, code: pkg.code, entryCount: order.length },
    });
    res.json({ ok: true, hasUnpublishedChanges: true });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  HISTORY
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Everything that has happened to one document in this package.
 *
 * The answer to "which edition did we send in March?" — every version of the
 * document, when it was published, and which package versions carried it.
 */
router.get('/api/onboarding/packages/:id/documents/:documentId/history',
  requireAnyPermission('onboarding.manage_packages', 'onboarding.view'),
  safe(async (req, res) => {
    const pkg = await loadPackage(req);
    if (!pkg) return notFound(res);
    if (!isUuid(req.params.documentId)) return notFound(res);

    const doc = await odb.getDocument(orgOf(req), req.params.documentId);
    if (!doc) return notFound(res);
    const versions = await odb.listDocumentVersions(doc.id);

    // Which starter packs actually shipped each version. This is the
    // evidentiary answer, read from the manifests rather than inferred: it
    // says what was sent, not what should have been.
    const { rows: issued } = await odb.pool.query(
      `SELECT p.id, p.generated_at, p.file_name, a.applicant_name, entry->>'documentVersion' AS version
         FROM onboarding_starter_packs p
         JOIN onboarding_assignments a ON a.id = p.assignment_id
         CROSS JOIN LATERAL jsonb_array_elements(p.manifest) AS entry
        WHERE entry->>'documentId' = $1
        ORDER BY p.generated_at DESC LIMIT 100`,
      [doc.id]
    );

    res.json({
      ok: true,
      document: {
        id: doc.id, title: doc.title, code: doc.code,
        classification: doc.classification, status: doc.status,
        currentVersion: doc.current_version,
        ownerControlled: doc.owner_controlled,
      },
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        title: v.title,
        publisherEdition: v.source_version_label || null,
        fileName: v.file_name,
        sizeBytes: v.file_size_bytes,
        status: v.status,
        current: v.version === doc.current_version,
        publishedAt: v.published_at,
        changeNote: v.change_note,
        previewKind: v.file_mime === 'application/pdf' ? 'pdf'
          : String(v.file_mime || '').includes('wordprocessingml') ? 'docx' : null,
        previewUrl: `/api/onboarding/documents/${doc.id}/versions/${v.id}/download`,
      })),
      issuedIn: issued.map((r) => ({
        starterPackId: r.id,
        employee: r.applicant_name,
        version: r.version ? Number(r.version) : null,
        sentAt: r.generated_at,
      })),
    });
  }));

module.exports = router;
