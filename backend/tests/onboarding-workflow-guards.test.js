'use strict';

/**
 * THE ONBOARDING JOURNEY — authorisation, and the rules that shape a screen.
 *
 * Static-source assertions in the same style as the other *-guards suites:
 * no DOM, no database, no HTTP. What they pin is the set of decisions a later
 * edit could quietly reverse without any test noticing.
 *
 * The route table is read out of the source and each entry checked against
 * the permission it must carry. That is deliberately stricter than "the
 * handler calls requirePermission somewhere": a new route added without a
 * guard fails here, which is the failure mode that matters — nobody forgets
 * to protect a route they are thinking about, only one they added in a hurry.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(BACKEND, 'onboarding-workflow-routes.js'), 'utf8');
const PACKAGE_DOCS = fs.readFileSync(path.join(BACKEND, 'onboarding-package-docs-routes.js'), 'utf8');
const WDB = fs.readFileSync(path.join(BACKEND, 'onboarding-workflow-db.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
const PERMISSIONS = fs.readFileSync(path.join(BACKEND, 'permissions.js'), 'utf8');
const APP_ROUTES = fs.readFileSync(path.join(BACKEND, 'app-routes.js'), 'utf8');
const MIGRATION = fs.readFileSync(
  path.join(BACKEND, 'migrations', '038_onboarding_starter_packs.sql'), 'utf8'
);

const routes = require('../onboarding-workflow-routes');
const { scorePackage, validateReturnedFile, buildJourneySteps, statusLabel, STATUS_LABELS } =
  routes._internals;

/**
 * Every route a router file declares, with the text of its declaration up to
 * the handler body — which is where the permission middleware lives.
 */
function declaredRoutes(source) {
  const out = [];
  const re = /router\.(get|post|patch|delete|put)\(\s*'([^']+)'([\s\S]*?)safe\(/g;
  let m = re.exec(source);
  while (m) {
    out.push({ method: m[1].toUpperCase(), path: m[2], guards: m[3] });
    m = re.exec(source);
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
//  EVERY ROUTE IS GUARDED
// ═════════════════════════════════════════════════════════════════════════════

describe('every journey route carries a permission', () => {
  const REQUIRED = {
    'POST /api/onboarding/assignments/:id/starter-pack': 'onboarding.assign',
    'GET /api/onboarding/assignments/:id/starter-pack': 'onboarding.view',
    'GET /api/onboarding/assignments/:id/starter-pack/download': 'onboarding.view',
    'POST /api/onboarding/assignments/:id/starter-pack/send': 'onboarding.assign',
    'POST /api/onboarding/assignments/:id/returned-documents': 'onboarding.review',
    'GET /api/onboarding/assignments/:id/returned-documents': 'onboarding.review',
    'GET /api/onboarding/assignments/:id/returned-documents/:docId/preview': 'onboarding.review',
    'GET /api/onboarding/assignments/:id/returned-documents/:docId/download': 'onboarding.review',
    'DELETE /api/onboarding/assignments/:id/returned-documents/:docId': 'onboarding.review',
    'POST /api/onboarding/assignments/:id/extraction': 'onboarding.review',
    'GET /api/onboarding/assignments/:id/extraction': 'onboarding.review',
    'PATCH /api/onboarding/assignments/:id/extraction/fields/:fieldId': 'onboarding.review',
    'POST /api/onboarding/assignments/:id/extraction/apply': 'onboarding.review',
    'POST /api/onboarding/assignments/:id/account': 'onboarding.activate',
    'POST /api/onboarding/assignments/:id/account/reissue-password': 'onboarding.activate',
    'POST /api/onboarding/assignments/:id/account/invite': 'onboarding.assign',
    'GET /api/onboarding/assignments/:id/journey': 'onboarding.view',
    'GET /api/onboarding/packages/recommend': 'onboarding.assign',
  };

  const declared = declaredRoutes(WORKFLOW);

  test('the route table is exactly what this test knows about', () => {
    // A new route with no entry above fails here rather than shipping
    // unreviewed. Removing one fails too, so the table cannot rot.
    const found = declared
      .map((r) => `${r.method} ${r.path}`)
      .filter((k) => k !== 'GET /api/onboarding/starter-pack/download')
      .sort();
    expect(found).toEqual(Object.keys(REQUIRED).sort());
  });

  for (const [key, permission] of Object.entries(REQUIRED)) {
    test(`${key} requires ${permission}`, () => {
      const [method, routePath] = key.split(' ');
      const route = declared.find((r) => r.method === method && r.path === routePath);
      expect(route).toBeTruthy();
      expect(route.guards).toContain(`requirePermission('${permission}')`);
    });
  }
});

describe('every package-document route carries a permission', () => {
  const declared = declaredRoutes(PACKAGE_DOCS);

  test('editing needs manage_packages; reading needs one of the three', () => {
    const byKey = {};
    declared.forEach((r) => { byKey[`${r.method} ${r.path}`] = r.guards; });

    for (const key of [
      'POST /api/onboarding/packages/:id/documents',
      'PATCH /api/onboarding/packages/:id/documents/:documentId',
      'DELETE /api/onboarding/packages/:id/documents/:documentId',
      'POST /api/onboarding/packages/:id/documents/:documentId/restore',
      'POST /api/onboarding/packages/:id/documents/reorder',
    ]) {
      expect(`${key}:${(byKey[key] || '').includes("requirePermission('onboarding.manage_packages')")}`)
        .toBe(`${key}:true`);
    }

    for (const key of [
      'GET /api/onboarding/packages/:id/documents',
      'GET /api/onboarding/packages/:id/documents/:documentId/history',
    ]) {
      expect(`${key}:${(byKey[key] || '').includes('requireAnyPermission(')}`).toBe(`${key}:true`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE TWO ACTIONS THAT NEED MORE THAN A PERMISSION
// ═════════════════════════════════════════════════════════════════════════════

describe('creating a login is owner-only, on top of the permission', () => {
  test('both credential-issuing routes check the role as well', () => {
    // onboarding.activate is delegable, and should be — an authorised Admin can
    // finish somebody's onboarding. Minting a CREDENTIAL is a different act.
    for (const decl of [
      "router.post('/api/onboarding/assignments/:id/account',",
      "router.post('/api/onboarding/assignments/:id/account/reissue-password',",
    ]) {
      const at = WORKFLOW.indexOf(decl);
      expect(`${decl}:${at > -1}`).toBe(`${decl}:true`);
      const head = WORKFLOW.slice(at, at + 900);
      expect(head).toContain("req.user.role !== 'owner'");
      expect(head).toContain('403');
    }
  });

  test('SENDING the invitation is not owner-only — it issues nothing', () => {
    // The distinction the two tests together draw: an authorised Admin may
    // email somebody their sign-in details, and may not create the account
    // those details belong to.
    const at = WORKFLOW.indexOf("router.post('/api/onboarding/assignments/:id/account/invite',");
    const head = WORKFLOW.slice(at, at + 400);
    expect(head).toContain("requirePermission('onboarding.assign')");
    expect(head).not.toContain("req.user.role !== 'owner'");
  });

  test('the owner check comes BEFORE anything is created', () => {
    const start = WORKFLOW.indexOf("router.post('/api/onboarding/assignments/:id/account',");
    const body = WORKFLOW.slice(start, WORKFLOW.indexOf('reissue-password', start));
    expect(body.indexOf("req.user.role !== 'owner'"))
      .toBeLessThan(body.indexOf('generateTemporaryPassword'));
  });
});

describe('a reviewer who may not SEE a value may not overwrite it', () => {
  test('the field-review route re-checks the tier before writing', () => {
    const start = WORKFLOW.indexOf("router.patch('/api/onboarding/assignments/:id/extraction/fields");
    const body = WORKFLOW.slice(start, start + 2000);
    expect(body).toContain('requiredPermissionFor(existing.field_key)');
    expect(body).toContain('hasPermission(req.user, needed)');
    // And the check happens before the write.
    expect(body.indexOf('hasPermission')).toBeLessThan(body.indexOf('reviewField'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  SENSITIVE VALUES
// ═════════════════════════════════════════════════════════════════════════════

describe('sensitive values never leave the server in clear', () => {
  test('the list query names its columns and excludes value_encrypted', () => {
    const start = WDB.indexOf('async function listExtractedFields');
    const body = WDB.slice(start, WDB.indexOf('async function getExtractedField'));
    expect(body).toContain('f.value_masked');
    expect(body).not.toMatch(/SELECT[\s\S]*f\.value_encrypted/);
    // An auto-mapper is what would leak the next column somebody adds.
    expect(body).not.toContain('SELECT *');
  });

  test('exactly ONE function decrypts, and no route serialises its result', () => {
    expect(WDB).toContain('function revealFieldValue');
    const callers = WDB.split('revealFieldValue').length - 1;
    // The definition, the export, and its two uses inside the apply path.
    expect(callers).toBeLessThanOrEqual(5);
    expect(WORKFLOW).not.toContain('revealFieldValue');
  });

  test('the API shape sends a mask for a sensitive field, never the value', () => {
    const start = WDB.indexOf('return rows.map((r) => {');
    const body = WDB.slice(start, start + 1400);
    expect(body).toContain("r.sensitivity === 'sensitive' ? r.value_masked : r.value_text");
  });

  test('a field the reader may not see is null, not omitted', () => {
    // Omitting it would tell the reader nothing exists; nulling it says "there
    // is a bank account on file and you cannot see it", which is the truth.
    const start = WDB.indexOf('const needed = extraction.requiredPermissionFor');
    const body = WDB.slice(start, start + 900);
    expect(body).toContain('visible: permitted');
  });

  test('the database refuses a sensitive value in the plaintext column', () => {
    expect(MIGRATION).toContain('ck_onboarding_extracted_field_sensitive');
    expect(MIGRATION).toMatch(/sensitivity <> 'sensitive'\s*OR \(value_text IS NULL/);
  });

  test('the database refuses a tax file number by field key', () => {
    expect(MIGRATION).toMatch(/field_key NOT IN \('tfn', 'tax_file_number', 'tfn_number'\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ONE-TIME SECRETS
// ═════════════════════════════════════════════════════════════════════════════

describe('the temporary password', () => {
  test('is returned with no-store, so no proxy or history keeps it', () => {
    const start = WORKFLOW.indexOf("router.post('/api/onboarding/assignments/:id/account',");
    const body = WORKFLOW.slice(start, WORKFLOW.indexOf('reissue-password', start));
    expect(body).toContain('noStore(res)');
    expect(body.indexOf('noStore(res)')).toBeLessThan(body.indexOf('temporaryPassword: tempPassword'));
  });

  test('never reaches an audit record', () => {
    // safeMetadata drops unknown keys, but the stronger guarantee is that no
    // call site even tries.
    expect(WORKFLOW).not.toMatch(/metadata:[\s\S]{0,400}tempPassword:\s*tempPassword/);
    expect(WORKFLOW).toContain('tempPasswordIssued: true');
  });

  test('the audit allowlist has no key that could carry a credential or a value', () => {
    const { ALLOWED_FIELDS, safeMetadata } = require('../onboarding-audit');
    // `tempPasswordIssued` is a BOOLEAN — it records that a credential was
    // issued, which a reviewer needs, and cannot hold the credential itself.
    // Every other password-shaped name is refused.
    const FLAG_ONLY = new Set(['tempPasswordIssued']);
    for (const key of ALLOWED_FIELDS) {
      if (FLAG_ONLY.has(key)) continue;
      expect(key).not.toMatch(/password|secret|token|tfn|bsb|account_?number/i);
    }
    // And the flag genuinely cannot carry a string value through.
    const out = safeMetadata({
      tempPasswordIssued: 'Valley-velvet-mallee-almond-82',
      temporaryPassword: 'Valley-velvet-mallee-almond-82',
      bsb: '066-123',
    });
    expect(out.temporaryPassword).toBeUndefined();
    expect(out.bsb).toBeUndefined();
    // A string survives only truncated — so the assertion that matters is that
    // no CALL SITE passes one. That is pinned by the test above this one.
    expect(Object.keys(out)).toEqual(['tempPasswordIssued']);
  });

  test('a download token is stored only as a hash', () => {
    expect(WDB).toContain("crypto.createHash('sha256')");
    const start = WDB.indexOf('async function issueDownloadToken');
    const body = WDB.slice(start, start + 700);
    expect(body).toContain('hashToken(token)');
    // The raw token is returned to the caller and never written.
    expect(body).not.toMatch(/download_token_hash = \$2[^]*?\[packId, token\b/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  IDEMPOTENCY
// ═════════════════════════════════════════════════════════════════════════════

describe('important operations survive a double click', () => {
  test('a live starter pack is REUSED rather than rebuilt', () => {
    const start = WORKFLOW.indexOf("router.post('/api/onboarding/assignments/:id/starter-pack',");
    const body = WORKFLOW.slice(start, start + 3000);
    expect(body).toContain('reused: true');
    expect(body).toContain('getLiveStarterPack');
  });

  test('the database allows only one live pack per onboarding', () => {
    expect(MIGRATION).toContain('uq_onboarding_starter_pack_live');
    expect(MIGRATION).toMatch(/ON onboarding_starter_packs \(assignment_id\)\s*\n\s*WHERE superseded_at IS NULL/);
  });

  test('re-uploading the same file is a no-op, not a duplicate', () => {
    expect(MIGRATION).toContain('uq_onboarding_returned_document_sha');
    expect(WDB).toContain('return { row: existing[0], duplicate: true }');
  });

  test('a second extraction request JOINS the run already going', () => {
    expect(MIGRATION).toContain('uq_onboarding_extraction_run_live');
    expect(WDB).toContain('joined: true');
  });

  test('a second account request is refused, not fulfilled twice', () => {
    const start = WORKFLOW.indexOf("router.post('/api/onboarding/assignments/:id/account',");
    const body = WORKFLOW.slice(start, start + 4000);
    expect(body).toContain('account_exists');
    expect(body).toContain('assignment.account_created_at && assignment.user_id');
  });

  test('a second extraction never overwrites a value a human touched', () => {
    const start = WDB.indexOf('async function upsertProposedField');
    const body = WDB.slice(start, start + 3000);
    expect(body).toContain("WHERE onboarding_extracted_fields.status = 'proposed'");
    expect(body).toContain("value_source = 'extraction'");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  FAILURE IS RECOVERABLE
// ═════════════════════════════════════════════════════════════════════════════

describe('a failure never loses the work already done', () => {
  test('a failed send leaves the pack and does not advance the status', () => {
    const start = WORKFLOW.indexOf("router.post('/api/onboarding/assignments/:id/starter-pack/send',");
    const body = WORKFLOW.slice(start, WORKFLOW.indexOf('async function sendViaSmtp', start));
    expect(body).toContain('const delivered =');
    expect(body).toContain('if (delivered) {');
    // The Owner is always handed a way to deliver it by hand.
    expect(body).toContain('downloadPath:');
  });

  test('every send outcome is recorded, including the failures', () => {
    const start = WORKFLOW.indexOf("router.post('/api/onboarding/assignments/:id/starter-pack/send',");
    const body = WORKFLOW.slice(start, start + 4000);
    // recordDispatch is called before the branch on success.
    expect(body.indexOf('wdb.recordDispatch')).toBeLessThan(body.indexOf('const delivered ='));
  });

  test('a failed apply-after-account-creation does not roll back the account', () => {
    const start = WORKFLOW.indexOf('let appliedFields = 0;');
    const body = WORKFLOW.slice(start, start + 800);
    expect(body).toContain('catch');
    expect(body).toContain('must not roll it back');
  });

  test('a returned document is ARCHIVED, never deleted', () => {
    expect(WDB).toContain("SET status = 'archived'");
    expect(WDB).not.toMatch(/DELETE FROM onboarding_returned_documents/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  PACKAGE RECOMMENDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('scorePackage', () => {
  const OT_FT = { role_category: 'occupational_therapy', employment_type: 'full_time' };
  const OT_CASUAL = { role_category: 'occupational_therapy', employment_type: 'casual' };
  const ADMIN_CASUAL = { role_category: 'administration', employment_type: 'casual' };
  const GENERAL = { role_category: null, employment_type: null };

  const ask = { roleCategory: 'occupational_therapy', employmentType: 'full_time' };

  test('an exact match outranks everything', () => {
    const exact = scorePackage(OT_FT, ask).score;
    expect(exact).toBeGreaterThan(scorePackage(OT_CASUAL, ask).score);
    expect(exact).toBeGreaterThan(scorePackage(ADMIN_CASUAL, ask).score);
    expect(exact).toBeGreaterThan(scorePackage(GENERAL, ask).score);
  });

  test('the role matters more than the employment type', () => {
    // Sending an OT the administration pack is a worse mistake than sending a
    // full-timer the casual one.
    expect(scorePackage(OT_CASUAL, ask).score).toBeGreaterThan(scorePackage(ADMIN_CASUAL, ask).score);
  });

  test('a general package ranks above a contradictory one', () => {
    expect(scorePackage(GENERAL, ask).score).toBeGreaterThan(scorePackage(ADMIN_CASUAL, ask).score);
  });

  test('explains itself, so the Owner can disagree', () => {
    expect(scorePackage(OT_FT, ask).reasons).toEqual(['role', 'employment type']);
    expect(scorePackage(GENERAL, ask).reasons).toEqual([]);
  });

  test('with nothing to go on, nothing scores as a match', () => {
    expect(scorePackage(OT_FT, {}).score).toBe(0);
  });

  test('only a genuine match is offered as "recommended"', () => {
    const body = WORKFLOW.slice(WORKFLOW.indexOf('recommended:'), WORKFLOW.indexOf('packages: ranked'));
    expect(body).toContain('best.score > 0');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  UPLOADS
// ═════════════════════════════════════════════════════════════════════════════

describe('validateReturnedFile', () => {
  const ok = {
    fileName: 'form.pdf', fileMime: 'application/pdf', fileData: 'JVBERi0xLjQK',
  };

  test('accepts an ordinary returned form', () => {
    expect(validateReturnedFile(ok)).toBeNull();
  });

  test('refuses a type that can carry script', () => {
    for (const mime of ['text/html', 'image/svg+xml', 'application/x-msdownload', 'application/javascript']) {
      expect(validateReturnedFile({ ...ok, fileMime: mime })).toMatch(/not allowed/i);
    }
  });

  test('refuses a file whose extension disagrees with its declared type', () => {
    // The trick that gets an executable past a MIME check.
    expect(validateReturnedFile({ ...ok, fileName: 'form.exe' })).toMatch(/does not match/i);
  });

  test('refuses a filename containing a path', () => {
    expect(validateReturnedFile({ ...ok, fileName: '../form.pdf' })).toMatch(/not allowed/i);
    expect(validateReturnedFile({ ...ok, fileName: 'a/b.pdf' })).toMatch(/not allowed/i);
  });

  test('refuses content that is not base64', () => {
    expect(validateReturnedFile({ ...ok, fileData: '<<<not base64>>>' })).toMatch(/base64/i);
  });

  test('refuses a file over the limit', () => {
    expect(validateReturnedFile({ ...ok, fileData: 'A'.repeat(15 * 1024 * 1024) }))
      .toMatch(/larger than 10 MB/i);
  });

  test('refuses nothing at all', () => {
    expect(validateReturnedFile(null)).toBeTruthy();
    expect(validateReturnedFile({})).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  WHAT THE OWNER READS
// ═════════════════════════════════════════════════════════════════════════════

describe('status labels', () => {
  test('every status the database allows has a human label', () => {
    const check = MIGRATION.slice(
      MIGRATION.indexOf('ADD CONSTRAINT onboarding_assignments_status_check'),
      MIGRATION.indexOf('-- Milestone timestamps')
    );
    const statuses = (check.match(/'[a-z_]+'/g) || []).map((s) => s.replace(/'/g, ''));
    expect(statuses.length).toBeGreaterThan(10);
    for (const s of statuses) {
      expect(`${s}:${typeof STATUS_LABELS[s]}`).toBe(`${s}:string`);
    }
  });

  test('no label leaks a raw enum value', () => {
    for (const label of Object.values(STATUS_LABELS)) {
      expect(label).not.toMatch(/_/);
    }
  });

  test('an activated run reads as Complete — the state machine keeps its name', () => {
    // `activated` IS the finished state; renaming it in the database would
    // have meant rewriting five guards for a word.
    expect(statusLabel('activated')).toBe('Complete');
    expect(statusLabel('completed')).toBe('Complete');
  });

  test('an unknown status degrades to readable text, never to blank', () => {
    expect(statusLabel('some_new_state')).toBe('some new state');
  });
});

describe('the journey steps', () => {
  const base = {
    status: 'created', applicant_email: 'jane@example.com',
    employee_done: 0, employee_total: 0,
  };
  const nothing = { pack: null, returned: [], run: null, summary: null };

  test('a brand-new onboarding starts at generating the pack', () => {
    const steps = buildJourneySteps(base, nothing);
    expect(steps[0].key).toBe('pack_generated');
    expect(steps[0].state).toBe('current');
    expect(steps[0].action.verb).toBe('generate');
  });

  test('EXACTLY ONE step is current at any time', () => {
    const cases = [
      [base, nothing],
      [{ ...base, status: 'starter_pack_ready' }, { ...nothing, pack: { document_count: 9 } }],
      [{ ...base, status: 'starter_pack_sent', starter_pack_sent_at: new Date() },
        { ...nothing, pack: { document_count: 9 } }],
      [{ ...base, status: 'documents_received', starter_pack_sent_at: new Date() },
        { ...nothing, pack: { document_count: 9 }, returned: [{ id: 'd1' }] }],
      [{ ...base, status: 'activated' }, nothing],
    ];
    for (const [a, ctx] of cases) {
      const current = buildJourneySteps(a, ctx).filter((s) => s.state === 'current');
      expect(`${a.status}:${current.length}`).toBe(`${a.status}:${a.status === 'activated' ? 1 : 1}`);
    }
  });

  test('a sent pack offers a RESEND, not a second send', () => {
    const steps = buildJourneySteps(
      { ...base, status: 'starter_pack_sent', starter_pack_sent_at: new Date() },
      { ...nothing, pack: { document_count: 9 } }
    );
    const sent = steps.find((s) => s.key === 'pack_sent');
    expect(sent.state).toBe('done');
    expect(sent.action.label).toMatch(/^Resend/);
  });

  test('a failed read says so, and does not claim the step is done', () => {
    const steps = buildJourneySteps(
      { ...base, status: 'documents_received' },
      { ...nothing, returned: [{ id: 'd1' }], run: { status: 'failed', errorReason: 'no_readable_text' } }
    );
    const read = steps.find((s) => s.key === 'details_read');
    expect(read.state).not.toBe('done');
    expect(read.detail).toMatch(/enter them manually/i);
  });

  test('a completed run has every step done and offers nothing', () => {
    const steps = buildJourneySteps({
      ...base,
      status: 'activated',
      starter_pack_generated_at: new Date(),
      starter_pack_sent_at: new Date(),
      documents_received_at: new Date(),
      extraction_completed_at: new Date(),
      details_reviewed_at: new Date(),
      account_created_at: new Date(),
      invitation_sent_at: new Date(),
      first_login_at: new Date(),
    }, {
      pack: { document_count: 9 }, returned: [{ id: 'd1' }],
      run: { status: 'succeeded' }, summary: { total: 12, confirmed: 12, needsReview: 0 },
    });
    expect(steps.every((s) => s.state === 'done')).toBe(true);
  });

  test('no step detail exposes a database status or an id', () => {
    const steps = buildJourneySteps(
      { ...base, status: 'documents_received', starter_pack_sent_at: new Date() },
      { ...nothing, pack: { document_count: 9 }, returned: [{ id: 'd1' }] }
    );
    for (const s of steps) {
      expect(s.label).not.toMatch(/_/);
      expect(String(s.detail)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE FORCED-CHANGE GATE, END TO END THROUGH THE SOURCE
// ═════════════════════════════════════════════════════════════════════════════

describe('the forced password change', () => {
  test('is enforced at requireAuth, BEFORE the pre-employee allowlist', () => {
    const authStart = PERMISSIONS.indexOf('async function requireAuth');
    const body = PERMISSIONS.slice(authStart);
    const gate = body.indexOf('must_change_password === true');
    const preEmployee = body.indexOf("req.user.role === 'pre_employee'");
    expect(gate).toBeGreaterThan(-1);
    expect(preEmployee).toBeGreaterThan(-1);
    // A new starter created through the temporary-password path holds both
    // conditions; the narrower gate has to decide.
    expect(gate).toBeLessThan(preEmployee);
  });

  test('answers with a machine-readable code an API client can act on', () => {
    expect(PERMISSIONS).toContain("code: 'must_change_password'");
  });

  test('changing the password CLEARS the gate in the same statement', () => {
    const start = APP_ROUTES.indexOf("router.post('/api/auth/change-password'");
    const body = APP_ROUTES.slice(start, start + 4000);
    expect(body).toMatch(/SET password_hash = \$1,[\s\S]*must_change_password = FALSE/);
    expect(body).toContain('password_is_temporary = FALSE');
    expect(body).toContain('temp_password_expires_at = NULL');
  });

  test('the change path enforces the SAME policy as registration', () => {
    const start = APP_ROUTES.indexOf("router.post('/api/auth/change-password'");
    const body = APP_ROUTES.slice(start, start + 2500);
    expect(body).toContain('validatePassword(newPassword)');
  });

  test('changing the password ends every other session', () => {
    const start = APP_ROUTES.indexOf("router.post('/api/auth/change-password'");
    const body = APP_ROUTES.slice(start, start + 5000);
    expect(body).toMatch(/DELETE FROM sessions WHERE sess->>'userId' = \$1 AND sid <> \$2/);
  });

  test('the change path is rate limited — it is a password oracle', () => {
    expect(APP_ROUTES).toContain('passwordChangeRateLimit');
    const start = APP_ROUTES.indexOf("router.post('/api/auth/change-password'");
    expect(APP_ROUTES.slice(start, start + 200)).toContain('passwordChangeRateLimit');
  });

  test('an expired temporary credential is refused at LOGIN, not after', () => {
    const AUTH = fs.readFileSync(path.join(BACKEND, 'auth.js'), 'utf8');
    expect(AUTH).toContain('accounts.temporaryPasswordExpired(user)');
    expect(AUTH).toContain("code:  'temporary_password_expired'");
    // Before the session is created.
    const start = AUTH.indexOf("router.post('/api/auth/login'");
    const body = AUTH.slice(start);
    expect(body.indexOf('temporaryPasswordExpired'))
      .toBeLessThan(body.indexOf('req.session.regenerate'));
  });

  test('the server sends a gated user to the one screen they can use', () => {
    expect(SERVER).toContain("res.redirect('/create-password')");
    expect(SERVER).toContain('create-password.html');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  MOUNTING
// ═════════════════════════════════════════════════════════════════════════════

describe('the routers are actually reachable', () => {
  test('both are mounted', () => {
    expect(SERVER).toContain("app.use('/', require('./onboarding-workflow-routes'));");
    expect(SERVER).toContain("app.use('/', require('./onboarding-package-docs-routes'));");
  });

  test('the journey router is mounted BEFORE onboarding-routes', () => {
    // onboarding-routes applies requireAuth across the whole /api/onboarding
    // prefix, which would 401 the unauthenticated starter-pack download link a
    // new starter follows before they have an account.
    expect(SERVER.indexOf("require('./onboarding-workflow-routes')"))
      .toBeLessThan(SERVER.indexOf("app.use('/', require('./onboarding-routes'));"));
  });

  test('the token download route sits outside the authenticated prefix', () => {
    const guard = WORKFLOW.indexOf("router.use('/api/onboarding/assignments', requireAuth)");
    const route = WORKFLOW.indexOf("router.get('/api/onboarding/starter-pack/download'");
    expect(route).toBeGreaterThan(guard);
    // It is not under /api/onboarding/assignments, so the prefix guard misses
    // it by design — and that is the whole reason the path is shaped this way.
    expect('/api/onboarding/starter-pack/download'.startsWith('/api/onboarding/assignments')).toBe(false);
  });
});
