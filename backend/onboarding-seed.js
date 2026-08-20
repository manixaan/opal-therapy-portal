'use strict';

/**
 * ONBOARDING SEEDER — installs the catalogue into an organisation.
 *
 * Idempotent by code: every upsert keys on (organisation_id, code), so running
 * it again refreshes definitions without duplicating anything and without
 * touching a single assignment. Safe to run on every boot, and it is.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * ────────────────────────────────
 *  • It never publishes a policy document it does not have. Opal policies seed
 *    as DRAFT / document_required. The slot, its versioning and its
 *    acknowledgement workflow are real; the words are the Owner's to write.
 *    Generating an authoritative-sounding WHS policy so the feature looked
 *    finished would put invented rules in front of a real workforce.
 *  • It never republishes an official document it has not been given. The
 *    Fair Work statements and NDIS guidance seed as link_only, pointing at the
 *    publisher, until the real files are imported.
 *  • It never overwrites a package the Owner has edited. Packages are only
 *    composed on FIRST creation; afterwards the Owner's composition wins.
 */

const { pool } = require('./database');
const odb = require('./onboarding-db');
const catalogue = require('./onboarding-catalogue');
const log = require('./logger').createLogger('onboarding-seed');

/** Resolve the organisation to seed. Single-tenant in practice. */
async function resolveOrganisationId(q = pool) {
  const { rows } = await q.query('SELECT id FROM organisations ORDER BY created_at LIMIT 1');
  return rows[0]?.id || null;
}

async function seedComplianceSources(orgId, q) {
  const byCode = new Map();
  for (const src of catalogue.COMPLIANCE_SOURCES) {
    const row = await odb.upsertComplianceRequirement(orgId, {
      code: src.code,
      title: src.title,
      category: src.category,
      classification: src.classification,
      basis: src.basis,
      appliesTo: src.appliesTo,
      jurisdiction: src.jurisdiction,
      sourceOrg: src.sourceOrg,
      sourceTitle: src.sourceTitle,
      sourceUrl: src.sourceUrl,
      sourceVersionLabel: src.sourceVersionLabel || null,
      effectiveDate: src.effectiveDate || null,
      recurrence: src.recurrence || {},
      deliveryRules: src.deliveryRules || {},
      notes: src.notes,
      status: 'active',
    }, null, q);
    byCode.set(src.code, row);
  }
  return byCode;
}

async function seedDocuments(orgId, complianceByCode, q) {
  const byCode = new Map();

  for (const doc of catalogue.OFFICIAL_DOCUMENTS) {
    const row = await odb.upsertDocument(orgId, {
      code: doc.code,
      title: doc.title,
      description: doc.description,
      category: doc.category,
      classification: doc.classification,
      audience: doc.audience,
      ownerControlled: doc.ownerControlled,
      officialSourceUrl: doc.officialSourceUrl,
      complianceRequirementId: complianceByCode.get(doc.complianceCode)?.id || null,
      // link_only: Opal points at the publisher rather than serving a copy it
      // was never given. The import pipeline replaces this with a real file.
      contentStatus: 'link_only',
      status: 'draft',
      requiresAcknowledgement: doc.requiresAcknowledgement === true,
    }, null, q);
    byCode.set(doc.code, row);
  }

  for (const pol of catalogue.OPAL_POLICIES) {
    const row = await odb.upsertDocument(orgId, {
      code: pol.code,
      title: pol.title,
      description: pol.description || null,
      category: pol.category,
      classification: 'OPAL_POLICY',
      audience: 'employee',
      ownerControlled: true,
      complianceRequirementId: complianceByCode.get(pol.complianceCode)?.id || null,
      contentStatus: 'document_required',
      status: 'draft',
      requiresAcknowledgement: pol.ack === true,
    }, null, q);
    byCode.set(pol.code, row);
  }

  return byCode;
}

async function seedRequirementTemplates(orgId, docsByCode, complianceByCode, q) {
  const byCode = new Map();

  // Catalogue templates.
  for (const tpl of catalogue.REQUIREMENT_TEMPLATES) {
    const row = await odb.upsertRequirementTemplate(orgId, {
      code: tpl.code,
      title: tpl.title,
      summary: tpl.summary,
      instructions: tpl.instructions,
      section: tpl.section,
      classification: tpl.classification,
      handler: tpl.handler,
      actor: tpl.actor,
      requiresEmployerVerification: tpl.requiresEmployerVerification === true,
      formKey: tpl.formKey,
      credentialType: tpl.credentialType,
      documentId: docsByCode.get(tpl.documentCode)?.id || null,
      externalUrl: tpl.externalUrl,
      complianceRequirementId: complianceByCode.get(tpl.complianceCode)?.id || null,
      applicability: tpl.applicability || {},
      config: tpl.config || {},
      mandatory: tpl.mandatory,
      blocksActivation: tpl.blocksActivation,
      dueOffsetDays: tpl.dueOffsetDays ?? null,
      expiryRule: tpl.expiryRule || {},
      sensitivity: tpl.sensitivity || 'standard',
      sortHint: tpl.sortHint || 0,
      isSystem: true,
    }, null, q);
    byCode.set(tpl.code, row);
  }

  // One acknowledgement requirement per Opal policy that needs one. Generated
  // rather than hand-listed so adding a policy to the catalogue automatically
  // produces its requirement, and the two can never drift apart.
  let sort = 0;
  for (const pol of catalogue.OPAL_POLICIES) {
    if (!pol.ack) continue;
    sort += 10;
    const doc = docsByCode.get(pol.code);
    const code = `REQ_ACK_${pol.code}`;
    const row = await odb.upsertRequirementTemplate(orgId, {
      code,
      title: pol.title,
      summary: `Read and acknowledge the ${pol.title}.`,
      instructions: 'Open the policy, read it, then confirm your acknowledgement. '
        + 'Your acknowledgement is recorded against this exact version.',
      section: 'policies',
      classification: 'ACKNOWLEDGEMENT',
      handler: 'document_ack',
      actor: 'employee',
      requiresEmployerVerification: false,
      documentId: doc?.id || null,
      complianceRequirementId: complianceByCode.get(pol.complianceCode)?.id || null,
      applicability: {},
      config: {},
      mandatory: true,
      // Policy acknowledgements block activation: an employee who has not
      // agreed to the confidentiality and safeguarding rules should not be
      // given access to participant records.
      blocksActivation: true,
      expiryRule: {},
      sensitivity: 'standard',
      sortHint: sort,
      isSystem: true,
    }, null, q);
    byCode.set(code, row);
  }

  return byCode;
}

/** Composition rows for one package, replacing whatever is there. */
async function setComposition(packageId, templateCodes, templatesByCode, q) {
  await q.query('DELETE FROM onboarding_package_requirements WHERE package_id = $1', [packageId]);
  let order = 0;
  for (const code of templateCodes) {
    const tpl = templatesByCode.get(code);
    if (!tpl) { log.warn('seed: unknown template code', { code }); continue; }
    order += 10;
    await q.query(
      `INSERT INTO onboarding_package_requirements (package_id, template_id, sort_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (package_id, template_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
      [packageId, tpl.id, order]
    );
  }
}

async function upsertPackage(orgId, def, q) {
  const existing = await odb.getPackageByCode(orgId, def.code, q);
  if (existing) return { pkg: existing, created: false };
  const { rows } = await q.query(
    `INSERT INTO onboarding_packages
       (organisation_id, code, title, description, kind, role_category, employment_type,
        extends_codes, status, draft_dirty)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',TRUE) RETURNING *`,
    [
      orgId, def.code, def.title, def.description || null, def.kind || 'package',
      def.roleCategory || null, def.employmentType || null,
      JSON.stringify(def.extends || []),
    ]
  );
  return { pkg: rows[0], created: true };
}

async function seedPackages(orgId, templatesByCode, q) {
  const results = { created: [], existing: [], published: [] };

  // Base — every policy acknowledgement lives here, so one edit reaches
  // everyone rather than six packages drifting apart.
  const policyReqCodes = catalogue.OPAL_POLICIES
    .filter((p) => p.ack)
    .map((p) => `REQ_ACK_${p.code}`);

  const baseDef = {
    ...catalogue.PACKAGE_BASE,
    extends: [],
  };
  const base = await upsertPackage(orgId, baseDef, q);
  if (base.created) {
    await setComposition(
      base.pkg.id,
      [...catalogue.PACKAGE_BASE.requirements, ...policyReqCodes],
      templatesByCode, q
    );
    results.created.push(baseDef.code);
  } else {
    results.existing.push(baseDef.code);
  }

  for (const ovl of catalogue.PACKAGE_OVERLAYS) {
    const r = await upsertPackage(orgId, { ...ovl, extends: [] }, q);
    if (r.created) {
      await setComposition(r.pkg.id, ovl.requirements, templatesByCode, q);
      results.created.push(ovl.code);
    } else {
      results.existing.push(ovl.code);
    }
  }

  for (const def of catalogue.PACKAGES) {
    const r = await upsertPackage(orgId, def, q);
    if (r.created) {
      // Assignable packages carry no requirements of their own — they are
      // entirely composition. That is the point.
      results.created.push(def.code);
    } else {
      results.existing.push(def.code);
    }
  }

  // Publish v1 of every assignable package so the Owner can assign
  // immediately. Base and overlays are never published: they are ingredients.
  for (const def of catalogue.PACKAGES) {
    const pkg = await odb.getPackageByCode(orgId, def.code, q);
    if (!pkg || pkg.current_version > 0) continue;
    const version = await odb.publishPackage(
      orgId, pkg, null, 'Initial version seeded from the Opal onboarding catalogue.', q
    );
    results.published.push(`${def.code} v${version.version}`);
  }

  return results;
}

async function seedOrgComplianceSlots(orgId, complianceByCode, q) {
  const created = [];
  for (const slot of catalogue.ORG_COMPLIANCE_SLOTS) {
    const { rows } = await q.query(
      `SELECT id FROM organisation_compliance_records
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND record_type = $2 LIMIT 1`,
      [orgId, slot.recordType]
    );
    if (rows.length) continue;
    await q.query(
      `INSERT INTO organisation_compliance_records
         (organisation_id, record_type, title, status, reminder_days, notes)
       VALUES ($1,$2,$3,'active',$4,$5)`,
      [
        orgId, slot.recordType, slot.title,
        JSON.stringify([90, 60, 30, 7]),
        'Seeded slot — record the policy details and expiry to enable renewal reminders.',
      ]
    );
    created.push(slot.recordType);
  }
  return created;
}

/**
 * Seed everything. Runs in one transaction so a partial catalogue can never
 * be left behind.
 */
async function seedOnboarding({ organisationId } = {}) {
  const orgId = organisationId || await resolveOrganisationId();
  if (!orgId) {
    log.warn('onboarding seed skipped — no organisation exists yet');
    return { skipped: true, reason: 'no_organisation' };
  }

  return odb.withTransaction(async (q) => {
    const complianceByCode = await seedComplianceSources(orgId, q);
    const docsByCode = await seedDocuments(orgId, complianceByCode, q);
    const templatesByCode = await seedRequirementTemplates(orgId, docsByCode, complianceByCode, q);
    const packages = await seedPackages(orgId, templatesByCode, q);
    const orgSlots = await seedOrgComplianceSlots(orgId, complianceByCode, q);

    // Ensure the settings key exists so the UI never renders an empty object.
    await odb.saveOnboardingSettings({}, q);

    const summary = {
      organisationId: orgId,
      complianceSources: complianceByCode.size,
      documents: docsByCode.size,
      requirementTemplates: templatesByCode.size,
      packagesCreated: packages.created.length,
      packagesExisting: packages.existing.length,
      packagesPublished: packages.published,
      orgComplianceSlots: orgSlots.length,
    };
    log.info('onboarding catalogue seeded', summary);
    return summary;
  });
}

// CLI: node onboarding-seed.js
if (require.main === module) {
  require('dotenv').config();
  seedOnboarding()
    .then((r) => { console.log(JSON.stringify(r, null, 2)); return pool.end(); })
    .then(() => process.exit(0))
    .catch((err) => { console.error('Seed failed:', err); process.exit(1); });
}

module.exports = { seedOnboarding, resolveOrganisationId };
