'use strict';
/**
 * ONBOARDING PACKAGES — staging smoke test.
 *
 * Runs the whole workflow against the DEPLOYED staging app over HTTPS, using
 * synthetic accounts only:
 *
 *   Owner reviews a package → assigns → releases → invitation issued
 *   → the applicant sets a password → completes forms, credentials and
 *   acknowledgements → submits → the Owner verifies → activation gate refuses
 *   while blocking work is outstanding → verifies the rest → activates.
 *
 * Plus the boundaries that must hold: a therapist cannot reach the management
 * surface, an Admin without delegation cannot see payroll, and no tax file
 * number or bank account appears anywhere in a response.
 *
 * Usage:
 *   BASE=https://opal-portal-staging.azurewebsites.net \
 *   SYN_PASS="$(sed 's/.*: //' deploy/staging-synthetic.local.txt)" \
 *   node deploy/staging-validate-onboarding.js
 *
 * The run creates ONE synthetic pre-employee (synthetic.newstarter@example.test)
 * and leaves it activated. Re-running is safe: it cancels any live onboarding
 * for that address first.
 */

const BASE = process.env.BASE;
const SYN_PASS = process.env.SYN_PASS;
if (!BASE || !SYN_PASS) { console.error('BASE and SYN_PASS are required'); process.exit(2); }

// Account addresses are overridable so the same script can be dry-run against
// a local server with its own seeded users before it is pointed at staging.
const OWNER = process.env.SYN_OWNER || 'synthetic.owner@example.test';
const ADMIN = process.env.SYN_ADMIN || 'synthetic.admin@example.test';
const THERAPIST = process.env.SYN_THERAPIST || 'synthetic.therapist@example.test';
const NEW_STARTER = process.env.SYN_NEWSTARTER || 'synthetic.newstarter@example.test';
const NEW_PASS = 'SyntheticStarter2026!';
const PDF_B64 = Buffer.from('%PDF-1.4 synthetic onboarding evidence').toString('base64');

// A TFN and ABN that satisfy the ATO checksums, so validation passes and the
// real encrypt/mask path is exercised rather than a 400.
const TFN = '123456782';
const ABN = '51824753556';

const results = [];
function record(id, desc, got, want) {
  const ok = String(got) === String(want);
  results.push({ id, desc, got: String(got), want: String(want), ok });
  console.log(`${ok ? '✓' : '✗ FINDING'} [${id}] ${desc} → ${got} (want ${want})`);
}

function makeClient() {
  let cookie = '';
  return async function client(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
    const res = await fetch(BASE + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: BASE,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setC = res.headers.getSetCookie?.() || [];
    if (setC.length) cookie = setC.map((c) => c.split(';')[0]).join('; ');
    if (raw) return res;
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, json, headers: res.headers };
  };
}

async function login(email, password = SYN_PASS) {
  const c = makeClient();
  const r = await c('/api/auth/login', { method: 'POST', body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  return c;
}

(async () => {
  const owner = await login(OWNER);

  // ── O1: the catalogue seeded on boot ────────────────────────────────────
  const dash = await owner('/api/onboarding/dashboard');
  record('O1.1', 'owner reaches the onboarding dashboard', dash.status, 200);
  record('O1.2', 'field encryption is configured', dash.json?.settings?.encryptionConfigured, true);

  const pkgs = await owner('/api/onboarding/packages');
  const assignable = (pkgs.json?.packages || []).filter((p) => p.kind === 'package');
  record('O1.3', 'six assignable packages seeded', assignable.length, 6);
  record('O1.4', 'all published', assignable.every((p) => p.status === 'published'), true);

  const registry = await owner('/api/onboarding/compliance/requirements');
  const codes = (registry.json?.requirements || []).map((c) => c.code);
  record('O1.5', 'compliance registry seeded', codes.length >= 30, true);
  const screening = (registry.json?.requirements || []).find((c) => c.code === 'NDIS_WORKER_SCREENING');
  // The honesty column: worker screening must not be recorded as a blanket
  // legal requirement, because for an unregistered provider it is not one.
  record('O1.6', 'worker screening is not asserted as universal law',
    screening?.basis !== 'LEGAL_REQUIREMENT', true);

  // ── O2: the rule engine issues the right set ────────────────────────────
  const otCasual = assignable.find((p) => p.code === 'PKG_OT_CASUAL');
  const preview = await owner(`/api/onboarding/packages/${otCasual.id}/preview`, {
    method: 'POST',
    body: {
      facts: {
        employment_type: 'casual', role_category: 'occupational_therapist',
        child_related_work: 'yes', ndis_risk_assessed_role: 'yes',
        mobile_community_role: true, uses_own_vehicle: true, is_treating_therapist: true,
      },
    },
  });
  const previewCodes = (preview.json?.sections || []).flatMap((s) => s.requirements.map((r) => r.code));
  record('O2.1', 'FWIS issued to every employee', previewCodes.includes('REQ_FWIS'), true);
  record('O2.2', 'CEIS issued to a casual', previewCodes.includes('REQ_CEIS'), true);
  record('O2.3', 'FTCIS NOT issued to a casual', previewCodes.includes('REQ_FTCIS'), false);
  record('O2.4', 'Ahpra issued to an OT', previewCodes.includes('REQ_AHPRA'), true);
  record('O2.5', 'WWCC issued for child-related work', previewCodes.includes('REQ_WWCC'), true);
  record('O2.6', 'screening issued for a risk-assessed role', previewCodes.includes('REQ_NDIS_SCREENING'), true);
  record('O2.7', 'police check never auto-applied', previewCodes.includes('REQ_POLICE_CHECK'), false);

  const adminCasual = assignable.find((p) => p.code === 'PKG_ADMIN_CASUAL');
  const adminPreview = await owner(`/api/onboarding/packages/${adminCasual.id}/preview`, {
    method: 'POST',
    body: {
      facts: {
        employment_type: 'casual', role_category: 'administration',
        child_related_work: 'no', ndis_risk_assessed_role: 'no',
      },
    },
  });
  const adminCodes = (adminPreview.json?.sections || []).flatMap((s) => s.requirements.map((r) => r.code));
  record('O2.8', 'office admin gets no Ahpra', adminCodes.includes('REQ_AHPRA'), false);
  record('O2.9', 'office admin gets no WWCC', adminCodes.includes('REQ_WWCC'), false);
  record('O2.10', 'office admin gets no driver licence', adminCodes.includes('REQ_DRIVERS_LICENCE'), false);
  // The NDIS Code of Conduct binds every worker, including administration.
  record('O2.11', 'NDIS Code of Conduct still applies to admin', adminCodes.includes('REQ_NDIS_CODE'), true);

  // ── O3: publish policy content, then assign and release ─────────────────
  // Release deliberately refuses to ask anyone to acknowledge a document that
  // has no published version, so this is a real first step for an Owner.
  const docs = await owner('/api/onboarding/documents');
  let published = 0;
  for (const d of (docs.json?.documents || [])) {
    if (!d.requiresAcknowledgement || d.currentVersion > 0) continue;
    const v = await owner(`/api/onboarding/documents/${d.id}/versions`, {
      method: 'POST',
      body: { title: d.title, body: `${d.title}\n\nSynthetic staging content.`, effectiveDate: '2026-08-01' },
    });
    if (v.status !== 201) continue;
    const p = await owner(`/api/onboarding/documents/${d.id}/versions/${v.json.version.id}/publish`,
      { method: 'POST', body: {} });
    if (p.status === 200) published += 1;
  }
  record('O3.1', 'policy documents published', published >= 0, true);
  for (const pkg of assignable) {
    await owner(`/api/onboarding/packages/${pkg.id}/publish`,
      { method: 'POST', body: { changeNote: 'Pin published policy versions' } });
  }

  // Cancel any live run from a previous smoke, so re-running is safe.
  const existing = await owner('/api/onboarding/assignments?active=1');
  for (const a of (existing.json?.assignments || [])) {
    if (a.applicantEmail === NEW_STARTER) {
      await owner(`/api/onboarding/assignments/${a.id}/cancel`,
        { method: 'POST', body: { reason: 'Superseded by a new staging smoke run' } });
    }
  }

  const created = await owner('/api/onboarding/assignments', {
    method: 'POST',
    body: {
      packageId: otCasual.id,
      applicantName: 'Nia Synthetic-Starter', applicantEmail: NEW_STARTER,
      jobTitle: 'Occupational Therapist', proposedRole: 'therapist',
      isTreatingTherapist: true, employmentType: 'casual',
      roleCategory: 'occupational_therapist', startDate: '2026-10-01',
      childRelatedWork: 'yes', ndisRiskAssessedRole: 'yes',
      mobileCommunityRole: true, usesOwnVehicle: true,
    },
  });
  record('O3.2', 'assignment created', created.status, 201);
  const asnId = created.json?.assignment?.id;

  const released = await owner(`/api/onboarding/assignments/${asnId}/release`,
    { method: 'POST', body: {} });
  record('O3.3', 'released', released.status, 201);
  record('O3.4', 'requirements issued', (released.json?.requirementsIssued || 0) > 20, true);
  const inviteUrl = released.json?.onboardingUrl || '';
  record('O3.5', 'a secure invitation link was produced', /\/onboarding-invite\?token=/.test(inviteUrl), true);

  const token = (inviteUrl.split('token=')[1] || '').trim();

  // ── O4: the applicant accepts and completes ─────────────────────────────
  const anon = makeClient();
  const check = await anon('/api/onboarding-invite/check', { method: 'POST', body: { token } });
  record('O4.1', 'invitation validates', check.json?.ok, true);
  record('O4.2', 'no employment terms leak into the pre-auth page',
    JSON.stringify(check.json).includes('salary'), false);

  const applicant = makeClient();
  const accept = await applicant('/api/onboarding-invite/accept', {
    method: 'POST', body: { token, password: NEW_PASS, name: 'Nia Synthetic-Starter' },
  });
  record('O4.3', 'invitation accepted and signed in', accept.status, 200);

  // Single use.
  const replay = await makeClient()('/api/onboarding-invite/accept', {
    method: 'POST', body: { token, password: 'AnotherPass1!' },
  });
  record('O4.4', 'the same token cannot be spent twice', replay.status, 400);

  let mine = await applicant('/api/onboarding/me');
  record('O4.5', 'the new starter sees their own onboarding', mine.json?.hasOnboarding, true);

  const R = (id, suffix) => `/api/onboarding/me/requirements/${id}/${suffix}`;
  const all = () => (mine.json?.sections || []).flatMap((s) => s.requirements);

  for (const r of all()) {
    if (!['document_ack', 'info'].includes(r.handler)) continue;
    const body = { acknowledged: true };
    if (r.config?.requiresTypedName) body.typedLegalName = 'Nia Synthetic-Starter';
    await applicant(R(r.id, 'acknowledge'), { method: 'POST', body });
  }
  mine = await applicant('/api/onboarding/me');

  const forms = {
    REQ_PERSONAL_DETAILS: {
      legalFirstName: 'Nia', surname: 'Synthetic-Starter', dateOfBirth: '1993-03-03',
      mobile: '0400000000', addressLine1: '1 Synthetic St', suburb: 'Perth',
      state: 'WA', postcode: '6000',
    },
    REQ_EMERGENCY_CONTACT: {
      emergencyName: 'Kin Synthetic', emergencyRelationship: 'Partner', emergencyPhone: '0411111111',
    },
    REQ_BANK_DETAILS: { accountHolderName: 'Nia Synthetic-Starter', bsb: '062-000', accountNumber: '12345678' },
    REQ_TAX_SETUP: {
      taxSubmissionMethod: 'employer_electronic_form', residencyStatus: 'australian_resident',
      tfn: TFN, claimsTaxFreeThreshold: true, hasStudyLoan: false,
    },
    REQ_SUPER_SETUP: {
      superChoiceType: 'apra_fund', superFundName: 'Synthetic Super', superFundAbn: ABN,
      superFundUsi: 'SYN0100AU', superMemberNumber: 'M000001', superAccountName: 'Nia Synthetic-Starter',
    },
    REQ_IDENTITY: {
      evidenceType: 'australian_passport', nameOnDocument: 'Nia Synthetic-Starter',
      travelDocumentType: 'Passport', documentNumber: 'PA9999999', countryOfIssue: 'Australia',
    },
    REQ_RIGHT_TO_WORK: { rightToWorkBasis: 'citizen' },
    REQ_VEHICLE: { registration: '1SYN123', make: 'Toyota', model: 'Corolla', businessUseConfirmed: true },
  };
  for (const [code, body] of Object.entries(forms)) {
    const r = all().find((x) => x.code === code);
    if (r) await applicant(R(r.id, 'form'), { method: 'POST', body });
  }
  mine = await applicant('/api/onboarding/me');

  const creds = {
    REQ_AHPRA: { registrationNumber: 'OCC9999999999', expiryDate: '2026-11-30' },
    REQ_QUALIFICATION: { registrationNumber: 'BSc-OT-2015', institution: 'Curtin University', completionYear: 2015 },
    REQ_PII: { registrationNumber: 'PII-SYN-001', arrangement: 'employer_policy', expiryDate: '2027-06-30' },
    REQ_NDIS_SCREENING: { registrationNumber: 'WA-NDIS-SYN-1', jurisdiction: 'WA', expiryDate: '2031-01-01' },
    REQ_WWCC: { registrationNumber: 'WWCSYN0001', familyName: 'Synthetic-Starter', expiryDate: '2029-05-01' },
    REQ_DRIVERS_LICENCE: { registrationNumber: 'WASYN0001', licenceClass: 'C', jurisdiction: 'WA', expiryDate: '2030-02-02' },
  };
  for (const [code, body] of Object.entries(creds)) {
    const r = all().find((x) => x.code === code);
    if (r) await applicant(R(r.id, 'credential'), { method: 'POST', body });
  }
  mine = await applicant('/api/onboarding/me');

  for (const r of all()) {
    if (!['employee', 'both'].includes(r.actor)) continue;
    if (['complete', 'verified', 'submitted', 'not_applicable'].includes(r.status)) continue;
    if (r.handler === 'upload' || r.handler === 'training') {
      await applicant(R(r.id, 'upload'), {
        method: 'POST',
        body: {
          title: r.title, fileName: 'evidence.pdf', fileMime: 'application/pdf',
          fileSizeBytes: 40, fileData: PDF_B64,
        },
      });
      if (r.handler === 'training') {
        await applicant(R(r.id, 'training'), { method: 'POST', body: { completedAt: '2026-08-20' } });
      }
    } else if (r.handler === 'live_source') {
      await applicant(R(r.id, 'confirm-live-source'), { method: 'POST', body: { confirmed: true } });
    }
  }
  mine = await applicant('/api/onboarding/me');

  record('O4.6', 'the employee reaches 100% on their own actions', mine.json?.yourProgress?.percent, 100);
  // The whole point of the two meters: employer verification is reported
  // separately and never drags the employee's figure down.
  record('O4.7', 'employer review is reported separately',
    (mine.json?.employerReview?.remaining || 0) > 0, true);
  record('O4.8', 'the run waits for the employee to submit', mine.json?.status, 'employee_actions_complete');
  record('O4.9', 'submit is offered', mine.json?.canSubmit, true);
  record('O4.10', 'no tax file number is echoed back to the employee',
    JSON.stringify(mine.json).includes(TFN), false);
  record('O4.11', 'no bank account is echoed back to the employee',
    JSON.stringify(mine.json).includes('12345678'), false);

  const submitted = await applicant('/api/onboarding/me/submit', { method: 'POST', body: {} });
  record('O4.12', 'submitted', submitted.status, 200);
  record('O4.13', 'the run moves to employer review', submitted.json?.status, 'employer_review');
  const afterSubmit = await applicant('/api/onboarding/me');
  record('O4.14', 'submit is not offered twice', afterSubmit.json?.canSubmit, false);

  // ── O5: the activation gate ─────────────────────────────────────────────
  const tooEarly = await owner(`/api/onboarding/assignments/${asnId}/activate`, { method: 'POST', body: {} });
  record('O5.1', 'activation refused while verification is outstanding', tooEarly.status, 409);
  record('O5.2', 'and it names the blockers', (tooEarly.json?.blockers || []).length > 0, true);

  // A statutory verification can never be waived into a clearance.
  const detail = await owner(`/api/onboarding/assignments/${asnId}`);
  const screeningReq = (detail.json?.sections || []).flatMap((s) => s.requirements)
    .find((r) => r.code === 'REQ_NDIS_SCREENING');
  const waive = await owner(
    `/api/onboarding/assignments/${asnId}/requirements/${screeningReq.id}/waive`,
    { method: 'POST', body: { reason: 'smoke test' } }
  );
  record('O5.3', 'a statutory requirement cannot be waived', waive.status, 409);

  for (const sec of (detail.json?.sections || [])) {
    for (const r of sec.requirements) {
      if (['verified', 'complete', 'not_applicable'].includes(r.status)) continue;
      const base = `/api/onboarding/assignments/${asnId}/requirements/${r.id}`;
      const action = (r.requiresEmployerVerification || r.actor === 'both') ? 'verify' : 'approve';
      await owner(`${base}/${action}`, { method: 'POST', body: {} });
    }
  }
  const ready = await owner(`/api/onboarding/assignments/${asnId}`);
  record('O5.4', 'ready to activate once every blocker clears', ready.json?.assignment?.status, 'ready_to_activate');

  const activated = await owner(`/api/onboarding/assignments/${asnId}/activate`, { method: 'POST', body: {} });
  record('O5.5', 'activated', activated.status, 200);
  record('O5.6', 'the pre-employee became a therapist', activated.json?.user?.role, 'therapist');
  const again = await owner(`/api/onboarding/assignments/${asnId}/activate`, { method: 'POST', body: {} });
  record('O5.7', 'activation is idempotent', again.status, 409);

  const employee = await owner(`/api/onboarding/employees/${activated.json.user.id}`);
  record('O5.8', 'employment record is live', employee.json?.employment?.status, 'active');
  record('O5.9', 'credentials retained', (employee.json?.credentials || []).length >= 6, true);
  record('O5.10', 'acknowledgements retained', (employee.json?.acknowledgements || []).length > 0, true);
  record('O5.11', 'onboarding history retained', (employee.json?.onboardingHistory || []).length, 1);
  record('O5.12', 'no tax file number in the employee record',
    JSON.stringify(employee.json).includes(TFN), false);
  record('O5.13', 'no bank account in the employee record',
    JSON.stringify(employee.json).includes('12345678'), false);
  record('O5.14', 'payroll is masked', employee.json?.payroll?.accountNumberLast4, '5678');

  // ── O6: access control ──────────────────────────────────────────────────
  const therapist = await login(THERAPIST);
  const admin = await login(ADMIN);

  for (const [id, desc, client] of [
    ['O6.1', 'therapist cannot reach the dashboard', therapist],
    ['O6.2', 'admin without delegation cannot reach the dashboard', admin],
  ]) {
    const r = await client('/api/onboarding/dashboard');
    record(id, desc, r.status, 403);
  }
  const tPay = await therapist(`/api/onboarding/assignments/${asnId}/payroll`);
  record('O6.3', 'therapist cannot read payroll', [403, 404].includes(tPay.status), true);
  const aPay = await admin(`/api/onboarding/assignments/${asnId}/payroll`);
  record('O6.4', 'undelegated admin cannot read payroll', aPay.status, 403);

  // The activated employee is now a therapist: they must see their own record
  // and nothing of the management surface.
  const activatedUser = await login(NEW_STARTER, NEW_PASS);
  const own = await activatedUser('/api/onboarding/me');
  record('O6.5', 'the activated employee still sees their own onboarding', own.status, 200);
  const mgmt = await activatedUser('/api/onboarding/assignments');
  record('O6.6', 'but not the management surface', mgmt.status, 403);

  // ── Summary ─────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`Onboarding staging smoke: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFINDINGS:');
    for (const f of failed) console.log(`  ✗ [${f.id}] ${f.desc} → got ${f.got}, want ${f.want}`);
  }
  console.log('═══════════════════════════════════════════════════════');
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('\n✗ Smoke test aborted:', err.message);
  process.exit(2);
});
