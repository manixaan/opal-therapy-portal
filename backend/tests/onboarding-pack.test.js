'use strict';

/**
 * THE DOCUMENT PACK — the rules that decide what one person receives.
 *
 * Built against the real seeded catalogue so the defaults pinned here are
 * the defaults the practice actually gets: an Occupational Therapist and an
 * administration employee must not receive the same pack, and the six items
 * the requirement catalogue never carried (contract, super choice form,
 * employee details form, passport/visa, first aid, CPR) must be there.
 */

const JSZip = require('jszip');
const pack = require('../onboarding-pack');
const engine = require('../onboarding-engine');
const catalogue = require('../onboarding-catalogue');
const email = require('../onboarding-pack-email');

/** A package version's content, composed the way the seed would, from the catalogue. */
function contentFor(pkgCode) {
  const pkg = catalogue.PACKAGES.find((p) => p.code === pkgCode);
  const overlays = catalogue.PACKAGE_OVERLAYS;
  const codes = new Set();
  const chain = [catalogue.PACKAGE_BASE, ...pkg.extends.map((c) => overlays.find((o) => o.code === c)).filter(Boolean)];
  for (const part of chain) for (const r of part.requirements || []) codes.add(typeof r === 'string' ? r : r.code);
  const docs = new Map([...catalogue.OFFICIAL_DOCUMENTS, ...catalogue.OPAL_POLICIES].map((d) => [d.code, d]));
  const requirements = [...codes].map((code, i) => {
    const t = catalogue.REQUIREMENT_TEMPLATES.find((x) => x.code === code);
    if (!t) throw new Error(`unknown template ${code}`);
    const doc = t.documentCode ? docs.get(t.documentCode) : null;
    return {
      template_code: t.code, title: t.title, summary: t.summary || null, section: t.section, handler: t.handler,
      actor: t.actor, requires_employer_verification: t.requiresEmployerVerification === true,
      mandatory: t.mandatory !== false, blocks_activation: t.blocksActivation === true,
      applicability: t.applicability || {}, config: t.config || {}, sort_order: (i + 1) * 10,
      document_id: doc ? `doc-${doc.code}` : null, document_version_id: doc ? `ver-${doc.code}` : null,
      document_code: doc ? doc.code : null, document: doc ? { code: doc.code, officialSourceUrl: doc.officialSourceUrl } : null,
    };
  });
  return { requirements, starterPack: { documents: [], omissions: [] } };
}

const facts = (over) => engine.buildFacts({
  employment_type: 'full_time', role_category: 'occupational_therapist', proposed_role: 'therapist',
  is_treating_therapist: true, child_related_work: 'yes', ndis_risk_assessed_role: 'yes',
  mobile_community_role: true, uses_own_vehicle: true, ...over,
}, { ndisProviderStatus: 'unregistered' });

const library = new Map([
  ['DOC_CONTRACT_TEMPLATE', { id: 'lib-contract', current_version_id: 'v-contract', official_source_url: null }],
  ['DOC_SUPER_CHOICE', { id: 'lib-super', current_version_id: null, official_source_url: 'https://ato.gov.au/x' }],
]);

describe('the default pack', () => {
  const ADMIN = { employment_type: 'casual', role_category: 'administration', is_treating_therapist: false, child_related_work: 'no', ndis_risk_assessed_role: 'no', mobile_community_role: false, uses_own_vehicle: false };
  const ATTACHMENTS = ['PACK_CONTRACT', 'PACK_SUPER_CHOICE', 'PACK_FWIS', 'PACK_NEW_EMPLOYEE_DETAILS'];
  const SUPPORTING = ['REQ_DRIVERS_LICENCE', 'REQ_IDENTITY', 'REQ_RIGHT_TO_WORK', 'REQ_AHPRA', 'PACK_FIRST_AID', 'REQ_NDIS_SCREENING', 'REQ_WWCC', 'PACK_POLICE_CHECK', 'REQ_TAX_SETUP'];

  test('every package, role and contract type gets the one documentation list: four attachments, then the supporting documents', () => {
    const ot = pack.buildDefaultItems(contentFor('PKG_OT_FULL_TIME'), facts({}), library);
    const admin = pack.buildDefaultItems(contentFor('PKG_ADMIN_CASUAL'), facts(ADMIN), library);
    expect(ot.map((i) => i.code)).toEqual([...ATTACHMENTS, ...SUPPORTING]);
    // A casual starter also gets the CEIS; a fixed-term starter the FTCIS; nobody gets both.
    expect(admin.map((i) => i.code)).toEqual(['PACK_CONTRACT', 'PACK_SUPER_CHOICE', 'PACK_FWIS', 'PACK_CEIS', 'PACK_NEW_EMPLOYEE_DETAILS', ...SUPPORTING]);
    const fixed = pack.buildDefaultItems(contentFor('PKG_OT_FULL_TIME'), facts({ employment_type: 'fixed_term' }), library);
    expect(fixed.map((i) => i.code)).toContain('PACK_FTCIS');
    expect(fixed.map((i) => i.code)).not.toContain('PACK_CEIS');
    expect(pack.DOCUMENTATION_PACK.filter((d) => d.sends).every((d) => d.shippedFile)).toBe(true);
    expect(ot.every((i) => i.phase === 'documentation' && i.itemKind === 'document')).toBe(true);
    expect(new Set(ot.map((i) => i.code)).size).toBe(ot.length);
    // The requirement-derived paper (portal forms, statements) no longer leaks into the pack.
    for (const gone of ['REQ_FWIS', 'REQ_CEIS', 'REQ_FTCIS', 'REQ_PERSONAL_DETAILS', 'REQ_BANK_DETAILS', 'PACK_PASSPORT_VISA', 'PACK_CPR', 'REQ_VEHICLE']) {
      expect(`${gone}:${ot.some((i) => i.code === gone)}`).toBe(`${gone}:false`);
    }
    // Grouping: attachments go in the ZIP; the rest sit under the New Employee Details.
    for (const c of ATTACHMENTS) expect(pack.groupOf(c)).toBe('attachment');
    for (const c of SUPPORTING) { expect(pack.groupOf(c)).toBe('supporting'); expect(pack.parentOf(c)).toBe('PACK_NEW_EMPLOYEE_DETAILS'); }
    // The form's own attachments sit beneath the New Employee Details, not under identity / professional / screening headings.
    for (const c of SUPPORTING.filter((x) => x !== 'REQ_TAX_SETUP')) expect(ot.find((i) => i.code === c).section).toBe('personal_details');
    expect(pack.groupOf('DEF_ABC')).toBe('added');
  });

  test('each item says what it means: sends, returns, verifies, required — and required follows the role', () => {
    const ot = pack.buildDefaultItems(contentFor('PKG_OT_FULL_TIME'), facts({}), library);
    const by = Object.fromEntries(ot.map((i) => [i.code, i]));
    expect(by.PACK_CONTRACT).toMatchObject({ sends: true, returns: true, verifies: true, required: true, documentId: 'lib-contract', documentVersionId: 'v-contract' });
    expect(by.PACK_FWIS).toMatchObject({ sends: true, returns: false, verifies: false, required: true, documentCode: 'DOC_FWIS' });
    expect(by.PACK_NEW_EMPLOYEE_DETAILS).toMatchObject({ sends: true, returns: true, verifies: true, required: true });
    expect(by.PACK_SUPER_CHOICE).toMatchObject({ sends: true, returns: true, verifies: true, documentId: 'lib-super' });
    expect(by.REQ_AHPRA).toMatchObject({ sends: false, returns: true, verifies: true, required: true });
    expect(by.PACK_FIRST_AID).toMatchObject({ sends: false, returns: true, verifies: true, required: true });
    expect(by.REQ_TAX_SETUP).toMatchObject({ sends: false, returns: true, required: false });
    const admin = Object.fromEntries(pack.buildDefaultItems(contentFor('PKG_ADMIN_CASUAL'), facts(ADMIN), library).map((i) => [i.code, i]));
    expect(admin.REQ_AHPRA.required).toBe(false);
    expect(admin.PACK_FIRST_AID.required).toBe(false);
    expect(admin.PACK_POLICE_CHECK.required).toBe(true);
    // The induction pack keeps its own list.
    const ind = pack.buildDefaultItems(contentFor('PKG_OT_FULL_TIME'), facts({}), library, 'induction');
    expect(ind.map((i) => i.code)).toEqual(expect.arrayContaining(['REQ_HANDBOOK', 'REQ_NDIS_CODE', 'IND_SPLOSE_SETUP', 'IND_PRIVACY_AGREEMENT', 'IND_SPLOSE_ACTIVE', 'IND_TRAINING']));
    expect(ind.find((i) => i.code === 'IND_SPLOSE_ACTIVE')).toMatchObject({ itemKind: 'account', linkedTaskCode: 'systems_access', sends: false });
    expect(ind.every((i) => i.phase === 'induction')).toBe(true);
    // The Owner's induction layout: the handbook alone under Employment; agreements, injury information and the
    // NDIS Code under Policies and agreements; the welcome page and position description are not induction items.
    const sectionOf = (c) => (ind.find((i) => i.code === c) || {}).section;
    expect(ind.filter((i) => i.section === 'welcome_employment').map((i) => i.code).sort()).toEqual(['IND_HANDBOOK', 'REQ_HANDBOOK']);
    for (const c of ['IND_PRIVACY_AGREEMENT', 'IND_CODE_OF_CONDUCT', 'REQ_INJURY_INFO', 'REQ_NDIS_CODE']) expect(`${c}:${sectionOf(c)}`).toBe(`${c}:agreements`);
    expect(ind.some((i) => i.section === 'policies' || i.section === 'ndis')).toBe(false);
    for (const gone of ['REQ_WELCOME', 'REQ_POSITION_DESCRIPTION']) expect(ind.some((i) => i.code === gone)).toBe(false);
    // The handbook and both agreements ship with the portal.
    for (const c of ['IND_HANDBOOK', 'IND_PRIVACY_AGREEMENT', 'IND_CODE_OF_CONDUCT']) expect(pack.INDUCTION_SUPPLEMENT.find((d) => d.code === c).shippedFile).toBeTruthy();
    // A handbook in the library means the supplement's handbook replaces the requirement's copy (sent once).
    const withHandbook = pack.buildDefaultItems(contentFor('PKG_OT_FULL_TIME'), facts({}), new Map([...library, ['DOC_HANDBOOK', { id: 'doc-DOC_HANDBOOK', current_version_id: 'v' }]]), 'induction');
    expect(withHandbook.filter((i) => i.section === 'welcome_employment').map((i) => i.code)).toEqual(['IND_HANDBOOK']);
    expect(ot[0].code).toBe('PACK_CONTRACT');
  });

  test('package-level additions travel with the pack once', () => {
    const content = contentFor('PKG_ADMIN_PERMANENT');
    content.starterPack.documents = [{ documentId: 'lib-extra', documentCode: 'DOC_EXTRA', title: 'Parking guide', position: 1 }];
    const items = pack.buildDefaultItems(content, facts(ADMIN), library);
    expect(items.filter((i) => i.documentId === 'lib-extra')).toHaveLength(1);
    expect(items.find((i) => i.documentId === 'lib-extra')).toMatchObject({ sends: true, returns: false, required: false });
  });
});

describe('package defaults (Edit onboarding)', () => {
  test('a package tweak removes, renames, reflags or adds — and only for that phase', () => {
    const derived = pack.buildDefaultItems(contentFor('PKG_OT_FULL_TIME'), facts({}), library);
    const out = pack.applyDefaults(derived, [
      { phase: 'documentation', code: 'PACK_FIRST_AID', action: 'remove' },
      { phase: 'documentation', code: 'PACK_CONTRACT', action: 'override', title: 'Employment Contract', required: false },
      { phase: 'documentation', code: 'DEF_ABC', action: 'add', title: 'Parking map', sends_document: true, employee_returns: false, document_id: 'lib-map', sort_order: 950 },
      { phase: 'induction', code: 'PACK_CONTRACT', action: 'remove' },
    ], 'documentation');
    const codes = out.map((i) => i.code);
    expect(codes).not.toContain('PACK_FIRST_AID');
    expect(out.find((i) => i.code === 'PACK_CONTRACT')).toMatchObject({ title: 'Employment Contract', required: false, sends: true, returns: true });
    expect(out[out.length - 1]).toMatchObject({ code: 'DEF_ABC', title: 'Parking map', phase: 'documentation', documentId: 'lib-map', returns: false });
    // Untouched, an item keeps what the list says about it.
    const untouched = pack.applyDefaults(derived, [], 'documentation');
    expect(untouched.find((i) => i.code === 'PACK_CONTRACT')).toMatchObject({ required: true, returns: true, verifies: true, sends: true });
    expect(untouched.find((i) => i.code === 'PACK_FWIS')).toMatchObject({ returns: false, verifies: false });
  });

  test('sample facts follow the package: an OT package is treating, mobile and child-related; an admin one is not', () => {
    const ot = pack.sampleFactsFor({ role_category: 'occupational_therapist', employment_type: 'casual' }, { ndisProviderStatus: 'unregistered' });
    const admin = pack.sampleFactsFor({ role_category: 'administration', employment_type: 'full_time' }, { ndisProviderStatus: 'unregistered' });
    expect(ot).toMatchObject({ employment_type: 'casual', is_treating_therapist: true, mobile_community_role: true });
    expect(admin).toMatchObject({ employment_type: 'full_time', is_treating_therapist: false, mobile_community_role: false });
  });
});

describe('the ZIP', () => {
  test('carries only sendable items with files, numbered, with a read-me that lists the returns', async () => {
    const items = [
      { id: '1', code: 'PACK_CONTRACT', title: 'Contract of Employment', required: true, employee_returns: true, sends_document: true, file: { bytes: Buffer.from('PDF1'), mime: 'application/pdf', fileName: 'contract.pdf', source: 'library' } },
      { id: '2', code: 'REQ_FWIS', title: 'Fair Work Information Statement', required: true, employee_returns: false, sends_document: true, file: null, unavailableReason: 'link only' },
      { id: '3', code: 'PACK_PASSPORT_VISA', title: 'Passport / visa documentation', required: true, employee_returns: true, sends_document: false, file: null },
      { id: '4', code: 'X', title: 'Contract of Employment', required: false, employee_returns: false, sends_document: true, file: { bytes: Buffer.from('DOCX'), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'c.docx', source: 'own' } },
    ];
    const out = await pack.buildPackZip(items, { orgName: 'Opal Therapy', employeeName: 'Jane Smith', roleTitle: 'OT', dueDate: '2026-09-10', returnEmail: 'ann@opal.test' });
    expect(out.fileName).toBe('Opal Therapy - Jane Smith - Onboarding Documentation Pack.zip');
    expect(out.manifest.map((m) => m.fileName)).toEqual(['01 - Contract of Employment.pdf', '02 - Contract of Employment.docx']);
    expect(out.omissions).toEqual([{ code: 'REQ_FWIS', title: 'Fair Work Information Statement', reason: 'link only' }]);
    const zip = await JSZip.loadAsync(out.buffer);
    expect(Object.keys(zip.files).sort()).toEqual(['00 - Read Me First.txt', '01 - Contract of Employment.pdf', '02 - Contract of Employment.docx']);
    const readme = await zip.file('00 - Read Me First.txt').async('string');
    expect(readme).toContain('Prepared for: Jane Smith (OT)');
    expect(readme).toContain('• Contract of Employment');
    expect(readme).toContain('• Passport / visa documentation — your own copy');
    expect(readme).toContain('10 September 2026');
    expect(out.manifest[0].sha256).toHaveLength(64);
  });

  test('is byte-for-byte stable for the same inputs', async () => {
    const items = [{ id: '1', code: 'A', title: 'A', sends_document: true, employee_returns: false, file: { bytes: Buffer.from('x'), mime: 'application/pdf', fileName: 'a.pdf', source: 'own' } }];
    const a = await pack.buildPackZip(items, { orgName: 'O', employeeName: 'E' });
    const b = await pack.buildPackZip(items, { orgName: 'O', employeeName: 'E' });
    expect(a.buffer.equals(b.buffer)).toBe(true);
  });
});

describe('Email 2', () => {
  test('is Opal\'s wording with the name and the seven-day due date filled in', () => {
    const e = email.composePackEmail({ applicantName: 'Jane Smith', sentAt: new Date('2026-09-03T02:00:00Z') });
    expect(e.subject).toBe('Onboarding Documentation Pack - Opal Therapy');
    expect(e.body.startsWith('Hi Jane,')).toBe(true);
    expect(e.body).toContain('within seven days, by 10/09/2026.');
    expect(e.body).toContain('ato.gov.au/forms-and-instructions/tfn-declaration');
    expect(e.body).not.toMatch(/\[Name\]|\[DD\/MM\/YYYY\]/);
    expect(email.ddmmyyyy(e.dueAt)).toBe('10/09/2026');
  });

  test('an edited body keeps the Owner\'s words but the date follows the day it is drafted', () => {
    const old = email.composePackEmail({ applicantName: 'Jane', sentAt: new Date('2026-09-03T02:00:00Z') });
    const edited = old.body.replace('Warmly,', 'Kind regards,');
    const restamped = email.restampDueDate(edited, old.dueAt, new Date('2026-09-12T02:00:00Z'));
    expect(restamped).toContain('Kind regards,');
    expect(restamped).toContain('by 12/09/2026.');
    expect(restamped).not.toContain('10/09/2026');
  });
});
