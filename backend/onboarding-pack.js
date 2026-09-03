'use strict';

/**
 * PHASE 2 — THE DOCUMENT PACK. Pure rules plus the ZIP builder.
 *
 * THE DEFAULT PACK IS DERIVED, THE PERSON'S PACK IS EDITED
 * ──────────────────────────────────────────────────────
 * buildDefaultItems() turns the record's pinned package version and its
 * facts (role, employment type, screening determinations) into a list of
 * pack items — the same engine that decides a requirement applies decides
 * a pack item applies. Items the requirement catalogue does not carry
 * (contract template, the super choice form, the new-employee form,
 * passport/visa, first aid, CPR, a police check for everyone) come from the
 * SUPPLEMENT below, gated by the same facts.
 *
 * The result is written as rows of onboarding_pack_items for that person
 * and never read again for the defaults: removing, renaming or replacing an
 * item there changes nobody else's pack.
 *
 * Each item answers four questions the Owner's table shows:
 *   sends_document        — does a file go out in the ZIP?
 *   employee_returns      — must something come back?
 *   requires_verification — does the practice check it?
 *   required              — can it be waived?
 */

const JSZip = require('jszip');
const engine = require('./onboarding-engine');

const R = {
  ALL: {},
  CASUAL: { fact: 'employment_type', op: 'eq', value: 'casual' },
  FIXED_TERM: { fact: 'employment_type', op: 'eq', value: 'fixed_term' },
  OT: { fact: 'role_category', op: 'eq', value: 'occupational_therapist' },
  PARTICIPANT_FACING: { fact: 'works_with_participants', op: 'is_true' },
  MOBILE: { fact: 'mobile_community_role', op: 'is_true' },
  OWN_VEHICLE: { fact: 'uses_own_vehicle', op: 'is_true' },
};

/**
 * Pack items the requirement templates do not carry, or carry as a portal
 * form rather than a document. `documentCode` names the library document
 * whose current file goes in the ZIP, when one is published.
 */
const SUPPLEMENT = [
  { code: 'PACK_CONTRACT', title: 'Contract of Employment', section: 'welcome_employment', sortOrder: 5,
    documentCode: 'DOC_CONTRACT_TEMPLATE', sends: true, returns: true, verifies: true, required: true, rule: R.ALL,
    description: 'Sent for signature; the signed contract comes back with the pack.' },
  { code: 'PACK_NEW_EMPLOYEE_DETAILS', title: 'New Employee Details Form', section: 'personal_details', sortOrder: 120,
    documentCode: 'DOC_NEW_EMPLOYEE_DETAILS', sends: true, returns: true, verifies: true, required: true, rule: R.ALL,
    description: 'Personal, emergency contact and bank details.' },
  { code: 'PACK_SUPER_CHOICE', title: 'Superannuation Standard Choice Form', section: 'payroll_tax_super', sortOrder: 140,
    documentCode: 'DOC_SUPER_CHOICE', sends: true, returns: true, verifies: true, required: true, rule: R.ALL,
    description: 'ATO NAT 13080. Completed and returned; the Tax File Number declaration is done online instead.' },
  { code: 'PACK_PASSPORT_VISA', title: 'Passport / visa documentation', section: 'identity', sortOrder: 220,
    sends: false, returns: true, verifies: true, required: true, rule: R.ALL,
    description: 'A copy of the passport, and the visa where the right to work depends on one.' },
  { code: 'PACK_POLICE_CHECK', title: 'National Police Check', section: 'screening', sortOrder: 330,
    sends: false, returns: true, verifies: true, required: true, rule: R.ALL,
    description: 'Issued within the last 12 months.' },
  { code: 'PACK_FIRST_AID', title: 'First Aid Certificate', section: 'screening', sortOrder: 360,
    sends: false, returns: true, verifies: true, required: false, rule: R.PARTICIPANT_FACING,
    description: 'A current certificate (HLTAID011 or equivalent).' },
  { code: 'PACK_CPR', title: 'CPR Certificate', section: 'screening', sortOrder: 370,
    sends: false, returns: true, verifies: true, required: false, rule: R.PARTICIPANT_FACING,
    description: 'A current CPR certificate (HLTAID009 or equivalent), renewed annually.' },
];

/** The induction pack's own items. Instructions go out; agreements come back signed; accounts and training are tracked, not sent. */
const INDUCTION_SUPPLEMENT = [
  { code: 'IND_SPLOSE_SETUP', title: 'Splose setup instructions', section: 'systems', sortOrder: 10, documentCode: 'DOC_SPLOSE_SETUP', sends: true, returns: false, verifies: false, required: true, rule: R.PARTICIPANT_FACING, itemKind: 'document' },
  { code: 'IND_OUTLOOK_SETUP', title: 'Outlook setup instructions', section: 'systems', sortOrder: 20, documentCode: 'DOC_OUTLOOK_SETUP', sends: true, returns: false, verifies: false, required: true, rule: R.ALL, itemKind: 'document' },
  { code: 'IND_PORTAL_SETUP', title: 'Opal Portal setup instructions', section: 'systems', sortOrder: 30, documentCode: 'DOC_PORTAL_SETUP', sends: true, returns: false, verifies: false, required: true, rule: R.ALL, itemKind: 'document' },
  { code: 'IND_PRIVACY_AGREEMENT', title: 'Privacy and Confidentiality Agreement', section: 'agreements', sortOrder: 100, documentCode: 'DOC_PRIVACY_AGREEMENT', sends: true, returns: true, verifies: false, required: true, rule: R.ALL, itemKind: 'document' },
  { code: 'IND_CODE_OF_CONDUCT', title: 'Code of Conduct Agreement', section: 'agreements', sortOrder: 110, documentCode: 'DOC_CODE_OF_CONDUCT_AGREEMENT', sends: true, returns: true, verifies: false, required: true, rule: R.ALL, itemKind: 'document' },
  { code: 'IND_HANDBOOK', title: 'Staff Handbook acknowledgement', section: 'agreements', sortOrder: 120, documentCode: 'DOC_HANDBOOK', sends: true, returns: true, verifies: false, required: false, rule: R.ALL, itemKind: 'document' },
  { code: 'IND_SPLOSE_ACTIVE', title: 'Splose account activated', section: 'accounts', sortOrder: 300, sends: false, returns: false, verifies: false, required: true, rule: R.PARTICIPANT_FACING, itemKind: 'account', linkedTaskCode: 'systems_access', description: 'Marked ready when the internal set-up task is done.' },
  { code: 'IND_OUTLOOK_ACTIVE', title: 'Outlook account activated', section: 'accounts', sortOrder: 310, sends: false, returns: false, verifies: false, required: true, rule: R.ALL, itemKind: 'account', linkedTaskCode: 'work_email', description: 'Marked ready when the internal set-up task is done.' },
  { code: 'IND_PORTAL_ACTIVE', title: 'Opal Portal account activated', section: 'accounts', sortOrder: 320, sends: false, returns: false, verifies: false, required: true, rule: R.ALL, itemKind: 'account', linkedTaskCode: 'portal_account', description: 'Marked ready when the internal set-up task is done.' },
  { code: 'IND_TRAINING', title: 'Opal induction training', section: 'training', sortOrder: 400, sends: false, returns: false, verifies: false, required: true, rule: R.ALL, itemKind: 'training', linkedTaskCode: 'induction_walkthrough', description: 'The portal induction walkthrough, assigned through Learning.' },
];

/** Requirement sections that belong to the induction pack, not the documentation pack. */
const INDUCTION_SECTIONS = new Set(['policies', 'ndis', 'training']);
const INDUCTION_REQ_CODES = new Set(['REQ_HANDBOOK', 'REQ_WELCOME', 'REQ_INJURY_INFO', 'REQ_POSITION_DESCRIPTION']);

/** Requirement codes whose portal form is replaced in the pack by a supplement document. */
const REPLACED_BY_SUPPLEMENT = new Set([
  'REQ_PERSONAL_DETAILS', 'REQ_EMERGENCY_CONTACT', 'REQ_BANK_DETAILS', 'REQ_SUPER_SETUP',
  'REQ_CONTRACT', 'REQ_POLICE_CHECK',
  // Identity and right to work are the passport / visa documentation in the paper model.
  'REQ_IDENTITY', 'REQ_RIGHT_TO_WORK',
]);

/** Requirement handlers that are not documents at all. */
const NOT_A_DOCUMENT = new Set(['employer_task', 'training', 'live_source']);

/** Section order for the table. */
const SECTION_BASE = {
  welcome_employment: 0, personal_details: 100, payroll_tax_super: 130, identity: 200,
  professional: 250, screening: 300, ndis: 400, policies: 500, training: 600,
  systems: 0, agreements: 100, accounts: 300,
};

/** Which phase a requirement-derived item belongs to. */
function phaseOf(req) {
  if (INDUCTION_SECTIONS.has(req.section) || INDUCTION_REQ_CODES.has(req.template_code) || /^REQ_ACK_/.test(req.template_code || '')) return 'induction';
  return 'documentation';
}

const TITLE_OVERRIDES = {
  REQ_TAX_SETUP: 'Tax File Number Declaration (online via myGov)',
  REQ_IDENTITY: 'Identity verification',
  REQ_RIGHT_TO_WORK: 'Right to Work documentation',
  REQ_AHPRA: 'AHPRA registration',
  REQ_DRIVERS_LICENCE: "Driver's licence",
  REQ_VEHICLE: 'Vehicle details and insurance',
};

/** Map one applicable requirement to a pack item, or null when it is not a document. */
function itemFromRequirement(item, index) {
  if (NOT_A_DOCUMENT.has(item.handler)) return null;
  if (REPLACED_BY_SUPPLEMENT.has(item.template_code)) return null;
  const hasDoc = !!item.document_id;
  const config = item.config || {};
  let sends = hasDoc;
  let returns; let verifies = item.requires_employer_verification === true;
  switch (item.handler) {
    case 'document_ack':
    case 'info':
      returns = verifies || config.requiresTypedName === true;
      break;
    case 'form':
      returns = true;
      // The tax declaration is done online; nothing is sent and the summary comes back.
      if (item.template_code === 'REQ_TAX_SETUP') { sends = false; verifies = true; }
      break;
    case 'credential':
    case 'upload':
      returns = true; verifies = true;
      break;
    default:
      returns = verifies;
  }
  return {
    code: item.template_code,
    title: TITLE_OVERRIDES[item.template_code] || item.title,
    description: item.summary || null,
    section: item.section || null,
    sends, returns, verifies,
    required: item.mandatory !== false,
    requirementCode: item.template_code,
    documentId: item.document_id || null,
    documentVersionId: item.document_version_id || null,
    documentCode: item.document_code || (item.document && item.document.code) || null,
    officialSourceUrl: (item.document && item.document.officialSourceUrl) || item.external_url || null,
    sortOrder: (SECTION_BASE[item.section] ?? 700) + 10 + index,
  };
}

/**
 * The default pack for one person.
 *
 * @param {object} versionContent the pinned package version's content
 * @param {object} facts          engine facts frozen on the assignment
 * @param {Map<string,object>} libraryByCode library documents keyed by code
 *        (rows from odb.listDocuments — current_version_id, current_file_*, official_source_url)
 * @returns {object[]} items in pack order
 */
function buildDefaultItems(versionContent, facts, libraryByCode = new Map(), phase = 'documentation') {
  const { applied } = engine.selectApplicable(versionContent, facts);
  const items = [];
  applied.forEach((req, i) => {
    if (phaseOf(req) !== phase) return;
    const it = itemFromRequirement(req, i);
    if (it) items.push({ ...it, phase, itemKind: 'document' });
  });

  const supplement = phase === 'induction' ? INDUCTION_SUPPLEMENT : SUPPLEMENT;
  for (const s of supplement) {
    if (!engine.evaluateRule(s.rule, facts)) continue;
    const lib = s.documentCode ? libraryByCode.get(s.documentCode) : null;
    // The supplement owns its document: a requirement the seed generated for
    // the same library document (an acknowledgement row) would send it twice.
    if (lib) {
      for (let i = items.length - 1; i >= 0; i -= 1) if (items[i].documentId === lib.id) items.splice(i, 1);
    }
    items.push({
      code: s.code, title: s.title, description: s.description, section: s.section,
      sends: s.sends, returns: s.returns, verifies: s.verifies, required: s.required,
      requirementCode: null, phase, itemKind: s.itemKind || 'document', linkedTaskCode: s.linkedTaskCode || null,
      documentId: lib ? lib.id : null,
      documentVersionId: lib ? (lib.current_version_id || null) : null,
      documentCode: s.documentCode || null,
      officialSourceUrl: lib ? (lib.official_source_url || null) : null,
      sortOrder: s.sortOrder,
    });
  }

  // Package-level manual additions (038's onboarding_package_documents) travel with the documentation pack.
  const pack = phase === 'documentation' ? versionContent && versionContent.starterPack : null;
  const known = new Set(items.map((i) => i.documentId).filter(Boolean));
  for (const d of (pack && Array.isArray(pack.documents) ? pack.documents : [])) {
    if (!d.documentId || known.has(d.documentId)) continue;
    known.add(d.documentId);
    items.push({
      code: `DOC_${String(d.documentCode || d.documentId).replace(/^DOC_/, '')}`.slice(0, 80),
      title: d.title || d.libraryTitle, description: null, section: 'policies',
      sends: true, returns: false, verifies: false, required: false, phase, itemKind: 'document',
      requirementCode: null, documentId: d.documentId, documentVersionId: d.documentVersionId || null,
      documentCode: d.documentCode || null, officialSourceUrl: d.officialSourceUrl || null,
      sortOrder: 500 + (d.position || 0),
    });
  }

  items.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  return items;
}

/**
 * Apply the package's saved tweaks (onboarding_pack_defaults rows) to a
 * derived list. Removals drop; overrides patch; adds append.
 */
function applyDefaults(items, defaults, phase) {
  const rows = (defaults || []).filter((d) => d.phase === phase);
  if (!rows.length) return items;
  const byCode = new Map(rows.map((d) => [d.code, d]));
  const out = [];
  for (const it of items) {
    const d = byCode.get(it.code);
    if (!d) { out.push(it); continue; }
    if (d.action === 'remove') continue;
    out.push({
      ...it,
      title: d.title || it.title, description: d.description ?? it.description,
      sends: d.sends_document ?? it.sends, returns: d.employee_returns ?? it.returns,
      verifies: d.requires_verification ?? it.verifies, required: d.required ?? it.required,
      sortOrder: d.sort_order ?? it.sortOrder,
    });
  }
  for (const d of rows) {
    if (d.action !== 'add') continue;
    out.push({
      code: d.code, title: d.title || 'Document', description: d.description || null, section: phase === 'induction' ? 'agreements' : 'policies',
      sends: d.sends_document !== false, returns: d.employee_returns === true, verifies: d.requires_verification === true, required: d.required !== false,
      requirementCode: null, phase, itemKind: 'document', linkedTaskCode: null,
      documentId: d.document_id || null, documentVersionId: d.current_version_id || null, documentCode: d.document_code || null,
      officialSourceUrl: d.official_source_url || null, sortOrder: d.sort_order ?? 900,
    });
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  return out;
}

/** Representative facts for a package, so its default pack can be shown without an employee. */
function sampleFactsFor(pkg, settings) {
  const engine2 = require('./onboarding-engine');
  const ot = pkg.role_category === 'occupational_therapist';
  return engine2.buildFacts({
    employment_type: pkg.employment_type || 'full_time', role_category: pkg.role_category || 'administration', proposed_role: ot ? 'therapist' : 'admin',
    is_treating_therapist: ot, child_related_work: ot ? 'yes' : 'no', ndis_risk_assessed_role: ot ? 'yes' : 'no',
    mobile_community_role: ot, uses_own_vehicle: ot, new_graduate: false, work_rights_check_required: false,
  }, settings || {});
}

// ── The ZIP ─────────────────────────────────────────────────────────────────

function safeStem(title, fallback = 'Document') {
  const s = String(title || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || fallback;
}
const EXT_BY_MIME = {
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/png': 'png', 'image/jpeg': 'jpg', 'text/plain': 'txt', 'application/rtf': 'rtf',
};
function extFor(mime, fileName) {
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'bin';
}
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Perth' }) : null);

/** The Read Me that leads the ZIP: what is enclosed, what must come back. */
function buildReadme({ orgName, employeeName, roleTitle, dueDate, returnEmail, items, packName }) {
  const org = orgName || 'Opal Therapy';
  const enclosed = items.filter((i) => i.entryName);
  const returns = items.filter((i) => i.employee_returns);
  const lines = [
    `${org} — ${packName || 'Onboarding Documentation Pack'}`,
    `Prepared for: ${employeeName || 'New starter'}${roleTitle ? ` (${roleTitle})` : ''}`,
    '',
    'ENCLOSED',
    ...enclosed.map((i, n) => `  ${String(n + 1).padStart(2, '0')}. ${i.title}`),
    '',
    'PLEASE COMPLETE AND RETURN',
    ...returns.map((i) => `  • ${i.title}${i.required ? '' : ' (if applicable)'}${i.entryName ? '' : ' — your own copy'}`),
    '',
    dueDate ? `Please return everything by ${fmtDate(dueDate)}.` : 'Please return everything within seven days.',
    returnEmail ? `Return to: ${returnEmail}` : '',
    '',
    'Documents that ask for your own copy (passport, checks, certificates) are not enclosed — please scan or photograph yours.',
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}

/**
 * Build the ZIP from resolved items.
 *
 * @param {object[]} resolved items with { title, required, employee_returns, sends_document,
 *                            file: { bytes, mime, fileName } | null, unavailableReason }
 * @returns {{ buffer, manifest, omissions, fileName }}
 */
async function buildPackZip(resolved, meta) {
  const zip = new JSZip();
  const manifest = [];
  const omissions = [];
  const used = new Set();
  let position = 0;

  for (const item of resolved) {
    if (!item.sends_document) continue;
    if (!item.file || !item.file.bytes || !item.file.bytes.length) {
      omissions.push({ code: item.code, title: item.title, reason: item.unavailableReason || 'No file behind this document' });
      continue;
    }
    position += 1;
    const ext = extFor(item.file.mime, item.file.fileName);
    let name = `${String(position).padStart(2, '0')} - ${safeStem(item.title)}.${ext}`;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${String(position).padStart(2, '0')} - ${safeStem(item.title)} (${n++}).${ext}`;
    used.add(name.toLowerCase());
    zip.file(name, item.file.bytes, { date: new Date(0), binary: true });
    item.entryName = name;
    manifest.push({
      position, fileName: name, title: item.title, code: item.code, itemId: item.id || null,
      documentId: item.document_id || null, documentVersionId: item.document_version_id || null,
      source: item.file.source, sizeBytes: item.file.bytes.length, mime: item.file.mime,
      sha256: require('crypto').createHash('sha256').update(item.file.bytes).digest('hex'),
    });
  }

  zip.file('00 - Read Me First.txt', buildReadme({ ...meta, items: resolved }), { date: new Date(0) });

  const buffer = await zip.generateAsync({
    type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX',
  });
  return {
    buffer, manifest, omissions,
    fileName: `${safeStem(meta.orgName, 'Opal Therapy')} - ${safeStem(meta.employeeName, 'New starter')} - Onboarding Documentation Pack.zip`,
  };
}

module.exports = {
  SUPPLEMENT, INDUCTION_SUPPLEMENT, INDUCTION_SECTIONS, REPLACED_BY_SUPPLEMENT, NOT_A_DOCUMENT, TITLE_OVERRIDES, phaseOf,
  itemFromRequirement, buildDefaultItems, applyDefaults, sampleFactsFor, buildPackZip, buildReadme, safeStem, extFor,
};
