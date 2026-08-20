'use strict';

/**
 * ONBOARDING DATA ACCESS
 *
 * Every SQL statement the onboarding feature runs lives here, for the same
 * reason database.js exists: encrypted columns must never be read or written
 * by raw SQL elsewhere. The portal has already been bitten by that once — a
 * route that selected an encrypted OAuth token directly handed `enc:…` to
 * Microsoft Graph and 401'd every sync. Payroll and identity values go through
 * the read/write helpers below, and nothing else.
 *
 * ORG SCOPING. This deployment is single-tenant but the schema is not, and
 * there is no row-level security — every boundary is a WHERE clause. Existing
 * rows can carry a NULL organisation_id (users.organisation_id is nullable),
 * so comparisons use `IS NOT DISTINCT FROM`, matching the most recent
 * precedent in learning-routes.js. A bare `=` would silently hide every
 * NULL-org row instead of erroring.
 */

const { pool } = require('./database');
const { encryptField, decryptField, isEncryptionConfigured } = require('./onboarding-crypto');
const engine = require('./onboarding-engine');
const log = require('./logger').createLogger('onboarding-db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => UUID_RE.test(String(s || ''));

/** Trim to a max length, or null. Used for every free-text column. */
function str(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function bool(v, dflt = null) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return dflt;
}

function dateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Run `fn` inside a transaction, releasing the client either way. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  SETTINGS  (org_settings JSONB, key 'onboarding')
// ═════════════════════════════════════════════════════════════════════════════

const ORG_SETTINGS_KEY = 'opal';

async function getOnboardingSettings(q = pool) {
  const { rows } = await q.query(
    'SELECT settings FROM org_settings WHERE org_id = $1', [ORG_SETTINGS_KEY]
  );
  const all = rows[0]?.settings || {};
  const { DEFAULT_SETTINGS } = require('./onboarding-catalogue');
  return { ...DEFAULT_SETTINGS, ...(all.onboarding || {}) };
}

async function saveOnboardingSettings(patch, q = pool) {
  const { rows } = await q.query(
    'SELECT settings FROM org_settings WHERE org_id = $1', [ORG_SETTINGS_KEY]
  );
  const all = rows[0]?.settings || {};
  const next = { ...all, onboarding: { ...(all.onboarding || {}), ...patch } };
  await q.query(
    `INSERT INTO org_settings (org_id, settings, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (org_id) DO UPDATE SET settings = $2, updated_at = NOW()`,
    [ORG_SETTINGS_KEY, JSON.stringify(next)]
  );
  return next.onboarding;
}

// ═════════════════════════════════════════════════════════════════════════════
//  COMPLIANCE REGISTRY
// ═════════════════════════════════════════════════════════════════════════════

async function listComplianceRequirements(orgId, { status } = {}, q = pool) {
  const params = [orgId];
  // Qualified: onboarding_documents also has organisation_id and status, so an
  // unqualified reference is ambiguous once the LEFT JOIN is added.
  let where = 'c.organisation_id IS NOT DISTINCT FROM $1';
  if (status) { params.push(status); where += ` AND c.status = $${params.length}`; }
  const { rows } = await q.query(
    `SELECT c.*, d.title AS stored_document_title
       FROM compliance_requirements c
       LEFT JOIN onboarding_documents d ON d.id = c.stored_document_id
      WHERE ${where}
      ORDER BY c.category, c.title`, params
  );
  return rows;
}

async function getComplianceRequirementByCode(orgId, code, q = pool) {
  const { rows } = await q.query(
    `SELECT * FROM compliance_requirements
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND code = $2 LIMIT 1`,
    [orgId, code]
  );
  return rows[0] || null;
}

async function upsertComplianceRequirement(orgId, data, actorId, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO compliance_requirements
       (organisation_id, code, title, category, classification, basis, applies_to,
        jurisdiction, source_org, source_title, source_url, source_version_label,
        source_last_modified, source_checked_at, document_version, effective_date,
        recurrence, delivery_rules, next_review_date, stored_document_id, status, notes,
        last_verified_at, last_verified_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW())
     ON CONFLICT (organisation_id, code) DO UPDATE SET
       title = EXCLUDED.title, category = EXCLUDED.category,
       classification = EXCLUDED.classification, basis = EXCLUDED.basis,
       applies_to = EXCLUDED.applies_to, jurisdiction = EXCLUDED.jurisdiction,
       source_org = EXCLUDED.source_org, source_title = EXCLUDED.source_title,
       source_url = EXCLUDED.source_url, source_version_label = EXCLUDED.source_version_label,
       source_last_modified = EXCLUDED.source_last_modified,
       source_checked_at = EXCLUDED.source_checked_at,
       document_version = EXCLUDED.document_version, effective_date = EXCLUDED.effective_date,
       recurrence = EXCLUDED.recurrence, delivery_rules = EXCLUDED.delivery_rules,
       next_review_date = EXCLUDED.next_review_date,
       stored_document_id = COALESCE(EXCLUDED.stored_document_id, compliance_requirements.stored_document_id),
       status = EXCLUDED.status, notes = EXCLUDED.notes,
       last_verified_at = COALESCE(EXCLUDED.last_verified_at, compliance_requirements.last_verified_at),
       last_verified_by = COALESCE(EXCLUDED.last_verified_by, compliance_requirements.last_verified_by),
       updated_at = NOW()
     RETURNING *`,
    [
      orgId, str(data.code, 60), str(data.title, 250), str(data.category, 40) || 'other',
      data.classification, data.basis || 'OPAL_POLICY_REQUIREMENT', str(data.appliesTo, 120),
      data.jurisdiction || 'AU', str(data.sourceOrg, 150), str(data.sourceTitle, 250),
      str(data.sourceUrl, 2000), str(data.sourceVersionLabel, 120),
      dateOrNull(data.sourceLastModified), dateOrNull(data.sourceCheckedAt),
      str(data.documentVersion, 60), dateOrNull(data.effectiveDate),
      JSON.stringify(data.recurrence || {}), JSON.stringify(data.deliveryRules || {}),
      dateOrNull(data.nextReviewDate), data.storedDocumentId || null,
      data.status || 'active', data.notes || null,
      dateOrNull(data.lastVerifiedAt), data.lastVerifiedBy || actorId || null,
    ]
  );
  return rows[0];
}

// ═════════════════════════════════════════════════════════════════════════════
//  DOCUMENT LIBRARY
// ═════════════════════════════════════════════════════════════════════════════

async function listDocuments(orgId, { audience, category, status } = {}, q = pool) {
  const params = [orgId];
  let where = 'd.organisation_id IS NOT DISTINCT FROM $1';
  if (audience) {
    params.push(audience);
    where += ` AND (d.audience = $${params.length} OR d.audience = 'both')`;
  }
  if (category) { params.push(category); where += ` AND d.category = $${params.length}`; }
  if (status) { params.push(status); where += ` AND d.status = $${params.length}`; }
  const { rows } = await q.query(
    `SELECT d.*,
            v.id AS current_version_id, v.version AS current_version_number,
            v.source_version_label, v.effective_date AS current_effective_date,
            v.file_name AS current_file_name, v.file_mime AS current_file_mime,
            (v.file_data IS NOT NULL OR v.storage_key IS NOT NULL OR v.body IS NOT NULL) AS has_content
       FROM onboarding_documents d
       LEFT JOIN onboarding_document_versions v
              ON v.document_id = d.id AND v.version = d.current_version
      WHERE ${where}
      ORDER BY d.category, d.title`, params
  );
  return rows;
}

async function getDocument(orgId, id, q = pool) {
  if (!isUuid(id)) return null;
  const { rows } = await q.query(
    `SELECT * FROM onboarding_documents
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 LIMIT 1`, [id, orgId]
  );
  return rows[0] || null;
}

async function getDocumentByCode(orgId, code, q = pool) {
  const { rows } = await q.query(
    `SELECT * FROM onboarding_documents
      WHERE code = $1 AND organisation_id IS NOT DISTINCT FROM $2 LIMIT 1`, [code, orgId]
  );
  return rows[0] || null;
}

async function listDocumentVersions(documentId, q = pool) {
  const { rows } = await q.query(
    `SELECT id, document_id, version, title, summary, source_version_label,
            source_url, effective_date, status, change_note, file_name, file_mime,
            file_size_bytes, file_sha256, published_at, published_by, created_at,
            (body IS NOT NULL) AS has_body,
            (file_data IS NOT NULL OR storage_key IS NOT NULL) AS has_file
       FROM onboarding_document_versions
      WHERE document_id = $1 ORDER BY version DESC`, [documentId]
  );
  return rows;
}

/** The published version a requirement should pin to, or null. */
async function getCurrentDocumentVersion(documentId, q = pool) {
  const { rows } = await q.query(
    `SELECT v.* FROM onboarding_document_versions v
       JOIN onboarding_documents d ON d.id = v.document_id
      WHERE v.document_id = $1 AND v.version = d.current_version AND v.status = 'published'
      LIMIT 1`, [documentId]
  );
  return rows[0] || null;
}

async function getDocumentVersion(id, q = pool) {
  if (!isUuid(id)) return null;
  const { rows } = await q.query(
    'SELECT * FROM onboarding_document_versions WHERE id = $1 LIMIT 1', [id]
  );
  return rows[0] || null;
}

async function upsertDocument(orgId, data, actorId, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO onboarding_documents
       (organisation_id, code, title, description, category, classification, audience,
        owner_controlled, official_source_url, compliance_requirement_id, content_status,
        status, requires_acknowledgement, created_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
     ON CONFLICT (organisation_id, code) DO UPDATE SET
       title = EXCLUDED.title, description = EXCLUDED.description,
       category = EXCLUDED.category, classification = EXCLUDED.classification,
       audience = EXCLUDED.audience, owner_controlled = EXCLUDED.owner_controlled,
       official_source_url = EXCLUDED.official_source_url,
       compliance_requirement_id = COALESCE(EXCLUDED.compliance_requirement_id,
                                            onboarding_documents.compliance_requirement_id),
       requires_acknowledgement = EXCLUDED.requires_acknowledgement,
       updated_at = NOW()
     RETURNING *`,
    [
      orgId, str(data.code, 80), str(data.title, 250), str(data.description, 1000),
      str(data.category, 40) || 'other', data.classification || 'OPAL_POLICY',
      data.audience || 'employee', data.ownerControlled !== false,
      str(data.officialSourceUrl, 2000), data.complianceRequirementId || null,
      data.contentStatus || 'document_required', data.status || 'draft',
      data.requiresAcknowledgement === true, actorId || null,
    ]
  );
  return rows[0];
}

/**
 * Create the next DRAFT version of a document.
 * Bytes go through the same storage abstraction as employee documents.
 */
async function createDocumentVersion(documentId, data, actorId, q = pool) {
  const { rows: maxRows } = await q.query(
    'SELECT COALESCE(MAX(version), 0) AS v FROM onboarding_document_versions WHERE document_id = $1',
    [documentId]
  );
  const version = Number(maxRows[0].v) + 1;
  const { rows } = await q.query(
    `INSERT INTO onboarding_document_versions
       (document_id, version, title, summary, body, file_name, file_mime, file_size_bytes,
        file_sha256, storage_backend, storage_key, file_data, source_url,
        source_version_label, source_last_modified, effective_date, status, change_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'draft',$17)
     RETURNING *`,
    [
      documentId, version, str(data.title, 250), str(data.summary, 2000), data.body || null,
      str(data.fileName, 255), str(data.fileMime, 100), data.fileSizeBytes || null,
      str(data.fileSha256, 64), data.storageBackend || 'db', data.storageKey || null,
      data.fileData || null, str(data.sourceUrl, 2000), str(data.sourceVersionLabel, 120),
      dateOrNull(data.sourceLastModified), dateOrNull(data.effectiveDate),
      str(data.changeNote, 1000),
    ]
  );
  return rows[0];
}

/**
 * Publish a version. The previous current version becomes 'superseded'.
 *
 * Superseding NEVER touches acknowledgement history: an acknowledgement is
 * pinned to a version id, so "who agreed to v1" stays answerable forever.
 */
async function publishDocumentVersion(documentId, versionId, actorId, q = pool) {
  const { rows: vRows } = await q.query(
    'SELECT * FROM onboarding_document_versions WHERE id = $1 AND document_id = $2',
    [versionId, documentId]
  );
  const version = vRows[0];
  if (!version) return null;

  await q.query(
    `UPDATE onboarding_document_versions SET status = 'superseded'
      WHERE document_id = $1 AND id <> $2 AND status = 'published'`,
    [documentId, versionId]
  );
  await q.query(
    `UPDATE onboarding_document_versions
        SET status = 'published', published_by = $2, published_at = NOW()
      WHERE id = $1`, [versionId, actorId || null]
  );
  const hasContent = !!(version.body || version.file_data || version.storage_key);
  await q.query(
    `UPDATE onboarding_documents
        SET current_version = $2, status = 'published',
            content_status = CASE WHEN $3 THEN 'available' ELSE content_status END,
            updated_at = NOW()
      WHERE id = $1`, [documentId, version.version, hasContent]
  );
  const { rows } = await q.query(
    'SELECT * FROM onboarding_document_versions WHERE id = $1', [versionId]
  );
  return rows[0];
}

// ═════════════════════════════════════════════════════════════════════════════
//  REQUIREMENT TEMPLATES
// ═════════════════════════════════════════════════════════════════════════════

async function listRequirementTemplates(orgId, { status = 'active', section } = {}, q = pool) {
  const params = [orgId];
  let where = 't.organisation_id IS NOT DISTINCT FROM $1';
  if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
  if (section) { params.push(section); where += ` AND t.section = $${params.length}`; }
  const { rows } = await q.query(
    `SELECT t.*, d.title AS document_title, d.code AS document_code,
            d.content_status AS document_content_status,
            c.title AS compliance_title, c.basis AS compliance_basis,
            c.source_url AS compliance_source_url, c.source_org AS compliance_source_org
       FROM onboarding_requirement_templates t
       LEFT JOIN onboarding_documents d ON d.id = t.document_id
       LEFT JOIN compliance_requirements c ON c.id = t.compliance_requirement_id
      WHERE ${where}
      ORDER BY t.section, t.sort_hint, t.title`, params
  );
  return rows;
}

async function getRequirementTemplate(orgId, id, q = pool) {
  if (!isUuid(id)) return null;
  const { rows } = await q.query(
    `SELECT * FROM onboarding_requirement_templates
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 LIMIT 1`, [id, orgId]
  );
  return rows[0] || null;
}

async function getRequirementTemplateByCode(orgId, code, q = pool) {
  const { rows } = await q.query(
    `SELECT * FROM onboarding_requirement_templates
      WHERE code = $1 AND organisation_id IS NOT DISTINCT FROM $2 LIMIT 1`, [code, orgId]
  );
  return rows[0] || null;
}

async function upsertRequirementTemplate(orgId, data, actorId, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO onboarding_requirement_templates
       (organisation_id, code, title, summary, instructions, section, classification,
        handler, actor, requires_employer_verification, form_key, credential_type,
        document_id, learning_workflow_id, external_url, compliance_requirement_id,
        applicability, config, default_mandatory, default_blocks_activation,
        default_due_offset_days, expiry_rule, sensitivity, sort_hint, is_system,
        created_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,NOW())
     ON CONFLICT (organisation_id, code) DO UPDATE SET
       title = EXCLUDED.title, summary = EXCLUDED.summary,
       instructions = EXCLUDED.instructions, section = EXCLUDED.section,
       classification = EXCLUDED.classification, handler = EXCLUDED.handler,
       actor = EXCLUDED.actor,
       requires_employer_verification = EXCLUDED.requires_employer_verification,
       form_key = EXCLUDED.form_key, credential_type = EXCLUDED.credential_type,
       document_id = COALESCE(EXCLUDED.document_id, onboarding_requirement_templates.document_id),
       learning_workflow_id = COALESCE(EXCLUDED.learning_workflow_id,
                                       onboarding_requirement_templates.learning_workflow_id),
       external_url = EXCLUDED.external_url,
       compliance_requirement_id = COALESCE(EXCLUDED.compliance_requirement_id,
                                            onboarding_requirement_templates.compliance_requirement_id),
       applicability = EXCLUDED.applicability, config = EXCLUDED.config,
       default_mandatory = EXCLUDED.default_mandatory,
       default_blocks_activation = EXCLUDED.default_blocks_activation,
       default_due_offset_days = EXCLUDED.default_due_offset_days,
       expiry_rule = EXCLUDED.expiry_rule, sensitivity = EXCLUDED.sensitivity,
       sort_hint = EXCLUDED.sort_hint,
       -- Editing a template bumps its version so issued snapshots stay
       -- distinguishable from what the library says today.
       version = onboarding_requirement_templates.version + 1,
       updated_at = NOW()
     RETURNING *`,
    [
      orgId, str(data.code, 80), str(data.title, 250), str(data.summary, 2000),
      data.instructions || null, data.section, data.classification, data.handler,
      data.actor || 'employee', data.requiresEmployerVerification === true,
      str(data.formKey, 40), str(data.credentialType, 60),
      data.documentId || null, data.learningWorkflowId || null, str(data.externalUrl, 2000),
      data.complianceRequirementId || null,
      JSON.stringify(data.applicability || {}), JSON.stringify(data.config || {}),
      data.mandatory !== false, data.blocksActivation === true,
      data.dueOffsetDays ?? null, JSON.stringify(data.expiryRule || {}),
      data.sensitivity || 'standard', Number(data.sortHint || 0), data.isSystem === true,
      actorId || null,
    ]
  );
  return rows[0];
}

// ═════════════════════════════════════════════════════════════════════════════
//  PACKAGES
// ═════════════════════════════════════════════════════════════════════════════

async function listPackages(orgId, { kind, status } = {}, q = pool) {
  const params = [orgId];
  let where = 'p.organisation_id IS NOT DISTINCT FROM $1';
  if (kind) { params.push(kind); where += ` AND p.kind = $${params.length}`; }
  if (status) { params.push(status); where += ` AND p.status = $${params.length}`; }
  const { rows } = await q.query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM onboarding_package_requirements r WHERE r.package_id = p.id)
              AS own_requirement_count,
            (SELECT COUNT(*) FROM onboarding_assignments a WHERE a.package_id = p.id)
              AS assignment_count
       FROM onboarding_packages p
      WHERE ${where}
      ORDER BY p.kind DESC, p.title`, params
  );
  return rows;
}

async function getPackage(orgId, id, q = pool) {
  if (!isUuid(id)) return null;
  const { rows } = await q.query(
    `SELECT * FROM onboarding_packages
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 LIMIT 1`, [id, orgId]
  );
  return rows[0] || null;
}

async function getPackageByCode(orgId, code, q = pool) {
  const { rows } = await q.query(
    `SELECT * FROM onboarding_packages
      WHERE code = $1 AND organisation_id IS NOT DISTINCT FROM $2 LIMIT 1`, [code, orgId]
  );
  return rows[0] || null;
}

/** A package's OWN composition rows, joined to their templates. */
async function getPackageComposition(packageId, q = pool) {
  const { rows } = await q.query(
    `SELECT r.*, t.code AS template_code, t.title, t.summary, t.instructions, t.section,
            t.classification, t.handler, t.actor, t.requires_employer_verification,
            t.form_key, t.credential_type, t.document_id, t.learning_workflow_id,
            t.external_url, t.compliance_requirement_id, t.applicability, t.config,
            t.default_mandatory, t.default_blocks_activation, t.default_due_offset_days,
            t.expiry_rule, t.sensitivity, t.version AS template_version, t.sort_hint,
            t.status AS template_status
       FROM onboarding_package_requirements r
       JOIN onboarding_requirement_templates t ON t.id = r.template_id
      WHERE r.package_id = $1
      ORDER BY r.sort_order, t.sort_hint`, [packageId]
  );
  return rows;
}

/**
 * Resolve a package's full requirement list, following its inheritance chain.
 * Pure resolution lives in onboarding-engine; this supplies the data.
 */
async function resolvePackage(orgId, pkg, q = pool) {
  const cache = new Map();

  const { rows: allPackages } = await q.query(
    `SELECT * FROM onboarding_packages WHERE organisation_id IS NOT DISTINCT FROM $1`, [orgId]
  );
  const byCode = new Map(allPackages.map((p) => [p.code, p]));

  // Pre-load composition for every package in the chain, breadth-first, so the
  // synchronous resolver in the engine has everything it needs.
  const needed = new Set([pkg.code]);
  const queue = [...(Array.isArray(pkg.extends_codes) ? pkg.extends_codes : [])];
  let guard = 0;
  while (queue.length && guard < 64) {
    guard += 1;
    const code = String(queue.shift());
    if (needed.has(code)) continue;
    needed.add(code);
    const parent = byCode.get(code);
    if (parent && Array.isArray(parent.extends_codes)) queue.push(...parent.extends_codes);
  }
  for (const code of needed) {
    const p = byCode.get(code);
    if (!p) continue;
    cache.set(code, { package: p, requirements: await getPackageComposition(p.id, q) });
  }

  const ownRows = cache.get(pkg.code)?.requirements || await getPackageComposition(pkg.id, q);
  return engine.resolveComposition(pkg, ownRows, (code) => cache.get(code) || null);
}

/**
 * Build the immutable snapshot content for a package version.
 * Every referenced document version and compliance record is copied in.
 */
async function buildPackageVersionContent(orgId, pkg, q = pool) {
  const { rows, chain, warnings } = await resolvePackage(orgId, pkg, q);
  const requirements = [];

  for (const row of rows) {
    if (row.template_status === 'archived') continue;

    let extras = {};
    if (row.document_id) {
      const version = await getCurrentDocumentVersion(row.document_id, q);
      const doc = (await q.query(
        'SELECT code, title, content_status, official_source_url FROM onboarding_documents WHERE id = $1',
        [row.document_id]
      )).rows[0];
      extras = {
        documentVersionId: version?.id || null,
        documentVersion: version?.version || null,
        documentCode: doc?.code || null,
      };
      if (doc) {
        extras.document = {
          code: doc.code, title: doc.title,
          contentStatus: doc.content_status,
          officialSourceUrl: doc.official_source_url,
          sourceVersionLabel: version?.source_version_label || null,
        };
      }
    }
    if (row.compliance_requirement_id) {
      const c = (await q.query(
        `SELECT code, title, basis, jurisdiction, source_org, source_url,
                source_version_label, applies_to, recurrence, delivery_rules
           FROM compliance_requirements WHERE id = $1`, [row.compliance_requirement_id]
      )).rows[0];
      if (c) {
        extras.compliance = {
          code: c.code, title: c.title, basis: c.basis, jurisdiction: c.jurisdiction,
          sourceOrg: c.source_org, sourceUrl: c.source_url,
          sourceVersionLabel: c.source_version_label, appliesTo: c.applies_to,
          recurrence: c.recurrence, deliveryRules: c.delivery_rules,
        };
      }
    }

    const template = {
      id: row.template_id, code: row.template_code, version: row.template_version,
      title: row.title, summary: row.summary, instructions: row.instructions,
      section: row.section, classification: row.classification, handler: row.handler,
      actor: row.actor, requires_employer_verification: row.requires_employer_verification,
      sensitivity: row.sensitivity, form_key: row.form_key,
      credential_type: row.credential_type, document_id: row.document_id,
      learning_workflow_id: row.learning_workflow_id, external_url: row.external_url,
      compliance_requirement_id: row.compliance_requirement_id,
      applicability: row.applicability, config: row.config,
      default_mandatory: row.default_mandatory,
      default_blocks_activation: row.default_blocks_activation,
      default_due_offset_days: row.default_due_offset_days,
      expiry_rule: row.expiry_rule, sort_hint: row.sort_hint,
    };
    requirements.push(engine.snapshotRequirement(row, template, extras));
  }

  return {
    content: {
      requirements,
      chain,
      resolvedAt: new Date().toISOString(),
      warnings,
    },
    warnings,
  };
}

/** Publish the current draft as the next immutable version. */
async function publishPackage(orgId, pkg, actorId, changeNote, q = pool) {
  const { content } = await buildPackageVersionContent(orgId, pkg, q);
  const version = Number(pkg.current_version || 0) + 1;

  await q.query(
    `UPDATE onboarding_package_versions SET status = 'superseded', superseded_at = NOW()
      WHERE package_id = $1 AND status = 'published'`, [pkg.id]
  );
  const { rows } = await q.query(
    `INSERT INTO onboarding_package_versions
       (package_id, version, title, description, role_category, employment_type,
        content, requirement_count, change_note, published_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      pkg.id, version, pkg.title, pkg.description, pkg.role_category, pkg.employment_type,
      JSON.stringify(content), content.requirements.length, str(changeNote, 1000),
      actorId || null,
    ]
  );
  await q.query(
    `UPDATE onboarding_packages
        SET current_version = $2, status = 'published', draft_dirty = FALSE, updated_at = NOW()
      WHERE id = $1`, [pkg.id, version]
  );
  return rows[0];
}

async function getPackageVersion(id, q = pool) {
  if (!isUuid(id)) return null;
  const { rows } = await q.query(
    'SELECT * FROM onboarding_package_versions WHERE id = $1 LIMIT 1', [id]
  );
  return rows[0] || null;
}

async function getCurrentPackageVersion(packageId, q = pool) {
  const { rows } = await q.query(
    `SELECT v.* FROM onboarding_package_versions v
       JOIN onboarding_packages p ON p.id = v.package_id
      WHERE v.package_id = $1 AND v.version = p.current_version LIMIT 1`, [packageId]
  );
  return rows[0] || null;
}

async function markPackageDirty(packageId, q = pool) {
  await q.query(
    'UPDATE onboarding_packages SET draft_dirty = TRUE, updated_at = NOW() WHERE id = $1',
    [packageId]
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  ASSIGNMENTS AND REQUIREMENTS
// ═════════════════════════════════════════════════════════════════════════════

const ASSIGNMENT_SELECT = `
  SELECT a.*, p.code AS package_code, p.title AS package_title,
         v.version AS package_version, v.title AS package_version_title,
         u.name AS user_name, u.email AS user_email, u.role AS user_role,
         m.name AS manager_name, cb.name AS created_by_name
    FROM onboarding_assignments a
    JOIN onboarding_packages p ON p.id = a.package_id
    JOIN onboarding_package_versions v ON v.id = a.package_version_id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN users m ON m.id = a.manager_user_id
    LEFT JOIN users cb ON cb.id = a.created_by`;

async function listAssignments(orgId, filters = {}, q = pool) {
  const params = [orgId];
  let where = 'a.organisation_id IS NOT DISTINCT FROM $1';

  if (filters.status) {
    params.push(filters.status); where += ` AND a.status = $${params.length}`;
  }
  if (filters.active) {
    where += " AND a.status NOT IN ('activated','completed','cancelled','archived')";
  }
  if (filters.packageId && isUuid(filters.packageId)) {
    params.push(filters.packageId); where += ` AND a.package_id = $${params.length}`;
  }
  if (filters.employmentType) {
    params.push(filters.employmentType); where += ` AND a.employment_type = $${params.length}`;
  }
  if (filters.roleCategory) {
    params.push(filters.roleCategory); where += ` AND a.role_category = $${params.length}`;
  }
  if (filters.assignedBy && isUuid(filters.assignedBy)) {
    params.push(filters.assignedBy); where += ` AND a.created_by = $${params.length}`;
  }
  if (filters.search) {
    params.push(`%${String(filters.search).slice(0, 80)}%`);
    where += ` AND (a.applicant_name ILIKE $${params.length} OR a.applicant_email ILIKE $${params.length})`;
  }
  const { rows } = await q.query(
    `${ASSIGNMENT_SELECT} WHERE ${where} ORDER BY a.created_at DESC LIMIT 500`, params
  );
  return rows;
}

async function getAssignment(orgId, id, q = pool) {
  if (!isUuid(id)) return null;
  const { rows } = await q.query(
    `${ASSIGNMENT_SELECT} WHERE a.id = $1 AND a.organisation_id IS NOT DISTINCT FROM $2 LIMIT 1`,
    [id, orgId]
  );
  return rows[0] || null;
}

/** The requesting user's OWN active assignment. Strictly user-scoped. */
async function getMyAssignment(userId, q = pool) {
  const { rows } = await q.query(
    `${ASSIGNMENT_SELECT}
      WHERE a.user_id = $1 AND a.status NOT IN ('cancelled','archived')
      ORDER BY a.created_at DESC LIMIT 1`, [userId]
  );
  return rows[0] || null;
}

async function listRequirements(assignmentId, q = pool) {
  const { rows } = await q.query(
    `SELECT r.*, d.title AS evidence_document_title, d.file_name AS evidence_file_name,
            c.credential_name, c.registration_number, c.expiry_date AS credential_expiry,
            c.lifecycle_status AS credential_lifecycle_status,
            c.status AS credential_status,
            la.status AS learning_status, la.progress_percent AS learning_progress,
            rv.name AS reviewed_by_name
       FROM onboarding_requirements r
       LEFT JOIN pd_documents d ON d.id = r.document_id
       LEFT JOIN credentials c ON c.id = r.credential_id
       LEFT JOIN learning_assignments la ON la.id = r.learning_assignment_id
       LEFT JOIN users rv ON rv.id = r.reviewed_by
      WHERE r.assignment_id = $1
      ORDER BY r.section, r.sort_order, r.title`, [assignmentId]
  );
  return rows;
}

async function getRequirement(assignmentId, requirementId, q = pool) {
  if (!isUuid(requirementId)) return null;
  const { rows } = await q.query(
    'SELECT * FROM onboarding_requirements WHERE id = $1 AND assignment_id = $2 LIMIT 1',
    [requirementId, assignmentId]
  );
  return rows[0] || null;
}

/** Recompute both meters and the derived assignment status, atomically. */
async function recomputeAssignment(client, assignmentId) {
  const { rows: reqs } = await client.query(
    `SELECT id, status, actor, requires_employer_verification, blocks_activation, waived,
            template_code, title, section
       FROM onboarding_requirements WHERE assignment_id = $1`, [assignmentId]
  );
  const progress = engine.computeProgress(reqs);

  const { rows: aRows } = await client.query(
    `SELECT status, invite_accepted_at, submitted_at
       FROM onboarding_assignments WHERE id = $1`, [assignmentId]
  );
  const current = aRows[0]?.status || 'created';
  const next = engine.deriveAssignmentStatus(current, progress, {
    inviteAccepted: !!aRows[0]?.invite_accepted_at,
    // Handing the pack over is the employee's own act; the run does not
    // advance into employer review until they make it.
    submitted: !!aRows[0]?.submitted_at,
  });

  // $8 is cast explicitly: without it Postgres deduces varchar from the
  // `status = $8` assignment and text from the `IN (…)` comparison, and
  // refuses the statement with "inconsistent types deduced for parameter $8".
  const { rows } = await client.query(
    `UPDATE onboarding_assignments
        SET employee_total = $2, employee_done = $3,
            employer_total = $4, employer_done = $5,
            blocking_total = $6, blocking_done = $7,
            status = $8::text, last_activity_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [
      assignmentId, progress.employeeTotal, progress.employeeDone,
      progress.employerTotal, progress.employerDone,
      progress.blockingTotal, progress.blockingDone, next,
    ]
  );
  return { assignment: rows[0], progress, requirements: reqs };
}

// ═════════════════════════════════════════════════════════════════════════════
//  EMPLOYEE DATA — the four permission tiers
// ═════════════════════════════════════════════════════════════════════════════

async function upsertEmploymentProfile(userId, orgId, data, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO employment_profiles
       (user_id, organisation_id, assignment_id, job_title, employment_type, role_category,
        start_date, end_date, probation_end_date, hours_per_week, award_classification,
        manager_user_id, work_location, child_related_work, child_related_work_reason,
        ndis_risk_assessed_role, ndis_risk_reason, mobile_community_role, uses_own_vehicle,
        determined_by, determined_at, status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       assignment_id = COALESCE(EXCLUDED.assignment_id, employment_profiles.assignment_id),
       job_title = COALESCE(EXCLUDED.job_title, employment_profiles.job_title),
       employment_type = COALESCE(EXCLUDED.employment_type, employment_profiles.employment_type),
       role_category = COALESCE(EXCLUDED.role_category, employment_profiles.role_category),
       start_date = COALESCE(EXCLUDED.start_date, employment_profiles.start_date),
       end_date = COALESCE(EXCLUDED.end_date, employment_profiles.end_date),
       probation_end_date = COALESCE(EXCLUDED.probation_end_date, employment_profiles.probation_end_date),
       hours_per_week = COALESCE(EXCLUDED.hours_per_week, employment_profiles.hours_per_week),
       award_classification = COALESCE(EXCLUDED.award_classification, employment_profiles.award_classification),
       manager_user_id = COALESCE(EXCLUDED.manager_user_id, employment_profiles.manager_user_id),
       work_location = COALESCE(EXCLUDED.work_location, employment_profiles.work_location),
       child_related_work = EXCLUDED.child_related_work,
       child_related_work_reason = COALESCE(EXCLUDED.child_related_work_reason,
                                            employment_profiles.child_related_work_reason),
       ndis_risk_assessed_role = EXCLUDED.ndis_risk_assessed_role,
       ndis_risk_reason = COALESCE(EXCLUDED.ndis_risk_reason, employment_profiles.ndis_risk_reason),
       mobile_community_role = EXCLUDED.mobile_community_role,
       uses_own_vehicle = EXCLUDED.uses_own_vehicle,
       determined_by = COALESCE(EXCLUDED.determined_by, employment_profiles.determined_by),
       determined_at = COALESCE(EXCLUDED.determined_at, employment_profiles.determined_at),
       status = EXCLUDED.status, updated_at = NOW()
     RETURNING *`,
    [
      userId, orgId, data.assignmentId || null, str(data.jobTitle, 150),
      data.employmentType || null, str(data.roleCategory, 40),
      dateOrNull(data.startDate), dateOrNull(data.endDate), dateOrNull(data.probationEndDate),
      data.hoursPerWeek ?? null, str(data.awardClassification, 150),
      data.managerUserId || null, str(data.workLocation, 150),
      data.childRelatedWork || 'assessment_required', str(data.childRelatedWorkReason, 1000),
      data.ndisRiskAssessedRole || 'requires_determination', str(data.ndisRiskReason, 1000),
      data.mobileCommunityRole === true, data.usesOwnVehicle === true,
      data.determinedBy || null, dateOrNull(data.determinedAt),
      data.status || 'onboarding',
    ]
  );
  return rows[0];
}

async function getEmploymentProfile(userId, q = pool) {
  const { rows } = await q.query('SELECT * FROM employment_profiles WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

async function upsertPersonalDetails(userId, orgId, data, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO employee_personal_details
       (user_id, organisation_id, assignment_id, legal_first_name, middle_name, surname,
        preferred_name, date_of_birth, personal_email, mobile, address_line1, address_line2,
        suburb, state, postcode, country, postal_same_as_residential, postal_line1,
        postal_line2, postal_suburb, postal_state, postal_postcode, emergency_name,
        emergency_relationship, emergency_phone, emergency_alt_phone, completed_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
             $23,$24,$25,$26,$27,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       assignment_id = COALESCE(EXCLUDED.assignment_id, employee_personal_details.assignment_id),
       legal_first_name = COALESCE(EXCLUDED.legal_first_name, employee_personal_details.legal_first_name),
       middle_name = EXCLUDED.middle_name,
       surname = COALESCE(EXCLUDED.surname, employee_personal_details.surname),
       preferred_name = EXCLUDED.preferred_name,
       date_of_birth = COALESCE(EXCLUDED.date_of_birth, employee_personal_details.date_of_birth),
       personal_email = COALESCE(EXCLUDED.personal_email, employee_personal_details.personal_email),
       mobile = COALESCE(EXCLUDED.mobile, employee_personal_details.mobile),
       address_line1 = COALESCE(EXCLUDED.address_line1, employee_personal_details.address_line1),
       address_line2 = EXCLUDED.address_line2,
       suburb = COALESCE(EXCLUDED.suburb, employee_personal_details.suburb),
       state = COALESCE(EXCLUDED.state, employee_personal_details.state),
       postcode = COALESCE(EXCLUDED.postcode, employee_personal_details.postcode),
       country = COALESCE(EXCLUDED.country, employee_personal_details.country),
       postal_same_as_residential = EXCLUDED.postal_same_as_residential,
       postal_line1 = EXCLUDED.postal_line1, postal_line2 = EXCLUDED.postal_line2,
       postal_suburb = EXCLUDED.postal_suburb, postal_state = EXCLUDED.postal_state,
       postal_postcode = EXCLUDED.postal_postcode,
       emergency_name = COALESCE(EXCLUDED.emergency_name, employee_personal_details.emergency_name),
       emergency_relationship = COALESCE(EXCLUDED.emergency_relationship,
                                         employee_personal_details.emergency_relationship),
       emergency_phone = COALESCE(EXCLUDED.emergency_phone, employee_personal_details.emergency_phone),
       emergency_alt_phone = EXCLUDED.emergency_alt_phone,
       completed_at = COALESCE(EXCLUDED.completed_at, employee_personal_details.completed_at),
       updated_at = NOW()
     RETURNING *`,
    [
      userId, orgId, data.assignmentId || null,
      str(data.legalFirstName, 100), str(data.middleName, 100), str(data.surname, 100),
      str(data.preferredName, 100), dateOrNull(data.dateOfBirth),
      str(data.personalEmail, 255), str(data.mobile, 40),
      str(data.addressLine1, 200), str(data.addressLine2, 200), str(data.suburb, 100),
      str(data.state, 10), str(data.postcode, 10), str(data.country, 60) || 'Australia',
      data.postalSameAsResidential !== false,
      str(data.postalLine1, 200), str(data.postalLine2, 200), str(data.postalSuburb, 100),
      str(data.postalState, 10), str(data.postalPostcode, 10),
      str(data.emergencyName, 150), str(data.emergencyRelationship, 80),
      str(data.emergencyPhone, 40), str(data.emergencyAltPhone, 40),
      data.completedAt ? dateOrNull(data.completedAt) : new Date(),
    ]
  );
  return rows[0];
}

async function getPersonalDetails(userId, q = pool) {
  const { rows } = await q.query(
    'SELECT * FROM employee_personal_details WHERE user_id = $1', [userId]
  );
  return rows[0] || null;
}

// ── Payroll: the only place bank/TFN values are written or read ─────────────

/**
 * Write bank details. Values are encrypted; the masked forms are what every
 * response afterwards is allowed to show.
 *
 * Throws ENCRYPTION_UNAVAILABLE rather than storing plaintext — a route turns
 * that into a 503 saying encryption is not configured. Refusing is the right
 * failure: an unencrypted account number cannot be un-stored.
 */
async function savePayrollBank(userId, orgId, data, actorId, q = pool) {
  const bsb = engine.digitsOnly(data.bsb);
  const acct = engine.digitsOnly(data.accountNumber);

  const { rows } = await q.query(
    `INSERT INTO payroll_profiles
       (user_id, organisation_id, assignment_id, account_holder_name,
        bsb_encrypted, bsb_masked, account_number_encrypted, account_number_last4,
        bank_status, bank_updated_at, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'provided',NOW(),$9,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       assignment_id = COALESCE(EXCLUDED.assignment_id, payroll_profiles.assignment_id),
       account_holder_name = EXCLUDED.account_holder_name,
       bsb_encrypted = EXCLUDED.bsb_encrypted, bsb_masked = EXCLUDED.bsb_masked,
       account_number_encrypted = EXCLUDED.account_number_encrypted,
       account_number_last4 = EXCLUDED.account_number_last4,
       bank_status = 'provided', bank_updated_at = NOW(),
       updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING user_id, bank_status, bsb_masked, account_number_last4, account_holder_name`,
    [
      userId, orgId, data.assignmentId || null, str(data.accountHolderName, 200),
      encryptField(bsb), engine.maskBsb(bsb),
      encryptField(acct), engine.lastN(acct, 4),
      actorId || null,
    ]
  );
  return rows[0];
}

async function savePayrollTax(userId, orgId, data, actorId, q = pool) {
  const tfn = data.tfn ? engine.digitsOnly(data.tfn) : null;
  const { rows } = await q.query(
    `INSERT INTO payroll_profiles
       (user_id, organisation_id, assignment_id, tax_setup_status, tax_submission_method,
        residency_status, tfn_encrypted, tfn_last3, tfn_provided, tfn_exemption_reason,
        claims_tax_free_threshold, has_study_loan, tax_summary_document_id,
        tax_updated_at, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),$14,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       assignment_id = COALESCE(EXCLUDED.assignment_id, payroll_profiles.assignment_id),
       tax_setup_status = EXCLUDED.tax_setup_status,
       tax_submission_method = EXCLUDED.tax_submission_method,
       residency_status = EXCLUDED.residency_status,
       tfn_encrypted = COALESCE(EXCLUDED.tfn_encrypted, payroll_profiles.tfn_encrypted),
       tfn_last3 = COALESCE(EXCLUDED.tfn_last3, payroll_profiles.tfn_last3),
       tfn_provided = EXCLUDED.tfn_provided OR payroll_profiles.tfn_provided,
       tfn_exemption_reason = EXCLUDED.tfn_exemption_reason,
       claims_tax_free_threshold = EXCLUDED.claims_tax_free_threshold,
       has_study_loan = EXCLUDED.has_study_loan,
       tax_summary_document_id = COALESCE(EXCLUDED.tax_summary_document_id,
                                          payroll_profiles.tax_summary_document_id),
       tax_updated_at = NOW(), updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING user_id, tax_setup_status, tax_submission_method, residency_status,
               tfn_last3, tfn_provided, tfn_exemption_reason,
               claims_tax_free_threshold, has_study_loan`,
    [
      userId, orgId, data.assignmentId || null,
      data.taxSetupStatus || 'employee_completed', data.taxSubmissionMethod || null,
      data.residencyStatus || null,
      tfn ? encryptField(tfn) : null, tfn ? engine.lastN(tfn, 3) : null,
      !!tfn, str(data.tfnExemptionReason, 200),
      bool(data.claimsTaxFreeThreshold), bool(data.hasStudyLoan),
      data.taxSummaryDocumentId || null, actorId || null,
    ]
  );
  return rows[0];
}

async function savePayrollSuper(userId, orgId, data, actorId, q = pool) {
  const smsfBsb = data.smsfBankBsb ? engine.digitsOnly(data.smsfBankBsb) : null;
  const smsfAcct = data.smsfBankAccount ? engine.digitsOnly(data.smsfBankAccount) : null;
  const { rows } = await q.query(
    `INSERT INTO payroll_profiles
       (user_id, organisation_id, assignment_id, super_status, super_choice_type,
        super_fund_name, super_fund_abn, super_fund_usi, super_member_number,
        super_account_name, smsf_esa, smsf_bank_account_name,
        smsf_bank_bsb_encrypted, smsf_bank_bsb_masked,
        smsf_bank_account_encrypted, smsf_bank_account_last4,
        super_evidence_document_id, super_updated_at, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),$18,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       assignment_id = COALESCE(EXCLUDED.assignment_id, payroll_profiles.assignment_id),
       super_status = EXCLUDED.super_status, super_choice_type = EXCLUDED.super_choice_type,
       super_fund_name = EXCLUDED.super_fund_name, super_fund_abn = EXCLUDED.super_fund_abn,
       super_fund_usi = EXCLUDED.super_fund_usi, super_member_number = EXCLUDED.super_member_number,
       super_account_name = EXCLUDED.super_account_name, smsf_esa = EXCLUDED.smsf_esa,
       smsf_bank_account_name = EXCLUDED.smsf_bank_account_name,
       smsf_bank_bsb_encrypted = EXCLUDED.smsf_bank_bsb_encrypted,
       smsf_bank_bsb_masked = EXCLUDED.smsf_bank_bsb_masked,
       smsf_bank_account_encrypted = EXCLUDED.smsf_bank_account_encrypted,
       smsf_bank_account_last4 = EXCLUDED.smsf_bank_account_last4,
       super_evidence_document_id = COALESCE(EXCLUDED.super_evidence_document_id,
                                             payroll_profiles.super_evidence_document_id),
       super_updated_at = NOW(), updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING user_id, super_status, super_choice_type, super_fund_name, super_fund_abn,
               super_fund_usi, super_member_number, super_account_name, smsf_esa,
               smsf_bank_account_name, smsf_bank_bsb_masked, smsf_bank_account_last4`,
    [
      userId, orgId, data.assignmentId || null,
      data.superStatus || 'employee_nominated', data.superChoiceType || null,
      str(data.superFundName, 200), str(data.superFundAbn, 20), str(data.superFundUsi, 40),
      str(data.superMemberNumber, 60), str(data.superAccountName, 200),
      str(data.smsfEsa, 80), str(data.smsfBankAccountName, 200),
      smsfBsb ? encryptField(smsfBsb) : null, smsfBsb ? engine.maskBsb(smsfBsb) : null,
      smsfAcct ? encryptField(smsfAcct) : null, smsfAcct ? engine.lastN(smsfAcct, 4) : null,
      data.superEvidenceDocumentId || null, actorId || null,
    ]
  );
  return rows[0];
}

/**
 * Read the payroll profile in its ONLY renderable form.
 *
 * The encrypted columns are not selected at all. There is deliberately no
 * "reveal" helper: nothing in the portal has a legitimate reason to display a
 * full TFN or account number, and the ATO/OAIC rules on both point the same way.
 * Payroll export (a separate, audited path) is the only consumer of plaintext,
 * and it calls decryptPayrollForExport below.
 */
async function getPayrollProfileMasked(userId, q = pool) {
  const { rows } = await q.query(
    `SELECT user_id, organisation_id, assignment_id, account_holder_name,
            bsb_masked, account_number_last4, bank_status, bank_updated_at,
            tax_setup_status, tax_submission_method, residency_status,
            tfn_last3, tfn_provided, tfn_exemption_reason,
            claims_tax_free_threshold, has_study_loan, tax_updated_at,
            tax_summary_document_id,
            super_status, super_choice_type, super_fund_name, super_fund_abn,
            super_fund_usi, super_member_number, super_account_name, smsf_esa,
            smsf_bank_account_name, smsf_bank_bsb_masked, smsf_bank_account_last4,
            super_evidence_document_id, stapled_requested_at, stapled_confirmed_at,
            super_updated_at, payroll_setup_status, payroll_system, payroll_employee_ref,
            payroll_setup_at, created_at, updated_at
       FROM payroll_profiles WHERE user_id = $1`, [userId]
  );
  return rows[0] || null;
}

/**
 * The API shape for a payroll profile.
 *
 * Deliberately an explicit allowlist rather than a snake→camel mapper: adding
 * a column to payroll_profiles must never silently start returning it. Every
 * value here is either non-sensitive or already masked.
 */
function payrollView(p) {
  if (!p) return null;
  return {
    userId: p.user_id,
    assignmentId: p.assignment_id,
    // Bank — masked only. The encrypted columns are not even selected.
    accountHolderName: p.account_holder_name,
    bsbMasked: p.bsb_masked,
    accountNumberLast4: p.account_number_last4,
    bankStatus: p.bank_status,
    bankUpdatedAt: p.bank_updated_at,
    // Tax — the last three digits of a TFN are the most that may ever be shown.
    taxSetupStatus: p.tax_setup_status,
    taxSubmissionMethod: p.tax_submission_method,
    residencyStatus: p.residency_status,
    tfnLast3: p.tfn_last3,
    tfnProvided: p.tfn_provided,
    tfnExemptionReason: p.tfn_exemption_reason,
    claimsTaxFreeThreshold: p.claims_tax_free_threshold,
    hasStudyLoan: p.has_study_loan,
    taxSummaryDocumentId: p.tax_summary_document_id,
    taxUpdatedAt: p.tax_updated_at,
    // Super — fund identifiers are ordinary business data; the SMSF bank
    // account is the only sensitive part and is masked.
    superStatus: p.super_status,
    superChoiceType: p.super_choice_type,
    superFundName: p.super_fund_name,
    superFundAbn: p.super_fund_abn,
    superFundUsi: p.super_fund_usi,
    superMemberNumber: p.super_member_number,
    superAccountName: p.super_account_name,
    smsfEsa: p.smsf_esa,
    smsfBankAccountName: p.smsf_bank_account_name,
    smsfBankBsbMasked: p.smsf_bank_bsb_masked,
    smsfBankAccountLast4: p.smsf_bank_account_last4,
    superEvidenceDocumentId: p.super_evidence_document_id,
    stapledRequestedAt: p.stapled_requested_at,
    stapledConfirmedAt: p.stapled_confirmed_at,
    superUpdatedAt: p.super_updated_at,
    // Payroll handoff
    payrollSetupStatus: p.payroll_setup_status,
    payrollSystem: p.payroll_system,
    payrollEmployeeRef: p.payroll_employee_ref,
    payrollSetupAt: p.payroll_setup_at,
    updatedAt: p.updated_at,
  };
}

/**
 * Decrypt payroll values for a payroll handoff. AUDITED AT EVERY CALL SITE.
 * Never call this to render a screen.
 */
async function decryptPayrollForExport(userId, q = pool) {
  const { rows } = await q.query(
    `SELECT account_holder_name, bsb_encrypted, account_number_encrypted,
            tfn_encrypted, residency_status, claims_tax_free_threshold, has_study_loan,
            super_choice_type, super_fund_name, super_fund_abn, super_fund_usi,
            super_member_number, super_account_name, smsf_esa, smsf_bank_account_name,
            smsf_bank_bsb_encrypted, smsf_bank_account_encrypted
       FROM payroll_profiles WHERE user_id = $1`, [userId]
  );
  const p = rows[0];
  if (!p) return null;
  return {
    accountHolderName: p.account_holder_name,
    bsb: decryptField(p.bsb_encrypted),
    accountNumber: decryptField(p.account_number_encrypted),
    tfn: decryptField(p.tfn_encrypted),
    residencyStatus: p.residency_status,
    claimsTaxFreeThreshold: p.claims_tax_free_threshold,
    hasStudyLoan: p.has_study_loan,
    superChoiceType: p.super_choice_type,
    superFundName: p.super_fund_name,
    superFundAbn: p.super_fund_abn,
    superFundUsi: p.super_fund_usi,
    superMemberNumber: p.super_member_number,
    superAccountName: p.super_account_name,
    smsfEsa: p.smsf_esa,
    smsfBankAccountName: p.smsf_bank_account_name,
    smsfBankBsb: decryptField(p.smsf_bank_bsb_encrypted),
    smsfBankAccount: decryptField(p.smsf_bank_account_encrypted),
  };
}

async function setPayrollStatus(userId, patch, actorId, q = pool) {
  const sets = [];
  const params = [userId];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.bankStatus) add('bank_status', patch.bankStatus);
  if (patch.taxSetupStatus) add('tax_setup_status', patch.taxSetupStatus);
  if (patch.superStatus) add('super_status', patch.superStatus);
  if (patch.payrollSetupStatus) add('payroll_setup_status', patch.payrollSetupStatus);
  if (patch.payrollSystem !== undefined) add('payroll_system', str(patch.payrollSystem, 40));
  if (patch.payrollEmployeeRef !== undefined) add('payroll_employee_ref', str(patch.payrollEmployeeRef, 120));
  if (patch.stapledRequestedAt) add('stapled_requested_at', dateOrNull(patch.stapledRequestedAt));
  if (patch.stapledConfirmedAt) add('stapled_confirmed_at', dateOrNull(patch.stapledConfirmedAt));
  if (patch.stapledConfirmedBy) add('stapled_confirmed_by', patch.stapledConfirmedBy);
  if (patch.payrollSetupAt) add('payroll_setup_at', dateOrNull(patch.payrollSetupAt));
  if (!sets.length) return null;
  params.push(actorId || null);
  sets.push(`updated_by = $${params.length}`);
  const { rows } = await q.query(
    `UPDATE payroll_profiles SET ${sets.join(', ')}, updated_at = NOW()
      WHERE user_id = $1 RETURNING user_id`, params
  );
  return rows[0] || null;
}

// ── Identity records ────────────────────────────────────────────────────────

async function saveIdentityRecord(userId, orgId, data, q = pool) {
  const num = data.documentNumber ? String(data.documentNumber).trim() : null;
  const { rows } = await q.query(
    `INSERT INTO employee_identity_records
       (user_id, organisation_id, assignment_id, requirement_id, record_kind, evidence_type,
        name_on_document, travel_document_type, document_number_encrypted,
        document_number_last4, country_of_issue, issue_date, expiry_date,
        sighted_by, sighted_at, document_id, copy_retained, retention_reason,
        right_to_work_basis, visa_subclass, work_conditions, work_rights_expiry,
        vevo_result_document_id, vevo_check_reference, next_recheck_due,
        verification_status, verification_method, verification_reference,
        verified_by, verified_at, notes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
             $23,$24,$25,$26,$27,$28,$29,$30,$31,NOW())
     RETURNING id, user_id, record_kind, evidence_type, name_on_document,
               travel_document_type, document_number_last4, country_of_issue,
               issue_date, expiry_date, sighted_by, sighted_at, copy_retained,
               retention_reason, right_to_work_basis, visa_subclass, work_conditions,
               work_rights_expiry, vevo_check_reference, next_recheck_due,
               verification_status, verification_method, verified_by, verified_at, notes`,
    [
      userId, orgId, data.assignmentId || null, data.requirementId || null,
      data.recordKind || 'identity', data.evidenceType,
      str(data.nameOnDocument, 200), str(data.travelDocumentType, 40),
      num ? encryptField(num) : null, num ? String(num).slice(-4) : null,
      str(data.countryOfIssue, 60), dateOrNull(data.issueDate), dateOrNull(data.expiryDate),
      data.sightedBy || null, dateOrNull(data.sightedAt),
      data.documentId || null, data.copyRetained === true, str(data.retentionReason, 500),
      data.rightToWorkBasis || null, str(data.visaSubclass, 20),
      str(data.workConditions, 500), dateOrNull(data.workRightsExpiry),
      data.vevoResultDocumentId || null, str(data.vevoCheckReference, 200),
      dateOrNull(data.nextRecheckDue),
      data.verificationStatus || 'not_verified', data.verificationMethod || null,
      str(data.verificationReference, 200), data.verifiedBy || null,
      dateOrNull(data.verifiedAt), str(data.notes, 1000),
    ]
  );
  return rows[0];
}

/** Identity records WITHOUT the encrypted columns. */
async function listIdentityRecordsMasked(userId, q = pool) {
  const { rows } = await q.query(
    `SELECT id, user_id, assignment_id, requirement_id, record_kind, evidence_type,
            name_on_document, travel_document_type, document_number_last4,
            country_of_issue, issue_date, expiry_date, sighted_by, sighted_at,
            document_id, copy_retained, retention_reason, right_to_work_basis,
            visa_subclass, work_conditions, work_rights_expiry,
            vevo_result_document_id, vevo_check_reference, next_recheck_due,
            verification_status, verification_method, verification_reference,
            verified_by, verified_at, notes, created_at, updated_at
       FROM employee_identity_records WHERE user_id = $1 ORDER BY created_at DESC`, [userId]
  );
  return rows;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CREDENTIALS  (reuses the existing table)
// ═════════════════════════════════════════════════════════════════════════════

async function upsertCredential(userId, orgId, data, q = pool) {
  if (data.id && isUuid(data.id)) {
    const { rows } = await q.query(
      `UPDATE credentials SET
         credential_name = COALESCE($3, credential_name),
         issuing_body = COALESCE($4, issuing_body),
         registration_number = COALESCE($5, registration_number),
         issue_date = COALESCE($6, issue_date),
         expiry_date = COALESCE($7, expiry_date),
         document_id = COALESCE($8, document_id),
         jurisdiction = COALESCE($9, jurisdiction),
         detail = COALESCE($10, detail),
         notes = COALESCE($11, notes),
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        data.id, userId, str(data.credentialName, 255), str(data.issuingBody, 255),
        str(data.registrationNumber, 100), dateOrNull(data.issueDate), dateOrNull(data.expiryDate),
        data.documentId || null, str(data.jurisdiction, 20),
        data.detail ? JSON.stringify(data.detail) : null, data.notes || null,
      ]
    );
    return rows[0] || null;
  }
  const { rows } = await q.query(
    `INSERT INTO credentials
       (user_id, organisation_id, credential_type, credential_name, issuing_body,
        registration_number, issue_date, expiry_date, document_id, status,
        jurisdiction, lifecycle_status, detail, source, onboarding_requirement_id,
        reminder_days, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'onboarding',$14,$15,$16)
     RETURNING *`,
    [
      userId, orgId, str(data.credentialType, 100), str(data.credentialName, 255),
      str(data.issuingBody, 255), str(data.registrationNumber, 100),
      dateOrNull(data.issueDate), dateOrNull(data.expiryDate), data.documentId || null,
      data.status || 'pending_review', str(data.jurisdiction, 20),
      data.lifecycleStatus || null, JSON.stringify(data.detail || {}),
      data.onboardingRequirementId || null,
      JSON.stringify(data.reminderDays || engine.DEFAULT_REMINDER_WINDOWS),
      data.notes || null,
    ]
  );
  return rows[0];
}

/**
 * Record a verification outcome against a credential.
 *
 * `lifecycleStatus` is what the ISSUING AUTHORITY says. Nothing in this
 * function can synthesise it: a waiver elsewhere may relax an Opal
 * requirement, but "excluded" can never be written here as "clearance".
 */
async function verifyCredential(credentialId, userId, data, verifierId, q = pool) {
  const { rows } = await q.query(
    `UPDATE credentials SET
       status = $3, lifecycle_status = COALESCE($4, lifecycle_status),
       verification_method = COALESCE($5, verification_method),
       verification_reference = COALESCE($6, verification_reference),
       expiry_date = COALESCE($7, expiry_date),
       detail = COALESCE($8, detail),
       notes = COALESCE($9, notes),
       verified_by_user_id = $10, verified_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [
      credentialId, userId, data.status || 'verified', data.lifecycleStatus || null,
      data.verificationMethod || null, str(data.verificationReference, 200),
      dateOrNull(data.expiryDate), data.detail ? JSON.stringify(data.detail) : null,
      data.notes || null, verifierId || null,
    ]
  );
  return rows[0] || null;
}

async function listCredentialsForUser(userId, q = pool) {
  const { rows } = await q.query(
    `SELECT c.*, v.name AS verified_by_name
       FROM credentials c LEFT JOIN users v ON v.id = c.verified_by_user_id
      WHERE c.user_id = $1 ORDER BY c.credential_type, c.created_at DESC`, [userId]
  );
  return rows;
}

// ═════════════════════════════════════════════════════════════════════════════
//  ACKNOWLEDGEMENTS AND STATEMENT ISSUANCES
// ═════════════════════════════════════════════════════════════════════════════

async function recordAcknowledgement(data, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO onboarding_acknowledgements
       (organisation_id, user_id, document_id, document_version_id, document_code,
        document_title, document_version, requirement_id, assignment_id,
        package_version_id, statement_sha256, typed_legal_name, viewed_at, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (user_id, document_version_id) DO UPDATE SET
       -- An acknowledgement is recorded ONCE. A repeat is a no-op that returns
       -- the original row: history must never be rewritten by a double-click.
       acknowledged_at = onboarding_acknowledgements.acknowledged_at
     RETURNING *`,
    [
      data.organisationId || null, data.userId, data.documentId, data.documentVersionId,
      str(data.documentCode, 80), str(data.documentTitle, 250), data.documentVersion,
      data.requirementId || null, data.assignmentId || null, data.packageVersionId || null,
      str(data.statementSha256, 64), str(data.typedLegalName, 200),
      dateOrNull(data.viewedAt), str(data.ipAddress, 50),
    ]
  );
  return rows[0];
}

async function listAcknowledgements(userId, q = pool) {
  const { rows } = await q.query(
    `SELECT * FROM onboarding_acknowledgements WHERE user_id = $1
      ORDER BY acknowledged_at DESC`, [userId]
  );
  return rows;
}

async function recordStatementIssuance(data, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO onboarding_statement_issuances
       (organisation_id, user_id, assignment_id, requirement_id, statement_code,
        source_version_label, file_sha256, document_version_id, trigger_kind,
        trigger_due_at, delivery_method, electronic_delivery_agreed, issued_by,
        acknowledged_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      data.organisationId || null, data.userId || null, data.assignmentId || null,
      data.requirementId || null, str(data.statementCode, 40),
      str(data.sourceVersionLabel, 120), str(data.fileSha256, 64),
      data.documentVersionId || null, data.triggerKind || 'commencement',
      dateOrNull(data.triggerDueAt), data.deliveryMethod || 'portal',
      bool(data.electronicDeliveryAgreed), data.issuedBy || null,
      dateOrNull(data.acknowledgedAt), str(data.notes, 1000),
    ]
  );
  return rows[0];
}

async function listStatementIssuances(userId, q = pool) {
  const { rows } = await q.query(
    `SELECT * FROM onboarding_statement_issuances WHERE user_id = $1
      ORDER BY issued_at DESC`, [userId]
  );
  return rows;
}

// ═════════════════════════════════════════════════════════════════════════════
//  ORGANISATION COMPLIANCE + EXPIRY
// ═════════════════════════════════════════════════════════════════════════════

async function listOrgCompliance(orgId, q = pool) {
  const { rows } = await q.query(
    `SELECT o.*, v.name AS verified_by_name
       FROM organisation_compliance_records o
       LEFT JOIN users v ON v.id = o.verified_by
      WHERE o.organisation_id IS NOT DISTINCT FROM $1
      ORDER BY o.record_type, o.title`, [orgId]
  );
  return rows;
}

async function upsertOrgCompliance(orgId, data, actorId, q = pool) {
  if (data.id && isUuid(data.id)) {
    const { rows } = await q.query(
      `UPDATE organisation_compliance_records SET
         title = COALESCE($3, title), provider = $4, policy_number = $5,
         coverage_amount_cents = $6, effective_date = $7, expiry_date = $8,
         document_id = COALESCE($9, document_id), status = COALESCE($10, status),
         reminder_days = COALESCE($11, reminder_days), notes = $12,
         verified_by = COALESCE($13, verified_by),
         verified_at = CASE WHEN $13 IS NOT NULL THEN NOW() ELSE verified_at END,
         updated_at = NOW()
       WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 RETURNING *`,
      [
        data.id, orgId, str(data.title, 200), str(data.provider, 200),
        str(data.policyNumber, 120), data.coverageAmountCents ?? null,
        dateOrNull(data.effectiveDate), dateOrNull(data.expiryDate),
        data.documentId || null, data.status || null,
        data.reminderDays ? JSON.stringify(data.reminderDays) : null,
        data.notes || null, data.verified ? actorId : null,
      ]
    );
    return rows[0] || null;
  }
  const { rows } = await q.query(
    `INSERT INTO organisation_compliance_records
       (organisation_id, record_type, title, provider, policy_number,
        coverage_amount_cents, effective_date, expiry_date, document_id, status,
        reminder_days, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      orgId, data.recordType, str(data.title, 200), str(data.provider, 200),
      str(data.policyNumber, 120), data.coverageAmountCents ?? null,
      dateOrNull(data.effectiveDate), dateOrNull(data.expiryDate),
      data.documentId || null, data.status || 'active',
      JSON.stringify(data.reminderDays || engine.DEFAULT_REMINDER_WINDOWS),
      data.notes || null,
    ]
  );
  return rows[0];
}

/**
 * Everything with an expiry date, in one shape, for the compliance dashboard
 * and the reminder sweep.
 */
async function listExpiringItems(orgId, withinDays = 90, q = pool) {
  const { rows } = await q.query(
    `SELECT 'credential' AS subject_type, c.id AS subject_id, c.user_id,
            u.name AS user_name, c.credential_type AS kind, c.credential_name AS title,
            c.expiry_date, c.lifecycle_status, c.status, c.reminder_days
       FROM credentials c JOIN users u ON u.id = c.user_id
      WHERE c.organisation_id IS NOT DISTINCT FROM $1
        AND c.expiry_date IS NOT NULL
        AND c.expiry_date <= (CURRENT_DATE + ($2::text || ' days')::INTERVAL)
     UNION ALL
     SELECT 'identity_record', i.id, i.user_id, u.name, i.record_kind,
            i.evidence_type, i.work_rights_expiry, i.verification_status, NULL, NULL
       FROM employee_identity_records i JOIN users u ON u.id = i.user_id
      WHERE i.organisation_id IS NOT DISTINCT FROM $1
        AND i.work_rights_expiry IS NOT NULL
        AND i.work_rights_expiry <= (CURRENT_DATE + ($2::text || ' days')::INTERVAL)
     UNION ALL
     SELECT 'org_record', o.id, NULL, NULL, o.record_type, o.title,
            o.expiry_date, o.status, NULL, o.reminder_days
       FROM organisation_compliance_records o
      WHERE o.organisation_id IS NOT DISTINCT FROM $1
        AND o.expiry_date IS NOT NULL
        AND o.expiry_date <= (CURRENT_DATE + ($2::text || ' days')::INTERVAL)
     ORDER BY 7 ASC`,
    [orgId, String(Number(withinDays) || 90)]
  );
  return rows;
}

/**
 * Claim a reminder window. Returns false when this exact notice already went
 * out — the unique constraint, not application logic, is what guarantees a
 * restart cannot replay yesterday's reminders.
 */
async function claimExpiryNotice(data, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO compliance_expiry_notices
       (organisation_id, subject_type, subject_id, user_id, expiry_date, window_days, severity)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (subject_type, subject_id, expiry_date, window_days) DO NOTHING
     RETURNING id`,
    [
      data.organisationId || null, data.subjectType, data.subjectId, data.userId || null,
      data.expiryDate, data.windowDays, data.severity || 'warning',
    ]
  );
  return rows.length > 0;
}

module.exports = {
  pool,
  isUuid,
  str,
  bool,
  dateOrNull,
  withTransaction,
  isEncryptionConfigured,
  // settings
  getOnboardingSettings,
  saveOnboardingSettings,
  // compliance registry
  listComplianceRequirements,
  getComplianceRequirementByCode,
  upsertComplianceRequirement,
  // documents
  listDocuments,
  getDocument,
  getDocumentByCode,
  listDocumentVersions,
  getCurrentDocumentVersion,
  getDocumentVersion,
  upsertDocument,
  createDocumentVersion,
  publishDocumentVersion,
  // templates
  listRequirementTemplates,
  getRequirementTemplate,
  getRequirementTemplateByCode,
  upsertRequirementTemplate,
  // packages
  listPackages,
  getPackage,
  getPackageByCode,
  getPackageComposition,
  resolvePackage,
  buildPackageVersionContent,
  publishPackage,
  getPackageVersion,
  getCurrentPackageVersion,
  markPackageDirty,
  // assignments
  listAssignments,
  getAssignment,
  getMyAssignment,
  listRequirements,
  getRequirement,
  recomputeAssignment,
  // employee data
  upsertEmploymentProfile,
  getEmploymentProfile,
  upsertPersonalDetails,
  getPersonalDetails,
  savePayrollBank,
  savePayrollTax,
  savePayrollSuper,
  getPayrollProfileMasked,
  payrollView,
  decryptPayrollForExport,
  setPayrollStatus,
  saveIdentityRecord,
  listIdentityRecordsMasked,
  // credentials
  upsertCredential,
  verifyCredential,
  listCredentialsForUser,
  // acknowledgements
  recordAcknowledgement,
  listAcknowledgements,
  recordStatementIssuance,
  listStatementIssuances,
  // org compliance + expiry
  listOrgCompliance,
  upsertOrgCompliance,
  listExpiringItems,
  claimExpiryNotice,
};
