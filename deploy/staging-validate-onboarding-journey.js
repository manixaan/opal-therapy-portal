'use strict';
/**
 * THE ONBOARDING JOURNEY — staging smoke test (migration 038).
 *
 * Runs the whole paper round-trip against the DEPLOYED staging app over
 * HTTPS, with a synthetic person only:
 *
 *   recommend a package → generate the starter-pack ZIP → send it →
 *   upload the returned forms → read the details out of them →
 *   review and apply → create a portal account with a temporary password →
 *   send the sign-in email → first login → forced password change →
 *   the employee's onboarding, already filled in
 *
 * Companion to staging-validate-onboarding.js, which covers the 034
 * requirement workflow. This one exists because six things behave differently
 * on staging than on a laptop, and each is checked by name below:
 *
 *   S1  ZIP delivery through the REAL SMTP provider, and its attachment limit
 *   S2  Returned documents on REAL Azure Blob Storage, not a local disk
 *   S3  AI extraction against the ACTUAL configured provider and policy
 *   S4  Session invalidation after the temporary password is changed
 *   S5  Employee scoping — another person's onboarding, by hand, over HTTPS
 *   S6  Payroll permissions — an ordinary employee and an under-privileged
 *       Admin must not be able to retrieve bank details
 *
 * Then S7: archiving the test person must leave package and version history
 * untouched.
 *
 * Usage:
 *   BASE=https://opal-portal-staging.azurewebsites.net \
 *   SYN_PASS="$(sed 's/.*: //' deploy/staging-synthetic.local.txt)" \
 *   node deploy/staging-validate-onboarding-journey.js
 *
 * RE-RUNNING. The run signs in six times. The login limiter allows ten
 * attempts per IP per fifteen minutes, so two runs back to back from the same
 * address will trip it and abort with a 429 on a login — that is the limiter
 * working, not a regression. Leave fifteen minutes between runs.
 *
 * SAFETY. Everything it creates is synthetic and named so:
 * `synthetic.testemployee@example.test`, "Test Employee - OT Full Time". It
 * cancels any live run for that address first, so re-running is safe. It never
 * touches a real person, and the only mailbox it can reach is a synthetic one.
 */

const BASE = process.env.BASE;
const SYN_PASS = process.env.SYN_PASS;
if (!BASE || !SYN_PASS) { console.error('BASE and SYN_PASS are required'); process.exit(2); }

const OWNER = process.env.SYN_OWNER || 'synthetic.owner@example.test';
const ADMIN = process.env.SYN_ADMIN || 'synthetic.admin@example.test';
const THERAPIST = process.env.SYN_THERAPIST || 'synthetic.therapist@example.test';

/** The test person. Named so nobody mistakes them for staff. */
const TEST_NAME = 'Test Employee - OT Full Time';
const TEST_EMAIL = process.env.SYN_TESTEMPLOYEE || 'synthetic.testemployee@example.test';
const CHOSEN_PASSWORD = 'SyntheticJourney2026!';

const results = [];
function record(id, desc, got, want) {
  const ok = String(got) === String(want);
  results.push({ id, desc, got: String(got), want: String(want), ok });
  console.log(`${ok ? '✓' : '✗ FINDING'} [${id}] ${desc} → ${got} (want ${want})`);
}
function note(id, desc, value) {
  results.push({ id, desc, got: String(value), want: '(observation)', ok: true, observation: true });
  console.log(`·  [${id}] ${desc} → ${value}`);
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
  c._loginBody = r.json;
  return c;
}

/** The returned form, as plain text so the extractor has a real text layer. */
const RETURNED_FORM = [
  'OPAL THERAPY - EMPLOYEE DETAILS FORM',
  '',
  'Legal first name: Test',
  'Surname: Employee',
  'Preferred name: Testy',
  'Date of birth: 1990-04-03',
  'Personal email: synthetic.personal@example.test',
  'Mobile: 0412 000 111',
  'Address: 12 Synthetic Street, Fremantle WA 6160',
  'Emergency contact: Pat Synthetic (sibling) 0498 000 222',
  '',
  'BANK DETAILS',
  'Account name: Test Employee',
  'BSB: 066-123',
  'Account number: 12345678',
].join('\n');

(async () => {
  const owner = await login(OWNER);

  // ═════════════════════════════════════════════════════════════════════════
  //  Preconditions
  // ═════════════════════════════════════════════════════════════════════════
  const dash = await owner('/api/onboarding/dashboard');
  record('J0.1', 'owner reaches the onboarding dashboard', dash.status, 200);
  record('J0.2', 'field encryption is configured on staging',
    dash.json?.settings?.encryptionConfigured, true);

  // Clear any live run for the test address so a re-run is clean.
  const existing = await owner('/api/onboarding/assignments?search=' + encodeURIComponent(TEST_EMAIL));
  for (const a of (existing.json?.assignments || [])) {
    if (['activated', 'completed', 'cancelled', 'archived'].includes(a.status)) continue;
    await owner(`/api/onboarding/assignments/${a.id}/cancel`, {
      method: 'POST', body: { reason: 'Re-running the staging journey smoke test' },
    });
  }

  // Package/version history BEFORE the run, so S7 can prove it is unchanged.
  const pkgsBefore = await owner('/api/onboarding/packages');
  const otFullTime = (pkgsBefore.json?.packages || []).find((p) => p.code === 'PKG_OT_FULL_TIME');
  record('J0.3', 'the OT full-time package exists and is published',
    otFullTime?.status, 'published');
  const detailBefore = await owner(`/api/onboarding/packages/${otFullTime.id}`);
  const versionsBefore = (detailBefore.json?.versions || []).length;
  const currentVersionBefore = detailBefore.json?.package?.currentVersion;
  note('J0.4', 'package versions before the run', versionsBefore);

  // ═════════════════════════════════════════════════════════════════════════
  //  Recommendation and start
  // ═════════════════════════════════════════════════════════════════════════
  const rec = await owner('/api/onboarding/packages/recommend'
    + '?roleCategory=occupational_therapist&employmentType=full_time');
  record('J1.1', 'the recommendation endpoint answers', rec.status, 200);
  record('J1.2', 'it recommends the OT full-time package',
    rec.json?.recommended?.title, 'Occupational Therapist — Full-Time');

  const created = await owner('/api/onboarding/assignments', {
    method: 'POST',
    body: {
      applicantName: TEST_NAME,
      applicantEmail: TEST_EMAIL,
      jobTitle: 'Occupational Therapist',
      employmentType: 'full_time',
      roleCategory: 'occupational_therapist',
      proposedRole: 'therapist',
      startDate: '2026-10-01',
      packageId: rec.json.recommended.packageId,
      mobile: '0412 000 111',
    },
  });
  record('J1.3', 'the onboarding is created', created.status, 201);
  const A = created.json.assignment.id;
  record('J1.4', 'it starts as a draft', created.json.assignment.status, 'created');

  // ═════════════════════════════════════════════════════════════════════════
  //  S1 — the starter pack, and REAL SMTP
  // ═════════════════════════════════════════════════════════════════════════
  const gen = await owner(`/api/onboarding/assignments/${A}/starter-pack`, {
    method: 'POST', body: {},
  });
  record('S1.1', 'the starter pack generates', gen.status, 201);
  const pack = gen.json.starterPack;
  record('S1.2', 'it contains documents', pack.documentCount > 0, true);
  note('S1.3', 'documents in the pack', pack.documentCount);
  note('S1.4', 'pack size (bytes)', pack.sizeBytes);
  note('S1.5', 'documents that could not be included', (pack.omissions || []).length);
  // The practice's OWN name, whatever it is — staging's organisation is
  // "Synthetic Staging Practice", and an assertion that hardcoded "Opal
  // Therapy" was testing a constant this feature deliberately does not have.
  record('S1.6', 'the filename is human, with no internal code',
    / - Starter Pack\.zip$/.test(pack.fileName)
      && !/PKG_|DOC_|[0-9a-f]{8}-[0-9a-f]{4}/.test(pack.fileName)
      && !pack.fileName.includes('..'), true);
  note('S1.6a', 'pack filename', pack.fileName);

  // Generating twice must REUSE, not build a second pack.
  const genAgain = await owner(`/api/onboarding/assignments/${A}/starter-pack`, {
    method: 'POST', body: {},
  });
  record('S1.7', 'a second generate reuses rather than rebuilds', genAgain.json?.reused, true);
  record('S1.8', 'and returns the same pack', genAgain.json?.starterPack?.id, pack.id);

  // The bytes come back over HTTPS as a real ZIP.
  const dl = await owner(`/api/onboarding/assignments/${A}/starter-pack/download`, { raw: true });
  record('S1.9', 'the ZIP downloads', dl.status, 200);
  record('S1.10', 'served as a zip', (dl.headers.get('content-type') || '').includes('zip'), true);
  record('S1.11', 'and never cached', (dl.headers.get('cache-control') || '').includes('no-store'), true);
  const zipBytes = Buffer.from(await dl.arrayBuffer());
  record('S1.12', 'the bytes are a real ZIP archive', zipBytes.subarray(0, 2).toString('latin1'), 'PK');
  record('S1.13', 'the downloaded size matches what was recorded', zipBytes.length, pack.sizeBytes);

  // THE SMTP TEST. On staging this is a real provider and a real send.
  const sent = await owner(`/api/onboarding/assignments/${A}/starter-pack/send`, {
    method: 'POST', body: { toEmail: TEST_EMAIL, method: 'smtp' },
  });
  record('S1.14', 'the send call succeeds', sent.status, 200);
  note('S1.15', 'send outcome', sent.json?.status);
  note('S1.16', 'the pack travelled as an attachment', sent.json?.attached);
  note('S1.17', 'or as a secure download link', sent.json?.downloadLinkUsed);
  // Whatever happened, the Owner must always be handed a way to deliver by hand.
  record('S1.18', 'a manual download path is always offered',
    typeof sent.json?.downloadPath === 'string', true);
  // "skipped" means SMTP is not configured on staging — a real finding, not a pass.
  record('S1.19', 'SMTP is actually configured on staging', sent.json?.status !== 'skipped', true);

  // The oversize fallback is a PUBLIC route — the recipient has no account
  // yet. The seeded pack is small, so the link path itself is not exercised
  // here; what must be true on staging either way is that the route is mounted
  // and fails closed. An anonymous client with a bad token, or none, gets
  // nothing.
  const anon = makeClient();
  const badToken = await anon('/api/onboarding/starter-pack/download?token=not-a-real-token');
  record('S1.14a', 'the public pack link refuses an invalid token', badToken.status, 404);
  const noToken = await anon('/api/onboarding/starter-pack/download');
  record('S1.14b', 'and refuses no token at all', noToken.status, 404);

  const afterSend = await owner(`/api/onboarding/assignments/${A}/starter-pack`);
  const dispatches = afterSend.json?.dispatches || [];
  record('S1.20', 'the attempt is recorded', dispatches.length >= 1, true);
  note('S1.21', 'recorded method', dispatches[0]?.method);
  note('S1.22', 'recorded status', dispatches[0]?.status);

  // ═════════════════════════════════════════════════════════════════════════
  //  S2 — returned documents on REAL Azure Blob Storage
  // ═════════════════════════════════════════════════════════════════════════
  const up = await owner(`/api/onboarding/assignments/${A}/returned-documents`, {
    method: 'POST',
    body: {
      files: [{
        title: 'Employee Details Form',
        fileName: 'employee-details-form.txt',
        fileMime: 'text/plain',
        fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
      }],
    },
  });
  record('S2.1', 'the returned document uploads', up.status, 201);
  const returnedId = up.json?.stored?.[0]?.id;
  record('S2.2', 'staging can read text out of it', up.json?.stored?.[0]?.textStatus, 'extracted');

  // THE BLOB TEST: the bytes must come back BYTE-IDENTICAL through whatever
  // backend staging is configured with. A local-disk assumption would fail
  // here, and so would a blob write that silently did not happen.
  const back = await owner(
    `/api/onboarding/assignments/${A}/returned-documents/${returnedId}/download`, { raw: true }
  );
  record('S2.3', 'the stored original downloads again', back.status, 200);
  const backBytes = Buffer.from(await back.arrayBuffer());
  record('S2.4', 'the bytes round-trip unchanged through storage',
    backBytes.toString('utf8'), RETURNED_FORM);
  record('S2.5', 'and are never cached', (back.headers.get('cache-control') || '').includes('no-store'), true);

  // Re-uploading the identical file must not store it twice.
  const dupe = await owner(`/api/onboarding/assignments/${A}/returned-documents`, {
    method: 'POST',
    body: {
      files: [{
        fileName: 'employee-details-form.txt', fileMime: 'text/plain',
        fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
      }],
    },
  });
  record('S2.6', 'an identical re-upload is recognised as a duplicate',
    dupe.json?.stored?.[0]?.duplicate, true);
  const listed = await owner(`/api/onboarding/assignments/${A}/returned-documents`);
  record('S2.7', 'and only one document is held', (listed.json?.documents || []).length, 1);

  // ═════════════════════════════════════════════════════════════════════════
  //  S3 — extraction on the ACTUAL staging AI configuration
  // ═════════════════════════════════════════════════════════════════════════
  // Ask the governance surface FIRST, so a 503 below can be read as a
  // configuration fact rather than guessed at.
  const aiStatus = await owner('/api/ai/security-status');
  if (aiStatus.status === 200) {
    const f = aiStatus.json?.features?.onboarding_document_extraction;
    record('S3.0a', 'the extraction policy is registered on staging', !!f, true);
    note('S3.0b', 'gateway permits extraction', f?.gateway_permits);
    note('S3.0c', 'blocked reason, if any', f?.blocked_reason || '(none)');
    note('S3.0d', 'AI globally enabled', aiStatus.json?.ai_globally_enabled);
    if (f) {
      // Whatever else is true, the policy must not have drifted into being
      // allowed to receive clinical data.
      record('S3.0e', 'extraction may only receive internal data',
        JSON.stringify(f.allowed_inputs), JSON.stringify(['internal']));
      record('S3.0f', 'and produces no clinical document', f.human_review, false);
    }
  } else {
    note('S3.0a', 'AI security status unavailable', aiStatus.status);
  }

  const ext = await owner(`/api/onboarding/assignments/${A}/extraction`, { method: 'POST', body: {} });
  note('S3.1', 'extraction HTTP status', ext.status);

  let aiRan = ext.status === 201;
  if (!aiRan) {
    // A 503 is a legitimate configuration answer, not a crash — but it must
    // arrive as a sentence a person can act on, never a machine code.
    note('S3.2', 'extraction unavailable, reason code', ext.json?.code);
    note('S3.3', 'message shown to the Owner', ext.json?.message);
    record('S3.4', 'the message is a sentence, not a raw code',
      /^[A-Z].* /.test(String(ext.json?.message || '')) && !/_/.test(String(ext.json?.message || '')), true);
    record('S3.5', 'and the uploaded documents survive the failure',
      (listed.json?.documents || []).length, 1);
  } else {
    note('S3.2', 'fields proposed', ext.json?.fieldsProposed);
    note('S3.3', 'fields dropped by validation', ext.json?.fieldsSkipped);
    record('S3.4', 'the extractor found something', ext.json?.fieldsProposed > 0, true);
  }

  const review = await owner(`/api/onboarding/assignments/${A}/extraction`);
  record('S3.6', 'the review surface answers', review.status, 200);
  const allFields = (review.json?.groups || []).flatMap((g) => g.fields);
  note('S3.7', 'fields available to review', allFields.length);

  // WHATEVER the model returned, these must hold.
  const raw = JSON.stringify(review.json);
  record('S3.8', 'no tax file number field exists', /"key":"tfn/i.test(raw), false);
  record('S3.9', 'no full account number is in the response', raw.includes('12345678'), false);
  const bsbField = allFields.find((f) => f.key === 'bsb');
  if (bsbField) {
    record('S3.10', 'the BSB is masked for the owner too',
      bsbField.value === null || String(bsbField.value).includes('•'), true);
  } else {
    note('S3.10', 'no BSB was proposed', 'n/a');
  }

  // The Owner confirms everything, then applies.
  for (const f of allFields) {
    await owner(`/api/onboarding/assignments/${A}/extraction/fields/${f.id}`, {
      method: 'PATCH', body: { decision: 'accept' },
    });
  }
  const applied = await owner(`/api/onboarding/assignments/${A}/extraction/apply`, {
    method: 'POST', body: {},
  });
  if (allFields.length) {
    record('S3.11', 'the reviewed details apply', applied.status, 200);
    note('S3.12', 'fields written through to the employee record', applied.json?.applied);
    note('S3.13', 'fields waiting for the account to exist', applied.json?.pending);
  } else {
    // Nothing was proposed, so there is nothing to apply and a 409 is the
    // correct answer. Asserting 200 here would turn "the AI is switched off"
    // into a false product failure.
    record('S3.11', 'applying nothing is refused honestly', applied.json?.code, 'no_fields');
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  The account
  // ═════════════════════════════════════════════════════════════════════════
  const acct = await owner(`/api/onboarding/assignments/${A}/account`, {
    method: 'POST', body: { portalRole: 'employee', loginEmail: TEST_EMAIL },
  });
  record('J2.1', 'the portal account is created', acct.status, 201);
  record('J2.2', 'the credential is never cached',
    (acct.headers.get('cache-control') || '').includes('no-store'), true);
  const tempPassword = acct.json?.temporaryPassword;
  record('J2.3', 'a temporary password is issued', typeof tempPassword === 'string' && tempPassword.length >= 16, true);
  record('J2.4', 'requirements were issued', acct.json?.requirementsIssued > 0, true);
  note('J2.5', 'fields written to the employee record', acct.json?.fieldsApplied);

  // A retried request must not mint a second account.
  const acctAgain = await owner(`/api/onboarding/assignments/${A}/account`, {
    method: 'POST', body: { portalRole: 'employee' },
  });
  record('J2.6', 'a retry is refused, not fulfilled twice', acctAgain.status, 409);
  record('J2.7', 'and says why', acctAgain.json?.code, 'account_exists');

  // Owner can never be granted here, whatever the client sends.
  const ownerAttempt = await owner(`/api/onboarding/assignments/${A}/account`, {
    method: 'POST', body: { portalRole: 'owner' },
  });
  record('J2.8', 'onboarding cannot mint an Owner', ownerAttempt.status, 400);

  const invite = await owner(`/api/onboarding/assignments/${A}/account/invite`, {
    method: 'POST', body: { temporaryPassword: tempPassword },
  });
  record('J2.9', 'the sign-in email is sent', invite.status, 200);
  note('J2.10', 'invitation outcome', invite.json?.status);
  record('J2.11', 'the invitation actually left the building', invite.json?.status !== 'skipped', true);

  // ═════════════════════════════════════════════════════════════════════════
  //  S4 — first login, the gate, and session invalidation
  // ═════════════════════════════════════════════════════════════════════════
  const starter = await login(TEST_EMAIL, tempPassword);
  record('S4.1', 'the temporary password signs in', !!starter, true);
  record('S4.2', 'and the response says a change is required',
    starter._loginBody?.mustChangePassword, true);

  // A SECOND session on the same temporary credential — this is the one that
  // must be dead after the password changes.
  const secondSession = await login(TEST_EMAIL, tempPassword);
  record('S4.3', 'a second session on the temporary password also opens', !!secondSession, true);

  // THE GATE: nothing but the password change is reachable.
  const gateChecks = [
    ['/api/onboarding/me', 'their own onboarding'],
    ['/api/onboarding/dashboard', 'the management surface'],
    ['/api/profile/documents', 'the profile surface'],
  ];
  for (const [path, what] of gateChecks) {
    const r = await starter(path);
    record(`S4.4:${path}`, `a temporary credential cannot reach ${what}`, r.status, 403);
    if (r.status === 403) {
      record(`S4.5:${path}`, 'and says why in a machine-readable code', r.json?.code, 'must_change_password');
    }
  }
  const meOk = await starter('/api/auth/me');
  record('S4.6', 'but it can still read its own identity', meOk.status, 200);

  // Change it.
  const changed = await starter('/api/auth/change-password', {
    method: 'POST', body: { currentPassword: tempPassword, newPassword: CHOSEN_PASSWORD },
  });
  record('S4.7', 'the password change succeeds', changed.status, 200);
  record('S4.8', 'and reports that it replaced a temporary credential',
    changed.json?.replacedTemporary, true);
  record('S4.9', 'and sends them to their onboarding', changed.json?.next, 'onboarding');

  // THE SESSION INVALIDATION TEST.
  const secondAfter = await secondSession('/api/auth/me');
  record('S4.10', 'the OTHER session is invalidated by the change', secondAfter.status, 401);
  const changerAfter = await starter('/api/onboarding/me');
  record('S4.11', 'the session that changed it survives and is released', changerAfter.status, 200);

  // The temporary password is dead.
  const stale = makeClient();
  const staleLogin = await stale('/api/auth/login', {
    method: 'POST', body: { email: TEST_EMAIL, password: tempPassword },
  });
  record('S4.12', 'the temporary password no longer works', staleLogin.status, 401);

  // ── Pre-population ──────────────────────────────────────────────────────
  const mine = changerAfter.json;
  record('J3.1', 'the employee has an onboarding waiting', mine?.hasOnboarding, true);
  const personalReq = (mine?.sections || []).flatMap((s) => s.requirements)
    .find((r) => r.formKey === 'personal_details');
  if (personalReq) {
    const detail = await starter(`/api/onboarding/me/requirements/${personalReq.id}`);
    record('J3.2', 'their personal details form opens', detail.status, 200);
    if (aiRan) {
      record('J3.3', 'and their surname is already filled in',
        detail.json?.values?.surname, 'Employee');
      record('J3.4', 'and the form says where it came from',
        !!detail.json?.prefill?.message, true);
      record('J3.5', 'without mentioning a model',
        /\bAI\b|confidence|model/i.test(JSON.stringify(detail.json?.prefill || {})), false);
    } else {
      note('J3.3', 'pre-population not checked — extraction did not run', 'skipped');
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  S5 — employee scoping: reaching another person's onboarding by hand
  // ═════════════════════════════════════════════════════════════════════════
  // The test employee, now an ordinary signed-in user, tries the Owner's URLs
  // for their OWN onboarding id. Guessing the id is not the point — being
  // refused while holding it is.
  const scopeChecks = [
    [`/api/onboarding/assignments/${A}`, 'the employer view of their own run'],
    [`/api/onboarding/assignments/${A}/journey`, 'the journey panel'],
    [`/api/onboarding/assignments/${A}/starter-pack/download`, 'the starter pack'],
    [`/api/onboarding/assignments/${A}/returned-documents`, 'the returned documents'],
    [`/api/onboarding/assignments/${A}/extraction`, 'the extracted details'],
    [`/api/onboarding/assignments/${A}/personal-details`, 'the personal-details read'],
    [`/api/onboarding/assignments/${A}/payroll`, 'the payroll read'],
  ];
  for (const [path, what] of scopeChecks) {
    const r = await starter(path);
    record(`S5.1:${path}`, `an employee is refused ${what}`, r.status === 403 || r.status === 404, true);
  }

  // And a DIFFERENT employee cannot reach this person's onboarding either.
  const otherTherapist = await login(THERAPIST);
  for (const [path, what] of scopeChecks.slice(0, 5)) {
    const r = await otherTherapist(path);
    record(`S5.2:${path}`, `another therapist is refused ${what}`, r.status === 403 || r.status === 404, true);
  }
  const otherMine = await otherTherapist('/api/onboarding/me');
  record('S5.3', 'and their own /me surface is scoped to them, not to the test person',
    otherMine.json?.welcome?.name === TEST_NAME, false);

  // ═════════════════════════════════════════════════════════════════════════
  //  S6 — payroll permissions
  // ═════════════════════════════════════════════════════════════════════════
  // THE BOUNDARY THAT MATTERS: an Admin who has been delegated day-to-day
  // onboarding work but NOT the payroll tier. With no delegation at all an
  // Admin is refused everything, which proves less — the interesting question
  // is whether somebody who legitimately chases paperwork can reach a bank
  // account. So the Owner grants exactly that pair for the duration of this
  // check, through the real delegation endpoint, and takes it back afterwards
  // whatever happens.
  const perms = await owner('/api/onboarding/permissions');
  const adminRow = (perms.json?.users || []).find((u) => u.email === ADMIN);
  const adminOriginal = adminRow?.granted || [];
  note('S6.0', 'admin delegation before the test', adminOriginal.join(',') || '(none)');
  record('S6.0a', 'the admin does not already hold the payroll tier',
    adminOriginal.includes('onboarding.payroll'), false);

  let restored = false;
  const restoreAdmin = async () => {
    if (restored || !adminRow) return;
    restored = true;
    const r = await owner(`/api/onboarding/permissions/${adminRow.id}`, {
      method: 'PUT', body: { permissions: adminOriginal },
    });
    record('S6.9', 'the temporary delegation is taken back', r.status, 200);
  };

  try {
    if (adminRow) {
      const granted = await owner(`/api/onboarding/permissions/${adminRow.id}`, {
        method: 'PUT', body: { permissions: ['onboarding.view', 'onboarding.review'] },
      });
      record('S6.0b', 'the owner can delegate day-to-day onboarding', granted.status, 200);
    }

  // An Admin with operational delegation but WITHOUT onboarding.payroll.
  const admin = await login(ADMIN);
  const adminPerms = admin._loginBody?.user?.permissions || [];
  record('S6.0c', 'that admin now holds review', adminPerms.includes('onboarding.review'), true);
  record('S6.0d', 'and still does NOT hold payroll', adminPerms.includes('onboarding.payroll'), false);

  const adminExtraction = await admin(`/api/onboarding/assignments/${A}/extraction`);
  if (adminExtraction.status === 200) {
    record('S6.1', 'the under-privileged Admin is told they cannot see payroll',
      adminExtraction.json?.canSeePayroll, false);
    const adminRaw = JSON.stringify(adminExtraction.json);
    record('S6.2', 'and no bank value appears anywhere in their response',
      adminRaw.includes('12345678') || adminRaw.includes('066-123'), false);
    const adminBsb = (adminExtraction.json?.groups || []).flatMap((g) => g.fields)
      .find((f) => f.key === 'bsb');
    if (adminBsb) {
      record('S6.3', 'the bank field is present but not visible to them', adminBsb.visible, false);
      record('S6.4', 'and carries no value', adminBsb.value, 'null');
      // They must not be able to overwrite what they cannot see.
      const overwrite = await admin(`/api/onboarding/assignments/${A}/extraction/fields/${adminBsb.id}`, {
        method: 'PATCH', body: { decision: 'correct', value: '999-999' },
      });
      record('S6.5', 'and they cannot silently overwrite it', overwrite.status, 403);
    }
  } else {
    note('S6.1', 'admin has no onboarding.review delegation — extraction refused', adminExtraction.status);
  }

  const adminPayroll = await admin(`/api/onboarding/assignments/${A}/payroll`);
  record('S6.6', 'the payroll read is refused without the payroll permission',
    adminPayroll.status, 403);

  // The employee themselves must never reach a payroll read.
  const employeePayroll = await starter(`/api/onboarding/assignments/${A}/payroll`);
  record('S6.7', 'an ordinary employee cannot read payroll at all',
    employeePayroll.status === 403 || employeePayroll.status === 404, true);

  // A therapist cannot reach the employee register either.
  const therapistEmployees = await otherTherapist('/api/onboarding/employees');
  record('S6.8', 'a therapist cannot list employees', therapistEmployees.status, 403);
  } finally {
    // The grant is temporary by construction: it comes back off whether the
    // checks passed, failed, or threw. Leaving a synthetic admin holding
    // delegation after a smoke test would be exactly the kind of quiet
    // privilege drift this feature is supposed to prevent.
    await restoreAdmin();
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  S7 — archiving the test person leaves history untouched
  // ═════════════════════════════════════════════════════════════════════════
  const cancelled = await owner(`/api/onboarding/assignments/${A}/cancel`, {
    method: 'POST', body: { reason: 'Staging smoke test complete — synthetic person' },
  });
  record('S7.1', 'the test onboarding cancels', cancelled.status === 200 || cancelled.status === 201, true);
  const archived = await owner(`/api/onboarding/assignments/${A}/archive`, { method: 'POST', body: {} });
  record('S7.2', 'and archives', archived.status === 200 || archived.status === 409, true);

  const detailAfter = await owner(`/api/onboarding/packages/${otFullTime.id}`);
  record('S7.3', 'the package still has the same number of versions',
    (detailAfter.json?.versions || []).length, versionsBefore);
  record('S7.4', 'and the same current version',
    detailAfter.json?.package?.currentVersion, currentVersionBefore);
  record('S7.5', 'and is still published', detailAfter.json?.package?.status, 'published');

  const pkgDocsAfter = await owner(`/api/onboarding/packages/${otFullTime.id}/documents`);
  record('S7.6', 'the starter-pack document list is intact',
    (pkgDocsAfter.json?.documents || []).length > 0, true);

  // The evidence of what the test person was sent survives the archive —
  // which is the whole point of keeping a manifest.
  const packAfter = await owner(`/api/onboarding/assignments/${A}/starter-pack`);
  record('S7.7', 'the record of what they were sent survives archiving',
    (packAfter.json?.history || []).length > 0, true);

  // And an archived run no longer blocks a fresh one for the same address.
  const reRun = await owner('/api/onboarding/assignments', {
    method: 'POST',
    body: {
      applicantName: TEST_NAME, applicantEmail: TEST_EMAIL,
      jobTitle: 'Occupational Therapist', employmentType: 'full_time',
      roleCategory: 'occupational_therapist', packageId: rec.json.recommended.packageId,
    },
  });
  record('S7.8', 'a finished run does not block re-onboarding the same person',
    reRun.status, 201);
  if (reRun.status === 201) {
    await owner(`/api/onboarding/assignments/${reRun.json.assignment.id}/cancel`, {
      method: 'POST', body: { reason: 'Smoke-test cleanup' },
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Summary
  // ═════════════════════════════════════════════════════════════════════════
  const checks = results.filter((r) => !r.observation);
  const failed = checks.filter((r) => !r.ok);
  console.log('\n' + '─'.repeat(70));
  console.log(`${checks.length} checks · ${checks.length - failed.length} passed · ${failed.length} findings`);
  if (failed.length) {
    console.log('\nFINDINGS:');
    for (const f of failed) console.log(`  [${f.id}] ${f.desc}\n      got ${f.got}, want ${f.want}`);
  }
  console.log('─'.repeat(70));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('\n✗ The staging journey aborted:', err.message);
  console.error('  If a temporary admin delegation was granted, check '
    + 'Settings → Onboarding permissions and clear it by hand.');
  process.exit(2);
});
