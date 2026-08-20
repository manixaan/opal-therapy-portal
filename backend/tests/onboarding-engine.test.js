'use strict';

/**
 * ONBOARDING ENGINE — pure-logic unit tests.
 *
 * The rules that decide who is asked for what, who may be activated, and what
 * may be rendered of a bank account are all functions of their arguments, so
 * they are tested here without a database, a request or a session.
 */

const engine = require('../onboarding-engine');

// ═════════════════════════════════════════════════════════════════════════════

describe('applicability rules', () => {
  const facts = {
    employment_type: 'casual',
    role_category: 'occupational_therapist',
    child_related_work: 'yes',
    ndis_risk_assessed_role: 'requires_determination',
    mobile_community_role: true,
    uses_own_vehicle: false,
    provider_status: 'unregistered',
    is_treating_therapist: true,
  };

  test('an empty rule always applies', () => {
    expect(engine.evaluateRule({}, facts)).toBe(true);
    expect(engine.evaluateRule(null, facts)).toBe(true);
    expect(engine.evaluateRule(undefined, facts)).toBe(true);
  });

  test('eq / neq compare case-insensitively', () => {
    expect(engine.evaluateRule({ fact: 'employment_type', op: 'eq', value: 'CASUAL' }, facts)).toBe(true);
    expect(engine.evaluateRule({ fact: 'employment_type', op: 'eq', value: 'full_time' }, facts)).toBe(false);
    expect(engine.evaluateRule({ fact: 'employment_type', op: 'neq', value: 'full_time' }, facts)).toBe(true);
  });

  test('in / not_in match a list', () => {
    expect(engine.evaluateRule(
      { fact: 'child_related_work', op: 'in', value: ['yes', 'assessment_required'] }, facts
    )).toBe(true);
    expect(engine.evaluateRule(
      { fact: 'child_related_work', op: 'not_in', value: ['yes'] }, facts
    )).toBe(false);
  });

  test('is_true / is_false accept booleans and yes/no strings', () => {
    expect(engine.evaluateRule({ fact: 'mobile_community_role', op: 'is_true' }, facts)).toBe(true);
    expect(engine.evaluateRule({ fact: 'uses_own_vehicle', op: 'is_true' }, facts)).toBe(false);
    expect(engine.evaluateRule({ fact: 'uses_own_vehicle', op: 'is_false' }, facts)).toBe(true);
    expect(engine.evaluateRule({ fact: 'child_related_work', op: 'is_true' }, facts)).toBe(true);
  });

  test('all / any / not compose', () => {
    expect(engine.evaluateRule({
      all: [
        { fact: 'employment_type', op: 'eq', value: 'casual' },
        { fact: 'role_category', op: 'eq', value: 'occupational_therapist' },
      ],
    }, facts)).toBe(true);

    expect(engine.evaluateRule({
      all: [
        { fact: 'employment_type', op: 'eq', value: 'casual' },
        { fact: 'uses_own_vehicle', op: 'is_true' },
      ],
    }, facts)).toBe(false);

    expect(engine.evaluateRule({
      any: [
        { fact: 'uses_own_vehicle', op: 'is_true' },
        { fact: 'mobile_community_role', op: 'is_true' },
      ],
    }, facts)).toBe(true);

    expect(engine.evaluateRule({ not: { fact: 'uses_own_vehicle', op: 'is_true' } }, facts)).toBe(true);
  });

  test('an empty any[] matches nothing', () => {
    expect(engine.evaluateRule({ any: [] }, facts)).toBe(false);
  });

  // FAIL CLOSED. An authoring mistake must not hand someone a requirement set
  // they should not have, nor silently drop one they should.
  test('an unknown fact evaluates false rather than matching', () => {
    expect(engine.evaluateRule({ fact: 'invented_fact', op: 'eq', value: 'x' }, facts)).toBe(false);
  });

  test('an unknown operator evaluates false', () => {
    expect(engine.evaluateRule({ fact: 'employment_type', op: 'regex', value: '.*' }, facts)).toBe(false);
  });

  test('a malformed rule evaluates false rather than throwing', () => {
    expect(engine.evaluateRule('casual', facts)).toBe(false);
    expect(engine.evaluateRule([1, 2, 3], facts)).toBe(false);
    expect(engine.evaluateRule({ unknownKey: true }, facts)).toBe(false);
  });

  test('deeply nested rules are bounded, not recursed without limit', () => {
    let rule = { fact: 'employment_type', op: 'eq', value: 'casual' };
    for (let i = 0; i < 40; i += 1) rule = { all: [rule] };
    expect(() => engine.evaluateRule(rule, facts)).not.toThrow();
    expect(engine.evaluateRule(rule, facts)).toBe(false);
  });

  test('describeRule renders something a human can check', () => {
    expect(engine.describeRule({})).toBe('Always');
    expect(engine.describeRule({ fact: 'employment_type', op: 'eq', value: 'casual' }))
      .toBe('employment_type is casual');
    expect(engine.describeRule({
      all: [
        { fact: 'employment_type', op: 'eq', value: 'casual' },
        { fact: 'mobile_community_role', op: 'is_true' },
      ],
    })).toBe('employment_type is casual AND mobile_community_role is yes');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('buildFacts', () => {
  test('an undetermined risk-assessed role still requires screening', () => {
    const facts = engine.buildFacts(
      { employment_type: 'casual', ndis_risk_assessed_role: 'requires_determination' }, {}
    );
    // "We have not decided yet" must surface as work to do, never as an exemption.
    expect(facts.requires_worker_screening).toBe(true);
  });

  test('an explicit no does not require screening', () => {
    const facts = engine.buildFacts(
      { employment_type: 'casual', ndis_risk_assessed_role: 'no' }, {}
    );
    expect(facts.requires_worker_screening).toBe(false);
  });

  test('an occupational therapist is treated as participant-facing', () => {
    const facts = engine.buildFacts({ role_category: 'occupational_therapist' }, {});
    expect(facts.is_treating_therapist).toBe(true);
    expect(facts.works_with_participants).toBe(true);
  });

  test('provider status comes from organisation settings, not the assignment', () => {
    const facts = engine.buildFacts({ employment_type: 'casual' }, { ndisProviderStatus: 'registered' });
    expect(facts.provider_status).toBe('registered');
    const unset = engine.buildFacts({ employment_type: 'casual' }, {});
    expect(unset.provider_status).toBe('unregistered');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('progress meters', () => {
  const req = (over) => ({
    actor: 'employee', status: 'not_started',
    requires_employer_verification: false, blocks_activation: false, ...over,
  });

  test('the two meters are independent', () => {
    const rows = [
      req({ status: 'complete' }),
      req({ status: 'submitted', requires_employer_verification: true }),
      req({ actor: 'employer', status: 'not_started' }),
    ];
    const p = engine.computeProgress(rows);
    // The employee has done everything that is theirs to do…
    expect(p.employeeDone).toBe(2);
    expect(p.employeeTotal).toBe(2);
    expect(p.employeePercent).toBe(100);
    expect(p.employeeComplete).toBe(true);
    // …while employer work is separately outstanding.
    expect(p.employerDone).toBe(0);
    expect(p.employerTotal).toBe(2);
    expect(p.employerComplete).toBe(false);
  });

  test('a submitted item counts for the employee but not the employer', () => {
    const p = engine.computeProgress([req({ status: 'submitted', requires_employer_verification: true })]);
    expect(p.employeeDone).toBe(1);
    expect(p.employerDone).toBe(0);
  });

  test('not_applicable counts as done for the employee', () => {
    const p = engine.computeProgress([req({ status: 'not_applicable' })]);
    expect(p.employeeDone).toBe(1);
    expect(p.employeeComplete).toBe(true);
  });

  test('corrections and expiries are surfaced', () => {
    const p = engine.computeProgress([
      req({ status: 'correction_required' }),
      req({ status: 'expired' }),
    ]);
    expect(p.correctionsOpen).toBe(1);
    expect(p.expired).toBe(1);
  });

  test('an empty requirement list is complete, not divided by zero', () => {
    const p = engine.computeProgress([]);
    expect(p.employeePercent).toBe(100);
    expect(p.employeeComplete).toBe(true);
    expect(p.readyToActivate).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('activation gate', () => {
  const blocking = (over) => ({
    id: 'r1', template_code: 'REQ_X', title: 'Thing', section: 'screening',
    actor: 'employee', blocks_activation: true, status: 'not_started', ...over,
  });

  test('an outstanding blocking requirement refuses activation and says which', () => {
    const out = engine.evaluateActivation([blocking()]);
    expect(out.ok).toBe(false);
    expect(out.blockers).toHaveLength(1);
    expect(out.blockers[0].code).toBe('REQ_X');
    expect(out.blockers[0].reason).toBeTruthy();
  });

  test('verified, complete and not_applicable all satisfy a blocker', () => {
    for (const status of ['verified', 'complete', 'not_applicable']) {
      expect(engine.evaluateActivation([blocking({ status })]).ok).toBe(true);
    }
  });

  test('an optional requirement never blocks activation', () => {
    const out = engine.evaluateActivation([blocking({ blocks_activation: false, status: 'not_started' })]);
    expect(out.ok).toBe(true);
  });

  test('a waived requirement stops blocking', () => {
    const out = engine.evaluateActivation([blocking({ status: 'not_started', waived: true })]);
    expect(out.ok).toBe(true);
  });

  test('a submitted-but-unverified employer item reads as awaiting verification', () => {
    const out = engine.evaluateActivation([blocking({
      status: 'submitted', requires_employer_verification: true,
    })]);
    expect(out.ok).toBe(false);
    expect(out.blockers[0].reason).toMatch(/verification/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('status transitions', () => {
  test('a requirement cannot jump straight to verified', () => {
    expect(engine.canTransition('not_started', 'verified')).toBe(false);
    expect(engine.canTransition('submitted', 'verified')).toBe(true);
  });

  test('a correction can be resubmitted', () => {
    // The regression this guards: without 'complete' here, an employee asked
    // to correct a self-completing item could never resubmit it.
    expect(engine.canTransition('correction_required', 'complete')).toBe(true);
    expect(engine.canTransition('correction_required', 'submitted')).toBe(true);
    expect(engine.canTransition('correction_required', 'in_progress')).toBe(true);
  });

  test('an expired requirement can be redone', () => {
    expect(engine.canTransition('expired', 'submitted')).toBe(true);
  });

  test('a same-status transition is a no-op, not a refusal', () => {
    expect(engine.canTransition('complete', 'complete')).toBe(true);
  });

  test('an employee action lands on submitted only when verification is required', () => {
    expect(engine.statusAfterEmployeeAction({ requires_employer_verification: true })).toBe('submitted');
    expect(engine.statusAfterEmployeeAction({ actor: 'employer' })).toBe('submitted');
    // Making someone wait for a verification that will never come would be a
    // lie about their progress.
    expect(engine.statusAfterEmployeeAction({ actor: 'employee' })).toBe('complete');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('derived assignment status', () => {
  const progress = (over) => ({
    employeeTotal: 5, employeeDone: 0, employerTotal: 2, employerDone: 0,
    blockingTotal: 3, blockingDone: 0, correctionsOpen: 0, expired: 0,
    employeeComplete: false, employerComplete: false, readyToActivate: false, ...over,
  });

  test('terminal statuses are never re-derived', () => {
    for (const status of ['activated', 'completed', 'cancelled', 'archived']) {
      expect(engine.deriveAssignmentStatus(status, progress({ employeeDone: 5 }),
        { submitted: true })).toBe(status);
    }
  });

  test('an open correction wins over everything else', () => {
    expect(engine.deriveAssignmentStatus('in_progress', progress({
      correctionsOpen: 1, employeeDone: 5, employeeComplete: true,
    }), { submitted: true })).toBe('corrections_required');
  });

  test('finishing the last item stops at employee_actions_complete', () => {
    // Submission is the EMPLOYEE'S act. Deriving straight into employer review
    // would make the Submit button vanish the moment it became relevant.
    expect(engine.deriveAssignmentStatus('in_progress', progress({
      employeeDone: 5, employeeComplete: true, employerDone: 1,
    }))).toBe('employee_actions_complete');
  });

  test('employee done AND submitted, employer outstanding, is employer_review', () => {
    expect(engine.deriveAssignmentStatus('in_progress', progress({
      employeeDone: 5, employeeComplete: true, employerDone: 1,
    }), { submitted: true })).toBe('employer_review');
  });

  test('everything satisfied is ready_to_activate', () => {
    expect(engine.deriveAssignmentStatus('employer_review', progress({
      employeeDone: 5, employeeComplete: true,
      employerDone: 2, employerComplete: true,
      blockingDone: 3,
    }), { submitted: true })).toBe('ready_to_activate');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('masking and validation', () => {
  test('a BSB renders as the last two digits only', () => {
    expect(engine.maskBsb('062-000')).toBe('•••-•00');
    expect(engine.maskBsb('062000')).toBe('•••-•00');
    expect(engine.maskBsb('12')).toBeNull();
  });

  test('an account number renders as the last four only', () => {
    expect(engine.maskAccountNumber('12345678')).toBe('••••5678');
    expect(engine.maskAccountNumber('123')).toBeNull();
  });

  test('a TFN never renders more than its last three digits', () => {
    const masked = engine.maskTfn('123456782');
    expect(masked).toBe('•••-•••-782');
    expect(masked).not.toContain('123456');
    expect(masked.replace(/\D/g, '')).toHaveLength(3);
  });

  test('BSB validation requires exactly six digits', () => {
    expect(engine.isValidBsb('062-000')).toBe(true);
    expect(engine.isValidBsb('06200')).toBe(false);
    expect(engine.isValidBsb('0620001')).toBe(false);
  });

  test('account number validation accepts 5-10 digits', () => {
    expect(engine.isValidAccountNumber('12345')).toBe(true);
    expect(engine.isValidAccountNumber('1234567890')).toBe(true);
    expect(engine.isValidAccountNumber('1234')).toBe(false);
    expect(engine.isValidAccountNumber('12345678901')).toBe(false);
  });

  test('TFN validation applies the ATO modulus-11 checksum', () => {
    // Known-valid checksums.
    expect(engine.isValidTfn('123456782')).toBe(true);
    expect(engine.isValidTfn('123 456 782')).toBe(true);
    // Right length, wrong checksum — this is what catches a typo before the
    // value is encrypted and stored.
    expect(engine.isValidTfn('123456789')).toBe(false);
    expect(engine.isValidTfn('111111111')).toBe(false);
    expect(engine.isValidTfn('12345')).toBe(false);
  });

  test('ABN validation applies the ATO modulus-89 checksum', () => {
    expect(engine.isValidAbn('51824753556')).toBe(true);
    expect(engine.isValidAbn('51 824 753 556')).toBe(true);
    expect(engine.isValidAbn('51824753557')).toBe(false);
    expect(engine.isValidAbn('123')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('expiry windows', () => {
  const today = new Date(Date.UTC(2026, 7, 20)); // 20 August 2026

  test('a date inside a window returns that window', () => {
    expect(engine.expiryWindow('2026-09-10', today)).toBe(30); // 21 days away
    expect(engine.expiryWindow('2026-08-25', today)).toBe(7);  // 5 days away
    expect(engine.expiryWindow('2026-10-10', today)).toBe(60);
  });

  test('a date beyond every window returns null', () => {
    expect(engine.expiryWindow('2027-08-20', today)).toBeNull();
  });

  test('today or the past returns 0', () => {
    expect(engine.expiryWindow('2026-08-20', today)).toBe(0);
    expect(engine.expiryWindow('2026-01-01', today)).toBe(0);
  });

  test('a missing or unparseable date returns null rather than throwing', () => {
    expect(engine.expiryWindow(null, today)).toBeNull();
    expect(engine.expiryWindow('not a date', today)).toBeNull();
  });

  test('severity escalates as expiry approaches', () => {
    expect(engine.expirySeverity(90)).toBe('info');
    expect(engine.expirySeverity(30)).toBe('warning');
    expect(engine.expirySeverity(7)).toBe('warning');
    expect(engine.expirySeverity(0)).toBe('error');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('package composition', () => {
  const template = (id, section, sort) => ({
    template_id: id, id: `pr-${id}`, section, sort_order: sort, title: `T${id}`,
  });

  test('inheritance flattens base then overlays, with the child winning', () => {
    const packages = {
      BASE: { package: { code: 'BASE', extends_codes: [] }, requirements: [template('a', 'policies', 10)] },
      OVL: { package: { code: 'OVL', extends_codes: ['BASE'] }, requirements: [template('b', 'policies', 20)] },
    };
    const pkg = { code: 'CHILD', extends_codes: ['OVL'] };
    const own = [{ ...template('a', 'policies', 10), mandatory: false }];

    const out = engine.resolveComposition(pkg, own, (code) => packages[code] || null);
    expect(out.chain).toEqual(['BASE', 'OVL', 'CHILD']);
    expect(out.rows).toHaveLength(2);
    // The child's override of 'a' wins over the base's copy.
    const a = out.rows.find((r) => r.template_id === 'a');
    expect(a.mandatory).toBe(false);
    expect(a.inherited_from).toBeNull();
  });

  test('a circular inheritance chain is reported, not followed', () => {
    const packages = {
      A: { package: { code: 'A', extends_codes: ['B'] }, requirements: [] },
      B: { package: { code: 'B', extends_codes: ['A'] }, requirements: [] },
    };
    const out = engine.resolveComposition({ code: 'A', extends_codes: ['B'] }, [],
      (code) => packages[code] || null);
    expect(out.warnings.some((w) => /circular|repeated/i.test(w))).toBe(true);
  });

  test('a missing parent package is reported rather than silently dropped', () => {
    const out = engine.resolveComposition({ code: 'X', extends_codes: ['GONE'] }, [], () => null);
    expect(out.warnings.some((w) => /not found/i.test(w))).toBe(true);
  });

  test('rows are ordered by section then sort order', () => {
    const own = [
      template('a', 'policies', 10),
      template('b', 'welcome_employment', 20),
      template('c', 'welcome_employment', 10),
    ];
    const out = engine.resolveComposition({ code: 'P', extends_codes: [] }, own, () => null);
    expect(out.rows.map((r) => r.template_id)).toEqual(['c', 'b', 'a']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('due dates', () => {
  test('an offset is measured from the start date', () => {
    const due = engine.computeDueAt({ due_offset_days: 28 }, { startDate: '2026-09-01' });
    expect(due.toISOString().slice(0, 10)).toBe('2026-09-29');
  });

  test('no offset falls back to the assignment due date', () => {
    const assignmentDueAt = new Date('2026-09-15T00:00:00Z');
    expect(engine.computeDueAt({}, { assignmentDueAt })).toBe(assignmentDueAt);
  });

  test('an unparseable start date falls back rather than producing an invalid date', () => {
    const assignmentDueAt = new Date('2026-09-15T00:00:00Z');
    const due = engine.computeDueAt({ due_offset_days: 7 }, { startDate: 'nope', assignmentDueAt });
    expect(due).toBe(assignmentDueAt);
  });
});
