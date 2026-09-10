'use strict';

/**
 * EDIT ONBOARDING — the default copy each package starts from.
 *
 *   GET  /api/onboarding/journey/defaults                    the packages
 *   GET  /api/onboarding/journey/defaults/:packageId         three phases: letter + Email 1, documentation pack, induction pack + Email 3
 *   GET  …/defaults/:packageId/letter/preview.docx           the letter template filled with a sample employee
 *   POST …/defaults/:packageId/items                         add a document to a phase's default pack
 *   PATCH …/defaults/:packageId/items/:code                  rename / flags / remove / restore (body.removed)
 *   POST …/defaults/:packageId/restore                       clear every tweak for a phase (body.phase)
 *
 * Nothing here sends anything. Tweaks are stored as package-level overrides
 * and applied when a NEW record's packs are derived; records already
 * started keep their own copies.
 */

const express = require('express');
const router = express.Router();

const odb = require('./onboarding-db');
const pdb = require('./onboarding-pack-db');
const pack = require('./onboarding-pack');
const { PACK_SECTIONS } = pack;
const offerDocx = require('./onboarding-offer-docx');
const offerPdf = require('./onboarding-offer-pdf');
const offerEmail = require('./onboarding-offer-email');
const packEmail = require('./onboarding-pack-email');
const induction = require('./onboarding-induction');
const { auditOnboarding } = require('./onboarding-audit');
const { requireAuth, requirePermission } = require('./permissions');
const log = require('./logger').createLogger('onboarding-defaults');

const orgOf = (req) => req.user?.organisation_id || null;
const { isUuid, str } = odb;
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('defaults route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});
const notFound = (res) => res.status(404).json({ error: 'Not found' });
const PHASES = ['documentation', 'induction'];

async function loadPackage(req) {
  if (!isUuid(req.params.packageId)) return null;
  const pkg = await odb.getPackage(orgOf(req), req.params.packageId);
  return pkg && pkg.kind === 'package' ? pkg : null;
}

/** The derived default items for a package with its tweaks applied, shaped for the editor. */
async function defaultItems(req, pkg, phase) {
  const version = await odb.getCurrentPackageVersion(pkg.id);
  // The shipped Stage 2 and Stage 3 files are published into the library the first time anyone looks, so the master default is never shown empty.
  await require('./onboarding-pack-routes')._internals.ensurePlaceholderDocuments(orgOf(req));
  const library = await odb.listDocuments(orgOf(req));
  const byCode = new Map(library.map((d) => [d.code, d]));
  const byId = new Map(library.map((d) => [d.id, d]));
  const settings = await odb.getOnboardingSettings();
  const facts = pack.sampleFactsFor(pkg, settings);
  const derived = pack.buildDefaultItems(version ? version.content : {}, facts, byCode, phase);
  const defaults = await pdb.listPackDefaults(pkg.id);
  const applied = pack.applyDefaults(derived, defaults, phase);
  const tweaks = new Map(defaults.filter((d) => d.phase === phase).map((d) => [d.code, d]));
  const removed = derived.filter((it) => tweaks.get(it.code) && tweaks.get(it.code).action === 'remove');

  const shape = (it, status) => {
    const doc = it.documentId ? byId.get(it.documentId) : null;
    const hasFile = !!(doc && doc.current_file_name);
    const hasBody = !!(doc && doc.has_content && !doc.current_file_name);
    const t = tweaks.get(it.code);
    return {
      code: it.code, title: it.title, description: it.description || null, section: it.section || null,
      sendsDocument: it.sends === true, employeeReturns: it.returns === true, requiresVerification: it.verifies === true, required: it.required !== false,
      itemKind: it.itemKind || 'document', linkedTaskCode: it.linkedTaskCode || null,
      group: t && t.action === 'add' ? 'added' : pack.groupOf(it.code), parentCode: pack.parentOf(it.code),
      origin: t && t.action === 'add' ? 'added' : 'default', tweaked: !!t && t.action !== 'add', status,
      library: doc ? { documentId: doc.id, code: doc.code, title: doc.title, contentStatus: doc.content_status } : null,
      file: {
        source: hasFile ? 'library' : hasBody ? 'body' : doc && (doc.content_status === 'link_only' || doc.official_source_url) ? 'link' : 'none',
        fileName: hasFile ? doc.current_file_name : null, previewKind: hasFile ? (doc.current_file_mime === 'application/pdf' ? 'pdf' : String(doc.current_file_mime || '').includes('wordprocessingml') ? 'docx' : null) : null,
        previewUrl: hasFile && doc.current_version_id ? `/api/onboarding/documents/${doc.id}/versions/${doc.current_version_id}/download` : null,
        unavailableReason: !it.sends ? null : hasFile || hasBody ? null : doc ? 'No file has been published for this document yet' : 'No document attached',
      },
      officialSourceUrl: (doc && doc.official_source_url) || it.officialSourceUrl || null,
    };
  };
  return [...applied.map((it) => shape(it, 'included')), ...removed.map((it) => shape(it, 'removed'))];
}

router.use('/api/onboarding/journey/defaults', requireAuth);

router.get('/api/onboarding/journey/defaults', requirePermission('onboarding.view'), safe(async (req, res) => {
  const all = await odb.listPackages(orgOf(req), { kind: 'package' });
  const defaults = await odb.pool.query('SELECT package_id, COUNT(*)::int AS n FROM onboarding_pack_defaults WHERE organisation_id IS NOT DISTINCT FROM $1 GROUP BY package_id', [orgOf(req)]);
  const tweaks = new Map(defaults.rows.map((r) => [r.package_id, r.n]));
  res.json({
    ok: true,
    packages: all.filter((p) => p.status !== 'archived').map((p) => ({
      id: p.id, code: p.code, title: p.title, roleCategory: p.role_category, employmentType: p.employment_type,
      published: p.status === 'published' && Number(p.current_version) > 0, tweaks: tweaks.get(p.id) || 0,
    })),
  });
}));

router.get('/api/onboarding/journey/defaults/:packageId', requirePermission('onboarding.view'), safe(async (req, res) => {
  const pkg = await loadPackage(req);
  if (!pkg) return notFound(res);
  const sample = { name: 'Sample Employee', position: pkg.title.split('—')[0].trim() };
  const [documentation, inductionItems] = await Promise.all([defaultItems(req, pkg, 'documentation'), defaultItems(req, pkg, 'induction')]);
  res.json({
    ok: true,
    package: { id: pkg.id, code: pkg.code, title: pkg.title, roleCategory: pkg.role_category, employmentType: pkg.employment_type, published: pkg.status === 'published' && Number(pkg.current_version) > 0 },
    letter: { previewUrl: `/api/onboarding/journey/defaults/${pkg.id}/letter/preview.docx`, downloadUrl: `/api/onboarding/journey/defaults/${pkg.id}/letter/preview.docx?download=1`, pdfUrl: `/api/onboarding/journey/defaults/${pkg.id}/letter/download.pdf`, templateVersion: offerDocx.TEMPLATE_VERSION, sample },
    emails: {
      offer: offerEmail.composeOfferEmail({ applicantName: sample.name, positionTitle: sample.position }),
      documentation: packEmail.composePackEmail({ applicantName: sample.name }),
      induction: induction.composeInductionEmail({ applicantName: sample.name }),
    },
    phases: { documentation: { items: documentation }, induction: { items: inductionItems } },
    can: { edit: require('./permissions').hasPermission(req.user, 'onboarding.manage_packages') },
  });
}));

async function sampleLetter(pkg, org) {
  const settings = await odb.getOnboardingSettings();
  const start = new Date(); start.setDate(start.getDate() + 28);
  const ot = pkg.role_category === 'occupational_therapist';
  let bytes = await offerDocx.buildOfferDocx({
    templateBuffer: await require('./onboarding-offer-template').currentTemplateBuffer(org),
    terms: { positionTitle: pkg.title.split('—')[0].trim(), employmentType: pkg.employment_type || 'full_time', startDate: start.toISOString().slice(0, 10),
      payBasis: pkg.employment_type === 'casual' ? 'hourly' : 'annual', payRate: pkg.employment_type === 'casual' ? 45 : 90000, hoursPerWeek: pkg.employment_type === 'casual' ? null : 38, probationMonths: 3 },
    applicant: { name: 'Sample Employee', email: 'sample.employee@example.com', mobile: '0400 000 000' },
    signatory: { name: settings.offerSignatoryName, title: settings.offerSignatoryTitle, email: settings.offerSignatoryEmail, phone: settings.offerSignatoryPhone },
    isTreatingTherapist: ot,
  });
  return bytes;
}

router.get('/api/onboarding/journey/defaults/:packageId/letter/download.pdf', requirePermission('onboarding.view'), safe(async (req, res) => {
  const pkg = await loadPackage(req);
  if (!pkg) return notFound(res);
  let pdf;
  try {
    pdf = await offerPdf.offerPdfFromDocx(await sampleLetter(pkg, orgOf(req)), { title: 'Letter of Offer — template preview' });
  } catch (err) {
    log.error('sample letter could not be rendered as PDF', { error: err, packageId: pkg.id });
    return res.status(500).json({ error: 'The PDF could not be generated.', code: 'pdf_failed' });
  }
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', offerPdf.PDF_MIME);
  res.set('Content-Length', String(pdf.length));
  res.set('Content-Disposition', 'attachment; filename="Letter of Offer - template preview.pdf"');
  res.send(pdf);
}));

router.get('/api/onboarding/journey/defaults/:packageId/letter/preview.docx', requirePermission('onboarding.view'), safe(async (req, res) => {
  const pkg = await loadPackage(req);
  if (!pkg) return notFound(res);
  let bytes = await sampleLetter(pkg, orgOf(req));
  const download = req.query.download === '1';
  if (!download) { try { bytes = await require('./fca/preview-pagination').paginateForPreview(bytes); } catch (_) { /* preview only */ } }
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', offerDocx.DOCX_MIME);
  res.set('Content-Length', String(bytes.length));
  res.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="Letter of Offer - template preview.docx"`);
  res.send(bytes);
}));

router.post('/api/onboarding/journey/defaults/:packageId/items', requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
  const pkg = await loadPackage(req);
  if (!pkg) return notFound(res);
  const b = req.body || {};
  const phase = PHASES.includes(b.phase) ? b.phase : 'documentation';
  let title = str(b.title, 250); let doc = null;
  if (b.documentId) {
    if (!isUuid(b.documentId)) return res.status(400).json({ error: 'documentId is not valid' });
    doc = await odb.getDocument(orgOf(req), b.documentId);
    if (!doc) return res.status(400).json({ error: 'Unknown library document' });
    title = title || doc.title;
  }
  if (!title) return res.status(400).json({ error: 'A document name is required' });
  const code = `DEF_${require('crypto').randomBytes(4).toString('hex').toUpperCase()}`;
  // The heading the document files under — the section's own + Add document button sets it.
  const section = PACK_SECTIONS.has(b.section) ? b.section : null;
  await pdb.upsertPackDefault({
    organisationId: orgOf(req), packageId: pkg.id, phase, code, action: 'add', actorId: req.user.id,
    patch: { title, description: b.description, sends: b.sendsDocument !== false, returns: b.employeeReturns === true, verifies: b.requiresVerification === true, required: b.required !== false, documentId: doc ? doc.id : null, sortOrder: 900, section },
  });
  await auditOnboarding(req, 'pack_default_added', { targetType: 'onboarding_package', targetId: pkg.id, metadata: { packageId: pkg.id, phase, code, section, documentId: doc ? doc.id : null } });
  res.status(201).json({ ok: true, items: await defaultItems(req, pkg, phase), phase });
}));

router.patch('/api/onboarding/journey/defaults/:packageId/items/:code', requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
  const pkg = await loadPackage(req);
  if (!pkg) return notFound(res);
  const b = req.body || {};
  const phase = PHASES.includes(b.phase) ? b.phase : 'documentation';
  const code = str(req.params.code, 80);
  const existing = (await pdb.listPackDefaults(pkg.id)).find((d) => d.phase === phase && d.code === code);
  const isAdded = existing && existing.action === 'add';
  if (b.removed === true) {
    if (isAdded) await pdb.deletePackDefault(pkg.id, phase, code);
    else await pdb.upsertPackDefault({ organisationId: orgOf(req), packageId: pkg.id, phase, code, action: 'remove', actorId: req.user.id });
  } else if (b.removed === false && existing && existing.action === 'remove') {
    await pdb.deletePackDefault(pkg.id, phase, code);
  } else {
    if (b.title !== undefined && !str(b.title, 250)) return res.status(400).json({ error: 'A document name is required' });
    await pdb.upsertPackDefault({
      organisationId: orgOf(req), packageId: pkg.id, phase, code, action: isAdded ? 'add' : 'override', actorId: req.user.id,
      patch: { title: b.title, description: b.description, sends: b.sendsDocument, returns: b.employeeReturns, verifies: b.requiresVerification, required: b.required },
    });
  }
  await auditOnboarding(req, 'pack_default_updated', { targetType: 'onboarding_package', targetId: pkg.id, metadata: { packageId: pkg.id, phase, code, fields: Object.keys(b) } });
  res.json({ ok: true, items: await defaultItems(req, pkg, phase), phase });
}));

/**
 * Upload (or replace) the file behind a default item. The file becomes a
 * published version of the library document — so every package and every
 * new onboarding that uses the document gets it — and an item that had no
 * library document gets one created for it.
 */
router.post('/api/onboarding/journey/defaults/:packageId/items/:code/file', requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
  const pkg = await loadPackage(req);
  if (!pkg) return notFound(res);
  const b = req.body || {};
  const phase = PHASES.includes(b.phase) ? b.phase : 'documentation';
  const code = str(req.params.code, 80);
  const item = (await defaultItems(req, pkg, phase)).find((i) => i.code === code);
  if (!item) return notFound(res);
  const up = require('./onboarding-pack-routes')._internals.readUpload(b);
  if (up.error) return res.status(400).json({ error: up.error });

  let documentId = item.library ? item.library.documentId : null;
  if (!documentId) {
    const created = await odb.upsertDocument(orgOf(req), {
      code: `DOC_${code.replace(/^(PACK_|REQ_|IND_|DEF_)/, '').slice(0, 60)}_${require('crypto').randomBytes(2).toString('hex').toUpperCase()}`,
      title: item.title, category: phase === 'induction' ? 'Employment' : 'Employment', classification: 'OPAL_FORM', audience: 'employee',
      ownerControlled: true, contentStatus: 'available', status: 'published',
    }, req.user.id);
    documentId = created.id;
    await pdb.upsertPackDefault({ organisationId: orgOf(req), packageId: pkg.id, phase, code, action: item.origin === 'added' ? 'add' : 'override', actorId: req.user.id, patch: { documentId } });
  }
  const version = await odb.createDocumentVersion(documentId, {
    title: item.title, fileName: up.fileName, fileMime: up.fileMime, fileData: up.buffer.toString('base64'), fileSizeBytes: up.buffer.length,
    effectiveDate: new Date().toISOString().slice(0, 10), changeNote: 'Uploaded from Edit Onboarding',
  }, req.user.id);
  await odb.publishDocumentVersion(documentId, version.id, req.user.id);
  await odb.pool.query(`UPDATE onboarding_documents SET content_status = 'available', status = 'published', updated_at = NOW() WHERE id = $1`, [documentId]);
  await auditOnboarding(req, 'pack_default_file_uploaded', { targetType: 'onboarding_document', targetId: documentId, metadata: { packageId: pkg.id, phase, code, versionId: version.id, bytes: up.buffer.length } });
  res.status(201).json({ ok: true, items: await defaultItems(req, pkg, phase), phase });
}));

/** Rename the file behind a default item — the library document's current published version, so every pack that uses it follows. */
router.patch('/api/onboarding/journey/defaults/:packageId/items/:code/file', requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
  const pkg = await loadPackage(req);
  if (!pkg) return notFound(res);
  const b = req.body || {};
  const phase = PHASES.includes(b.phase) ? b.phase : 'documentation';
  const code = str(req.params.code, 80);
  const item = (await defaultItems(req, pkg, phase)).find((i) => i.code === code);
  if (!item) return notFound(res);
  const fileName = String((req.body || {}).fileName || '').trim().replace(/[\\/\u0000-\u001f]/g, '');
  if (!fileName || fileName.length > 255) return res.status(400).json({ error: 'Give the file a name (up to 255 characters).' });
  if (!item.library || item.file.source !== 'library') return res.status(400).json({ error: 'This document has no file to rename yet.' });
  const renamed = await odb.renameCurrentVersionFile(item.library.documentId, fileName);
  if (!renamed) return res.status(400).json({ error: 'This document has no file to rename yet.' });
  await auditOnboarding(req, 'pack_default_file_renamed', { targetType: 'onboarding_document', targetId: item.library.documentId, metadata: { packageId: pkg.id, phase, code, versionId: renamed.id } });
  res.json({ ok: true, items: await defaultItems(req, pkg, phase), phase });
}));

router.post('/api/onboarding/journey/defaults/:packageId/restore', requirePermission('onboarding.manage_packages'), safe(async (req, res) => {
  const pkg = await loadPackage(req);
  if (!pkg) return notFound(res);
  const phase = PHASES.includes(req.body?.phase) ? req.body.phase : 'documentation';
  const n = await pdb.clearPackDefaults(pkg.id, phase);
  await auditOnboarding(req, 'pack_defaults_restored', { targetType: 'onboarding_package', targetId: pkg.id, metadata: { packageId: pkg.id, phase, cleared: n } });
  res.json({ ok: true, items: await defaultItems(req, pkg, phase), phase });
}));

module.exports = router;
module.exports._internals = { defaultItems };
