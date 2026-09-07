'use strict';

/**
 * PAYROLL & XERO SETUP — routes and schema against a real PostgreSQL
 * database (migration 062), with Xero stubbed at the client boundary.
 *
 * The path the stage exists for: the employee saves bank, tax and super
 * details (accepting the privacy notice) → the Owner configures pay and
 * approves → the set is frozen as a snapshot → Sync creates and configures
 * the employee in the stubbed Xero, reads it back, checks the pay runs →
 * SYNCED, ready for the next regular pay run, with the Xero Me invitation as
 * a manual action.
 *
 * Alongside it, what must NOT happen: a user without onboarding.payroll
 * reading the stage; an admin with the permission but no owner/admin role
 * running the sync; a sensitive value appearing in any response; a sync
 * while the write flag is off; approval without a configuration.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

jest.mock('../../xero-payroll-connection', () => {
  const actual = jest.requireActual('../../xero-payroll-connection');
  return {
    ...actual,
    isConfigured: jest.fn(() => true),
    getConnection: jest.fn(async () => ({ accessToken: 'stub-token', tenantId: 'tenant-stub-abcdef', tenantName: 'Opal Demo', scope: actual.BASE_SCOPES, expiresAt: Date.now() + 1000000 })),
    health: jest.fn(async () => ({ configured: true, connected: true, tenantName: 'Opal Demo', tenantIdSuffix: 'abcdef', scopes: actual.BASE_SCOPES, syncEnabled: process.env.ENABLE_XERO_PAYROLL_SYNC === 'true' && process.env.ENABLE_XERO_WRITE === 'true' })),
  };
});

const xero = { employees: [], funds: [{ SuperFundID: 'sf-1', Type: 'REGULATED', Name: 'AustralianSuper', USI: 'STA0100AU', ABN: '65714394898' }], payRuns: [], created: 0, calls: [] };
jest.mock('../../xero-payroll-api', () => {
  const actual = jest.requireActual('../../xero-payroll-api');
  return {
    ...actual,
    getPayrollCalendars: jest.fn(async () => [{ PayrollCalendarID: 'cal-1', Name: 'Fortnightly', CalendarType: 'FORTNIGHTLY', StartDate: '2026-10-05', PaymentDate: '2026-10-21' }]),
    getPayItems: jest.fn(async () => ({ earningsRates: [{ EarningsRateID: 'er-1', Name: 'Ordinary Hours', RateType: 'RATEPERUNIT' }], leaveTypes: [{ LeaveTypeID: 'lt-1', Name: 'Annual Leave', NormalEntitlement: 152 }], deductionTypes: [], reimbursementTypes: [] })),
    getSuperFunds: jest.fn(async () => xero.funds),
    getSuperFundProducts: jest.fn(async () => []),
    getEmployees: jest.fn(async () => xero.employees),
    getEmployee: jest.fn(async (id) => xero.employees.find((e) => e.EmployeeID === id) || null),
    createEmployee: jest.fn(async (payload, opts) => { xero.calls.push(['create', opts.idempotencyKey]); xero.created++; const e = { EmployeeID: `e-${xero.created}`, Status: 'ACTIVE', ...payload }; xero.employees.push(e); return e; }),
    updateEmployee: jest.fn(async (id, patch, opts) => {
      xero.calls.push(['update', opts.step, opts.idempotencyKey]);
      const e = xero.employees.find((x) => x.EmployeeID === id); Object.assign(e, patch);
      if (patch.SuperMemberships) e.SuperMemberships = patch.SuperMemberships.map((m, i) => ({ ...m, SuperMembershipID: `sm-${i + 1}` }));
      if (patch.TaxDeclaration) e.IsSTP2Qualified = true;
      return e;
    }),
    createSuperFund: jest.fn(),
    getPayRunsForCalendar: jest.fn(async () => xero.payRuns),
    getPayRun: jest.fn(async (id) => xero.payRuns.find((p) => p.PayRunID === id) || null),
  };
});

jest.setTimeout(60000);
const PASSWORD = 'PayrollPass1';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/onboarding', bodyParser.json({ limit: '16mb' }));
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../app-routes'));
  app.use('/', require('../../onboarding-employee-routes'));
  app.use('/', require('../../onboarding-payroll-routes'));
  app.use('/', require('../../onboarding-journey-routes'));
  app.use('/', require('../../onboarding-routes'));
  return app;
}

let app; let server; let org;
let ipCounter = 0;
const nextIp = () => `10.8.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function agentFor({ permissions, ...overrides } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, organisation_id: org.id, ...overrides });
  if (permissions) await db.pool.query('UPDATE users SET permissions = $2 WHERE id = $1', [user.id, JSON.stringify(permissions)]);
  const agent = request.agent(server);
  const res = await agent.post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** A record past the offer, with a profile that already holds what onboarding gathers. */
async function seedRecord() {
  const odb = require('../../onboarding-db');
  const employee = await seedUser({ organisation_id: org.id, role: 'pre_employee', email: `jane-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, name: 'Jane Smith' });
  const pkg = (await db.pool.query(`INSERT INTO onboarding_packages (organisation_id, code, title) VALUES ($1, 'PKG_TEST_' || substr(md5(random()::text), 1, 8), 'Test package') RETURNING id`, [org.id])).rows[0];
  const ver = (await db.pool.query(`INSERT INTO onboarding_package_versions (package_id, version, title, content) VALUES ($1, 1, 'Test package', '{}'::jsonb) RETURNING id`, [pkg.id])).rows[0];
  const { rows } = await db.pool.query(
    `INSERT INTO onboarding_assignments (organisation_id, package_id, package_version_id, applicant_name, applicant_email, proposed_role, employment_type, status, user_id, job_title, start_date, pay_basis, pay_rate, hours_per_week)
     VALUES ($1, $4, $5, 'Jane Smith', $2, 'therapist', 'full_time', 'in_progress', $3, 'Occupational Therapist', '2026-10-07', 'annual', 92000, 38) RETURNING *`,
    [org.id, employee.email, employee.id, pkg.id, ver.id]
  );
  const a = rows[0];
  await odb.upsertPersonalDetails(employee.id, org.id, { assignmentId: a.id, legalFirstName: 'Jane', surname: 'Smith', dateOfBirth: '1990-04-03', mobile: '0400000000', personalEmail: employee.email, addressLine1: '12 Wattle St', suburb: 'Fremantle', state: 'WA', postcode: '6160' });
  await db.pool.query(`INSERT INTO employment_profiles (user_id, organisation_id, assignment_id, job_title, employment_type, start_date, hours_per_week, pay_basis, pay_rate) VALUES ($1, $2, $3, 'Occupational Therapist', 'full_time', '2026-10-07', 38, 'annual', 92000)`, [employee.id, org.id, a.id]);
  await odb.savePayrollBank(employee.id, org.id, { assignmentId: a.id, accountHolderName: 'Jane Smith', bsb: '062-123', accountNumber: '12345678' }, employee.id);
  await odb.savePayrollTax(employee.id, org.id, { assignmentId: a.id, taxSetupStatus: 'employee_completed', taxSubmissionMethod: 'employer_electronic_form', residencyStatus: 'australian_resident', tfn: '123456782', claimsTaxFreeThreshold: true, hasStudyLoan: false }, employee.id);
  await odb.savePayrollSuper(employee.id, org.id, { assignmentId: a.id, superStatus: 'employee_nominated', superChoiceType: 'apra_fund', superFundName: 'AustralianSuper', superFundAbn: '65714394898', superFundUsi: 'STA0100AU', superMemberNumber: '99881234', superAccountName: 'Jane Smith' }, employee.id);
  await require('../../xero-payroll-db').recordPrivacyNotice(employee.id, 'payroll-xero-2026-09');
  return { assignment: a, employee };
}

const SECRETS = ['123456782', '12345678', '062123', '062-123', 'stub-token', 'tenant-stub-abcdef'];
function expectNoSecrets(body) {
  const text = JSON.stringify(body);
  for (const s of SECRETS) expect(text).not.toContain(s);
}

beforeAll(async () => {
  app = buildApp();
  server = app.listen(0);
});
afterAll(async () => { server.close(); await closePool(); });
beforeEach(async () => {
  await truncateAll();
  await db.pool.query('TRUNCATE payroll_xero_operations, payroll_xero_sync CASCADE');
  org = await seedOrganisation('Opal Test');
  xero.employees = []; xero.payRuns = []; xero.created = 0; xero.calls = [];
  process.env.ENABLE_XERO_WRITE = 'true'; process.env.ENABLE_XERO_PAYROLL_SYNC = 'true';
});

const CONFIG = { employmentBasis: 'FULLTIME', payBasis: 'annual', annualSalary: 92000, unitsPerWeek: 38, earningsRateId: 'er-1', payrollCalendarId: 'cal-1', taxScaleType: 'REGULAR', jobTitle: 'Occupational Therapist', leaveLines: [{ leaveTypeId: 'lt-1', annualNumberOfUnits: 152, fullTimeNumberOfUnitsPerPeriod: 76 }] };

describe('the whole stage', () => {
  test('migration 062 is applied', async () => {
    const { rows } = await db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'payroll_xero_sync' AND column_name IN ('state', 'approved_snapshot', 'operation_id', 'manual_actions')");
    expect(rows).toHaveLength(4);
    const ops = await db.pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'payroll_xero_operations'");
    expect(ops.rowCount).toBe(1);
    const p = await db.pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'payroll_profiles' AND column_name = 'privacy_notice_version'");
    expect(p.rowCount).toBe(1);
  });

  test('configure → approve → sync → verified and ready for the next regular pay run', async () => {
    const { assignment, employee } = await seedRecord();
    const { agent } = await agentFor({ role: 'owner' });
    const base = `/api/onboarding/journey/records/${assignment.id}/payroll-setup`;

    let res = await agent.get(base);
    expect(res.status).toBe(200);
    expect(res.body.payroll.xero.state).toBe('ADMIN_REVIEW');
    expect(res.body.payroll.xero.defaultConfig).toMatchObject({ employmentBasis: 'FULLTIME', annualSalary: 92000, taxScaleType: 'REGULAR' });
    expect(res.body.payroll.xero.can.approve).toBe(false); // no configuration yet
    expectNoSecrets(res.body);

    res = await agent.get(`${base}/xero/reference`);
    expect(res.status).toBe(200);
    expect(res.body.reference.calendars[0]).toEqual({ id: 'cal-1', name: 'Fortnightly', calendarType: 'FORTNIGHTLY', startDate: '2026-10-05', paymentDate: '2026-10-21' });

    res = await agent.post(`${base}/approve`);
    expect(res.status).toBe(409); expect(res.body.code).toBe('no_config');

    res = await agent.put(`${base}/config`).send({ ...CONFIG, payrollCalendarId: 'missing' });
    expect(res.status).toBe(400); expect(res.body.errors).toContain('The chosen payroll calendar no longer exists in Xero');

    res = await agent.put(`${base}/config`).send(CONFIG);
    expect(res.status).toBe(200);
    expect(res.body.payroll.xero.config).toMatchObject({ payrollCalendarName: 'Fortnightly', earningsRateName: 'Ordinary Hours' });
    expect(res.body.payroll.xero.can.approve).toBe(true);

    res = await agent.post(`${base}/approve`);
    expect(res.status).toBe(200);
    const X = res.body.payroll.xero;
    expect(X.state).toBe('APPROVED_FOR_XERO');
    expect(X.snapshotVersion).toBe(1);
    expect(X.snapshot.bank).toMatchObject({ bsbMasked: '•••-•23', accountLast4: '5678' });
    expect(X.snapshot.tax).toMatchObject({ tfnProvided: true, tfnLast3: '782' });
    expect(X.snapshot.super.memberNumberMasked).toBe('••••1234');
    expect(X.privacyNotice).toMatchObject({ version: 'payroll-xero-2026-09' });
    expect(X.can.sync).toBe(true);
    expectNoSecrets(res.body);

    res = await agent.post(`${base}/sync`);
    expect(res.status).toBe(200);
    const S = res.body.payroll.xero;
    expect(S.state).toBe('SYNCED');
    expect(S.nextPayRun.state).toBe('READY_FOR_NEXT_PAY_RUN');
    expect(S.xeroEmployeeId).toBe('e-1');
    expect(S.verification.ok).toBe(true);
    expect(S.manualActions.map((a) => a.code)).toEqual(['invite_to_xero_me']);
    expect(S.tenantIdSuffix).toBe('abcdef');
    expectNoSecrets(res.body);

    // What Xero received: the real values, exactly once, under stable idempotency keys.
    expect(xero.created).toBe(1);
    const emp = xero.employees[0];
    expect(emp.TaxDeclaration.TaxFileNumber).toBe('123456782');
    expect(emp.BankAccounts[0]).toMatchObject({ BSB: '062123', AccountNumber: '12345678', Remainder: true });
    expect(emp.HomeAddress).toEqual({ AddressLine1: '12 Wattle St', City: 'Fremantle', Region: 'WA', PostalCode: '6160', Country: 'Australia' });
    expect(emp.PayTemplate.LeaveLines[0]).toMatchObject({ LeaveTypeID: 'lt-1', CalculationType: 'BASEDONORDINARYEARNINGS' });
    expect(xero.calls[0][1]).toMatch(/^opal-payroll-[0-9a-f-]{36}-create$/);

    // Stored: identifiers and a redacted operation log, nothing secret.
    const row = (await db.pool.query('SELECT * FROM payroll_xero_sync WHERE assignment_id = $1', [assignment.id])).rows[0];
    expect(row).toMatchObject({ state: 'SYNCED', xero_employee_id: 'e-1', xero_super_fund_id: 'sf-1', xero_super_membership_id: 'sm-1', attempt_count: 1 });
    expectNoSecrets(row);
    const ops = (await db.pool.query('SELECT * FROM payroll_xero_operations WHERE sync_id = $1', [row.id])).rows;
    expect(ops.length).toBeGreaterThan(0);
    expectNoSecrets(ops);
    const profile = (await db.pool.query('SELECT payroll_setup_status, payroll_employee_ref, payroll_system FROM payroll_profiles WHERE user_id = $1', [employee.id])).rows[0];
    expect(profile).toEqual({ payroll_setup_status: 'configured', payroll_employee_ref: 'e-1', payroll_system: 'xero' });

    // Audit: started, result, and the reveal is a matter of record — without values.
    const audit = (await db.pool.query("SELECT action, metadata FROM audit_logs WHERE action LIKE 'onboarding.payroll_%' ORDER BY created_at")).rows;
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['onboarding.payroll_config_saved', 'onboarding.payroll_setup_approved', 'onboarding.payroll_xero_sync_started', 'onboarding.payroll_xero_sync_result']));
    expectNoSecrets(audit);

    // Locked now: configuration and approval refuse, recheck works, second sync refuses.
    expect((await agent.put(`${base}/config`).send(CONFIG)).status).toBe(409);
    expect((await agent.post(`${base}/sync`)).status).toBe(409);
    res = await agent.post(`${base}/recheck`);
    expect(res.status).toBe(200);
    expect(res.body.payroll.xero.lastRecheckAt).toBeTruthy();
    res = await agent.post(`${base}/manual-actions/invite_to_xero_me/complete`);
    expect(res.status).toBe(200);
    expect(res.body.payroll.xero.manualActions[0].completedAt).toBeTruthy();
    expect((await agent.post(`${base}/manual-actions/not_a_thing/complete`)).status).toBe(404);
  });

  test('a draft pay run without the employee → manual inclusion; a duplicate stops the sync', async () => {
    xero.payRuns = [{ PayRunID: 'p1', PayRunStatus: 'DRAFT', PayrollCalendarID: 'cal-1', PayRunPeriodStartDate: '2026-10-05', PayRunPeriodEndDate: '2026-10-18', PaymentDate: '2026-10-21', Payslips: [] }];
    const { assignment } = await seedRecord();
    const { agent } = await agentFor({ role: 'owner' });
    const base = `/api/onboarding/journey/records/${assignment.id}/payroll-setup`;
    await agent.put(`${base}/config`).send(CONFIG);
    await agent.post(`${base}/approve`);
    let res = await agent.post(`${base}/sync`);
    expect(res.body.payroll.xero.nextPayRun.state).toBe('MANUAL_INCLUSION_REQUIRED');
    expect(res.body.payroll.xero.manualActions.map((a) => a.code)).toEqual(['include_in_draft_pay_run', 'invite_to_xero_me']);

    // A second person with the same name and DOB: possible duplicate, resolved by linking.
    const second = await seedRecord();
    const base2 = `/api/onboarding/journey/records/${second.assignment.id}/payroll-setup`;
    await agent.put(`${base2}/config`).send(CONFIG);
    await agent.post(`${base2}/approve`);
    res = await agent.post(`${base2}/sync`);
    expect(res.body.payroll.xero.state).toBe('POSSIBLE_DUPLICATE');
    expect(res.body.payroll.xero.duplicateCandidates[0].employeeId).toBe('e-1');
    expect(xero.created).toBe(1);
    expect((await agent.post(`${base2}/sync`)).body.code).toBe('duplicate_unresolved');
    expect((await agent.post(`${base2}/resolve-duplicate`).send({ resolution: 'link_existing', employeeId: 'e-other' })).status).toBe(400);
    res = await agent.post(`${base2}/resolve-duplicate`).send({ resolution: 'link_existing', employeeId: 'e-1' });
    expect(res.status).toBe(200);
    res = await agent.post(`${base2}/sync`);
    expect(res.body.payroll.xero.state).toBe('SYNCED');
    expect(res.body.payroll.xero.xeroEmployeeId).toBe('e-1');
    expect(xero.created).toBe(1);
  });

  test('request changes reopens the payroll forms and withdraws the approval', async () => {
    const { assignment, employee } = await seedRecord();
    await db.pool.query(`INSERT INTO onboarding_requirements (assignment_id, organisation_id, template_code, title, section, classification, handler, actor, status, snapshot) VALUES ($1, $2, 'FORM_BANK', 'Bank details', 'payroll_tax_super', 'personal', 'form', 'employee', 'submitted', '{"form_key":"bank_details"}'::jsonb)`, [assignment.id, org.id]);
    const { agent } = await agentFor({ role: 'owner' });
    const base = `/api/onboarding/journey/records/${assignment.id}/payroll-setup`;
    await agent.put(`${base}/config`).send(CONFIG);
    await agent.post(`${base}/approve`);
    expect((await agent.post(`${base}/request-changes`).send({})).status).toBe(400);
    const res = await agent.post(`${base}/request-changes`).send({ reason: 'The BSB does not match your bank statement.' });
    expect(res.status).toBe(200);
    expect(res.body.reopened).toBe(1);
    expect(res.body.payroll.xero.state).toBe('CHANGES_REQUESTED');
    const req = (await db.pool.query('SELECT status, review_reason FROM onboarding_requirements WHERE assignment_id = $1', [assignment.id])).rows[0];
    expect(req).toEqual({ status: 'correction_required', review_reason: 'The BSB does not match your bank statement.' });
    const prof = (await db.pool.query('SELECT payroll_approved_at FROM payroll_profiles WHERE user_id = $1', [employee.id])).rows[0];
    expect(prof.payroll_approved_at).toBeNull();
  });
});

describe('the guards', () => {
  test('no onboarding.payroll → 403 on every route; the permission alone cannot sync', async () => {
    const { assignment } = await seedRecord();
    const base = `/api/onboarding/journey/records/${assignment.id}/payroll-setup`;
    const { agent: therapist } = await agentFor({ role: 'therapist' });
    for (const [m, p] of [['get', ''], ['get', '/xero/reference'], ['put', '/config'], ['post', '/approve'], ['post', '/sync'], ['post', '/retry'], ['post', '/recheck'], ['post', '/request-changes'], ['post', '/resolve-duplicate']]) {
      const res = await therapist[m](base + p).send({});
      expect([401, 403]).toContain(res.status);
    }
    // A therapist delegated onboarding.payroll can review and approve but not release the values to Xero.
    const { agent: delegate } = await agentFor({ role: 'therapist', permissions: ['onboarding.view', 'onboarding.payroll'] });
    expect((await delegate.get(base)).status).toBe(200);
    expect((await delegate.put(`${base}/config`).send(CONFIG)).status).toBe(200);
    expect((await delegate.post(`${base}/approve`)).status).toBe(200);
    const res = await delegate.post(`${base}/sync`);
    expect(res.status).toBe(403); expect(res.body.code).toBe('role_required');
    expect(xero.created).toBe(0);
  });
  test('the write flag is fail-closed', async () => {
    process.env.ENABLE_XERO_PAYROLL_SYNC = 'false';
    const { assignment } = await seedRecord();
    const { agent } = await agentFor({ role: 'owner' });
    const base = `/api/onboarding/journey/records/${assignment.id}/payroll-setup`;
    await agent.put(`${base}/config`).send(CONFIG);
    await agent.post(`${base}/approve`);
    const res = await agent.post(`${base}/sync`);
    expect(res.status).toBe(403); expect(res.body.code).toBe('PAYROLL_SYNC_DISABLED');
    expect(xero.created).toBe(0);
  });
  test('another organisation cannot see the record', async () => {
    const { assignment } = await seedRecord();
    const other = await seedOrganisation('Other Org');
    const { agent } = await agentFor({ role: 'owner', organisation_id: other.id });
    expect((await agent.get(`/api/onboarding/journey/records/${assignment.id}/payroll-setup`)).status).toBe(404);
  });
  test('the applicant must accept the privacy notice to save payroll details, and it is recorded', async () => {
    const { assignment, employee } = await seedRecord();
    await db.pool.query('UPDATE payroll_profiles SET privacy_notice_version = NULL, privacy_notice_accepted_at = NULL WHERE user_id = $1', [employee.id]);
    const { rows } = await db.pool.query(`INSERT INTO onboarding_requirements (assignment_id, organisation_id, template_code, title, section, classification, handler, actor, status, snapshot) VALUES ($1, $2, 'FORM_BANK', 'Bank details', 'payroll_tax_super', 'personal', 'form', 'employee', 'not_started', '{"form_key":"bank_details"}'::jsonb) RETURNING id`, [assignment.id, org.id]);
    await db.pool.query(`UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1`, [employee.id, await bcrypt.hash(PASSWORD, 4)]);
    const agent = request.agent(server);
    const login = await agent.post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email: employee.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const path = `/api/onboarding/me/requirements/${rows[0].id}/form`;
    let res = await agent.post(path).send({ accountHolderName: 'Jane Smith', bsb: '062-123', accountNumber: '12345678' });
    expect(res.status).toBe(400); expect(res.body.error).toMatch(/shared with Xero/);
    res = await agent.post(path).send({ accountHolderName: 'Jane Smith', bsb: '062-123', accountNumber: '12345678', payrollNoticeAccepted: true });
    expect(res.status).toBe(200);
    const p = (await db.pool.query('SELECT privacy_notice_version, privacy_notice_accepted_at FROM payroll_profiles WHERE user_id = $1', [employee.id])).rows[0];
    expect(p.privacy_notice_version).toBe('payroll-xero-2026-09');
    expect(p.privacy_notice_accepted_at).toBeTruthy();
    // The applicant cannot reach the staff stage.
    expect((await agent.get(`/api/onboarding/journey/records/${assignment.id}/payroll-setup`)).status).toBe(403);
  });
});
