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
 * THE DOCUMENTATION PACK — the same list for every package, every role and
 * every contract type. Four documents go out in the ZIP; the New Employee
 * Details come back with the supporting documents grouped beneath it.
 *
 *   group 'attachment'  — sent in the ZIP (and, mostly, returned completed)
 *   group 'supporting'  — the employee's own documents, returned with the
 *                         New Employee Details (parentCode)
 *
 * `documentCode` names the library document whose current file goes in the
 * ZIP; where the library has none yet, the file shipped with the portal
 * (`shippedFile`, backend/onboarding-templates/stage2) is published for it —
 * or a placeholder where nothing is shipped — so the pack can be assembled
 * and sent end to end. CEIS and FTCIS go only to the contract types that
 * call for them (rule). `requiredRule`
 * decides whether an item is required for this person; it is still listed
 * for everyone ("if applicable" when not required).
 */
const DOCUMENTATION_PACK = [
  { code: 'PACK_CONTRACT', title: 'Contract of Employment', section: 'welcome_employment', sortOrder: 10, group: 'attachment',
    documentCode: 'DOC_CONTRACT_TEMPLATE', shippedFile: 'contract-of-employment.docx', sends: true, returns: true, verifies: true,
    description: 'Sent for signature; the signed contract comes back with the pack.' },
  { code: 'PACK_SUPER_CHOICE', title: 'Superannuation Form', section: 'payroll_tax_super', sortOrder: 20, group: 'attachment',
    documentCode: 'DOC_SUPER_CHOICE', shippedFile: 'superannuation-standard-choice-form.pdf', sends: true, returns: true, verifies: true,
    description: 'ATO Superannuation Standard Choice Form, completed and returned.' },
  { code: 'PACK_FWIS', title: 'FWIS (and FTCIS/CEIS)', section: 'welcome_employment', sortOrder: 30, group: 'attachment',
    documentCode: 'DOC_FWIS', shippedFile: 'fair-work-information-statement.pdf', sends: true, returns: false, verifies: false,
    description: 'Fair Work Information Statement. For reading; nothing comes back. The Casual or Fixed Term statement below goes with it where the contract type calls for one.' },
  { code: 'PACK_CEIS', title: 'Casual Employment Information Statement (CEIS)', section: 'welcome_employment', sortOrder: 31, group: 'attachment', rule: R.CASUAL,
    documentCode: 'DOC_CEIS', shippedFile: 'casual-employment-information-statement.pdf', sends: true, returns: false, verifies: false,
    description: 'Goes out with the FWIS to casual starters. For reading; nothing comes back.' },
  { code: 'PACK_FTCIS', title: 'Fixed Term Contract Information Statement (FTCIS)', section: 'welcome_employment', sortOrder: 32, group: 'attachment', rule: R.FIXED_TERM,
    documentCode: 'DOC_FTCIS', shippedFile: 'fixed-term-contract-information-statement.pdf', sends: true, returns: false, verifies: false,
    description: 'Goes out with the FWIS to fixed-term starters. For reading; nothing comes back.' },
  { code: 'PACK_NEW_EMPLOYEE_DETAILS', title: 'New Employee Details', section: 'personal_details', sortOrder: 40, group: 'attachment',
    documentCode: 'DOC_NEW_EMPLOYEE_DETAILS', shippedFile: 'new-employee-details.docx', sends: true, returns: true, verifies: true,
    description: 'Personal, emergency contact and bank details, returned together with the supporting documents below.' },
  // Supporting documents — the attachments the New Employee Details form
  // itself asks for, one per form section, in the form's order. Details
  // (visa type, licence number, clearance numbers) are written into the
  // form; only the copies are separate items. Every one sits beneath the
  // New Employee Details (section + parentCode), not under its own heading.
  { code: 'REQ_DRIVERS_LICENCE', title: "Driver's licence (front and back)", section: 'personal_details', sortOrder: 110, group: 'supporting', parentCode: 'PACK_NEW_EMPLOYEE_DETAILS', sends: false, returns: true, verifies: true, description: "Form section: Driver's Licence Details. Vehicle registration and insurance too where the role uses a vehicle." },
  { code: 'REQ_IDENTITY', title: 'Passport photo page (identity and right to work)', section: 'personal_details', sortOrder: 120, group: 'supporting', parentCode: 'PACK_NEW_EMPLOYEE_DETAILS', sends: false, returns: true, verifies: true, description: 'Form section: Working Rights and Identity Verification. Other identity documents may be asked for to complete a 100-point check.' },
  { code: 'REQ_RIGHT_TO_WORK', title: 'Visa evidence / VEVO check', section: 'personal_details', sortOrder: 130, group: 'supporting', parentCode: 'PACK_NEW_EMPLOYEE_DETAILS', sends: false, returns: true, verifies: true, requiredRule: null, description: 'Only where the employee is not an Australian citizen or permanent resident; visa details go in the form.' },
  { code: 'REQ_AHPRA', title: 'AHPRA registration certificate', section: 'personal_details', sortOrder: 140, group: 'supporting', parentCode: 'PACK_NEW_EMPLOYEE_DETAILS', sends: false, returns: true, verifies: true, requiredRule: R.OT, description: 'Form section: AHPRA Registration Details.' },
  { code: 'PACK_FIRST_AID', title: 'First Aid / CPR certificate', section: 'personal_details', sortOrder: 150, group: 'supporting', parentCode: 'PACK_NEW_EMPLOYEE_DETAILS', sends: false, returns: true, verifies: true, requiredRule: R.PARTICIPANT_FACING, description: 'Form section: First Aid and CPR Certification (HLTAID011 and HLTAID009 or equivalent).' },
  { code: 'REQ_NDIS_SCREENING', title: 'NDIS Worker Screening clearance', section: 'personal_details', sortOrder: 160, group: 'supporting', parentCode: 'PACK_NEW_EMPLOYEE_DETAILS', sends: false, returns: true, verifies: true, description: 'Form section: NDIS Worker Screening Check.' },
  { code: 'REQ_WWCC', title: 'WWCC clearance', section: 'personal_details', sortOrder: 170, group: 'supporting', parentCode: 'PACK_NEW_EMPLOYEE_DETAILS', sends: false, returns: true, verifies: true, description: 'Form section: Working With Children Check.' },
  { code: 'PACK_POLICE_CHECK', title: 'National Police Check certificate', section: 'personal_details', sortOrder: 180, group: 'supporting', parentCode: 'PACK_NEW_EMPLOYEE_DETAILS', sends: false, returns: true, verifies: true, description: 'Form section: National Police Check. Issued within the last twelve months.' },
  { code: 'REQ_TAX_SETUP', title: 'Employee Tax Details Summary (from myGov)', section: 'payroll_tax_super', sortOrder: 190, group: 'supporting', parentCode: 'PACK_NEW_EMPLOYEE_DETAILS', sends: false, returns: true, verifies: true, requiredRule: null, description: 'Emailed after completing the Tax File Number declaration online; not part of the ZIP.' },
];
const GROUP_BY_CODE = new Map(DOCUMENTATION_PACK.map((d) => [d.code, d.group]));
const PARENT_BY_CODE = new Map(DOCUMENTATION_PACK.map((d) => [d.code, d.parentCode || null]));
/** Which part of the Phase 2 list an item belongs to: 'attachment', 'supporting', or 'added' for the Owner's extras. */
function groupOf(code) { return GROUP_BY_CODE.get(code) || 'added'; }
function parentOf(code) { return PARENT_BY_CODE.get(code) || null; }

/** Kept for the tests and the older records that still carry these items. */
const SUPPLEMENT = DOCUMENTATION_PACK;

/** The induction pack's own items. Instructions go out; agreements come back signed; accounts and training are tracked, not sent.
 *  The handbook and the two agreements ship with the portal (backend/onboarding-templates/stage3) until the practice replaces them. */
const INDUCTION_SUPPLEMENT = [
  { code: 'IND_HANDBOOK', title: 'Opal Therapy Staff Handbook', section: 'welcome_employment', sortOrder: 5, documentCode: 'DOC_HANDBOOK', shippedFile: 'staff-handbook.docx', sends: true, returns: false, verifies: false, required: true, rule: R.ALL, itemKind: 'document', description: 'For reading; the policies it refers to are acknowledged under Training and induction.' },
  { code: 'IND_SPLOSE_SETUP', title: 'Splose setup instructions', section: 'systems', sortOrder: 10, documentCode: 'DOC_SPLOSE_SETUP', sends: true, returns: false, verifies: false, required: true, rule: R.PARTICIPANT_FACING, itemKind: 'document' },
  { code: 'IND_OUTLOOK_SETUP', title: 'Outlook setup instructions', section: 'systems', sortOrder: 20, documentCode: 'DOC_OUTLOOK_SETUP', sends: true, returns: false, verifies: false, required: true, rule: R.ALL, itemKind: 'document' },
  { code: 'IND_PORTAL_SETUP', title: 'Opal Portal setup instructions', section: 'systems', sortOrder: 30, documentCode: 'DOC_PORTAL_SETUP', sends: true, returns: false, verifies: false, required: true, rule: R.ALL, itemKind: 'document' },
  { code: 'IND_PRIVACY_AGREEMENT', title: 'Privacy and Confidentiality Agreement', section: 'agreements', sortOrder: 100, documentCode: 'DOC_PRIVACY_AGREEMENT', shippedFile: 'privacy-and-confidentiality-agreement.docx', sends: true, returns: true, verifies: false, required: true, rule: R.ALL, itemKind: 'document' },
  { code: 'IND_CODE_OF_CONDUCT', title: 'Opal Therapy Code of Conduct Agreement', section: 'agreements', sortOrder: 110, documentCode: 'DOC_CODE_OF_CONDUCT_AGREEMENT', shippedFile: 'code-of-conduct-agreement.docx', sends: true, returns: true, verifies: false, required: true, rule: R.ALL, itemKind: 'document' },
  { code: 'IND_SPLOSE_ACTIVE', title: 'Splose account activated', section: 'accounts', sortOrder: 300, sends: false, returns: false, verifies: false, required: true, rule: R.PARTICIPANT_FACING, itemKind: 'account', linkedTaskCode: 'systems_access', description: 'Marked ready when the internal set-up task is done.' },
  { code: 'IND_OUTLOOK_ACTIVE', title: 'Outlook account activated', section: 'accounts', sortOrder: 310, sends: false, returns: false, verifies: false, required: true, rule: R.ALL, itemKind: 'account', linkedTaskCode: 'work_email', description: 'Marked ready when the internal set-up task is done.' },
  { code: 'IND_PORTAL_ACTIVE', title: 'Opal Portal account activated', section: 'accounts', sortOrder: 320, sends: false, returns: false, verifies: false, required: true, rule: R.ALL, itemKind: 'account', linkedTaskCode: 'portal_account', description: 'Marked ready when the internal set-up task is done.' },
  { code: 'IND_TRAINING', title: 'Opal induction training', section: 'training', sortOrder: 400, sends: false, returns: false, verifies: false, required: true, rule: R.ALL, itemKind: 'training', linkedTaskCode: 'induction_walkthrough', description: 'The portal induction walkthrough, assigned through Learning.' },
];

/** Requirement sections that belong to the induction pack, not the documentation pack. */
const INDUCTION_SECTIONS = new Set(['policies', 'ndis', 'training']);
const INDUCTION_REQ_CODES = new Set(['REQ_HANDBOOK', 'REQ_WELCOME', 'REQ_INJURY_INFO', 'REQ_POSITION_DESCRIPTION']);
/**
 * Where a requirement-derived item sits in the Owner's induction table.
 * Employment holds the handbook alone; the two agreements, the injury /
 * workers compensation information and the NDIS Code of Conduct are
 * "Policies and agreements"; every policy acknowledgement and the NDIS
 * modules are "Training and induction". The welcome page and position
 * description are Phase 1 material and are not induction items at all.
 */
const INDUCTION_EXCLUDED = new Set(['REQ_WELCOME', 'REQ_POSITION_DESCRIPTION']);
const INDUCTION_SECTION_BY_CODE = { REQ_HANDBOOK: 'welcome_employment', REQ_INJURY_INFO: 'agreements', REQ_NDIS_CODE: 'agreements' };
const INDUCTION_SECTION_BY_SECTION = { policies: 'training', ndis: 'training' };
function inductionSectionFor(req) {
  return INDUCTION_SECTION_BY_CODE[req.template_code] || INDUCTION_SECTION_BY_SECTION[req.section] || req.section || null;
}

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
  const items = [];
  if (phase === 'induction') {
    const { applied } = engine.selectApplicable(versionContent, facts);
    applied.forEach((req, i) => {
      if (phaseOf(req) !== phase || INDUCTION_EXCLUDED.has(req.template_code)) return;
      const it = itemFromRequirement(req, i);
      if (it) items.push({ ...it, section: inductionSectionFor(req), phase, itemKind: 'document' });
    });
  }

  // The documentation pack is the one fixed list; the induction pack keeps its own supplement.
  const supplement = phase === 'induction' ? INDUCTION_SUPPLEMENT : DOCUMENTATION_PACK;
  for (const s of supplement) {
    if (s.rule && !engine.evaluateRule(s.rule, facts)) continue;
    const lib = s.documentCode ? libraryByCode.get(s.documentCode) : null;
    // The supplement owns its document: a requirement the seed generated for
    // the same library document (an acknowledgement row) would send it twice.
    if (lib) {
      for (let i = items.length - 1; i >= 0; i -= 1) if (items[i].documentId === lib.id) items.splice(i, 1);
    }
    const required = s.requiredRule === null ? false : s.requiredRule ? engine.evaluateRule(s.requiredRule, facts) : s.required !== false;
    items.push({
      code: s.code, title: s.title, description: s.description || null, section: s.section,
      sends: s.sends, returns: s.returns, verifies: s.verifies, required,
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
  const byCode = new Map(rows.map((d) => [d.code, d]));
  const out = [];
  for (const raw of items) {
    // Each item carries what it means (sent, returned, verified, required)
    // from the list itself; a saved tweak overrides it.
    const it = { ...raw };
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
    ...returns.flatMap((i) => {
      if (parentOf(i.code)) return [];
      const line = `  • ${i.title}${i.required ? '' : ' (if applicable)'}${i.entryName ? '' : ' — your own copy'}`;
      const under = returns.filter((c) => parentOf(c.code) === i.code)
        .map((c) => `      ○ ${c.title}${c.required ? '' : ' (if applicable)'}${c.entryName ? '' : ' — your own copy'}`);
      return under.length ? [line + ', together with:', ...under] : [line];
    }),
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
    // The document's attachments follow it, lettered so they sort together.
    (item.attachments || []).forEach((att, idx) => {
      if (!att.bytes || !att.bytes.length) return;
      const aext = extFor(att.mime, att.fileName);
      const letter = String.fromCharCode(97 + (idx % 26));
      let aname = `${String(position).padStart(2, '0')}${letter} - ${safeStem(item.title)} - ${safeStem(String(att.fileName || 'attachment').replace(/\.[^.]+$/, ''))}.${aext}`;
      let m = 2;
      while (used.has(aname.toLowerCase())) aname = aname.replace(/(\.[^.]+)$/, ` (${m++})$1`);
      used.add(aname.toLowerCase());
      zip.file(aname, att.bytes, { date: new Date(0), binary: true });
      manifest.push({
        position, fileName: aname, title: item.title, code: item.code, itemId: item.id || null, attachmentId: att.attachmentId || null,
        documentId: item.document_id || null, documentVersionId: item.document_version_id || null,
        source: 'attachment', sizeBytes: att.bytes.length, mime: att.mime,
        sha256: require('crypto').createHash('sha256').update(att.bytes).digest('hex'),
      });
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
  DOCUMENTATION_PACK, groupOf, parentOf,
  SUPPLEMENT, INDUCTION_SUPPLEMENT, INDUCTION_SECTIONS, REPLACED_BY_SUPPLEMENT, NOT_A_DOCUMENT, TITLE_OVERRIDES, phaseOf,
  itemFromRequirement, buildDefaultItems, applyDefaults, sampleFactsFor, buildPackZip, buildReadme, safeStem, extFor,
};
