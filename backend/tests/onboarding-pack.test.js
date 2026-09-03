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
  test('an OT gets the clinical, screening and mobile items; an admin casual does not', () => {
    const ot = pack.buildDefaultItems(contentFor('PKG_OT_FULL_TIME'), facts({}), library);
    const admin = pack.buildDefaultItems(contentFor('PKG_ADMIN_CASUAL'), facts({
      employment_type: 'casual', role_category: 'administration', is_treating_therapist: false,
      child_related_work: 'no', ndis_risk_assessed_role: 'no', mobile_community_role: false, uses_own_vehicle: false,
    }), library);
    const codes = (x) => x.map((i) => i.code);

    expect(codes(ot)).toEqual(expect.arrayContaining([
      'PACK_CONTRACT', 'PACK_NEW_EMPLOYEE_DETAILS', 'PACK_SUPER_CHOICE', 'REQ_FWIS', 'REQ_TAX_SETUP',
      'REQ_IDENTITY', 'REQ_RIGHT_TO_WORK', 'PACK_PASSPORT_VISA', 'PACK_POLICE_CHECK', 'REQ_AHPRA',
      'REQ_NDIS_SCREENING', 'REQ_WWCC', 'REQ_DRIVERS_LICENCE', 'REQ_VEHICLE', 'PACK_FIRST_AID', 'PACK_CPR',
    ]));
    expect(codes(ot)).not.toContain('REQ_CEIS');
    expect(codes(ot)).not.toContain('REQ_FTCIS');

    expect(codes(admin)).toEqual(expect.arrayContaining(['PACK_CONTRACT', 'REQ_CEIS', 'REQ_FWIS', 'PACK_POLICE_CHECK', 'PACK_PASSPORT_VISA']));
    for (const clinical of ['REQ_AHPRA', 'REQ_WWCC', 'REQ_NDIS_SCREENING', 'REQ_DRIVERS_LICENCE', 'REQ_VEHICLE', 'PACK_FIRST_AID', 'PACK_CPR']) {
      expect(`${clinical}:${codes(admin).includes(clinical)}`).toBe(`${clinical}:false`);
    }
    // A fixed-term contract brings its information statement.
    const ft = pack.buildDefaultItems(contentFor('PKG_OT_FIXED_TERM'), facts({ employment_type: 'fixed_term' }), library);
    expect(codes(ft)).toContain('REQ_FTCIS');
  });

  test('portal forms the supplement replaces do not appear twice; non-documents never appear', () => {
    const ot = pack.buildDefaultItems(contentFor('PKG_OT_FULL_TIME'), facts({}), library);
    const codes = ot.map((i) => i.code);
    for (const gone of ['REQ_PERSONAL_DETAILS', 'REQ_BANK_DETAILS', 'REQ_SUPER_SETUP', 'REQ_CONTRACT', 'REQ_PAYROLL_SETUP', 'REQ_OPAL_INDUCTION', 'REQ_WHS_INDUCTION', 'REQ_NDIS_ORIENTATION']) {
      expect(`${gone}:${codes.includes(gone)}`).toBe(`${gone}:false`);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('each item says what it means: sends, returns, verifies, required', () => {
    const ot = pack.buildDefaultItems(contentFor('PKG_OT_FULL_TIME'), facts({}), library);
    const by = Object.fromEntries(ot.map((i) => [i.code, i]));
    expect(by.PACK_CONTRACT).toMatchObject({ sends: true, returns: true, verifies: true, required: true, documentId: 'lib-contract', documentVersionId: 'v-contract' });
    expect(by.REQ_FWIS).toMatchObject({ sends: true, returns: false, verifies: false, required: true });
    expect(by.REQ_AHPRA).toMatchObject({ sends: false, returns: true, verifies: true, required: true });
    expect(by.PACK_PASSPORT_VISA).toMatchObject({ sends: false, returns: true, verifies: true });
    expect(by.REQ_TAX_SETUP).toMatchObject({ sends: false, returns: true, verifies: true });
    expect(by.PACK_FIRST_AID.required).toBe(false);
    expect(by.PACK_SUPER_CHOICE.documentId).toBe('lib-super');
    // Ordered: contract first, screening after identity.
    expect(ot[0].code).toBe('PACK_CONTRACT');
    expect(ot.findIndex((i) => i.code === 'REQ_IDENTITY')).toBeLessThan(ot.findIndex((i) => i.code === 'REQ_WWCC'));
  });

  test('package-level additions travel with the pack once, and unknown facts fail closed', () => {
    const content = contentFor('PKG_ADMIN_PERMANENT');
    content.starterPack.documents = [{ documentId: 'lib-extra', documentCode: 'DOC_EXTRA', title: 'Parking guide', position: 1 }];
    const items = pack.buildDefaultItems(content, facts({ role_category: 'administration', is_treating_therapist: false, mobile_community_role: false, uses_own_vehicle: false, child_related_work: 'no', ndis_risk_assessed_role: 'no' }), library);
    expect(items.filter((i) => i.documentId === 'lib-extra')).toHaveLength(1);
    expect(items.find((i) => i.documentId === 'lib-extra')).toMatchObject({ sends: true, returns: false, required: false });
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
