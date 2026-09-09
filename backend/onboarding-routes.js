'use strict';

/**
 * ONBOARDING PACKAGES — management surface.
 *
 * Packages, requirement templates, the compliance registry, organisational
 * compliance records, the expiry view, settings, and the Owner's delegation of
 * onboarding permissions to an Admin.
 *
 * ROUTE SECURITY MODEL
 * ────────────────────
 * Every route names the ONE permission it needs. The owner holds all of them
 * implicitly (getPermissions merges them); an Admin holds only what the Owner
 * has granted, one permission at a time.
 *
 * This is the first feature in the portal to use requirePermission — everything
 * before it gates on role alone. That is deliberate: "Admin" describes a job,
 * not a level of trust with someone's tax file number, and the two must be
 * separable in the schema, not merely in a screen.
 */

const express = require('express');
const router = express.Router();

const db = require('./database');
const odb = require('./onboarding-db');
const engine = require('./onboarding-engine');
const catalogue = require('./onboarding-catalogue');
const { auditOnboarding } = require('./onboarding-audit');
const {
  requireAuth, requirePermission, requireAnyPermission,
  ONBOARDING_PERMISSIONS, ONBOARDING_PERMISSION_GROUPS, getPermissions,
} = require('./permissions');
const log = require('./logger').createLogger('onboarding');

const orgOf = (req) => req.user?.organisation_id || null;
const { isUuid, str } = odb;

/** Wrap a handler so a thrown error becomes a logged 500, never a hang. */
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('onboarding route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const notFound = (res) => res.status(404).json({ error: 'Not found' });

// Every /api/onboarding route requires a session. The pre-employee choke point
// in requireAuth has already refused anyone whose access is onboarding-only
// before this router is reached, except under /api/onboarding/me.
router.use('/api/onboarding', requireAuth);

// ═════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/onboarding/dashboard', requirePermission('onboarding.view'), safe(async (req, res) => {
  const org = orgOf(req);
  const settings = await odb.getOnboardingSettings();

  const { rows: pkgCounts } = await odb.pool.query(
    `SELECT status, COUNT(*)::int AS n FROM onboarding_packages
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND kind = 'package'
      GROUP BY status`, [org]
  );
  const { rows: asnCounts } = await odb.pool.query(
    `SELECT status, COUNT(*)::int AS n FROM onboarding_assignments
      WHERE organisation_id IS NOT DISTINCT FROM $1 GROUP BY status`, [org]
  );
  const { rows: overdue } = await odb.pool.query(
    `SELECT COUNT(*)::int AS n FROM onboarding_assignments
      WHERE organisation_id IS NOT DISTINCT FROM $1
        AND due_at IS NOT NULL AND due_at < NOW()
        AND status NOT IN ('activated','completed','cancelled','archived')`, [org]
  );

  const expiring = await odb.listExpiringItems(org, 90);
  const today = new Date();
  const expiringSoon = expiring.filter((e) => {
    const w = engine.expiryWindow(e.expiry_date, today, settings.reminderWindowsDays);
    return w !== null && w > 0;
  });
  const expired = expiring.filter((e) => engine.expiryWindow(e.expiry_date, today) === 0);

  const { rows: verificationDue } = await odb.pool.query(
    `SELECT COUNT(*)::int AS n FROM onboarding_requirements r
       JOIN onboarding_assignments a ON a.id = r.assignment_id
      WHERE a.organisation_id IS NOT DISTINCT FROM $1
        AND r.status IN ('submitted','awaiting_verification')
        AND a.status NOT IN ('cancelled','archived')`, [org]
  );

  const byStatus = (rows) => rows.reduce((acc, r) => { acc[r.status] = r.n; return acc; }, {});

  res.json({
    ok: true,
    settings: {
      ndisProviderStatus: settings.ndisProviderStatus,
      industrialRelationsSystem: settings.industrialRelationsSystem,
      smallBusinessEmployer: settings.smallBusinessEmployer,
      encryptionConfigured: odb.isEncryptionConfigured(),
    },
    packages: byStatus(pkgCounts),
    onboarding: byStatus(asnCounts),
    overdue: overdue[0]?.n || 0,
    compliance: {
      expiringSoon: expiringSoon.length,
      expired: expired.length,
      verificationRequired: verificationDue[0]?.n || 0,
    },
  });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  SETTINGS
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/onboarding/settings',
  requireAnyPermission('onboarding.view', 'onboarding.manage_compliance'),
  safe(async (req, res) => {
    const settings = await odb.getOnboardingSettings();
    res.json({
      ok: true,
      settings,
      defaults: catalogue.DEFAULT_SETTINGS,
      encryptionConfigured: odb.isEncryptionConfigured(),
    });
  }));

const SETTING_KEYS = new Set(Object.keys(catalogue.DEFAULT_SETTINGS));

router.put('/api/onboarding/settings', requirePermission('onboarding.manage_compliance'),
  safe(async (req, res) => {
    const body = req.body || {};
    const patch = {};
    for (const [k, v] of Object.entries(body)) {
      if (SETTING_KEYS.has(k)) patch[k] = v;
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'No recognised settings supplied' });
    }
    // Provider status changes what the portal asserts is legally required, so
    // it is audited as its own event rather than a generic settings write.
    const before = await odb.getOnboardingSettings();
    const saved = await odb.saveOnboardingSettings(patch);
    if (patch.ndisProviderStatus && patch.ndisProviderStatus !== before.ndisProviderStatus) {
      await auditOnboarding(req, 'provider_status_changed', {
        targetType: 'organisation',
        metadata: { fromStatus: before.ndisProviderStatus, toStatus: patch.ndisProviderStatus },
      });
    }
    await auditOnboarding(req, 'settings_updated', {
      targetType: 'organisation', metadata: { permissions: Object.keys(patch) },
    });
    res.json({ ok: true, settings: saved });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  DELEGATION — the Owner grants onboarding permissions to an Admin
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Owner-only, by role rather than by permission: the ability to hand out
 * access to tax file numbers must not itself be delegable, or a delegate could
 * quietly widen their own reach.
 */
const ownerOnly = (req, res, next) => {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'Only the practice owner can change onboarding permissions' });
  }
  next();
};

router.get('/api/onboarding/permissions', ownerOnly, safe(async (req, res) => {
  const { rows } = await odb.pool.query(
    `SELECT id, name, email, role, permissions, is_active
       FROM users
      WHERE organisation_id IS NOT DISTINCT FROM $1
        AND role IN ('owner','admin','therapist','read_only')
        AND is_active = TRUE
      ORDER BY role, name`, [orgOf(req)]
  );
  res.json({
    ok: true,
    available: ONBOARDING_PERMISSIONS,
    groups: ONBOARDING_PERMISSION_GROUPS,
    users: rows.map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role,
      // The owner's implicit grants are shown as implicit, not as stored ones.
      implicit: u.role === 'owner',
      granted: u.role === 'owner'
        ? ONBOARDING_PERMISSIONS
        : (Array.isArray(u.permissions) ? u.permissions : []).filter((p) => ONBOARDING_PERMISSIONS.includes(p)),
    })),
  });
}));

router.put('/api/onboarding/permissions/:userId', ownerOnly, safe(async (req, res) => {
  const { userId } = req.params;
  if (!isUuid(userId)) return notFound(res);

  const requested = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
  const invalid = requested.filter((p) => !ONBOARDING_PERMISSIONS.includes(p));
  if (invalid.length) {
    return res.status(400).json({ error: `Unknown permission: ${invalid[0]}` });
  }

  const { rows: targets } = await odb.pool.query(
    `SELECT id, role, permissions FROM users
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 LIMIT 1`,
    [userId, orgOf(req)]
  );
  const target = targets[0];
  if (!target) return notFound(res);
  if (target.role === 'owner') {
    return res.status(409).json({ error: 'The owner already holds every onboarding permission' });
  }
  if (target.role === 'pre_employee') {
    return res.status(409).json({ error: 'A pre-employee cannot hold onboarding permissions' });
  }

  // Preserve any non-onboarding permission already on the record; this endpoint
  // owns only the onboarding namespace.
  const existing = Array.isArray(target.permissions) ? target.permissions : [];
  const kept = existing.filter((p) => !ONBOARDING_PERMISSIONS.includes(p));
  const next = [...new Set([...kept, ...requested])];

  await odb.pool.query(
    'UPDATE users SET permissions = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [userId, JSON.stringify(next)]
  );

  const before = existing.filter((p) => ONBOARDING_PERMISSIONS.includes(p));
  await auditOnboarding(req, 'permissions_changed', {
    targetType: 'user', targetId: userId,
    metadata: {
      targetUserId: userId, role: target.role,
      permissions: requested,
      // Named explicitly so a later review can see what was taken away too.
      note: `granted ${requested.length}, previously ${before.length}`,
    },
  });

  res.json({ ok: true, userId, permissions: requested });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  REQUIREMENT TEMPLATES
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/onboarding/requirement-templates',
  requireAnyPermission('onboarding.manage_packages', 'onboarding.view'),
  safe(async (req, res) => {
    const templates = await odb.listRequirementTemplates(orgOf(req), {
      status: req.query.status || 'active',
      section: req.query.section || null,
    });
    res.json({
      ok: true,
      templates: templates.map(templateRow),
      sections: engine.SECTIONS.map((s) => ({ key: s, label: engine.SECTION_LABELS[s] })),
      classifications: engine.CLASSIFICATIONS,
      handlers: engine.HANDLERS,
      facts: engine.KNOWN_FACTS,
      operators: engine.OPERATORS,
    });
  }));

function templateRow(t) {
  return {
    id: t.id, code: t.code, title: t.title, summary: t.summary,
    instructions: t.instructions, section: t.section,
    sectionLabel: engine.SECTION_LABELS[t.section] || t.section,
    classification: t.classification, handler: t.handler, actor: t.actor,
    requiresEmployerVerification: t.requires_employer_verification,
    formKey: t.form_key, credentialType: t.credential_type,
    documentId: t.document_id, documentTitle: t.document_title,
    documentCode: t.document_code, documentContentStatus: t.document_content_status,
    learningWorkflowId: t.learning_workflow_id, externalUrl: t.external_url,
    complianceRequirementId: t.compliance_requirement_id,
    complianceTitle: t.compliance_title, complianceBasis: t.compliance_basis,
    complianceSourceUrl: t.compliance_source_url, complianceSourceOrg: t.compliance_source_org,
    applicability: t.applicability, applicabilityText: engine.describeRule(t.applicability),
    config: t.config, mandatory: t.default_mandatory,
    blocksActivation: t.default_blocks_activation,
    dueOffsetDays: t.default_due_offset_days, expiryRule: t.expiry_rule,
    sensitivity: t.sensitivity, version: t.version, status: t.status,
    sortHint: t.sort_hint, isSystem: t.is_system,
  };
}

function validateTemplate(body) {
  if (!body.code || !/^[A-Z0-9_]{3,80}$/.test(String(body.code))) {
    return 'code must be 3-80 characters of A-Z, 0-9 and underscore';
  }
  if (!body.title) return 'title is required';
  if (!engine.SECTIONS.includes(body.section)) return 'section is not recognised';
  if (!engine.CLASSIFICATIONS.includes(body.classification)) return 'classification is not recognised';
  if (!engine.HANDLERS.includes(body.handler)) return 'handler is not recognised';
  if (body.formKey && !engine.FORM_KEYS.includes(body.formKey)) return 'formKey is not recognised';
  if (body.handler === 'form' && !body.formKey) return 'a form requirement needs a formKey';
  if (body.applicability && typeof body.applicability !== 'object') return 'applicability must be an object';
  return null;
}

router.post('/api/onboarding/requirement-templates',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const body = req.body || {};
    const error = validateTemplate(body);
    if (error) return res.status(400).json({ error });

    const row = await odb.upsertRequirementTemplate(orgOf(req), { ...body, isSystem: false }, req.user.id);
    await auditOnboarding(req, 'template_saved', {
      targetType: 'requirement_template', targetId: row.id,
      metadata: { code: row.code, section: row.section, classification: row.classification, handler: row.handler },
    });
    res.status(201).json({ ok: true, template: templateRow(row) });
  }));

router.put('/api/onboarding/requirement-templates/:id',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const existing = await odb.getRequirementTemplate(orgOf(req), req.params.id);
    if (!existing) return notFound(res);
    const body = { ...req.body, code: existing.code };
    const error = validateTemplate(body);
    if (error) return res.status(400).json({ error });

    const row = await odb.upsertRequirementTemplate(orgOf(req), body, req.user.id);
    // Every package that references this template now has an unpublished
    // change. Marking them dirty is what makes "publish v2" a visible choice
    // rather than something that silently already happened.
    await odb.pool.query(
      `UPDATE onboarding_packages SET draft_dirty = TRUE, updated_at = NOW()
        WHERE id IN (SELECT package_id FROM onboarding_package_requirements WHERE template_id = $1)`,
      [existing.id]
    );
    await auditOnboarding(req, 'template_updated', {
      targetType: 'requirement_template', targetId: row.id,
      metadata: { code: row.code, version: row.version, previousVersion: existing.version },
    });
    res.json({ ok: true, template: templateRow(row) });
  }));

router.post('/api/onboarding/requirement-templates/:id/archive',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const existing = await odb.getRequirementTemplate(orgOf(req), req.params.id);
    if (!existing) return notFound(res);
    await odb.pool.query(
      "UPDATE onboarding_requirement_templates SET status = 'archived', updated_at = NOW() WHERE id = $1",
      [existing.id]
    );
    await auditOnboarding(req, 'template_archived', {
      targetType: 'requirement_template', targetId: existing.id, metadata: { code: existing.code },
    });
    res.json({ ok: true });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  PACKAGES
// ═════════════════════════════════════════════════════════════════════════════

function packageRow(p) {
  return {
    id: p.id, code: p.code, title: p.title, description: p.description,
    kind: p.kind, roleCategory: p.role_category, employmentType: p.employment_type,
    extends: Array.isArray(p.extends_codes) ? p.extends_codes : [],
    status: p.status, currentVersion: p.current_version, draftDirty: p.draft_dirty,
    ownRequirementCount: p.own_requirement_count !== undefined ? Number(p.own_requirement_count) : undefined,
    assignmentCount: p.assignment_count !== undefined ? Number(p.assignment_count) : undefined,
    createdAt: p.created_at, updatedAt: p.updated_at,
  };
}

router.get('/api/onboarding/packages', requirePermission('onboarding.view'), safe(async (req, res) => {
  const packages = await odb.listPackages(orgOf(req), {
    kind: req.query.kind || null,
    status: req.query.status || null,
  });
  res.json({ ok: true, packages: packages.map(packageRow) });
}));

router.get('/api/onboarding/packages/:id', requirePermission('onboarding.view'), safe(async (req, res) => {
  const pkg = await odb.getPackage(orgOf(req), req.params.id);
  if (!pkg) return notFound(res);

  const own = await odb.getPackageComposition(pkg.id);
  const { rows: resolved, chain, warnings } = await odb.resolvePackage(orgOf(req), pkg);
  const versions = (await odb.pool.query(
    `SELECT id, version, title, requirement_count, change_note, status, published_at, published_by
       FROM onboarding_package_versions WHERE package_id = $1 ORDER BY version DESC`, [pkg.id]
  )).rows;

  res.json({
    ok: true,
    package: packageRow(pkg),
    ownRequirements: own.map(compositionRow),
    resolvedRequirements: resolved.map(compositionRow),
    chain,
    warnings,
    versions,
  });
}));

function compositionRow(r) {
  const mandatory = r.mandatory === null || r.mandatory === undefined ? r.default_mandatory : r.mandatory;
  const blocks = r.blocks_activation === null || r.blocks_activation === undefined
    ? r.default_blocks_activation : r.blocks_activation;
  const rule = r.condition || r.applicability || {};
  return {
    id: r.id, templateId: r.template_id, templateCode: r.template_code,
    title: r.title, summary: r.summary, section: r.section,
    sectionLabel: engine.SECTION_LABELS[r.section] || r.section,
    classification: r.classification, handler: r.handler, actor: r.actor,
    requiresEmployerVerification: r.requires_employer_verification,
    sensitivity: r.sensitivity, sortOrder: r.sort_order,
    mandatory, blocksActivation: blocks,
    dueOffsetDays: r.due_offset_days ?? r.default_due_offset_days,
    condition: rule, conditionText: engine.describeRule(rule),
    inheritedFrom: r.inherited_from || null,
    note: r.note || null,
    templateStatus: r.template_status,
  };
}

router.post('/api/onboarding/packages', requirePermission('onboarding.manage_packages'),
  safe(async (req, res) => {
    const b = req.body || {};
    if (!b.code || !/^[A-Z0-9_]{3,80}$/.test(String(b.code))) {
      return res.status(400).json({ error: 'code must be 3-80 characters of A-Z, 0-9 and underscore' });
    }
    if (!b.title) return res.status(400).json({ error: 'title is required' });
    if (b.employmentType && !engine.EMPLOYMENT_TYPES.includes(b.employmentType)) {
      return res.status(400).json({ error: 'employmentType is not recognised' });
    }
    if (await odb.getPackageByCode(orgOf(req), b.code)) {
      return res.status(409).json({ error: 'A package with that code already exists' });
    }

    const { rows } = await odb.pool.query(
      `INSERT INTO onboarding_packages
         (organisation_id, code, title, description, kind, role_category, employment_type,
          extends_codes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        orgOf(req), str(b.code, 80), str(b.title, 200), str(b.description, 1000),
        ['base', 'overlay', 'package'].includes(b.kind) ? b.kind : 'package',
        str(b.roleCategory, 40), b.employmentType || null,
        JSON.stringify(Array.isArray(b.extends) ? b.extends : []), req.user.id,
      ]
    );
    await auditOnboarding(req, 'package_created', {
      targetType: 'package', targetId: rows[0].id, metadata: { code: rows[0].code },
    });
    res.status(201).json({ ok: true, package: packageRow(rows[0]) });
  }));

router.put('/api/onboarding/packages/:id', requirePermission('onboarding.manage_packages'),
  safe(async (req, res) => {
    const pkg = await odb.getPackage(orgOf(req), req.params.id);
    if (!pkg) return notFound(res);
    const b = req.body || {};
    if (b.employmentType && !engine.EMPLOYMENT_TYPES.includes(b.employmentType)) {
      return res.status(400).json({ error: 'employmentType is not recognised' });
    }
    const { rows } = await odb.pool.query(
      `UPDATE onboarding_packages SET
         title = COALESCE($2, title), description = $3,
         role_category = $4, employment_type = $5,
         extends_codes = COALESCE($6, extends_codes),
         draft_dirty = TRUE, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        pkg.id, str(b.title, 200), str(b.description, 1000), str(b.roleCategory, 40),
        b.employmentType || null,
        Array.isArray(b.extends) ? JSON.stringify(b.extends) : null,
      ]
    );
    await auditOnboarding(req, 'package_updated', {
      targetType: 'package', targetId: pkg.id, metadata: { code: pkg.code },
    });
    res.json({ ok: true, package: packageRow(rows[0]) });
  }));

router.post('/api/onboarding/packages/:id/requirements',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await odb.getPackage(orgOf(req), req.params.id);
    if (!pkg) return notFound(res);
    const b = req.body || {};
    if (!isUuid(b.templateId)) return res.status(400).json({ error: 'templateId is required' });
    const tpl = await odb.getRequirementTemplate(orgOf(req), b.templateId);
    if (!tpl) return res.status(400).json({ error: 'Unknown requirement template' });

    const { rows } = await odb.pool.query(
      `INSERT INTO onboarding_package_requirements
         (package_id, template_id, sort_order, mandatory, blocks_activation,
          due_offset_days, condition, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (package_id, template_id) DO UPDATE SET
         sort_order = EXCLUDED.sort_order, mandatory = EXCLUDED.mandatory,
         blocks_activation = EXCLUDED.blocks_activation,
         due_offset_days = EXCLUDED.due_offset_days,
         condition = EXCLUDED.condition, note = EXCLUDED.note
       RETURNING *`,
      [
        pkg.id, tpl.id, Number(b.sortOrder ?? tpl.sort_hint ?? 0),
        b.mandatory === undefined ? null : !!b.mandatory,
        b.blocksActivation === undefined ? null : !!b.blocksActivation,
        b.dueOffsetDays ?? null,
        b.condition ? JSON.stringify(b.condition) : null,
        str(b.note, 1000),
      ]
    );
    await odb.markPackageDirty(pkg.id);
    await auditOnboarding(req, 'package_requirement_added', {
      targetType: 'package', targetId: pkg.id,
      metadata: { code: pkg.code, templateId: tpl.id, templateCode: tpl.code },
    });
    res.status(201).json({ ok: true, requirement: rows[0] });
  }));

router.patch('/api/onboarding/packages/:id/requirements/:rid',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await odb.getPackage(orgOf(req), req.params.id);
    if (!pkg || !isUuid(req.params.rid)) return notFound(res);
    const b = req.body || {};
    const { rows } = await odb.pool.query(
      `UPDATE onboarding_package_requirements SET
         sort_order = COALESCE($3, sort_order),
         mandatory = $4, blocks_activation = $5, due_offset_days = $6,
         condition = $7, note = $8
       WHERE id = $1 AND package_id = $2 RETURNING *`,
      [
        req.params.rid, pkg.id,
        b.sortOrder ?? null,
        b.mandatory === undefined ? null : !!b.mandatory,
        b.blocksActivation === undefined ? null : !!b.blocksActivation,
        b.dueOffsetDays ?? null,
        b.condition ? JSON.stringify(b.condition) : null,
        str(b.note, 1000),
      ]
    );
    if (!rows[0]) return notFound(res);
    await odb.markPackageDirty(pkg.id);
    res.json({ ok: true, requirement: rows[0] });
  }));

router.delete('/api/onboarding/packages/:id/requirements/:rid',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await odb.getPackage(orgOf(req), req.params.id);
    if (!pkg || !isUuid(req.params.rid)) return notFound(res);
    const { rowCount } = await odb.pool.query(
      'DELETE FROM onboarding_package_requirements WHERE id = $1 AND package_id = $2',
      [req.params.rid, pkg.id]
    );
    if (!rowCount) return notFound(res);
    await odb.markPackageDirty(pkg.id);
    await auditOnboarding(req, 'package_requirement_removed', {
      targetType: 'package', targetId: pkg.id, metadata: { code: pkg.code },
    });
    res.json({ ok: true });
  }));

router.post('/api/onboarding/packages/:id/reorder',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await odb.getPackage(orgOf(req), req.params.id);
    if (!pkg) return notFound(res);
    const order = Array.isArray(req.body?.order) ? req.body.order : [];
    if (!order.length || order.length > 500) {
      return res.status(400).json({ error: 'order must list the requirement ids' });
    }
    await odb.withTransaction(async (q) => {
      for (let i = 0; i < order.length; i += 1) {
        if (!isUuid(order[i])) continue;
        await q.query(
          'UPDATE onboarding_package_requirements SET sort_order = $3 WHERE id = $1 AND package_id = $2',
          [order[i], pkg.id, (i + 1) * 10]
        );
      }
    });
    await odb.markPackageDirty(pkg.id);
    res.json({ ok: true });
  }));

/**
 * Preview: what would this package issue, given a set of facts?
 *
 * The point of the builder — the Owner can see that an office Admin is not
 * asked for a driver licence BEFORE anyone is invited.
 */
router.post('/api/onboarding/packages/:id/preview',
  requirePermission('onboarding.view'), safe(async (req, res) => {
    const pkg = await odb.getPackage(orgOf(req), req.params.id);
    if (!pkg) return notFound(res);

    const settings = await odb.getOnboardingSettings();
    const facts = engine.buildFacts(req.body?.facts || {}, settings);

    let content;
    if (pkg.current_version > 0 && req.query.source !== 'draft') {
      const version = await odb.getCurrentPackageVersion(pkg.id);
      content = version?.content;
    }
    if (!content) ({ content } = await odb.buildPackageVersionContent(orgOf(req), pkg));

    const { applied, skipped } = engine.selectApplicable(content, facts);
    const bySection = {};
    for (const item of applied) {
      (bySection[item.section] ||= []).push({
        code: item.template_code, title: item.title,
        classification: item.classification, handler: item.handler, actor: item.actor,
        mandatory: item.mandatory, blocksActivation: item.blocks_activation,
        requiresEmployerVerification: item.requires_employer_verification,
        compliance: item.compliance || null,
        conditionText: engine.describeRule(item.applicability),
      });
    }

    res.json({
      ok: true,
      facts,
      sections: engine.SECTIONS
        .filter((s) => bySection[s]?.length)
        .map((s) => ({ key: s, label: engine.SECTION_LABELS[s], requirements: bySection[s] })),
      appliedCount: applied.length,
      skipped,
      blockingCount: applied.filter((r) => r.blocks_activation).length,
      employeeCount: applied.filter((r) => engine.isEmployeeItem(r)).length,
      employerCount: applied.filter((r) => engine.isEmployerItem(r)).length,
    });
  }));

router.post('/api/onboarding/packages/:id/publish',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await odb.getPackage(orgOf(req), req.params.id);
    if (!pkg) return notFound(res);
    if (pkg.kind !== 'package') {
      return res.status(409).json({
        error: 'Base and overlay packages are composed into others and are not published directly',
      });
    }
    const { content, warnings } = await odb.buildPackageVersionContent(orgOf(req), pkg);
    if (!content.requirements.length) {
      return res.status(400).json({ error: 'Add at least one requirement before publishing' });
    }

    const version = await odb.withTransaction(
      (q) => odb.publishPackage(orgOf(req), pkg, req.user.id, req.body?.changeNote, q)
    );
    await auditOnboarding(req, 'package_published', {
      targetType: 'package', targetId: pkg.id,
      metadata: {
        code: pkg.code, version: version.version,
        requirementCount: version.requirement_count,
        changeNote: str(req.body?.changeNote, 200),
      },
    });
    res.status(201).json({
      ok: true,
      version: {
        id: version.id, version: version.version,
        requirementCount: version.requirement_count, publishedAt: version.published_at,
      },
      warnings,
    });
  }));

router.post('/api/onboarding/packages/:id/duplicate',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await odb.getPackage(orgOf(req), req.params.id);
    if (!pkg) return notFound(res);
    const code = str(req.body?.code, 80);
    if (!code || !/^[A-Z0-9_]{3,80}$/.test(code)) {
      return res.status(400).json({ error: 'A new code is required' });
    }
    if (await odb.getPackageByCode(orgOf(req), code)) {
      return res.status(409).json({ error: 'A package with that code already exists' });
    }

    const copy = await odb.withTransaction(async (q) => {
      const { rows } = await q.query(
        `INSERT INTO onboarding_packages
           (organisation_id, code, title, description, kind, role_category,
            employment_type, extends_codes, created_by)
         SELECT organisation_id, $2, $3, description, kind, role_category,
                employment_type, extends_codes, $4
           FROM onboarding_packages WHERE id = $1 RETURNING *`,
        [pkg.id, code, str(req.body?.title, 200) || `${pkg.title} (copy)`, req.user.id]
      );
      await q.query(
        `INSERT INTO onboarding_package_requirements
           (package_id, template_id, sort_order, mandatory, blocks_activation,
            due_offset_days, condition, note)
         SELECT $2, template_id, sort_order, mandatory, blocks_activation,
                due_offset_days, condition, note
           FROM onboarding_package_requirements WHERE package_id = $1`,
        [pkg.id, rows[0].id]
      );
      return rows[0];
    });
    await auditOnboarding(req, 'package_duplicated', {
      targetType: 'package', targetId: copy.id, metadata: { code: copy.code },
    });
    res.status(201).json({ ok: true, package: packageRow(copy) });
  }));

router.post('/api/onboarding/packages/:id/archive',
  requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
    const pkg = await odb.getPackage(orgOf(req), req.params.id);
    if (!pkg) return notFound(res);
    const { rows: live } = await odb.pool.query(
      `SELECT COUNT(*)::int AS n FROM onboarding_assignments
        WHERE package_id = $1 AND status NOT IN ('activated','completed','cancelled','archived')`,
      [pkg.id]
    );
    if (live[0].n > 0) {
      return res.status(409).json({
        error: `${live[0].n} onboarding run(s) are still using this package`,
      });
    }
    await odb.pool.query(
      "UPDATE onboarding_packages SET status = 'archived', archived_at = NOW(), updated_at = NOW() WHERE id = $1",
      [pkg.id]
    );
    await auditOnboarding(req, 'package_archived', {
      targetType: 'package', targetId: pkg.id, metadata: { code: pkg.code },
    });
    res.json({ ok: true });
  }));

router.get('/api/onboarding/packages/:id/versions/:vid',
  requirePermission('onboarding.view'), safe(async (req, res) => {
    const pkg = await odb.getPackage(orgOf(req), req.params.id);
    if (!pkg) return notFound(res);
    const version = await odb.getPackageVersion(req.params.vid);
    if (!version || version.package_id !== pkg.id) return notFound(res);
    res.json({ ok: true, version });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  COMPLIANCE REGISTRY
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/onboarding/compliance/requirements',
  requireAnyPermission('onboarding.manage_compliance', 'onboarding.view'),
  safe(async (req, res) => {
    const rows = await odb.listComplianceRequirements(orgOf(req), { status: req.query.status });
    res.json({
      ok: true,
      requirements: rows.map((c) => ({
        id: c.id, code: c.code, title: c.title, category: c.category,
        classification: c.classification, basis: c.basis, appliesTo: c.applies_to,
        jurisdiction: c.jurisdiction, sourceOrg: c.source_org, sourceTitle: c.source_title,
        sourceUrl: c.source_url, sourceVersionLabel: c.source_version_label,
        sourceLastModified: c.source_last_modified, sourceCheckedAt: c.source_checked_at,
        documentVersion: c.document_version, effectiveDate: c.effective_date,
        recurrence: c.recurrence, deliveryRules: c.delivery_rules,
        lastVerifiedAt: c.last_verified_at, nextReviewDate: c.next_review_date,
        storedDocumentId: c.stored_document_id, storedDocumentTitle: c.stored_document_title,
        status: c.status, notes: c.notes,
      })),
    });
  }));

router.post('/api/onboarding/compliance/requirements',
  requirePermission('onboarding.manage_compliance'), safe(async (req, res) => {
    const b = req.body || {};
    if (!b.code || !b.title) return res.status(400).json({ error: 'code and title are required' });
    const row = await odb.upsertComplianceRequirement(orgOf(req), b, req.user.id);
    await auditOnboarding(req, 'compliance_requirement_saved', {
      targetType: 'compliance_requirement', targetId: row.id,
      metadata: { code: row.code, classification: row.classification },
    });
    res.status(201).json({ ok: true, requirement: row });
  }));

/** Record that the Owner re-checked a source against the publisher. */
router.post('/api/onboarding/compliance/requirements/:id/verify',
  requirePermission('onboarding.manage_compliance'), safe(async (req, res) => {
    if (!isUuid(req.params.id)) return notFound(res);
    const b = req.body || {};
    const { rows } = await odb.pool.query(
      `UPDATE compliance_requirements SET
         last_verified_at = NOW(), last_verified_by = $3,
         source_checked_at = NOW(),
         source_version_label = COALESCE($4, source_version_label),
         next_review_date = COALESCE($5, next_review_date),
         notes = COALESCE($6, notes), updated_at = NOW()
       WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 RETURNING *`,
      [
        req.params.id, orgOf(req), req.user.id,
        str(b.sourceVersionLabel, 120), odb.dateOrNull(b.nextReviewDate), b.notes || null,
      ]
    );
    if (!rows[0]) return notFound(res);
    await auditOnboarding(req, 'compliance_source_verified', {
      targetType: 'compliance_requirement', targetId: rows[0].id,
      metadata: { code: rows[0].code, note: str(b.sourceVersionLabel, 120) },
    });
    res.json({ ok: true, requirement: rows[0] });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  ORGANISATION COMPLIANCE  (employer obligations — never employee uploads)
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/onboarding/compliance/organisation',
  requirePermission('onboarding.manage_compliance'), safe(async (req, res) => {
    const rows = await odb.listOrgCompliance(orgOf(req));
    const today = new Date();
    res.json({
      ok: true,
      records: rows.map((r) => ({
        id: r.id, recordType: r.record_type, title: r.title, provider: r.provider,
        policyNumber: r.policy_number, coverageAmountCents: r.coverage_amount_cents,
        effectiveDate: r.effective_date, expiryDate: r.expiry_date,
        documentId: r.document_id, status: r.status, reminderDays: r.reminder_days,
        verifiedAt: r.verified_at, verifiedByName: r.verified_by_name, notes: r.notes,
        expiryWindow: engine.expiryWindow(r.expiry_date, today, r.reminder_days),
      })),
    });
  }));

router.post('/api/onboarding/compliance/organisation',
  requirePermission('onboarding.manage_compliance'), safe(async (req, res) => {
    const b = req.body || {};
    if (!b.id && !b.recordType) return res.status(400).json({ error: 'recordType is required' });
    if (!b.id && !b.title) return res.status(400).json({ error: 'title is required' });
    const row = await odb.upsertOrgCompliance(orgOf(req), b, req.user.id);
    if (!row) return notFound(res);
    await auditOnboarding(req, 'org_compliance_saved', {
      targetType: 'organisation_compliance', targetId: row.id,
      metadata: { recordType: row.record_type, expiryDate: row.expiry_date },
    });
    res.status(b.id ? 200 : 201).json({ ok: true, record: row });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  EXPIRING CREDENTIALS
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/onboarding/compliance/expiring',
  requirePermission('onboarding.view'), safe(async (req, res) => {
    const withinDays = Math.min(Math.max(Number(req.query.days) || 90, 1), 365);
    const settings = await odb.getOnboardingSettings();
    const rows = await odb.listExpiringItems(orgOf(req), withinDays);
    const today = new Date();

    res.json({
      ok: true,
      items: rows.map((r) => {
        const window = engine.expiryWindow(r.expiry_date, today, r.reminder_days || settings.reminderWindowsDays);
        return {
          subjectType: r.subject_type, subjectId: r.subject_id,
          userId: r.user_id, userName: r.user_name,
          kind: r.kind, title: r.title, expiryDate: r.expiry_date,
          lifecycleStatus: r.lifecycle_status, status: r.status,
          window, severity: engine.expirySeverity(window),
          expired: window === 0,
        };
      }),
    });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  EMPLOYEE COMPLIANCE VIEW  — "is this person safe and authorised to work?"
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/onboarding/employees',
  requirePermission('onboarding.view'), safe(async (req, res) => {
    // The Employees register asks for people still being onboarded too
    // (?include=onboarding); the compliance view keeps its historic shape.
    const includeOnboarding = String(req.query.include || '') === 'onboarding';
    const { rows } = await odb.pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.is_treating_therapist, u.role_title,
              e.job_title, e.employment_type, e.start_date, e.end_date, e.status AS employment_status,
              e.role_category, e.work_location, e.hours_per_week,
              e.child_related_work, e.ndis_risk_assessed_role, e.mobile_community_role,
              (SELECT COUNT(*)::int FROM credentials c
                WHERE c.user_id = u.id AND c.expiry_date IS NOT NULL
                  AND c.expiry_date < CURRENT_DATE) AS expired_credentials,
              (SELECT COUNT(*)::int FROM credentials c
                WHERE c.user_id = u.id AND c.status IN ('pending_review','missing')) AS unverified_credentials,
              (SELECT COUNT(*)::int FROM onboarding_acknowledgements ack
                WHERE ack.user_id = u.id) AS acknowledgements,
              a.id AS assignment_id, a.status AS onboarding_status
         FROM users u
         LEFT JOIN employment_profiles e ON e.user_id = u.id
         LEFT JOIN LATERAL (
           SELECT id, status FROM onboarding_assignments
            WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
         ) a ON TRUE
        WHERE u.organisation_id IS NOT DISTINCT FROM $1
          AND (u.role <> 'pre_employee' OR $2::boolean)
        ORDER BY u.name`, [orgOf(req), includeOnboarding]
    );
    res.json({
      ok: true,
      employees: rows.map((r) => ({
        userId: r.id, name: r.name, email: r.email, role: r.role, isActive: r.is_active,
        isTreatingTherapist: r.is_treating_therapist, roleTitle: r.role_title,
        jobTitle: r.job_title, employmentType: r.employment_type, startDate: r.start_date, endDate: r.end_date,
        employmentStatus: r.employment_status, roleCategory: r.role_category,
        workLocation: r.work_location, hoursPerWeek: r.hours_per_week,
        childRelatedWork: r.child_related_work,
        ndisRiskAssessedRole: r.ndis_risk_assessed_role,
        mobileCommunityRole: r.mobile_community_role,
        expiredCredentials: r.expired_credentials,
        unverifiedCredentials: r.unverified_credentials,
        acknowledgements: r.acknowledgements,
        assignmentId: r.assignment_id, onboardingStatus: r.onboarding_status,
      })),
    });
  }));

/**
 * One employee's complete compliance picture.
 *
 * Sensitive sections are attached ONLY for a caller who holds the matching
 * permission — the response shape changes with the reader, so a delegate
 * without onboarding.payroll never receives payroll data to begin with rather
 * than receiving it and being asked not to render it.
 */
router.get('/api/onboarding/employees/:userId',
  requirePermission('onboarding.view'), safe(async (req, res) => {
    const { userId } = req.params;
    if (!isUuid(userId)) return notFound(res);

    const { rows: users } = await odb.pool.query(
      `SELECT id, name, email, role, is_active, activated_from_onboarding_at
         FROM users WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 LIMIT 1`,
      [userId, orgOf(req)]
    );
    const user = users[0];
    if (!user) return notFound(res);

    const [employment, credentials, acknowledgements, issuances, assignments] = await Promise.all([
      odb.getEmploymentProfile(userId),
      odb.listCredentialsForUser(userId),
      odb.listAcknowledgements(userId),
      odb.listStatementIssuances(userId),
      odb.pool.query(
        `SELECT a.id, a.status, a.created_at, a.activated_at, p.title AS package_title,
                v.version AS package_version
           FROM onboarding_assignments a
           JOIN onboarding_packages p ON p.id = a.package_id
           JOIN onboarding_package_versions v ON v.id = a.package_version_id
          WHERE a.user_id = $1 ORDER BY a.created_at DESC`, [userId]
      ).then((r) => r.rows),
    ]);

    const payload = {
      ok: true,
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        isActive: user.is_active, activatedFromOnboardingAt: user.activated_from_onboarding_at,
      },
      employment,
      credentials: credentials.map((c) => ({
        id: c.id, type: c.credential_type, name: c.credential_name,
        issuingBody: c.issuing_body, registrationNumber: c.registration_number,
        issueDate: c.issue_date, expiryDate: c.expiry_date, status: c.status,
        lifecycleStatus: c.lifecycle_status, jurisdiction: c.jurisdiction,
        verificationMethod: c.verification_method, verificationReference: c.verification_reference,
        verifiedAt: c.verified_at, verifiedByName: c.verified_by_name,
        detail: c.detail, documentId: c.document_id,
      })),
      acknowledgements: acknowledgements.map((a) => ({
        documentCode: a.document_code, documentTitle: a.document_title,
        documentVersion: a.document_version, acknowledgedAt: a.acknowledged_at,
        typedLegalName: a.typed_legal_name,
      })),
      statementIssuances: issuances,
      onboardingHistory: assignments,
    };

    // Tiered attachments.
    const perms = getPermissions(req.user.role, req.user.permissions || []);
    if (perms.includes('onboarding.review') || perms.includes('onboarding.payroll')) {
      payload.personalDetails = await odb.getPersonalDetails(userId);
      payload.vehicle = await require('./onboarding-returns-db').getVehicle(userId);
    }
    if (perms.includes('onboarding.payroll')) {
      payload.payroll = odb.payrollView(await odb.getPayrollProfileMasked(userId));
      await auditOnboarding(req, 'payroll_viewed', {
        targetType: 'user', targetId: userId, metadata: { subjectUserId: userId },
      });
    }
    if (perms.includes('onboarding.sensitive_identity')) {
      payload.identityRecords = await odb.listIdentityRecordsMasked(userId);
      await auditOnboarding(req, 'identity_viewed', {
        targetType: 'user', targetId: userId, metadata: { subjectUserId: userId },
      });
    }

    res.json(payload);
  }));

module.exports = router;
