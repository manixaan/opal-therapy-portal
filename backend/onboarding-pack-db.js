'use strict';

/**
 * DATA ACCESS for the per-employee document pack (migration 049).
 *
 * A pack item's file resolves in this order, and readItemFile() is the one
 * place that order lives:
 *   1. the person's own copy on the row (a replacement the Owner uploaded)
 *   2. the pinned library version's file
 *   3. the library document's CURRENT version's file (a pin that lapsed)
 *   4. a text body, served as plain text
 *   5. nothing — an official link, or no file yet
 */

const crypto = require('crypto');
const odb = require('./onboarding-db');
const { getBackend, getBackendName } = require('./storage');

const { pool, isUuid, str } = odb;

const ITEM_SELECT = `
  SELECT i.*,
         d.code AS library_code, d.title AS library_title, d.content_status AS library_content_status,
         d.official_source_url AS library_source_url, d.current_version AS library_current_version,
         pv.file_name AS pinned_file_name, pv.file_mime AS pinned_file_mime,
         (pv.file_data IS NOT NULL OR pv.storage_key IS NOT NULL) AS pinned_has_file,
         (pv.body IS NOT NULL) AS pinned_has_body,
         cv.id AS current_version_id, cv.file_name AS current_file_name, cv.file_mime AS current_file_mime,
         (cv.file_data IS NOT NULL OR cv.storage_key IS NOT NULL) AS current_has_file,
         (cv.body IS NOT NULL) AS current_has_body,
         fu.name AS file_uploaded_by_name, vb.name AS verified_by_name
    FROM onboarding_pack_items i
    LEFT JOIN onboarding_documents d ON d.id = i.document_id
    LEFT JOIN onboarding_document_versions pv ON pv.id = i.document_version_id
    LEFT JOIN onboarding_document_versions cv ON cv.document_id = d.id AND cv.version = d.current_version
    LEFT JOIN users fu ON fu.id = i.file_uploaded_by
    LEFT JOIN users vb ON vb.id = i.verified_by`;

async function listItems(assignmentId, q = pool, phase = null) {
  if (!isUuid(assignmentId)) return [];
  const { rows } = await q.query(`${ITEM_SELECT} WHERE i.assignment_id = $1 ${phase ? 'AND i.phase = $2' : ''} ORDER BY i.sort_order, i.title`, phase ? [assignmentId, phase] : [assignmentId]);
  return rows;
}

async function getItem(assignmentId, itemId, q = pool) {
  if (!isUuid(assignmentId) || !isUuid(itemId)) return null;
  const { rows } = await q.query(`${ITEM_SELECT} WHERE i.assignment_id = $1 AND i.id = $2`, [assignmentId, itemId]);
  return rows[0] || null;
}

async function countItems(assignmentIds, q = pool) {
  const ids = (assignmentIds || []).filter(isUuid);
  const out = new Map();
  if (!ids.length) return out;
  const { rows } = await q.query(
    `SELECT assignment_id, COUNT(*) FILTER (WHERE status = 'included') AS included,
            COUNT(*) FILTER (WHERE status = 'included' AND employee_returns) AS returns,
            COUNT(*) FILTER (WHERE status = 'included' AND employee_returns AND returned_at IS NOT NULL) AS returned,
            COUNT(*) FILTER (WHERE status = 'included' AND requires_verification AND verified_at IS NOT NULL) AS verified
       FROM onboarding_pack_items WHERE assignment_id = ANY($1::uuid[]) GROUP BY assignment_id`, [ids]
  );
  for (const r of rows) out.set(r.assignment_id, { included: +r.included, returns: +r.returns, returned: +r.returned, verified: +r.verified });
  return out;
}

/** Insert the default items; existing (assignment, code) rows are left alone. */
async function insertDefaults(organisationId, assignmentId, items, q = pool) {
  let inserted = 0;
  for (const it of items) {
    const { rowCount } = await q.query(
      `INSERT INTO onboarding_pack_items
         (organisation_id, assignment_id, code, title, description, section,
          sends_document, employee_returns, requires_verification, required,
          origin, requirement_code, document_id, document_version_id, official_source_url, sort_order,
          phase, item_kind, linked_task_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'default',$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (assignment_id, code) DO NOTHING`,
      [organisationId, assignmentId, str(it.code, 80), str(it.title, 250), str(it.description, 1000), str(it.section, 40),
        it.sends === true, it.returns === true, it.verifies === true, it.required !== false,
        str(it.requirementCode, 80), isUuid(it.documentId) ? it.documentId : null,
        isUuid(it.documentVersionId) ? it.documentVersionId : null, str(it.officialSourceUrl, 2000), Number(it.sortOrder) || 0,
        it.phase || 'documentation', it.itemKind || 'document', str(it.linkedTaskCode, 60)]
    );
    inserted += rowCount;
  }
  return inserted;
}

async function addItem({ organisationId, assignmentId, title, description, sends, returns, verifies, required, documentId, documentVersionId, officialSourceUrl, phase = 'documentation', section = null }, q = pool) {
  const code = `ADDED_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const { rows } = await q.query(
    `INSERT INTO onboarding_pack_items
       (organisation_id, assignment_id, code, title, description, section,
        sends_document, employee_returns, requires_verification, required,
        origin, document_id, document_version_id, official_source_url, sort_order, phase)
     VALUES ($1,$2,$3,$4,$5,$13,$6,$7,$8,$9,'added',$10,$11,$12,
             COALESCE((SELECT MAX(sort_order) FROM onboarding_pack_items WHERE assignment_id = $2 AND phase = $14), 0) + 10, $14)
     RETURNING *`,
    [organisationId, assignmentId, code, str(title, 250), str(description, 1000),
      sends === true, returns === true, verifies === true, required !== false,
      isUuid(documentId) ? documentId : null, isUuid(documentVersionId) ? documentVersionId : null, str(officialSourceUrl, 2000),
      section || (phase === 'induction' ? 'agreements' : 'policies'), phase]
  );
  return rows[0];
}

/** Restore the defaults for one phase: removed default items come back, added ones are removed. */
async function restoreDefaults(assignmentId, phase, q = pool) {
  const { rowCount: restored } = await q.query(`UPDATE onboarding_pack_items SET status = 'included', removed_reason = NULL, updated_at = NOW() WHERE assignment_id = $1 AND phase = $2 AND origin = 'default' AND status = 'removed'`, [assignmentId, phase]);
  const { rowCount: removed } = await q.query(`UPDATE onboarding_pack_items SET status = 'removed', removed_reason = 'Defaults restored', updated_at = NOW() WHERE assignment_id = $1 AND phase = $2 AND origin = 'added' AND status = 'included'`, [assignmentId, phase]);
  return { restored, removed };
}

async function countItemsByPhase(assignmentIds, q = pool) {
  const ids = (assignmentIds || []).filter(isUuid);
  const out = new Map();
  if (!ids.length) return out;
  const { rows } = await q.query(
    `SELECT assignment_id, phase,
            COUNT(*) FILTER (WHERE status = 'included' AND (employee_returns OR item_kind <> 'document')) AS tracked,
            COUNT(*) FILTER (WHERE status = 'included' AND (employee_returns OR item_kind <> 'document') AND required) AS required,
            COUNT(*) FILTER (WHERE status = 'included' AND (employee_returns OR item_kind <> 'document') AND (verification_status = 'verified' OR completed_at IS NOT NULL)) AS done,
            COUNT(*) FILTER (WHERE status = 'included' AND (employee_returns OR item_kind <> 'document') AND required AND (verification_status = 'verified' OR completed_at IS NOT NULL)) AS required_done
       FROM onboarding_pack_items WHERE assignment_id = ANY($1::uuid[]) GROUP BY assignment_id, phase`, [ids]
  );
  for (const r of rows) {
    if (!out.has(r.assignment_id)) out.set(r.assignment_id, {});
    out.get(r.assignment_id)[r.phase] = { tracked: +r.tracked, required: +r.required, done: +r.done, requiredDone: +r.required_done };
  }
  return out;
}

async function setItemCompleted(assignmentId, code, completed, q = pool) {
  await q.query(`UPDATE onboarding_pack_items SET completed_at = CASE WHEN $3::boolean THEN COALESCE(completed_at, NOW()) ELSE NULL END, updated_at = NOW() WHERE assignment_id = $1 AND code = $2`, [assignmentId, code, completed]);
}

async function updateItem(assignmentId, itemId, patch, q = pool) {
  const sets = ['updated_at = NOW()'];
  const params = [assignmentId, itemId];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.title !== undefined) set('title', str(patch.title, 250));
  if (patch.description !== undefined) set('description', str(patch.description, 1000));
  if (patch.required !== undefined) set('required', patch.required === true);
  if (patch.returns !== undefined) set('employee_returns', patch.returns === true);
  if (patch.verifies !== undefined) set('requires_verification', patch.verifies === true);
  if (patch.sends !== undefined) set('sends_document', patch.sends === true);
  const { rows } = await q.query(
    `UPDATE onboarding_pack_items SET ${sets.join(', ')} WHERE assignment_id = $1 AND id = $2 RETURNING *`, params
  );
  return rows[0] || null;
}

async function setItemStatus(assignmentId, itemId, status, reason, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_pack_items SET status = $3, removed_reason = $4, updated_at = NOW()
      WHERE assignment_id = $1 AND id = $2 RETURNING *`,
    [assignmentId, itemId, status, status === 'removed' ? str(reason, 500) : null]
  );
  return rows[0] || null;
}

async function reorderItems(assignmentId, itemIds, q = pool) {
  await odb.withTransaction(async (c) => {
    for (let i = 0; i < itemIds.length; i += 1) {
      await c.query('UPDATE onboarding_pack_items SET sort_order = $3, updated_at = NOW() WHERE assignment_id = $1 AND id = $2',
        [assignmentId, itemIds[i], (i + 1) * 10]);
    }
  });
}

/** Store this person's own copy of a document on the item. */
async function setItemFile(assignmentId, itemId, { fileName, fileMime, buffer, uploadedBy }) {
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const backendName = getBackendName();
  let storageKey = null; let backend = 'db'; let fileData = buffer.toString('base64');
  if (backendName !== 'db') {
    const put = await getBackend(backendName).put({ userId: 'onboarding-pack', docId: `${itemId}-${Date.now()}`, fileName, mime: fileMime, base64: fileData });
    backend = put.backend; storageKey = put.storageKey; fileData = null;
  }
  const { rows } = await pool.query(
    `UPDATE onboarding_pack_items
        SET file_name = $3, file_mime = $4, file_size_bytes = $5, file_sha256 = $6,
            storage_backend = $7, storage_key = $8, file_data = $9,
            file_uploaded_by = $10, file_uploaded_at = NOW(), sends_document = TRUE, updated_at = NOW()
      WHERE assignment_id = $1 AND id = $2 RETURNING *`,
    [assignmentId, itemId, str(fileName, 255), str(fileMime, 100), buffer.length, sha, backend, storageKey, fileData, uploadedBy || null]
  );
  return rows[0] || null;
}

async function clearItemFile(assignmentId, itemId, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_pack_items
        SET file_name = NULL, file_mime = NULL, file_size_bytes = NULL, file_sha256 = NULL,
            storage_backend = NULL, storage_key = NULL, file_data = NULL,
            file_uploaded_by = NULL, file_uploaded_at = NULL, updated_at = NOW()
      WHERE assignment_id = $1 AND id = $2 RETURNING *`, [assignmentId, itemId]
  );
  return rows[0] || null;
}

async function readStored({ storage_backend, storage_key, file_data }) {
  if (!storage_backend || storage_backend === 'db' || !storage_key) {
    return file_data ? Buffer.from(file_data, 'base64') : null;
  }
  const out = await getBackend(storage_backend).get({ backend: storage_backend, storageKey: storage_key, fileData: file_data });
  return out && out.base64 ? Buffer.from(out.base64, 'base64') : null;
}

/**
 * What the item's file IS, without reading bytes: { source, fileName, mime, previewKind, unavailableReason }.
 * source: 'own' | 'library' | 'body' | 'link' | 'none'
 */
function describeItemFile(row) {
  const kind = (mime) => (mime === 'application/pdf' ? 'pdf' : String(mime || '').includes('wordprocessingml') ? 'docx' : (String(mime || '').startsWith('image/') ? 'image' : (mime === 'text/plain' ? 'text' : null)));
  if (row.file_name) return { source: 'own', fileName: row.file_name, mime: row.file_mime, previewKind: kind(row.file_mime), unavailableReason: null };
  if (row.document_id) {
    if (row.pinned_has_file) return { source: 'library', fileName: row.pinned_file_name, mime: row.pinned_file_mime, previewKind: kind(row.pinned_file_mime), unavailableReason: null };
    if (row.current_has_file) return { source: 'library', fileName: row.current_file_name, mime: row.current_file_mime, previewKind: kind(row.current_file_mime), unavailableReason: null };
    if (row.pinned_has_body || row.current_has_body) return { source: 'body', fileName: `${row.title}.txt`, mime: 'text/plain', previewKind: 'text', unavailableReason: null };
    if (row.library_content_status === 'link_only' || row.official_source_url || row.library_source_url) {
      return { source: 'link', fileName: null, mime: null, previewKind: 'link', unavailableReason: 'Published as an official link rather than a file — upload the current PDF to include it in the ZIP' };
    }
    return { source: 'none', fileName: null, mime: null, previewKind: null, unavailableReason: 'No file has been published for this document yet' };
  }
  if (row.official_source_url) return { source: 'link', fileName: null, mime: null, previewKind: 'link', unavailableReason: 'An official link — upload the file to include it in the ZIP' };
  return { source: 'none', fileName: null, mime: null, previewKind: null, unavailableReason: row.sends_document ? 'No file attached to this item yet' : null };
}

/** The bytes behind an item, per the order above. { bytes, mime, fileName, source } or null. */
async function readItemFile(row, q = pool) {
  if (row.file_name) {
    const bytes = await readStored(row);
    return bytes ? { bytes, mime: row.file_mime, fileName: row.file_name, source: 'own' } : null;
  }
  if (!row.document_id) return null;
  const versionIds = [row.document_version_id, row.current_version_id].filter(Boolean);
  for (const vid of versionIds) {
    const v = await odb.getDocumentVersion(vid, q);
    if (!v) continue;
    if (v.file_name || v.storage_key || v.file_data) {
      const bytes = await readStored(v);
      if (bytes) return { bytes, mime: v.file_mime || 'application/octet-stream', fileName: v.file_name || `${row.title}`, source: 'library' };
    }
    if (v.body) return { bytes: Buffer.from(String(v.body), 'utf8'), mime: 'text/plain', fileName: `${row.title}.txt`, source: 'body' };
  }
  return null;
}

// ── Attachments: any number of extra files alongside a document's own file ──

const ATTACH_SELECT = `
  SELECT a.id, a.item_id, a.assignment_id, a.file_name, a.file_mime, a.file_size_bytes, a.file_sha256,
         a.storage_backend, a.storage_key, a.uploaded_at, a.uploaded_by, a.sort_order, u.name AS uploaded_by_name
    FROM onboarding_pack_item_attachments a LEFT JOIN users u ON u.id = a.uploaded_by`;

/** Attachments for every item of a record, keyed by item id (no bytes). */
async function mapAttachments(assignmentId, q = pool) {
  const { rows } = await q.query(`${ATTACH_SELECT} WHERE a.assignment_id = $1 ORDER BY a.sort_order, a.uploaded_at`, [assignmentId]);
  const out = {};
  for (const r of rows) (out[r.item_id] = out[r.item_id] || []).push(r);
  return out;
}

async function getAttachment(assignmentId, itemId, id, q = pool) {
  if (!isUuid(id) || !isUuid(itemId)) return null;
  const { rows } = await q.query(`SELECT a.* FROM onboarding_pack_item_attachments a WHERE a.assignment_id = $1 AND a.item_id = $2 AND a.id = $3`, [assignmentId, itemId, id]);
  return rows[0] || null;
}

async function addAttachment({ organisationId, assignmentId, itemId, fileName, fileMime, buffer, uploadedBy }) {
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const backendName = getBackendName();
  let storageKey = null; let backend = 'db'; let fileData = buffer.toString('base64');
  if (backendName !== 'db') {
    const put = await getBackend(backendName).put({ userId: 'onboarding-pack', docId: `${itemId}-att-${Date.now()}`, fileName, mime: fileMime, base64: fileData });
    backend = put.backend; storageKey = put.storageKey; fileData = null;
  }
  const { rows } = await pool.query(
    `INSERT INTO onboarding_pack_item_attachments
       (organisation_id, assignment_id, item_id, file_name, file_mime, file_size_bytes, file_sha256, storage_backend, storage_key, file_data, uploaded_by, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             COALESCE((SELECT MAX(sort_order) FROM onboarding_pack_item_attachments WHERE item_id = $3), 0) + 1)
     RETURNING *`,
    [organisationId || null, assignmentId, itemId, str(fileName, 255), str(fileMime, 100), buffer.length, sha, backend, storageKey, fileData, uploadedBy || null]
  );
  return rows[0];
}

/** Rename an attachment as it shows in the pack and the ZIP; the bytes stay. */
async function renameAttachment(assignmentId, itemId, id, fileName, q = pool) {
  if (!isUuid(id) || !isUuid(itemId)) return null;
  const { rows } = await q.query(
    'UPDATE onboarding_pack_item_attachments SET file_name = $4 WHERE assignment_id = $1 AND item_id = $2 AND id = $3 RETURNING *',
    [assignmentId, itemId, id, str(fileName, 255)]
  );
  return rows[0] || null;
}

async function deleteAttachment(assignmentId, itemId, id, q = pool) {
  if (!isUuid(id) || !isUuid(itemId)) return false;
  const { rowCount } = await q.query('DELETE FROM onboarding_pack_item_attachments WHERE assignment_id = $1 AND item_id = $2 AND id = $3', [assignmentId, itemId, id]);
  return rowCount > 0;
}

async function readAttachment(row, q = pool) {
  // The listing carries no bytes; fetch the stored form when asked to read.
  let src = row;
  if (src.file_data === undefined) {
    const { rows } = await q.query('SELECT storage_backend, storage_key, file_data FROM onboarding_pack_item_attachments WHERE id = $1', [row.id]);
    if (!rows[0]) return null;
    src = { ...row, ...rows[0] };
  }
  const bytes = await readStored(src);
  return bytes ? { bytes, mime: row.file_mime, fileName: row.file_name, source: 'attachment' } : null;
}

// ── The record's pack milestones ─────────────────────────────────────────────

async function setPackPrepared(assignmentId, q = pool) {
  await q.query(`UPDATE onboarding_assignments SET pack_prepared_at = COALESCE(pack_prepared_at, NOW()), last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`, [assignmentId]);
}

async function savePackEmail(assignmentId, { subject, body }, q = pool) {
  await q.query(`UPDATE onboarding_assignments SET pack_email_subject = $2, pack_email_body = $3, updated_at = NOW() WHERE id = $1`,
    [assignmentId, str(subject, 250), body == null ? null : String(body).slice(0, 20000)]);
}

async function markPackDrafted(assignmentId, { actorId, draftId, webLink, subject, body, dueAt }, q = pool) {
  await q.query(
    `UPDATE onboarding_assignments
        SET pack_email_draft_id = $2, pack_email_web_link = $3, pack_email_drafted_at = NOW(), pack_email_drafted_by = $4,
            pack_email_subject = $5, pack_email_body = $6, pack_due_at = $7,
            status = CASE WHEN status = 'created' THEN 'starter_pack_ready' ELSE status END,
            starter_pack_generated_at = COALESCE(starter_pack_generated_at, NOW()),
            last_activity_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [assignmentId, str(draftId, 300), webLink ? String(webLink).slice(0, 2000) : null, actorId, str(subject, 250),
      body == null ? null : String(body).slice(0, 20000), dueAt || null]
  );
}

async function clearPackDraft(assignmentId, q = pool) {
  await q.query(`UPDATE onboarding_assignments SET pack_email_draft_id = NULL, pack_email_web_link = NULL, pack_email_drafted_at = NULL, pack_email_drafted_by = NULL, updated_at = NOW() WHERE id = $1`, [assignmentId]);
}

async function markPackSent(assignmentId, { actorId, toEmail, dueAt }, q = pool) {
  await q.query(
    `UPDATE onboarding_assignments
        SET status = CASE WHEN status IN ('created', 'starter_pack_ready') THEN 'starter_pack_sent' ELSE status END,
            starter_pack_sent_at = NOW(), starter_pack_sent_to = $3, pack_sent_by = $2,
            pack_due_at = COALESCE(pack_due_at, $4), last_activity_at = NOW(), updated_at = NOW()
      WHERE id = $1`, [assignmentId, actorId, toEmail, dueAt || null]
  );
}

async function unmarkPackSent(assignmentId, q = pool) {
  await q.query(
    `UPDATE onboarding_assignments
        SET status = CASE WHEN status = 'starter_pack_sent' THEN 'starter_pack_ready' ELSE status END,
            starter_pack_sent_at = NULL, starter_pack_sent_to = NULL, pack_sent_by = NULL, updated_at = NOW()
      WHERE id = $1`, [assignmentId]
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  PACKAGE DEFAULTS (Edit Onboarding)
// ═════════════════════════════════════════════════════════════════════════════

async function listPackDefaults(packageId, q = pool) {
  if (!isUuid(packageId)) return [];
  const { rows } = await q.query(
    `SELECT d.*, doc.code AS document_code, doc.official_source_url, v.id AS current_version_id
       FROM onboarding_pack_defaults d
       LEFT JOIN onboarding_documents doc ON doc.id = d.document_id
       LEFT JOIN onboarding_document_versions v ON v.document_id = doc.id AND v.version = doc.current_version
      WHERE d.package_id = $1 ORDER BY d.sort_order NULLS LAST, d.created_at`, [packageId]
  );
  return rows;
}

async function upsertPackDefault({ organisationId, packageId, phase, code, action, patch = {}, actorId }, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO onboarding_pack_defaults
       (organisation_id, package_id, phase, code, action, title, description, sends_document, employee_returns, requires_verification, required, document_id, sort_order, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (package_id, phase, code) DO UPDATE SET
       action = EXCLUDED.action,
       title = COALESCE(EXCLUDED.title, onboarding_pack_defaults.title),
       description = COALESCE(EXCLUDED.description, onboarding_pack_defaults.description),
       sends_document = COALESCE(EXCLUDED.sends_document, onboarding_pack_defaults.sends_document),
       employee_returns = COALESCE(EXCLUDED.employee_returns, onboarding_pack_defaults.employee_returns),
       requires_verification = COALESCE(EXCLUDED.requires_verification, onboarding_pack_defaults.requires_verification),
       required = COALESCE(EXCLUDED.required, onboarding_pack_defaults.required),
       document_id = COALESCE(EXCLUDED.document_id, onboarding_pack_defaults.document_id),
       sort_order = COALESCE(EXCLUDED.sort_order, onboarding_pack_defaults.sort_order),
       updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING *`,
    [organisationId, packageId, phase, str(code, 80), action, str(patch.title, 250), str(patch.description, 1000),
      patch.sends ?? null, patch.returns ?? null, patch.verifies ?? null, patch.required ?? null,
      isUuid(patch.documentId) ? patch.documentId : null, patch.sortOrder ?? null, actorId || null]
  );
  return rows[0];
}

async function deletePackDefault(packageId, phase, code, q = pool) {
  const { rowCount } = await q.query('DELETE FROM onboarding_pack_defaults WHERE package_id = $1 AND phase = $2 AND code = $3', [packageId, phase, str(code, 80)]);
  return rowCount;
}

async function clearPackDefaults(packageId, phase, q = pool) {
  const { rowCount } = await q.query('DELETE FROM onboarding_pack_defaults WHERE package_id = $1 AND phase = $2', [packageId, phase]);
  return rowCount;
}

module.exports = {
  mapAttachments, getAttachment, addAttachment, renameAttachment, deleteAttachment, readAttachment,
  listPackDefaults, upsertPackDefault, deletePackDefault, clearPackDefaults,
  listItems, getItem, countItems, countItemsByPhase, insertDefaults, addItem, restoreDefaults, updateItem, setItemStatus, reorderItems, setItemCompleted,
  setItemFile, clearItemFile, describeItemFile, readItemFile,
  setPackPrepared, savePackEmail, markPackDrafted, clearPackDraft, markPackSent, unmarkPackSent,
};
