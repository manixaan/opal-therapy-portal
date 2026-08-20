'use strict';

/**
 * ONBOARDING CATALOGUE — integrity and compliance-honesty tests.
 *
 * Two jobs:
 *
 *  1. REFERENTIAL INTEGRITY. Every code a template or package points at must
 *     exist. A dangling reference produces a silently missing requirement,
 *     which in this feature means a compliance obligation nobody is asked for.
 *
 *  2. HONESTY. The catalogue makes claims about Australian law. Several of
 *     those claims are commonly got wrong, and getting them wrong in a
 *     confident tone is worse than omitting them. These tests pin the ones
 *     that were verified against the primary source on 20 August 2026, so a
 *     later edit cannot quietly reintroduce the myth.
 */

const catalogue = require('../onboarding-catalogue');
const engine = require('../onboarding-engine');

const byCode = (list) => new Map(list.map((x) => [x.code, x]));

// ═════════════════════════════════════════════════════════════════════════════

describe('referential integrity', () => {
  const compliance = byCode(catalogue.COMPLIANCE_SOURCES);
  const documents = byCode([...catalogue.OFFICIAL_DOCUMENTS, ...catalogue.OPAL_POLICIES]);
  const templates = byCode(catalogue.REQUIREMENT_TEMPLATES);
  const packages = byCode([
    catalogue.PACKAGE_BASE, ...catalogue.PACKAGE_OVERLAYS, ...catalogue.PACKAGES,
  ]);

  test('every code is unique within its list', () => {
    expect(compliance.size).toBe(catalogue.COMPLIANCE_SOURCES.length);
    expect(documents.size).toBe(catalogue.OFFICIAL_DOCUMENTS.length + catalogue.OPAL_POLICIES.length);
    expect(templates.size).toBe(catalogue.REQUIREMENT_TEMPLATES.length);
    expect(packages.size).toBe(1 + catalogue.PACKAGE_OVERLAYS.length + catalogue.PACKAGES.length);
  });

  test('every template documentCode resolves', () => {
    for (const t of catalogue.REQUIREMENT_TEMPLATES) {
      if (t.documentCode) expect(documents.has(t.documentCode)).toBe(true);
    }
  });

  test('every complianceCode resolves', () => {
    const all = [
      ...catalogue.REQUIREMENT_TEMPLATES,
      ...catalogue.OFFICIAL_DOCUMENTS,
      ...catalogue.OPAL_POLICIES,
      ...catalogue.ORG_COMPLIANCE_SLOTS,
    ];
    for (const x of all) {
      if (x.complianceCode) expect(compliance.has(x.complianceCode)).toBe(true);
    }
  });

  test('every package requirement code resolves to a template', () => {
    for (const pkg of [catalogue.PACKAGE_BASE, ...catalogue.PACKAGE_OVERLAYS]) {
      for (const code of pkg.requirements || []) {
        expect(templates.has(code)).toBe(true);
      }
    }
  });

  test('every package extends an existing base or overlay', () => {
    for (const pkg of catalogue.PACKAGES) {
      for (const code of pkg.extends) expect(packages.has(code)).toBe(true);
    }
  });

  test('every template uses a known section, classification and handler', () => {
    for (const t of catalogue.REQUIREMENT_TEMPLATES) {
      expect(engine.SECTIONS).toContain(t.section);
      expect(engine.CLASSIFICATIONS).toContain(t.classification);
      expect(engine.HANDLERS).toContain(t.handler);
      if (t.formKey) expect(engine.FORM_KEYS).toContain(t.formKey);
      if (t.handler === 'form') expect(t.formKey).toBeTruthy();
    }
  });

  test('every applicability rule references only known facts', () => {
    const walk = (rule) => {
      if (!rule || typeof rule !== 'object') return;
      if (Array.isArray(rule.all)) return rule.all.forEach(walk);
      if (Array.isArray(rule.any)) return rule.any.forEach(walk);
      if (rule.not) return walk(rule.not);
      if (rule.fact) {
        expect(engine.KNOWN_FACTS).toContain(rule.fact);
        expect(engine.OPERATORS).toContain(rule.op || 'eq');
      }
    };
    for (const t of catalogue.REQUIREMENT_TEMPLATES) walk(t.applicability);
  });

  test('every seeded package is assignable, not a base or overlay', () => {
    for (const pkg of catalogue.PACKAGES) {
      expect(pkg.kind === undefined || pkg.kind === 'package').toBe(true);
      expect(engine.EMPLOYMENT_TYPES).toContain(pkg.employmentType);
    }
  });

  test('the six required starter packages exist', () => {
    expect(catalogue.PACKAGES.map((p) => p.code)).toEqual([
      'PKG_OT_FULL_TIME', 'PKG_OT_PART_TIME', 'PKG_OT_CASUAL', 'PKG_OT_FIXED_TERM',
      'PKG_ADMIN_PERMANENT', 'PKG_ADMIN_CASUAL',
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('compliance honesty', () => {
  const compliance = byCode(catalogue.COMPLIANCE_SOURCES);

  test('NDIS worker screening is NOT recorded as a universal legal requirement', () => {
    // It binds risk-assessed roles and key personnel of REGISTERED providers.
    // The Commission is explicit that unregistered providers are not legally
    // required to screen their staff.
    const rec = compliance.get('NDIS_WORKER_SCREENING');
    expect(rec).toBeTruthy();
    expect(rec.basis).not.toBe('LEGAL_REQUIREMENT');
    expect(rec.appliesTo).toMatch(/registered/i);
    expect(rec.notes).toMatch(/aren't legally required|not legally required/i);
  });

  test('a National Police Check is recorded as an Opal policy, not law', () => {
    const rec = compliance.get('NATIONAL_POLICE_CHECK');
    expect(rec.basis).toBe('OPAL_POLICY_REQUIREMENT');
    expect(rec.notes).toMatch(/NOT legally required/i);
  });

  test('the NDIS Code of Conduct IS universal', () => {
    // The one NDIS obligation an unregistered provider cannot opt out of.
    const rec = compliance.get('NDIS_CODE_OF_CONDUCT');
    expect(rec.basis).toBe('LEGAL_REQUIREMENT');
    expect(rec.appliesTo).toMatch(/unregistered/i);
  });

  test('the NDIS Code of Conduct requirement applies to everyone, unconditionally', () => {
    const req = catalogue.REQUIREMENT_TEMPLATES.find((t) => t.code === 'REQ_NDIS_CODE');
    expect(req.applicability).toEqual({});
  });

  test('OT CPD is 20 hours per year, not the widely-repeated 30', () => {
    expect(catalogue.DEFAULT_SETTINGS.otCpdHoursPerYear).toBe(20);
    expect(catalogue.DEFAULT_SETTINGS.otCpdInteractiveHours).toBe(5);
    const rec = compliance.get('OT_CPD');
    expect(rec.notes).toMatch(/NOT 30 hours/i);
  });

  test('a WWCC is conditional on child-related work, never on job title', () => {
    const req = catalogue.REQUIREMENT_TEMPLATES.find((t) => t.code === 'REQ_WWCC');
    expect(req.applicability.fact).toBe('child_related_work');
    // 'assessment_required' is included: an undetermined role must surface the
    // requirement rather than be silently exempted.
    expect(req.applicability.value).toContain('assessment_required');

    const rec = compliance.get('WWCC_WA');
    expect(rec.notes).toMatch(/DUTIES, NOT JOB TITLE/i);
  });

  test('a WWCC card number format is never enforced', () => {
    // No official WA source publishes the format, so a regex would reject
    // valid cards.
    const req = catalogue.REQUIREMENT_TEMPLATES.find((t) => t.code === 'REQ_WWCC');
    expect(req.config.noCardNumberFormat).toBe(true);
  });

  test('worker screening is verified in the database, never by uploaded certificate', () => {
    const req = catalogue.REQUIREMENT_TEMPLATES.find((t) => t.code === 'REQ_NDIS_SCREENING');
    expect(req.config.databaseVerificationOnly).toBe(true);
    // The NWSD vocabulary, verbatim — note the absence of "expired", which is
    // not one of the Commission's statuses.
    expect(req.config.statuses).toEqual([
      'clearance', 'pending', 'interim_bar', 'exclusion', 'suspension', 'no_valid_clearance',
    ]);
    expect(req.config.statuses).not.toContain('expired');
  });

  test('the three Fair Work statements are issued to the right people only', () => {
    const fwis = catalogue.REQUIREMENT_TEMPLATES.find((t) => t.code === 'REQ_FWIS');
    const ceis = catalogue.REQUIREMENT_TEMPLATES.find((t) => t.code === 'REQ_CEIS');
    const ftcis = catalogue.REQUIREMENT_TEMPLATES.find((t) => t.code === 'REQ_FTCIS');

    expect(fwis.applicability).toEqual({});                       // every employee
    expect(ceis.applicability).toEqual({ fact: 'employment_type', op: 'eq', value: 'casual' });
    expect(ftcis.applicability).toEqual({ fact: 'employment_type', op: 'eq', value: 'fixed_term' });
  });

  test('the CEIS is modelled as a recurring obligation, not a one-off', () => {
    const rec = compliance.get('CEIS');
    expect(rec.recurrence.kind).toBe('months_since_start');
    expect(rec.recurrence.months).toEqual([6, 12]);
    expect(rec.recurrence.thenEveryMonths).toBe(12);
    // A small business employer is on a 12-monthly cadence instead.
    expect(rec.recurrence.smallBusinessMonths).toEqual([12]);
  });

  test('the FTCIS records that electronic delivery needs the employee to agree', () => {
    const rec = compliance.get('FTCIS');
    expect(rec.deliveryRules.electronicRequiresAgreement).toBe(true);
    // The other two statements have the broader delivery list.
    expect(compliance.get('FWIS').deliveryRules.electronicRequiresAgreement).toBe(false);
  });

  test('statement versions are free text, because the publisher uses no version number', () => {
    for (const code of ['FWIS', 'CEIS', 'FTCIS']) {
      const rec = compliance.get(code);
      expect(rec.sourceVersionLabel).toMatch(/^Last updated: /);
    }
  });

  test('the industrial-relations system is unknown until the Owner sets it', () => {
    // A WA sole trader is not a national system employer, and the Fair Work
    // statements would not apply. Guessing here would assert an obligation
    // that may not exist.
    expect(catalogue.DEFAULT_SETTINGS.industrialRelationsSystem).toBe('unknown');
    expect(compliance.get('IR_SYSTEM')).toBeTruthy();
  });

  test('NDIS provider status defaults to unregistered', () => {
    expect(catalogue.DEFAULT_SETTINGS.ndisProviderStatus).toBe('unregistered');
  });

  test('workers compensation is an employer record, never an employee upload', () => {
    const rec = compliance.get('WA_WORKERS_COMPENSATION');
    expect(rec.classification).toBe('EMPLOYER_ONLY_COMPLIANCE');
    expect(rec.notes).toMatch(/NEVER AN EMPLOYEE UPLOAD/i);
    // And it is a seeded organisational slot.
    expect(catalogue.ORG_COMPLIANCE_SLOTS.map((s) => s.recordType))
      .toContain('workers_compensation');
    // No requirement asks an employee to PROVIDE it. The employee is given
    // injury-reporting information instead — an acknowledgement, never an
    // upload or a credential.
    const workersCompItems = catalogue.REQUIREMENT_TEMPLATES
      .filter((t) => /workers.?comp|injury/i.test(t.title));
    expect(workersCompItems.length).toBeGreaterThan(0);
    for (const t of workersCompItems) {
      expect(['upload', 'credential']).not.toContain(t.handler);
      expect(t.classification).not.toBe('EMPLOYEE_UPLOAD');
    }
    const injuryInfo = workersCompItems.find((t) => t.code === 'REQ_INJURY_INFO');
    expect(injuryInfo.handler).toBe('document_ack');
    expect(injuryInfo.instructions).toMatch(/not asked to provide any insurance document/i);
  });

  test('occupational therapists are not asserted to be mandatory reporters', () => {
    const rec = compliance.get('WA_MANDATORY_REPORTING');
    expect(rec.notes).toMatch(/OCCUPATIONAL THERAPISTS ARE NOT AMONG THEM/i);
  });

  test('identity collection prefers sighting over storing a copy', () => {
    const req = catalogue.REQUIREMENT_TEMPLATES.find((t) => t.code === 'REQ_IDENTITY');
    expect(req.config.preferSighting).toBe(true);
    expect(req.config.copyRequiresReason).toBe(true);
  });

  test('a privacy collection notice is issued before anything is collected', () => {
    const notice = catalogue.REQUIREMENT_TEMPLATES.find((t) => t.code === 'REQ_PRIVACY_NOTICE');
    expect(notice).toBeTruthy();
    expect(notice.blocksActivation).toBe(true);
    // It sorts before every other welcome-section requirement.
    const welcome = catalogue.REQUIREMENT_TEMPLATES
      .filter((t) => t.section === 'welcome_employment');
    expect(Math.min(...welcome.map((t) => t.sortHint))).toBe(notice.sortHint);
    // The employee records exemption does not cover applicants.
    const rec = compliance.get('PRIVACY_APP5_NOTICE');
    expect(rec.notes).toMatch(/DOES NOT COVER THIS/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('sensitivity classification', () => {
  test('payroll and identity requirements are marked restricted', () => {
    const restricted = ['REQ_BANK_DETAILS', 'REQ_TAX_SETUP', 'REQ_IDENTITY', 'REQ_RIGHT_TO_WORK'];
    for (const code of restricted) {
      const t = catalogue.REQUIREMENT_TEMPLATES.find((x) => x.code === code);
      expect(t.sensitivity).toBe('restricted');
    }
  });

  test('personal details are sensitive but not restricted', () => {
    for (const code of ['REQ_PERSONAL_DETAILS', 'REQ_EMERGENCY_CONTACT', 'REQ_SUPER_SETUP']) {
      const t = catalogue.REQUIREMENT_TEMPLATES.find((x) => x.code === code);
      expect(t.sensitivity).toBe('sensitive');
    }
  });

  test('every statutory credential requires employer verification', () => {
    for (const code of ['REQ_AHPRA', 'REQ_NDIS_SCREENING', 'REQ_WWCC', 'REQ_RIGHT_TO_WORK', 'REQ_PII']) {
      const t = catalogue.REQUIREMENT_TEMPLATES.find((x) => x.code === code);
      expect(t.requiresEmployerVerification).toBe(true);
      expect(t.blocksActivation).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('policy library', () => {
  test('the policy set covers the areas an NDIS allied-health practice needs', () => {
    const codes = catalogue.OPAL_POLICIES.map((p) => p.code);
    for (const expected of [
      'POL_CODE_OF_CONDUCT', 'POL_PRIVACY', 'POL_INFOSEC', 'POL_WHS', 'POL_EEO',
      'POL_INCIDENT', 'POL_COMPLAINTS', 'POL_SAFEGUARDING', 'POL_CONFLICT',
      'POL_RECORDS', 'POL_CLINICAL_DOC', 'POL_BOUNDARIES', 'POL_SOCIAL_MEDIA',
      'POL_TELEHEALTH', 'POL_HOME_VISIT', 'POL_LONE_WORKER', 'POL_VEHICLE',
      'POL_INFECTION', 'POL_EMERGENCY', 'POL_PARTICIPANT_RIGHTS', 'POL_SUPERVISION',
    ]) {
      expect(codes).toContain(expected);
    }
  });

  test('the handbook is a structure awaiting content, not invented rules', () => {
    const handbook = catalogue.OPAL_POLICIES.find((p) => p.code === 'DOC_HANDBOOK');
    expect(handbook.description).toMatch(/content required/i);
    expect(handbook.ack).toBe(false);
  });

  test('official documents are marked as not owner-controlled', () => {
    for (const doc of catalogue.OFFICIAL_DOCUMENTS) {
      if (doc.classification === 'OFFICIAL_DOCUMENT' || doc.classification === 'EMPLOYER_REFERENCE') {
        expect(doc.ownerControlled).toBe(false);
      }
    }
  });

  test('NDIS Practice Standards are employer reference, never an employee task', () => {
    const std = catalogue.OFFICIAL_DOCUMENTS.find((d) => d.code === 'DOC_NDIS_PRACTICE_STANDARDS');
    expect(std.classification).toBe('EMPLOYER_REFERENCE');
    expect(std.audience).toBe('employer');
    expect(std.requiresAcknowledgement).toBeFalsy();
  });
});
