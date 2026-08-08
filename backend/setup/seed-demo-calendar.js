/**
 * SEED DEMO CALENDAR — DEVELOPMENT ONLY
 *
 * Creates three fake therapists (with profiles + colours) and fills the
 * CURRENT week (Mon-Fri, Perth time) with realistic demo sessions so the
 * Master Calendar / week views can be reviewed with real-looking density:
 * back-to-back pairs, travel blocks, admin, meetings, a lunch, a report
 * block and one genuine overlap.
 *
 * Idempotent: demo events are tagged created_by_source='demo-seed' and are
 * deleted + re-created for the current week on every run. Demo users are
 * upserted by email.
 *
 *   node backend/setup/seed-demo-calendar.js          # seed / refresh
 *   node backend/setup/seed-demo-calendar.js --clean  # remove all demo data
 *
 * ⚠️  Local development only. Never run against staging or production.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'therapy_scheduler',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
});

const PERTH_OFFSET_H = 8; // AWST, no DST
const DEMO_SOURCE = 'demo-seed';

const DEMO_THERAPISTS = [
  { email: 'demo.maya@opaltherapy.dev',  name: 'Maya Chen',   colour: '#d96f4e', roleTitle: 'Occupational Therapist' },
  { email: 'demo.tom@opaltherapy.dev',   name: 'Tom Rivera',  colour: '#3d6cae', roleTitle: 'Speech Pathologist' },
  { email: 'demo.priya@opaltherapy.dev', name: 'Priya Nair',  colour: '#2f7d4f', roleTitle: 'Physiotherapist' },
];

// Perth-local weekly pattern per therapist index. [dayIdx(0=Mon), startH, endH, title, type]
// Includes: back-to-back pairs, travel, admin, meetings, lunch, report, one true overlap.
function weekPlan(i) {
  const base = [
    [0,  9, 10, 'Client session — initial assessment', 'therapy'],
    [0, 10, 11, 'Client session — therapy',            'therapy'],   // back-to-back with the 9-10
    [0, 11, 11.5, 'Travel to clinic',                  'travel'],
    [0, 12, 13, 'Lunch',                               'lunch'],
    [0, 13, 14.5, 'Report writing',                    'report'],
    [1,  8.5, 9.5, 'Team meeting',                     'meeting'],
    [1, 10, 11, 'Client session — therapy',            'therapy'],
    [1, 11, 12, 'Client session — therapy',            'therapy'],   // back-to-back
    [1, 14, 15, 'Case management',                     'admin'],
    [2,  9, 10, 'Client session — school visit',       'therapy'],
    [2, 10, 10.5, 'Travel — return',                   'travel'],
    [2, 13, 14, 'Client session — therapy',            'therapy'],
    [2, 13.5, 14.5, 'MDT call',                        'meeting'],   // genuine overlap
    [3,  9, 12, 'Community visits block',              'therapy'],
    [3, 13, 13.5, 'Admin — notes',                     'admin'],
    [4,  9, 10, 'Client session — review',             'therapy'],
    [4, 10, 11, 'Client session — therapy',            'therapy'],   // back-to-back
    [4, 15, 16, 'Professional development',            'cpd'],
  ];
  // Shift each therapist's day by i*0.5h so columns don't look cloned.
  return base.map(([d, s, e, title, type]) => [d, s + i * 0.5, e + i * 0.5, title, type]);
}

// Monday 00:00 Perth of the current week, as a UTC Date.
function perthMondayUTC() {
  const now = new Date(Date.now() + PERTH_OFFSET_H * 3600e3); // shift so getUTCDay reads Perth
  const dow = (now.getUTCDay() + 6) % 7;                      // 0 = Monday
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
  return new Date(mon.getTime() - PERTH_OFFSET_H * 3600e3);   // back to true UTC instant
}

async function main() {
  const clean = process.argv.includes('--clean');

  const org = await pool.query('SELECT organisation_id FROM users WHERE email = $1', ['owner@opaltherapy.dev']);
  if (!org.rows.length || !org.rows[0].organisation_id) {
    throw new Error('owner@opaltherapy.dev not found (run seed-users.js first)');
  }
  const orgId = org.rows[0].organisation_id;

  // Always clear previous demo events (idempotent refresh).
  const del = await pool.query('DELETE FROM events WHERE created_by_source = $1', [DEMO_SOURCE]);
  console.log(`− removed ${del.rowCount} previous demo events`);

  if (clean) {
    for (const t of DEMO_THERAPISTS) {
      await pool.query('DELETE FROM therapist_profiles WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [t.email]);
      await pool.query('DELETE FROM user_settings WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [t.email]);
      await pool.query('DELETE FROM users WHERE email = $1', [t.email]);
      console.log(`− removed ${t.email}`);
    }
    console.log('✓ demo calendar data removed');
    return;
  }

  const hash = await bcrypt.hash('DemoDev2026!', 12);
  const mondayUTC = perthMondayUTC();

  for (let i = 0; i < DEMO_THERAPISTS.length; i++) {
    const t = DEMO_THERAPISTS[i];

    const u = await pool.query(`
      INSERT INTO users (email, password_hash, name, display_name, role, organisation_id,
                         is_active, account_status, email_verified, is_treating_therapist)
      VALUES ($1, $2, $3, $4, 'therapist', $5, TRUE, 'active', TRUE, TRUE)
      ON CONFLICT (email) DO UPDATE
        SET is_active = TRUE, account_status = 'active', email_verified = TRUE,
            organisation_id = EXCLUDED.organisation_id
      RETURNING id`,
      [t.email, hash, t.name, t.name, orgId]);
    const userId = u.rows[0].id;

    const existing = await pool.query('SELECT id FROM therapist_profiles WHERE user_id = $1', [userId]);
    let profileId;
    if (existing.rows.length) {
      profileId = existing.rows[0].id;
      await pool.query('UPDATE therapist_profiles SET display_name = $2, colour = $3, role_title = $4, is_active = TRUE, organisation_id = $5 WHERE id = $1',
        [profileId, t.name, t.colour, t.roleTitle, orgId]);
    } else {
      const p = await pool.query(`
        INSERT INTO therapist_profiles (organisation_id, user_id, display_name, role_title, colour, is_active)
        VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
        [orgId, userId, t.name, t.roleTitle, t.colour]);
      profileId = p.rows[0].id;
    }

    let count = 0;
    for (const [dayIdx, startH, endH, title, type] of weekPlan(i)) {
      // mondayUTC is the UTC instant of Perth Mon 00:00, so just add day+hours.
      const s = new Date(mondayUTC.getTime() + (dayIdx * 24 + startH) * 3600e3);
      const e = new Date(mondayUTC.getTime() + (dayIdx * 24 + endH) * 3600e3);
      await pool.query(`
        INSERT INTO events (id, user_id, title, start_time, end_time, event_type, status,
                            source, created_by_source, therapist_profile_id, organisation_id, is_deleted)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'confirmed', 'manual', $6, $7, $8, FALSE)`,
        [userId, title, s.toISOString(), e.toISOString(), type, DEMO_SOURCE, profileId, orgId]);
      count++;
    }
    console.log(`✓ ${t.name.padEnd(12)} ${t.email}  (${count} events, colour ${t.colour})`);
  }

  console.log('\n✓ Demo calendar seeded for the current Perth week (Mon-Fri).');
  console.log('  Sign in as owner@opaltherapy.dev and open Calendar → Master.');
  console.log('  Remove with: node backend/setup/seed-demo-calendar.js --clean');
}

main().then(() => pool.end()).catch((err) => { console.error('✗ ' + err.message); pool.end(); process.exit(1); });
