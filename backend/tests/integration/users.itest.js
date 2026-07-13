'use strict';

/**
 * User-account integration tests — real SQL against the isolated *_test DB.
 * Covers: creation, login lookup, approval, role change, suspension +
 * session deletion, therapist profiles, Outlook token metadata, audit logging.
 */

const { db, truncateAll, seedUser, seedOrganisation, seedSession, closePool } = require('./helpers');

beforeEach(truncateAll);
afterAll(closePool);

describe('user creation & lookup', () => {
  test('createLocalUser inserts a row retrievable by getUserByEmail (case-insensitive)', async () => {
    const created = await db.createLocalUser({
      name: 'Casey Example',
      email: 'Casey.Example@Test.Invalid',
      passwordHash: 'hash-not-real',
      role: 'therapist',
    });
    expect(created.id).toBeDefined();

    const found = await db.getUserByEmail('casey.example@test.invalid');
    expect(found).not.toBeNull();
    expect(found.id).toBe(created.id);
    expect(found.role).toBe('therapist');
  });

  test('duplicate email upserts rather than erroring (ON CONFLICT path)', async () => {
    await db.createLocalUser({ name: 'A', email: 'dup@test.invalid', passwordHash: 'h1', role: 'therapist' });
    const second = await db.createLocalUser({ name: 'B', email: 'dup@test.invalid', passwordHash: 'h2', role: 'admin' });
    expect(second.role).toBe('admin');
    const { rows } = await db.pool.query("SELECT COUNT(*) FROM users WHERE email = 'dup@test.invalid'");
    expect(Number(rows[0].count)).toBe(1);
  });

  test('getUser returns null for unknown id', async () => {
    expect(await db.getUser('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('account approval (route SQL)', () => {
  test('pending_approval → active with approver stamped', async () => {
    const owner = await seedUser({ role: 'owner' });
    const pending = await seedUser({ role: 'therapist', account_status: 'pending_approval', is_active: true });

    // Exact UPDATE used by PATCH /api/admin/users/:id/approve
    const { rows } = await db.pool.query(
      `UPDATE users SET account_status = 'active', approved_by_user_id = $1, approved_at = NOW(),
                        is_active = TRUE, updated_at = NOW()
         WHERE id = $2 AND account_status IN ('pending_approval','pending_verification')
         RETURNING id, email, account_status`,
      [owner.id, pending.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].account_status).toBe('active');

    const after = await db.getUser(pending.id);
    expect(after.approved_by_user_id).toBe(owner.id);
    expect(after.approved_at).not.toBeNull();
  });

  test('already-active user is not re-approved (0 rows)', async () => {
    const owner = await seedUser({ role: 'owner' });
    const active = await seedUser({ account_status: 'active' });
    const { rows } = await db.pool.query(
      `UPDATE users SET account_status='active', approved_by_user_id=$1, approved_at=NOW()
        WHERE id=$2 AND account_status IN ('pending_approval','pending_verification') RETURNING id`,
      [owner.id, active.id]
    );
    expect(rows).toHaveLength(0);
  });
});

describe('role changes', () => {
  test.each(['owner', 'admin', 'therapist', 'read_only'])(
    'updateUserRole persists role %s', async (role) => {
      const u = await seedUser();
      const updated = await db.updateUserRole(u.id, role);
      expect(updated.role).toBe(role);
      const check = await db.getUser(u.id);
      expect(check.role).toBe(role);
    }
  );
});

describe('suspension & session invalidation', () => {
  test('suspend UPDATE deactivates and session-delete removes all user sessions', async () => {
    const owner = await seedUser({ role: 'owner' });
    const target = await seedUser({ account_status: 'active' });
    await seedSession(target.id);
    await seedSession(target.id);
    const bystander = await seedUser();
    const bystanderSid = await seedSession(bystander.id);

    // Exact SQL pair from PATCH /api/admin/users/:id/suspend
    const { rows } = await db.pool.query(
      `UPDATE users SET account_status='suspended', is_active=FALSE,
                        suspended_by_user_id=$1, suspended_at=NOW(), suspended_reason=$2, updated_at=NOW()
        WHERE id=$3 AND account_status='active' RETURNING id, email`,
      [owner.id, 'integration test', target.id]
    );
    expect(rows).toHaveLength(1);
    await db.pool.query(`DELETE FROM sessions WHERE sess->>'userId' = $1`, [target.id]);

    const targetSessions = await db.pool.query(
      `SELECT COUNT(*) FROM sessions WHERE sess->>'userId' = $1`, [target.id]);
    expect(Number(targetSessions.rows[0].count)).toBe(0);

    // Other users' sessions untouched
    const other = await db.pool.query('SELECT sid FROM sessions');
    expect(other.rows.map(r => r.sid)).toEqual([bystanderSid]);

    const after = await db.getUser(target.id);
    expect(after.account_status).toBe('suspended');
    expect(after.is_active).toBe(false);
  });
});

describe('therapist profiles', () => {
  test('upsert creates then updates a profile; getAllTherapistProfiles joins user info', async () => {
    const org = await seedOrganisation();
    const u = await seedUser({ role: 'therapist' });
    await db.pool.query('UPDATE users SET organisation_id=$1 WHERE id=$2', [org.id, u.id]);

    const created = await db.upsertTherapistProfile({
      userId: u.id, organisationId: org.id, displayName: 'T One', colour: '#112233',
    });
    expect(created.display_name).toBe('T One');

    const updated = await db.upsertTherapistProfile({
      userId: u.id, organisationId: org.id, displayName: 'T One Renamed',
      splosePractitionerId: '19521',
    });
    expect(updated.id).toBe(created.id); // UNIQUE(user_id) upsert, not a second row
    expect(updated.display_name).toBe('T One Renamed');
    expect(updated.splose_practitioner_id).toBe('19521');
    // Documented upsert semantics: omitting colour re-applies the function's
    // default ('#5b6af0') rather than preserving the stored value — the PUT
    // route always passes existing values explicitly, so this is safe.
    expect(updated.colour).toBe('#5b6af0');

    const all = await db.getAllTherapistProfiles(org.id);
    expect(all).toHaveLength(1);
    expect(all[0].user_email).toBe(u.email);
    expect(all[0].has_outlook_connected).toBe(false);

    const mine = await db.getTherapistProfile(u.id);
    expect(mine.id).toBe(created.id);
  });
});

describe('Outlook token metadata', () => {
  test('updateUserTokens stores tokens with expiry and round-trips through decryption', async () => {
    const u = await seedUser();
    const row = await db.updateUserTokens(u.id, 'access-token-value', 'refresh-token-value', 3600);
    expect(row.access_token).toBe('access-token-value');   // decrypt(encrypt(x)) === x
    expect(row.refresh_token).toBe('refresh-token-value');
    const msLeft = new Date(row.token_expires_at).getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(3500 * 1000);
    expect(msLeft).toBeLessThan(3700 * 1000);

    const fetched = await db.getUser(u.id);
    expect(fetched.access_token).toBe('access-token-value');
  });
});

describe('audit logging', () => {
  test('logAuditEvent writes a retrievable row with metadata', async () => {
    const u = await seedUser();
    await db.logAuditEvent({
      actorUserId: u.id, action: 'integration.test',
      targetType: 'user', targetId: u.id,
      metadata: { hello: 'world' }, ipAddress: '127.0.0.1',
    });
    const { rows } = await db.pool.query(
      "SELECT * FROM audit_logs WHERE action = 'integration.test'");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(u.id);
    expect(rows[0].metadata).toEqual({ hello: 'world' });
  });
});
