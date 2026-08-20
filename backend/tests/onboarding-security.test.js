'use strict';

/**
 * ONBOARDING SECURITY — pure-logic unit tests for the boundaries.
 *
 * Covers the four defences that are cheapest to get subtly wrong:
 *   the pre-employee path allowlist, the delegation permission model,
 *   ZIP import path/content safety, and the audit metadata allowlist.
 */

const permissions = require('../permissions');
const importSafety = require('../onboarding-library-routes');
const { safeMetadata, ALLOWED_FIELDS } = require('../onboarding-audit');
const { redact } = require('../logger');

// ═════════════════════════════════════════════════════════════════════════════

describe('pre-employee path allowlist', () => {
  test('their own onboarding is permitted', () => {
    expect(permissions.isPreEmployeePath('/api/onboarding/me')).toBe(true);
    expect(permissions.isPreEmployeePath('/api/onboarding/me/requirements/abc/form')).toBe(true);
    expect(permissions.isPreEmployeePath('/api/onboarding/me/submit')).toBe(true);
  });

  test('their own auth and assigned learning are permitted', () => {
    expect(permissions.isPreEmployeePath('/api/auth/me')).toBe(true);
    expect(permissions.isPreEmployeePath('/api/auth/change-password')).toBe(true);
    expect(permissions.isPreEmployeePath('/api/learning/my/123')).toBe(true);
  });

  test('the practice itself is not', () => {
    for (const path of [
      '/api/onboarding/dashboard',
      '/api/onboarding/assignments',
      '/api/onboarding/packages',
      '/api/onboarding/employees',
      '/api/contacts',
      '/api/clients',
      '/api/events',
      '/api/profile/leave',
      '/api/rh2/resources',
      '/api/learning/workflows',
      '/api/accounting/invoices',
    ]) {
      expect(permissions.isPreEmployeePath(path)).toBe(false);
    }
  });

  test('a prefix cannot be smuggled through a query string', () => {
    expect(permissions.isPreEmployeePath('/api/contacts?next=/api/onboarding/me')).toBe(false);
    expect(permissions.isPreEmployeePath('/api/clients?q=/api/auth/')).toBe(false);
  });

  test('a sibling path sharing a prefix is not permitted', () => {
    // The trap a bare startsWith() falls into.
    expect(permissions.isPreEmployeePath('/api/onboarding/members')).toBe(false);
    expect(permissions.isPreEmployeePath('/api/onboarding/metrics')).toBe(false);
    expect(permissions.isPreEmployeePath('/api/learning/myworkflows')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('delegation model', () => {
  test('a pre-employee holds no permission at all', () => {
    expect(permissions.getPermissions('pre_employee')).toEqual([]);
  });

  test('the owner holds every onboarding permission implicitly', () => {
    const perms = permissions.getPermissions('owner');
    for (const p of permissions.ONBOARDING_PERMISSIONS) expect(perms).toContain(p);
  });

  test('an admin holds none by default — the job is not the trust level', () => {
    const perms = permissions.getPermissions('admin');
    for (const p of permissions.ONBOARDING_PERMISSIONS) expect(perms).not.toContain(p);
  });

  test('a therapist and a read-only user hold none', () => {
    for (const role of ['therapist', 'read_only']) {
      const perms = permissions.getPermissions(role);
      for (const p of permissions.ONBOARDING_PERMISSIONS) expect(perms).not.toContain(p);
    }
  });

  test('a grant confers only what was granted', () => {
    const perms = permissions.getPermissions('admin', ['onboarding.view', 'onboarding.review']);
    expect(perms).toContain('onboarding.view');
    expect(perms).toContain('onboarding.review');
    // Nothing implies anything else — in particular, reviewing paperwork does
    // not confer sight of a tax file number.
    expect(perms).not.toContain('onboarding.payroll');
    expect(perms).not.toContain('onboarding.sensitive_identity');
    expect(perms).not.toContain('onboarding.activate');
  });

  test('an unrecognised permission string is ignored, not granted', () => {
    const perms = permissions.getPermissions('admin', ['onboarding.everything', 'admin.god', 'made.up']);
    expect(perms).not.toContain('onboarding.everything');
    expect(perms).not.toContain('admin.god');
    expect(perms).not.toContain('made.up');
  });

  test('the sensitive permissions are grouped with a warning', () => {
    const sensitive = permissions.ONBOARDING_PERMISSION_GROUPS.find((g) => g.key === 'sensitive');
    expect(sensitive.permissions).toContain('onboarding.payroll');
    expect(sensitive.permissions).toContain('onboarding.sensitive_identity');
    expect(sensitive.description).toMatch(/tax file numbers|regulated/i);
  });

  test('hasPermission respects a per-user grant', () => {
    const user = { role: 'admin', permissions: ['onboarding.payroll'] };
    expect(permissions.hasPermission(user, 'onboarding.payroll')).toBe(true);
    expect(permissions.hasPermission(user, 'onboarding.activate')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('ZIP import path safety', () => {
  test('traversal in any form is refused', () => {
    for (const p of [
      '../../etc/passwd.pdf',
      'a/../../b.pdf',
      'docs/../../secrets.pdf',
      '..\\..\\windows\\system32\\x.pdf',
      'a/..\\b/../../c.pdf',
    ]) {
      expect(importSafety.pathProblem(p)).toMatch(/traversal/i);
    }
  });

  test('absolute and drive-letter paths are refused', () => {
    expect(importSafety.pathProblem('/etc/passwd.pdf')).toMatch(/absolute/i);
    expect(importSafety.pathProblem('\\windows\\x.pdf')).toMatch(/absolute/i);
    expect(importSafety.pathProblem('C:/Windows/x.pdf')).toMatch(/drive-letter/i);
    expect(importSafety.pathProblem('D:\\x.pdf')).toMatch(/drive-letter/i);
  });

  test('a null byte is refused', () => {
    expect(importSafety.pathProblem('ok\u0000/evil.pdf')).toMatch(/null byte/i);
  });

  test('an over-long path is refused', () => {
    expect(importSafety.pathProblem(`${'a'.repeat(500)}.pdf`)).toMatch(/too long/i);
  });

  test('archive metadata is refused', () => {
    expect(importSafety.pathProblem('__MACOSX/._x.pdf')).toMatch(/metadata/i);
    expect(importSafety.pathProblem('docs/.DS_Store')).toMatch(/metadata/i);
  });

  test('an ordinary relative path is accepted', () => {
    expect(importSafety.pathProblem('policies/privacy.pdf')).toBeNull();
    expect(importSafety.pathProblem('Fair Work Information Statement.pdf')).toBeNull();
    expect(importSafety.pathProblem('a/b/c/d.pdf')).toBeNull();
  });

  test('an empty path is refused', () => {
    expect(importSafety.pathProblem('')).toBeTruthy();
    expect(importSafety.pathProblem(null)).toBeTruthy();
  });
});

describe('ZIP import content sniffing', () => {
  test('real signatures are recognised', () => {
    expect(importSafety.sniffSignature(Buffer.from('%PDF-1.7 x'))).toBe('pdf');
    expect(importSafety.sniffSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe('png');
    expect(importSafety.sniffSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe('jpeg');
    expect(importSafety.sniffSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toBe('zip');
    expect(importSafety.sniffSignature(Buffer.from('{\\rtf1 x'))).toBe('rtf');
  });

  test('an executable is not mistaken for a document', () => {
    const pe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0]); // "MZ"
    expect(importSafety.sniffSignature(pe)).toBe('unknown');
    expect(importSafety.sniffSignature(pe)).not.toBe('pdf');
  });

  test('a short or empty buffer returns null rather than throwing', () => {
    expect(importSafety.sniffSignature(Buffer.from('ab'))).toBeNull();
    expect(importSafety.sniffSignature(null)).toBeNull();
  });
});

describe('ZIP import classification proposals', () => {
  test('official statements are proposed as official documents', () => {
    const p = importSafety.proposeClassification('Fair Work Information Statement.pdf');
    expect(p.category).toBe('Fair Work');
    expect(p.classification).toBe('OFFICIAL_DOCUMENT');
  });

  test('audit material is proposed as employer-only reference', () => {
    const p = importSafety.proposeClassification('NDIS Practice Standards Verification Module.pdf');
    expect(p.audience).toBe('employer');
    expect(p.classification).toBe('EMPLOYER_REFERENCE');
  });

  test('an unrecognised file falls back to a policy the Owner must classify', () => {
    const p = importSafety.proposeClassification('random-file.pdf');
    expect(p.category).toBe('Other');
  });

  test('a proposed code is always a safe identifier', () => {
    expect(importSafety.proposeCode('Fair Work Information Statement.pdf'))
      .toBe('IMP_FAIR_WORK_INFORMATION_STATEMENT');
    expect(importSafety.proposeCode('../../evil name!.pdf')).toMatch(/^IMP_[A-Z0-9_]*$/);
    expect(importSafety.proposeCode('.pdf')).toBe('IMP_DOCUMENT');
  });
});

describe('document upload validation', () => {
  const b64 = Buffer.from('%PDF-1.4 x').toString('base64');

  test('a matching type and extension is accepted', () => {
    expect(importSafety.validateDocumentFile({
      fileName: 'policy.pdf', fileMime: 'application/pdf', fileData: b64,
    })).toBeNull();
  });

  test('a script-capable type is refused', () => {
    expect(importSafety.validateDocumentFile({
      fileName: 'x.svg', fileMime: 'image/svg+xml', fileData: b64,
    })).toMatch(/not allowed/i);
    expect(importSafety.validateDocumentFile({
      fileName: 'x.html', fileMime: 'text/html', fileData: b64,
    })).toMatch(/not allowed/i);
  });

  test('a mismatched extension is refused', () => {
    expect(importSafety.validateDocumentFile({
      fileName: 'x.exe', fileMime: 'application/pdf', fileData: b64,
    })).toMatch(/does not match/i);
  });

  test('a path segment in the file name is refused', () => {
    expect(importSafety.validateDocumentFile({
      fileName: '../x.pdf', fileMime: 'application/pdf', fileData: b64,
    })).toMatch(/file name/i);
  });

  test('a metadata-only version with no file is allowed', () => {
    expect(importSafety.validateDocumentFile({ fileName: null, fileMime: null, fileData: null }))
      .toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('audit metadata allowlist', () => {
  const TFN = '123456782';

  test('only named fields survive', () => {
    const out = safeMetadata({
      assignmentId: 'a1', code: 'REQ_X', reason: 'because',
      tfn: TFN, bsb: '062-000', accountNumber: '12345678',
      salary: 95000, dateOfBirth: '1994-04-04', passportNumber: 'PA1234567',
    });
    expect(out).toEqual({ assignmentId: 'a1', code: 'REQ_X', reason: 'because' });
  });

  test('a nested object cannot smuggle a payload through', () => {
    const out = safeMetadata({
      assignmentId: 'a1',
      // Even under an allowed key name, an object is dropped rather than
      // serialised — this is the shape a whole form body would arrive in.
      reason: { tfn: TFN },
      metadata: { tfn: TFN },
    });
    expect(JSON.stringify(out)).not.toContain(TFN);
    expect(out.reason).toBeUndefined();
  });

  test('an array of objects is dropped; an array of scalars survives', () => {
    const out = safeMetadata({
      permissions: ['onboarding.view', 'onboarding.payroll'],
      // An array of objects carries structure a scalar list cannot.
      blocked: [{ tfn: TFN }],
    });
    expect(out.permissions).toEqual(['onboarding.view', 'onboarding.payroll']);
    expect(JSON.stringify(out)).not.toContain(TFN);
  });

  test('long strings are truncated', () => {
    const out = safeMetadata({ reason: 'x'.repeat(500) });
    expect(out.reason.length).toBeLessThanOrEqual(201);
  });

  test('the allowlist names no field a sensitive value would fit', () => {
    for (const forbidden of [
      'tfn', 'taxFileNumber', 'bsb', 'accountNumber', 'bankAccount',
      'password', 'passportNumber', 'documentNumber', 'dateOfBirth',
      'salary', 'address', 'memberNumber',
    ]) {
      expect(ALLOWED_FIELDS).not.toContain(forbidden);
    }
  });

  test('null and undefined are dropped rather than stored', () => {
    const out = safeMetadata({ assignmentId: null, code: undefined, reason: 'x' });
    expect(out).toEqual({ reason: 'x' });
  });

  test('a non-object input returns an empty object', () => {
    expect(safeMetadata(null)).toEqual({});
    expect(safeMetadata('string')).toEqual({});
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('log redaction backstop', () => {
  test('tax, bank and identity keys are redacted', () => {
    const out = redact({
      tfn: '123456782', taxFileNumber: '123456782', bsb: '062-000',
      accountNumber: '12345678', bankAccount: 'x', memberNumber: 'M1',
      passport: 'PA123', dateOfBirth: '1994-04-04', dob: '1994-04-04',
      abn: '51824753556', userId: 'keep-me',
    });
    expect(JSON.stringify(out)).not.toContain('123456782');
    expect(JSON.stringify(out)).not.toContain('12345678');
    expect(JSON.stringify(out)).not.toContain('062-000');
    // Non-sensitive identifiers still come through — a redactor that ate
    // everything would make incidents impossible to investigate.
    expect(out.userId).toBe('keep-me');
  });

  test('a TFN or BSB embedded in a free-text string is scrubbed', () => {
    const out = redact({ note: 'employee quoted 123 456 782 and BSB 062-000 today' });
    expect(out.note).not.toContain('123 456 782');
    expect(out.note).not.toContain('062-000');
    expect(out.note).toContain('[REDACTED_TFN]');
    expect(out.note).toContain('[REDACTED_BSB]');
  });

  test('the existing token and JWT rules still apply', () => {
    const out = redact({ note: 'Bearer abcdef1234567890 and eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' });
    expect(out.note).toContain('Bearer [REDACTED]');
    expect(out.note).toContain('[REDACTED_JWT]');
  });
});
