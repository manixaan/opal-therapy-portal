/**
 * SEED USERS — DEVELOPMENT ONLY
 *
 * Creates role-based development accounts and therapist profiles.
 * Run once before first login (re-running is safe — fully idempotent):
 *
 *   cd "/Users/antonyxavier/Documents/Claude/Projects/Therapy Scheduling Application"
 *   node backend/setup/seed-users.js
 *
 * ⚠️  These are local-development credentials only.
 *     Do NOT use these passwords in staging or production.
 *
 * Accounts created:
 *   owner@opaltherapy.dev      DEV_OWNER_PASS     or "OwnerDev2026!"
 *   admin@opaltherapy.dev      DEV_ADMIN_PASS     or "AdminDev2026!"
 *   therapist@opaltherapy.dev  DEV_THERAPIST_PASS or "TherapistDev2026!"
 *
 * Therapist profiles created for all isTreatingTherapist=true users.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// ── DB connection ────────────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'therapy_scheduler',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
});

const SALT_ROUNDS = 12;

// ── Seed definitions ─────────────────────────────────────────────────────────
// Update SEED_USERS to reflect the real Opal Therapy team.
// Ann is the owner AND the treating therapist — she has her own clinical calendar.
const SEED_USERS = [
  {
    name:                'Ann (Owner)',
    email:               'owner@opaltherapy.dev',
    password:            process.env.DEV_OWNER_PASS     || 'OwnerDev2026!',
    role:                'owner',
    isTreatingTherapist: true,                  // Ann is also the treating therapist
    therapistProfile: {
      displayName:          'Ann',
      roleTitle:            'Occupational Therapist',
      colour:               '#7c3aed',           // purple — change as needed
      splosePractitionerId: null,                // fill in once Splose practitioner ID is known
    },
  },
  {
    name:                'Admin User',
    email:               'admin@opaltherapy.dev',
    password:            process.env.DEV_ADMIN_PASS     || 'AdminDev2026!',
    role:                'admin',
    isTreatingTherapist: false,
    therapistProfile:    null,                   // admins don't have a clinical calendar by default
  },
  {
    name:                'Dev Therapist',
    email:               'therapist@opaltherapy.dev',
    password:            process.env.DEV_THERAPIST_PASS || 'TherapistDev2026!',
    role:                'therapist',
    isTreatingTherapist: true,
    therapistProfile: {
      displayName:          'Dev Therapist',
      roleTitle:            'Therapist',
      colour:               '#0891b2',           // teal
      splosePractitionerId: null,
    },
  },
];

// ── Seed function ─────────────────────────────────────────────────────────────

async function seedUsers() {
  console.log('🌱  Starting user seed...\n');

  // ── 1. Ensure Opal Therapy organisation exists ───────────────────────────
  await pool.query(`
    INSERT INTO organisations (name)
    VALUES ('Opal Therapy')
    ON CONFLICT DO NOTHING
  `);
  const orgRow = await pool.query(
    "SELECT id FROM organisations WHERE name = 'Opal Therapy' LIMIT 1"
  );
  const orgId = orgRow.rows[0]?.id || null;
  console.log(`  Organisation: Opal Therapy (${orgId})\n`);

  // ── 2. Upsert each user account ──────────────────────────────────────────
  const createdUsers = [];

  for (const u of SEED_USERS) {
    try {
      const hash = await bcrypt.hash(u.password, SALT_ROUNDS);

      const result = await pool.query(`
        INSERT INTO users (name, email, password_hash, role, organisation_id, is_active, is_treating_therapist)
        VALUES ($1, $2, $3, $4, $5, TRUE, $6)
        ON CONFLICT (email) DO UPDATE
          SET name                  = EXCLUDED.name,
              password_hash         = EXCLUDED.password_hash,
              role                  = EXCLUDED.role,
              organisation_id       = EXCLUDED.organisation_id,
              is_treating_therapist = EXCLUDED.is_treating_therapist,
              is_active             = TRUE,
              updated_at            = CURRENT_TIMESTAMP
        RETURNING id, email, role, is_treating_therapist
      `, [u.name, u.email, hash, u.role, orgId, u.isTreatingTherapist]);

      const row = result.rows[0];
      console.log(`  ✅  ${row.role.padEnd(10)} ${row.email}  (id: ${row.id})`);
      createdUsers.push({ ...u, dbId: row.id });
    } catch (err) {
      console.error(`  ❌  Failed to seed ${u.email}:`, err.message);
    }
  }

  // ── 3. Create therapist profiles for treating users ──────────────────────
  console.log('\n  Creating therapist profiles...');

  for (const u of createdUsers) {
    if (!u.isTreatingTherapist || !u.therapistProfile) continue;
    try {
      const { displayName, roleTitle, colour, splosePractitionerId } = u.therapistProfile;

      const profResult = await pool.query(`
        INSERT INTO therapist_profiles
          (user_id, organisation_id, display_name, role_title, colour, splose_practitioner_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id) DO UPDATE
          SET display_name           = EXCLUDED.display_name,
              role_title             = EXCLUDED.role_title,
              colour                 = EXCLUDED.colour,
              splose_practitioner_id = COALESCE(EXCLUDED.splose_practitioner_id, therapist_profiles.splose_practitioner_id),
              organisation_id        = EXCLUDED.organisation_id,
              updated_at             = CURRENT_TIMESTAMP
        RETURNING id, display_name
      `, [u.dbId, orgId, displayName, roleTitle || null, colour || '#5b6af0', splosePractitionerId || null]);

      const prof = profResult.rows[0];
      console.log(`  ✅  Profile: "${prof.display_name}" (id: ${prof.id})`);

      // Link profile UUID back onto the user row
      await pool.query(`
        UPDATE users
        SET therapist_profile_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND (therapist_profile_id IS NULL OR therapist_profile_id != $1::text)
      `, [prof.id, u.dbId]);

      // Backfill any existing events for this user with the profile ID
      const backfill = await pool.query(`
        UPDATE events
        SET therapist_profile_id = $1,
            organisation_id      = COALESCE(organisation_id, $2),
            updated_at           = CURRENT_TIMESTAMP
        WHERE user_id = $3 AND therapist_profile_id IS NULL
        RETURNING id
      `, [prof.id, orgId, u.dbId]);
      if (backfill.rowCount > 0) {
        console.log(`     Backfilled ${backfill.rowCount} existing events → therapist_profile_id`);
      }
    } catch (err) {
      console.error(`  ❌  Failed to create profile for ${u.email}:`, err.message);
    }
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  console.log('\n🎉  Seed complete.\n');
  console.log('  ─────────────────────────────────────────────────');
  console.log('  ⚠️   DEV CREDENTIALS — do not use in production!');
  console.log('  ─────────────────────────────────────────────────');
  for (const u of SEED_USERS) {
    const pw = process.env[`DEV_${u.role.toUpperCase()}_PASS`] || u.password;
    const tag = u.isTreatingTherapist ? ' (treating)' : '';
    console.log(`  ${u.role.padEnd(10)}  ${u.email}  /  ${pw}${tag}`);
  }
  console.log('  ─────────────────────────────────────────────────\n');
  console.log('  Next steps:');
  console.log('  1. Restart the backend: node backend/server.js');
  console.log('  2. GET /api/therapists  (login as owner first)');
  console.log('  3. GET /api/calendar/master?startDate=2026-06-16&endDate=2026-06-20\n');
}

// ── Seed invites ──────────────────────────────────────────────────────────────
// Creates pending invites for dev test accounts so the registration flow can be
// tested without needing an owner session to manually create them via the API.
// Safe to run repeatedly — skips if a pending invite already exists.

async function seedInvites(orgId) {
  const crypto = require('crypto');
  const DEV_INVITES = [
    { email: 'newtherapist@opaltherapy.dev', role: 'therapist', isTreatingTherapist: true,  displayNameHint: 'New Therapist' },
    { email: 'newadmin@opaltherapy.dev',     role: 'admin',     isTreatingTherapist: false, displayNameHint: 'New Admin' },
  ];

  console.log('\n  Creating dev invites...');
  for (const inv of DEV_INVITES) {
    const existing = await pool.query(
      "SELECT id FROM user_invites WHERE LOWER(email) = LOWER($1) AND status = 'pending' LIMIT 1",
      [inv.email]
    );
    if (existing.rows.length > 0) {
      console.log(`  ⏭️   Invite already exists for ${inv.email}`);
      continue;
    }
    const userExists = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [inv.email]
    );
    if (userExists.rows.length > 0) {
      console.log(`  ⏭️   Account already exists for ${inv.email}`);
      continue;
    }
    const token      = crypto.randomBytes(32).toString('hex');
    const expiresAt  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await pool.query(`
      INSERT INTO user_invites
        (organisation_id, email, role, is_treating_therapist, display_name_hint, invite_token, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [orgId, inv.email.toLowerCase(), inv.role, inv.isTreatingTherapist, inv.displayNameHint, token, expiresAt]);

    const BASE = process.env.APP_BASE_URL || 'http://localhost:5001';
    console.log(`  ✅  Invite: ${inv.role.padEnd(10)} ${inv.email}`);
    console.log(`      Register: ${BASE}/register?token=${token}`);
  }
}

async function main() {
  await seedUsers();
  // Fetch the org ID for seeding invites
  const orgRow = await pool.query("SELECT id FROM organisations WHERE name = 'Opal Therapy' LIMIT 1");
  const orgId  = orgRow.rows[0]?.id;
  if (orgId) await seedInvites(orgId);
  console.log('\n  4. Test registration: open the Register link above in your browser\n');
}

main()
  .catch(err => { console.error('Seed script error:', err); process.exit(1); })
  .finally(() => pool.end());
