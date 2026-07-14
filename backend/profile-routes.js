/**
 * profile-routes.js
 *
 * REST endpoints for the My Profile panel sections that require real DB data:
 *   Leave requests
 *   CPD / Professional development activities
 *   Professional development documents
 *   Credentials
 *
 * Role behaviour:
 *   therapist  — can only see and manage their own records
 *   admin      — can view all records in the organisation (read-only approvals if permitted)
 *   owner      — can view all records and approve/reject leave + CPD + verify credentials
 *
 * All routes require an active session (requireAuth).
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('./database');
const { requireAuth } = require('./permissions');

// ─── helpers ────────────────────────────────────────────────────────────────

/** True when caller may take approval/verification actions. */
function canApprove(user) {
  return ['owner', 'admin'].includes(user?.role);
}

/** True when caller may view all-org data. */
function canViewAll(user) {
  return ['owner', 'admin'].includes(user?.role);
}

function notFound(res) { return res.status(404).json({ error: 'Record not found' }); }
function forbidden(res) { return res.status(403).json({ error: 'Insufficient permissions' }); }

/** Route ids are UUIDs; anything else is a guaranteed miss (and would throw a
 *  Postgres 22P02 cast error → 500 instead of the correct 404). */
const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

// ══════════════════════════════════════════════════════════════════════════════
//  LEAVE REQUESTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/profile/leave
 * Therapist: own requests.
 * Owner/Admin: all requests for the organisation (add ?mine=1 for own only).
 */
router.get('/api/profile/leave', requireAuth, async (req, res) => {
  try {
    const user    = req.user;
    const mineOnly = req.query.mine === '1' || !canViewAll(user);

    const requests = await db.getLeaveRequests({
      userId:         user.id,
      organisationId: user.organisation_id,
      allOrg:         !mineOnly,
    });

    res.json({ leaveRequests: requests });
  } catch (err) {
    console.error('GET /api/profile/leave error:', err);
    res.status(500).json({ error: 'Failed to load leave requests' });
  }
});

/**
 * POST /api/profile/leave
 * Submit a leave request. Any authenticated user may submit their own.
 * Body: { leaveType, startDate, endDate, reason?, status? }
 *   status defaults to 'submitted'; pass 'draft' to save without submitting.
 */
router.post('/api/profile/leave', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const { leaveType, startDate, endDate, reason, status } = req.body;

    if (!leaveType || !startDate || !endDate) {
      return res.status(400).json({ error: 'leaveType, startDate, and endDate are required' });
    }

    const record = await db.createLeaveRequest({
      userId:         user.id,
      organisationId: user.organisation_id,
      leaveType,
      startDate,
      endDate,
      reason: reason || null,
      status: status === 'draft' ? 'draft' : 'submitted',
    });

    await db.logAuditEvent({
      actorUserId:    user.id,
      action:         'leave_request_submitted',
      targetType:     'leave_request',
      targetId:       record.id,
      organisationId: user.organisation_id,
      ipAddress:      req.ip,
    }).catch(() => {});

    res.status(201).json({ leaveRequest: record });
  } catch (err) {
    console.error('POST /api/profile/leave error:', err);
    res.status(500).json({ error: 'Failed to submit leave request' });
  }
});

/**
 * PATCH /api/profile/leave/:id/approve
 * Owner/Admin only. Body: { comments? }
 */
router.patch('/api/profile/leave/:id/approve', requireAuth, async (req, res) => {
  if (!canApprove(req.user)) return forbidden(res);
  try {
    const record = await db.updateLeaveStatus({
      id:                req.params.id,
      status:            'approved',
      approvedByUserId:  req.user.id,
    });
    if (!record) return notFound(res);

    await db.logAuditEvent({
      actorUserId:    req.user.id,
      action:         'leave_request_approved',
      targetType:     'leave_request',
      targetId:       record.id,
      organisationId: req.user.organisation_id,
      ipAddress:      req.ip,
    }).catch(() => {});

    res.json({ leaveRequest: record });
  } catch (err) {
    console.error('PATCH leave approve error:', err);
    res.status(500).json({ error: 'Failed to approve leave request' });
  }
});

/**
 * PATCH /api/profile/leave/:id/reject
 * Owner/Admin only. Body: { rejectionReason? }
 */
router.patch('/api/profile/leave/:id/reject', requireAuth, async (req, res) => {
  if (!canApprove(req.user)) return forbidden(res);
  try {
    const record = await db.updateLeaveStatus({
      id:               req.params.id,
      status:           'rejected',
      approvedByUserId: req.user.id,
      rejectionReason:  req.body.rejectionReason || null,
    });
    if (!record) return notFound(res);

    await db.logAuditEvent({
      actorUserId:    req.user.id,
      action:         'leave_request_rejected',
      targetType:     'leave_request',
      targetId:       record.id,
      organisationId: req.user.organisation_id,
      ipAddress:      req.ip,
    }).catch(() => {});

    res.json({ leaveRequest: record });
  } catch (err) {
    console.error('PATCH leave reject error:', err);
    res.status(500).json({ error: 'Failed to reject leave request' });
  }
});

/**
 * DELETE /api/profile/leave/:id
 * Only the owner of a draft request may delete it.
 */
router.delete('/api/profile/leave/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await db.deleteLeaveRequest(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Draft leave request not found or already submitted' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE leave error:', err);
    res.status(500).json({ error: 'Failed to delete leave request' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  CPD ACTIVITIES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/profile/cpd
 * Therapist: own activities. Owner/Admin: all org activities (?mine=1 for own only).
 */
router.get('/api/profile/cpd', requireAuth, async (req, res) => {
  try {
    const user     = req.user;
    const mineOnly = req.query.mine === '1' || !canViewAll(user);

    const activities = await db.getCPDActivities({
      userId:         user.id,
      organisationId: user.organisation_id,
      allOrg:         !mineOnly,
    });

    res.json({ cpdActivities: activities });
  } catch (err) {
    console.error('GET /api/profile/cpd error:', err);
    res.status(500).json({ error: 'Failed to load CPD activities' });
  }
});

/**
 * POST /api/profile/cpd
 * Submit a CPD activity.
 * Body: { title, provider?, completedDate?, hours?, costAud?, mode?, category?, link?, notes?, status? }
 */
router.post('/api/profile/cpd', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const { title, provider, completedDate, hours, costAud, mode, category, link, notes, status } = req.body;

    if (!title) return res.status(400).json({ error: 'title is required' });

    const record = await db.createCPDActivity({
      userId:         user.id,
      organisationId: user.organisation_id,
      title, provider, completedDate, hours, costAud, mode, category, link, notes,
      status: status === 'draft' ? 'draft' : 'submitted',
    });

    await db.logAuditEvent({
      actorUserId:    user.id,
      action:         'cpd_activity_submitted',
      targetType:     'cpd_activity',
      targetId:       record.id,
      organisationId: user.organisation_id,
      ipAddress:      req.ip,
    }).catch(() => {});

    res.status(201).json({ cpdActivity: record });
  } catch (err) {
    console.error('POST /api/profile/cpd error:', err);
    res.status(500).json({ error: 'Failed to submit CPD activity' });
  }
});

/**
 * PATCH /api/profile/cpd/:id/approve
 * Owner/Admin only.
 */
router.patch('/api/profile/cpd/:id/approve', requireAuth, async (req, res) => {
  if (!canApprove(req.user)) return forbidden(res);
  try {
    const record = await db.updateCPDStatus({
      id:               req.params.id,
      status:           'approved',
      reviewedByUserId: req.user.id,
      reviewComments:   req.body.reviewComments || null,
    });
    if (!record) return notFound(res);
    res.json({ cpdActivity: record });
  } catch (err) {
    console.error('PATCH CPD approve error:', err);
    res.status(500).json({ error: 'Failed to approve CPD activity' });
  }
});

/**
 * PATCH /api/profile/cpd/:id/reject
 * Owner/Admin only. Body: { reviewComments? }
 */
router.patch('/api/profile/cpd/:id/reject', requireAuth, async (req, res) => {
  if (!canApprove(req.user)) return forbidden(res);
  try {
    const record = await db.updateCPDStatus({
      id:               req.params.id,
      status:           'rejected',
      reviewedByUserId: req.user.id,
      reviewComments:   req.body.reviewComments || null,
    });
    if (!record) return notFound(res);
    res.json({ cpdActivity: record });
  } catch (err) {
    console.error('PATCH CPD reject error:', err);
    res.status(500).json({ error: 'Failed to reject CPD activity' });
  }
});

/**
 * DELETE /api/profile/cpd/:id
 * Only the owner of a draft may delete it.
 */
router.delete('/api/profile/cpd/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await db.deleteCPDActivity(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Draft CPD activity not found or already submitted' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE CPD error:', err);
    res.status(500).json({ error: 'Failed to delete CPD activity' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PROFESSIONAL DEVELOPMENT DOCUMENTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/profile/documents
 * Returns the caller's own PD documents (metadata only, no file data in list).
 */
router.get('/api/profile/documents', requireAuth, async (req, res) => {
  try {
    const docs = await db.getPDDocuments({ userId: req.user.id });
    res.json({ documents: docs });
  } catch (err) {
    console.error('GET /api/profile/documents error:', err);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

/**
 * POST /api/profile/documents
 * Upload a PD document. File sent as base64 in fileData.
 * Body: { title, documentType?, fileName?, fileMime?, fileSizeBytes?, fileData?, relatedCpdActivityId? }
 * Max file size enforced here: 5 MB (base64 ≈ 4/3× binary, so ~6.7 MB of base64).
 */
// Employee-document upload allowlist: certificate/registration/CPD evidence
// formats only. Executables, HTML and SVG (script-capable) are refused, the
// extension must agree with the declared MIME type, and file names must not
// carry path segments.
const UPLOAD_ALLOWED = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
};

function validateUpload({ fileName, fileMime, fileData }) {
  if (!fileData) return null; // metadata-only records are allowed
  const exts = UPLOAD_ALLOWED[String(fileMime || '').toLowerCase()];
  if (!exts) return 'File type not allowed. Accepted: PDF, PNG, JPEG, DOC, DOCX';
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (!exts.includes(ext)) return `File extension ".${ext}" does not match the declared type`;
  if (/[/\\]|\.\./.test(String(fileName))) return 'Invalid file name';
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(String(fileData).slice(0, 1000))) {
    return 'File content must be base64-encoded';
  }
  return null;
}

router.post('/api/profile/documents', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const { title, documentType, fileName, fileMime, fileSizeBytes, fileData, relatedCpdActivityId } = req.body;

    if (!title) return res.status(400).json({ error: 'title is required' });

    // Guard against very large uploads in-band (5 MB raw limit)
    if (fileData && fileData.length > 7 * 1024 * 1024) {
      return res.status(413).json({ error: 'File exceeds 5 MB limit' });
    }

    const uploadError = validateUpload({ fileName, fileMime, fileData });
    if (uploadError) return res.status(415).json({ error: uploadError });

    const { getBackend, getBackendName } = require('./storage');
    const backend = getBackend();

    // db backend: bytes go inline via the INSERT. local/blob: create the row
    // first (to get an id for the storage key), write the object, then link it
    // and clear the inline column.
    let record;
    if (getBackendName() === 'db' || !fileData) {
      record = await db.createPDDocument({
        userId: user.id, organisationId: user.organisation_id,
        title, documentType, fileName, fileMime, fileSizeBytes,
        fileData: fileData || null,
        relatedCpdActivityId: relatedCpdActivityId || null,
        storageBackend: 'db',
      });
    } else {
      record = await db.createPDDocument({
        userId: user.id, organisationId: user.organisation_id,
        title, documentType, fileName, fileMime, fileSizeBytes,
        fileData: null, relatedCpdActivityId: relatedCpdActivityId || null,
        storageBackend: getBackendName(),
      });
      try {
        const { backend: b, storageKey } = await backend.put({
          userId: user.id, docId: record.id, fileName, mime: fileMime, base64: fileData,
        });
        await db.setPDDocumentStorage(record.id, { storageBackend: b, storageKey, clearInline: true });
        record.storage_backend = b;
      } catch (putErr) {
        // Storage write failed — remove the metadata row so no orphaned
        // "document" without content survives, then surface the failure.
        await db.deletePDDocument(record.id, user.id).catch(() => {});
        throw putErr;
      }
    }

    // Audit: title/filename are employee-chosen metadata, never file content.
    await db.logAuditEvent({
      actorUserId: user.id, action: 'document.uploaded',
      targetType: 'pd_document', targetId: record.id, ipAddress: req.ip,
      organisationId: user.organisation_id,
      metadata: { fileName, mime: fileMime, sizeBytes: fileSizeBytes || null, backend: record.storage_backend },
    }).catch(() => {});

    res.status(201).json({ document: record });
  } catch (err) {
    console.error('POST /api/profile/documents error:', err);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

/**
 * GET /api/profile/documents/:id/download
 * Streams a document's bytes through the backend after an ownership/role check.
 * This is the ONLY way to read document content — there are no public URLs.
 * Owner/admin may download any org member's document; others only their own.
 */
router.get('/api/profile/documents/:id/download', requireAuth, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return notFound(res);
    const doc = await db.getPDDocumentForDownload(req.params.id, req.user.id);
    if (!doc) return notFound(res);
    if (doc.user_id !== req.user.id && !canViewAll(req.user)) {
      // Audit the denied cross-user attempt (identifiers only).
      await db.logAuditEvent({
        actorUserId: req.user.id, action: 'document.download_denied',
        targetType: 'pd_document', targetId: doc.id, ipAddress: req.ip,
        organisationId: req.user.organisation_id,
        metadata: { documentOwnerUserId: doc.user_id },
      }).catch(() => {});
      return forbidden(res);
    }

    // Audit cross-user access (owner/admin reading an employee's document).
    if (doc.user_id !== req.user.id) {
      await db.logAuditEvent({
        actorUserId: req.user.id, action: 'document.downloaded',
        targetType: 'pd_document', targetId: doc.id, ipAddress: req.ip,
        organisationId: req.user.organisation_id,
        metadata: { documentOwnerUserId: doc.user_id },
      }).catch(() => {});
    }

    const { getBackend } = require('./storage');
    const backend = getBackend(doc.storage_backend || 'db');
    let base64 = null;
    try {
      ({ base64 } = await backend.get({
        backend: doc.storage_backend, storageKey: doc.storage_key, fileData: doc.file_data,
      }));
    } catch (readErr) {
      // Missing/unreadable stored object (deleted behind the app's back,
      // blob outage) — a safe 404, never a 500 with backend internals.
      console.warn(`Document ${doc.id} content unreadable (${readErr.code || readErr.name})`);
    }
    if (!base64) return res.status(404).json({ error: 'Document content unavailable' });

    const buf = Buffer.from(base64, 'base64');
    res.setHeader('Content-Type', doc.file_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.file_name || 'document')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  } catch (err) {
    console.error('GET document download error:', err.message);
    res.status(500).json({ error: 'Failed to download document' });
  }
});

/**
 * DELETE /api/profile/documents/:id
 * Only the document owner may delete. Also removes any external blob/file.
 */
router.delete('/api/profile/documents/:id', requireAuth, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return notFound(res);
    const doc = await db.getPDDocumentForDownload(req.params.id, req.user.id);
    if (!doc || doc.user_id !== req.user.id) return notFound(res);

    if (doc.storage_backend && doc.storage_backend !== 'db' && doc.storage_key) {
      try {
        const { getBackend } = require('./storage');
        await getBackend(doc.storage_backend).remove({ storageBackend: doc.storage_backend, storageKey: doc.storage_key });
      } catch (e) { console.warn('Blob delete (non-fatal):', e.message); }
    }

    const deleted = await db.deletePDDocument(req.params.id, req.user.id);
    if (!deleted) return notFound(res);
    await db.logAuditEvent({
      actorUserId: req.user.id, action: 'document.deleted',
      targetType: 'pd_document', targetId: req.params.id, ipAddress: req.ip,
      organisationId: req.user.organisation_id,
      metadata: { fileName: doc.file_name },
    }).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE document error:', err);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  CREDENTIALS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/profile/credentials
 * Therapist: own credentials. Owner/Admin: all org credentials (?mine=1 for own only).
 */
router.get('/api/profile/credentials', requireAuth, async (req, res) => {
  try {
    const user     = req.user;
    const mineOnly = req.query.mine === '1' || !canViewAll(user);

    const creds = await db.getCredentials({
      userId:         user.id,
      organisationId: user.organisation_id,
      allOrg:         !mineOnly,
    });

    res.json({ credentials: creds });
  } catch (err) {
    console.error('GET /api/profile/credentials error:', err);
    res.status(500).json({ error: 'Failed to load credentials' });
  }
});

/**
 * POST /api/profile/credentials
 * Add a credential.
 * Body: { credentialType, credentialName, issuingBody?, registrationNumber?, issueDate?, expiryDate?, documentId?, notes? }
 */
router.post('/api/profile/credentials', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const { credentialType, credentialName, issuingBody, registrationNumber,
            issueDate, expiryDate, documentId, notes } = req.body;

    if (!credentialType || !credentialName) {
      return res.status(400).json({ error: 'credentialType and credentialName are required' });
    }

    const record = await db.createCredential({
      userId:             user.id,
      organisationId:     user.organisation_id,
      credentialType, credentialName, issuingBody, registrationNumber,
      issueDate, expiryDate, documentId, notes,
    });

    res.status(201).json({ credential: record });
  } catch (err) {
    console.error('POST /api/profile/credentials error:', err);
    res.status(500).json({ error: 'Failed to add credential' });
  }
});

/**
 * PATCH /api/profile/credentials/:id
 * Update own credential fields (credential owner only, unless manager).
 * Body: { credentialName?, issuingBody?, registrationNumber?, issueDate?, expiryDate?, notes? }
 */
router.patch('/api/profile/credentials/:id', requireAuth, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return notFound(res);
    const { credentialName, issuingBody, registrationNumber, issueDate, expiryDate, notes } = req.body;
    const record = await db.updateCredential(req.params.id, req.user.id, {
      credential_name:     credentialName,
      issuing_body:        issuingBody,
      registration_number: registrationNumber,
      issue_date:          issueDate,
      expiry_date:         expiryDate,
      notes,
    });
    if (!record) return notFound(res);
    res.json({ credential: record });
  } catch (err) {
    console.error('PATCH credential error:', err);
    res.status(500).json({ error: 'Failed to update credential' });
  }
});

/**
 * PATCH /api/profile/credentials/:id/verify
 * Owner/Admin only — mark credential as verified.
 */
router.patch('/api/profile/credentials/:id/verify', requireAuth, async (req, res) => {
  if (!canApprove(req.user)) return forbidden(res);
  try {
    if (!isUuid(req.params.id)) return notFound(res);
    const record = await db.verifyCredential({ id: req.params.id, verifiedByUserId: req.user.id });
    if (!record) return notFound(res);
    await db.logAuditEvent({
      actorUserId: req.user.id, action: 'credential.verified',
      targetType: 'credential', targetId: req.params.id, ipAddress: req.ip,
      organisationId: req.user.organisation_id,
    }).catch(() => {});
    res.json({ credential: record });
  } catch (err) {
    console.error('PATCH credential verify error:', err);
    res.status(500).json({ error: 'Failed to verify credential' });
  }
});

/**
 * DELETE /api/profile/credentials/:id
 * Only the credential owner may delete.
 */
router.delete('/api/profile/credentials/:id', requireAuth, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return notFound(res);
    const deleted = await db.deleteCredential(req.params.id, req.user.id);
    if (!deleted) return notFound(res);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE credential error:', err);
    res.status(500).json({ error: 'Failed to delete credential' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  WORK LOCATION SCHEDULE
//  Stores the full WORK_LOCATION map (week-keyed) and WORK_BASES in two
//  existing JSONB columns on the users table.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/profile/work-schedule
 * Returns the caller's persisted work_location_schedule and default_work_location
 * (travel bases). Both may be null on first use.
 */
router.get('/api/profile/work-schedule', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.pool.query(
      `SELECT work_location_schedule, default_work_location
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    const row = rows[0] || {};
    res.json({
      workLocationSchedule: row.work_location_schedule || null,
      travelBases:          row.default_work_location  || null,
    });
  } catch (err) {
    console.error('GET work-schedule error:', err);
    res.status(500).json({ error: 'Failed to load work schedule' });
  }
});

/**
 * PUT /api/profile/work-schedule
 * Body: { workLocationSchedule?: object, travelBases?: object }
 * Saves whichever fields are provided (null-safe partial update).
 */
router.put('/api/profile/work-schedule', requireAuth, async (req, res) => {
  const { workLocationSchedule, travelBases } = req.body || {};
  try {
    await db.pool.query(
      `UPDATE users
          SET work_location_schedule = COALESCE($1::jsonb, work_location_schedule),
              default_work_location  = COALESCE($2::jsonb, default_work_location),
              updated_at             = NOW()
        WHERE id = $3`,
      [
        workLocationSchedule != null ? JSON.stringify(workLocationSchedule) : null,
        travelBases          != null ? JSON.stringify(travelBases)          : null,
        req.user.id,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT work-schedule error:', err);
    res.status(500).json({ error: 'Failed to save work schedule' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  NOTIFICATION PREFERENCES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/profile/notification-prefs
 * Returns the caller's persisted notification_preferences object (or null).
 */
router.get('/api/profile/notification-prefs', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.pool.query(
      `SELECT notification_preferences FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.json({ prefs: (rows[0]?.notification_preferences) || null });
  } catch (err) {
    console.error('GET notification-prefs error:', err);
    res.status(500).json({ error: 'Failed to load notification preferences' });
  }
});

/**
 * PUT /api/profile/notification-prefs
 * Body: { locationAlarm, planExpiry, cancellation, weeklyDigest, cpdReminder }
 * Deep-merges with any existing preferences so a partial update is safe.
 */
router.put('/api/profile/notification-prefs', requireAuth, async (req, res) => {
  const incoming = req.body || {};
  // Whitelist the expected keys
  const allowed = ['locationAlarm','planExpiry','cancellation','weeklyDigest','cpdReminder'];
  const prefs = {};
  for (const k of allowed) {
    if (typeof incoming[k] === 'boolean') prefs[k] = incoming[k];
  }
  if (!Object.keys(prefs).length) {
    return res.status(400).json({ error: 'No valid preference keys provided' });
  }
  try {
    await db.pool.query(
      `UPDATE users
          SET notification_preferences = COALESCE(notification_preferences, '{}'::jsonb) || $1::jsonb,
              updated_at               = NOW()
        WHERE id = $2`,
      [JSON.stringify(prefs), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT notification-prefs error:', err);
    res.status(500).json({ error: 'Failed to save notification preferences' });
  }
});

module.exports = router;

module.exports.validateUpload = validateUpload;
