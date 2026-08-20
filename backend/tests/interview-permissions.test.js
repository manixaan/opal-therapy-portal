'use strict';

/**
 * INTERVIEW PREPARATION — the permission model.
 *
 * The whole feature rests on one claim: nobody reaches interview records
 * unless the Owner said so. These are the unit-level guarantees behind it;
 * tests/integration/interviews.itest.js proves the same thing through real
 * HTTP against real sessions.
 *
 * What is asserted here, and why each one matters:
 *
 *   - the Owner holds both interview permissions IMPLICITLY, so the practice
 *     owner cannot lock themselves out of their own recruitment records;
 *   - NO other role holds either by default — not admin, not therapist, not
 *     read-only, and certainly not a pre-employee, who is themselves a
 *     recruitment subject;
 *   - a grant is real: an admin with interviews.access in the users column
 *     has it, and hasPermission agrees;
 *   - a revoke is real: removing it removes the capability;
 *   - an unrecognised permission string in the column is IGNORED, so the
 *     JSONB column can never become a capability nobody reviewed.
 */

const {
  ROLE_PERMISSIONS,
  INTERVIEW_PERMISSIONS,
  INTERVIEW_PERMISSION_GROUPS,
  INTERVIEW_PERMISSION_LABELS,
  KNOWN_PERMISSIONS,
  getPermissions,
  hasPermission,
} = require('../permissions');

const ACCESS = 'interviews.access';
const VIEW_ALL = 'interviews.view_all';

describe('the interview permission vocabulary', () => {
  test('is exactly the two capabilities the feature defines', () => {
    expect(INTERVIEW_PERMISSIONS).toEqual([ACCESS, VIEW_ALL]);
  });

  test('every one is grantable — present in the allowlist', () => {
    for (const p of INTERVIEW_PERMISSIONS) expect(KNOWN_PERMISSIONS.has(p)).toBe(true);
  });

  test('every one has a human label, so a delegation UI never shows a raw key', () => {
    for (const p of INTERVIEW_PERMISSIONS) {
      expect(typeof INTERVIEW_PERMISSION_LABELS[p]).toBe('string');
      expect(INTERVIEW_PERMISSION_LABELS[p].length).toBeGreaterThan(3);
    }
  });

  test('the delegation group carries the warning, not just the list', () => {
    expect(INTERVIEW_PERMISSION_GROUPS).toHaveLength(1);
    const g = INTERVIEW_PERMISSION_GROUPS[0];
    expect(g.permissions).toEqual(INTERVIEW_PERMISSIONS);
    expect(g.description).toMatch(/recruitment|applicant/i);
  });
});

describe('role defaults', () => {
  test('the owner holds both, implicitly, without any stored grant', () => {
    const perms = getPermissions('owner');
    expect(perms).toContain(ACCESS);
    expect(perms).toContain(VIEW_ALL);
    expect(hasPermission({ role: 'owner' }, ACCESS)).toBe(true);
    expect(hasPermission({ role: 'owner', permissions: [] }, VIEW_ALL)).toBe(true);
  });

  test('NO other role holds either by default', () => {
    for (const role of ['admin', 'therapist', 'read_only', 'pre_employee']) {
      const perms = getPermissions(role);
      expect(perms).not.toContain(ACCESS);
      expect(perms).not.toContain(VIEW_ALL);
      expect(hasPermission({ role }, ACCESS)).toBe(false);
      expect(hasPermission({ role }, VIEW_ALL)).toBe(false);
    }
  });

  test('no role\'s static permission list mentions interviews at all', () => {
    // A default that crept into ROLE_PERMISSIONS would be a grant nobody made.
    for (const [role, list] of Object.entries(ROLE_PERMISSIONS)) {
      expect(`${role}:${list.filter((p) => p.startsWith('interviews.')).join()}`).toBe(`${role}:`);
    }
  });

  test('an unknown role holds nothing', () => {
    expect(getPermissions('superuser')).toEqual([]);
    expect(hasPermission({ role: 'superuser' }, ACCESS)).toBe(false);
    expect(hasPermission(null, ACCESS)).toBe(false);
    expect(hasPermission(undefined, ACCESS)).toBe(false);
  });
});

describe('granting and revoking', () => {
  test('an admin the Owner granted access has it', () => {
    const admin = { role: 'admin', permissions: [ACCESS] };
    expect(hasPermission(admin, ACCESS)).toBe(true);
    expect(getPermissions(admin.role, admin.permissions)).toContain(ACCESS);
  });

  test('access does not imply seeing everybody else\'s interviews', () => {
    const admin = { role: 'admin', permissions: [ACCESS] };
    expect(hasPermission(admin, VIEW_ALL)).toBe(false);
  });

  test('both can be granted together', () => {
    const admin = { role: 'admin', permissions: [ACCESS, VIEW_ALL] };
    expect(hasPermission(admin, ACCESS)).toBe(true);
    expect(hasPermission(admin, VIEW_ALL)).toBe(true);
  });

  test('revoking removes the capability — an empty column is no access', () => {
    expect(hasPermission({ role: 'admin', permissions: [] }, ACCESS)).toBe(false);
    expect(hasPermission({ role: 'admin', permissions: null }, ACCESS)).toBe(false);
    expect(hasPermission({ role: 'admin' }, ACCESS)).toBe(false);
  });

  test('a grant never leaks into the role\'s other permissions', () => {
    const before = getPermissions('admin');
    const after = getPermissions('admin', [ACCESS, VIEW_ALL]);
    expect(after.filter((p) => !p.startsWith('interviews.'))).toEqual(before);
  });

  test('an onboarding grant on the same record is preserved alongside', () => {
    const perms = getPermissions('admin', ['onboarding.view', ACCESS]);
    expect(perms).toContain('onboarding.view');
    expect(perms).toContain(ACCESS);
  });

  test('an invented permission string in the column is ignored, not honoured', () => {
    const perms = getPermissions('admin', [
      'interviews.superuser', 'interviews.*', 'interviews', 'view_financials_but_not_really',
    ]);
    expect(perms.filter((p) => p.startsWith('interviews'))).toEqual([]);
    expect(perms).toEqual(getPermissions('admin'));
  });

  test('a granted permission cannot be spelled loosely into existence', () => {
    for (const near of ['Interviews.access', 'interviews.Access', ' interviews.access', 'interviews.access ']) {
      expect(hasPermission({ role: 'admin', permissions: [near] }, ACCESS)).toBe(false);
    }
  });
});

describe('the routes gate on the permission, never on the role', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'interview-routes.js'), 'utf8');

  test('the whole /api/interviews namespace is behind requireAuth AND the permission', () => {
    expect(source).toContain("router.use('/api/interviews', requireAuth);");
    expect(source).toContain("router.use('/api/interviews', requirePermission('interviews.access'));");
  });

  test('delegation is owner-only BY ROLE — the power to grant is not delegable', () => {
    expect(source).toMatch(/const ownerOnly = \(req, res, next\) => \{\s*\n\s*if \(req\.user\?\.role !== 'owner'\)/);
    expect(source).toContain("router.get('/api/interviews/permissions', ownerOnly");
    expect(source).toContain("router.put('/api/interviews/permissions/:userId', ownerOnly");
  });

  test('permanent deletion is owner-only', () => {
    expect(source).toContain("router.delete('/api/interviews/records/:id', ownerOnly");
  });

  test('a foreign-organisation record is a 404, never a 403', () => {
    expect(source).toContain('organisation_id IS NOT DISTINCT FROM');
    expect(source).toContain("const notFound = (res) => res.status(404).json({ error: 'not_found' });");
  });

  test('editing is narrower than reading — view_all never confers write', () => {
    expect(source).toContain(
      "const canEditRecord = (user, record) => user?.role === 'owner' || record.created_by === user?.id;");
  });

  test('the audit log is given ids, never candidate answers', () => {
    // Every audit() call site's metadata object, checked for answer-bearing keys.
    const calls = source.match(/await audit\(req,[\s\S]*?\);/g) || [];
    expect(calls.length).toBeGreaterThan(6);
    for (const call of calls) {
      expect(call).not.toMatch(/responses|candidate_name|candidateName|answers|ratings:/);
    }
  });

  test('no route reaches a clinical table', () => {
    // Comments are stripped first: the header says in prose that this module
    // touches none of these, and that sentence must not satisfy its own test.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const table of ['contacts', 'participants', 'events', 'case_note', 'whodas', 'fca_', 'clients']) {
      expect(`${table}:${code.includes(table)}`).toBe(`${table}:false`);
    }
  });

  test('the only table it reads or writes is its own', () => {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const tables = new Set(
      [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|DELETE FROM)\s+([a-z_][a-z0-9_]*)/gi)]
        .map((m) => m[1].toLowerCase())
    );
    // `users` is read for the Owner's delegation screen and joined for the
    // "created by" column; interview_records is the feature's own table.
    expect([...tables].sort()).toEqual(['interview_records', 'users']);
  });
});
