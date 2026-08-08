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

// Suburb pools per therapist index — Maya works the northern corridor, Tom
// the southern suburbs, Priya the coastal strip. Exercises suburb display.
const SUBURBS = [
  ['24 Grand Blvd, Joondalup WA 6027', '11 Scenic Dr, Wanneroo WA 6065', '3 Moolanda Blvd, Kingsley WA 6026', '8 Susan Rd, Madeley WA 6065'],
  ['52 Burrendah Blvd, Willetton WA 6155', '19 Eucalyptus Blvd, Canning Vale WA 6155', '7 Corinthian Rd, Riverton WA 6148', '30 High Rd, Willetton WA 6155'],
  ['14 Adelaide St, Fremantle WA 6160', '6 Chalgrove Ave, Rockingham WA 6168', '22 Makybe Dr, Baldivis WA 6171', '9 Parry St, Fremantle WA 6160'],
];

// Perth-local weekly pattern per therapist index. [dayIdx(0=Mon), startH, endH, title, type, suburbIdx|null]
// Includes: back-to-back pairs, travel, admin, meetings, lunch, report, leave, one true overlap.
function weekPlan(i) {
  const base = [
    [0,  9, 10, 'Client session — initial assessment', 'therapy', 0],
    [0, 10, 11, 'Client session — therapy',            'therapy', 1],   // back-to-back with the 9-10
    [0, 11, 11.5, 'Travel to clinic',                  'travel',  null],
    [0, 12, 13, 'Lunch',                               'lunch',   null],
    [0, 13, 14.5, 'Report writing',                    'report',  null],
    [1,  8.5, 9.5, 'Team meeting',                     'meeting', null],
    [1, 10, 11, 'Client session — therapy',            'therapy', 2],
    [1, 11, 12, 'Client session — therapy',            'therapy', 3],   // back-to-back
    [1, 14, 15, 'Case management',                     'admin',   null],
    [2,  9, 10, 'Client session — school visit',       'therapy', 0],
    [2, 10, 10.5, 'Travel — return',                   'travel',  null],
    [2, 13, 14, 'Client session — therapy',            'therapy', 1],
    [2, 13.5, 14.5, 'MDT call',                        'meeting', null],   // genuine overlap
    [3,  9, 10.5, 'Community visit — morning',         'therapy', 2],
    [3, 10.75, 12, 'Community visit — midday',          'therapy', 1],
    [3, 12.5, 13.75, 'Community visit — afternoon',     'therapy', 3],
    [3, 14, 15, 'Telehealth session',                   'therapy', 'TELEHEALTH'],
    [3, 15, 16, 'Client session — location TBC',        'therapy', 'NONE'],
    [3, 13, 13.5, 'Admin — notes',                     'admin',   null],
    [4,  9, 10, 'Client session — review',             'therapy', 3],
    [4, 10, 11, 'Client session — therapy',            'therapy', 0],   // back-to-back
    [4, 15, 16, 'Professional development',            'cpd',     null],
  ];
  if (i === 2) base.push([4, 13, 17, 'Annual leave (afternoon)', 'leave', null]);
  // Shift each therapist's day by i*0.5h so columns don't look cloned.
  return base.map(([d, s, e, title, type, sub]) =>
    [d, s + i * 0.5, e + i * 0.5, title, type,
      sub === null ? null
        : sub === 'TELEHEALTH' ? 'Telehealth — video call'
        : sub === 'NONE' ? null
        : SUBURBS[i][sub]]);
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
    for (const [dayIdx, startH, endH, title, type, location] of weekPlan(i)) {
      // mondayUTC is the UTC instant of Perth Mon 00:00, so just add day+hours.
      const s = new Date(mondayUTC.getTime() + (dayIdx * 24 + startH) * 3600e3);
      const e = new Date(mondayUTC.getTime() + (dayIdx * 24 + endH) * 3600e3);
      await pool.query(`
        INSERT INTO events (id, user_id, title, start_time, end_time, event_type, status,
                            source, created_by_source, therapist_profile_id, organisation_id, is_deleted, location)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'confirmed', 'manual', $6, $7, $8, FALSE, $9)`,
        [userId, title, s.toISOString(), e.toISOString(), type, DEMO_SOURCE, profileId, orgId, location]);
      count++;
    }
    console.log(`✓ ${t.name.padEnd(12)} ${t.email}  (${count} events, colour ${t.colour})`);

    // Phase 2 QA data: work schedules + leave.
    //   Maya  — full Mon-Fri schedule (configured confidence)
    //   Tom   — schedule with Wednesday OFF (not-working column)
    //   Priya — no schedule (default-hours badge) + approved Friday leave
    const weekKey = (() => {
      const d = new Date(mondayUTC.getTime() + PERTH_OFFSET_H * 3600e3);
      const t2 = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const day = (t2.getUTCDay() + 6) % 7; t2.setUTCDate(t2.getUTCDate() - day + 3);
      const ft = new Date(Date.UTC(t2.getUTCFullYear(), 0, 4));
      const fd = (ft.getUTCDay() + 6) % 7; ft.setUTCDate(ft.getUTCDate() - fd + 3);
      return `${t2.getUTCFullYear()}-W${String(1 + Math.round((t2 - ft) / 6048e5)).padStart(2, '0')}`;
    })();
    if (i === 0) await pool.query('UPDATE users SET work_location_schedule = $1 WHERE id = $2',
      [JSON.stringify({ [weekKey]: { mon: 'office', tue: 'office', wed: 'office', thu: 'office', fri: 'office' } }), userId]);
    if (i === 1) await pool.query('UPDATE users SET work_location_schedule = $1 WHERE id = $2',
      [JSON.stringify({ [weekKey]: { mon: 'office', tue: 'office', thu: 'office', fri: 'office' } }), userId]);
    if (i === 2) {
      await pool.query('UPDATE users SET work_location_schedule = NULL WHERE id = $1', [userId]);
      const friday = new Date(mondayUTC.getTime() + (4 * 24 + PERTH_OFFSET_H) * 3600e3).toISOString().slice(0, 10);
      await pool.query(`DELETE FROM leave_requests WHERE user_id = $1`, [userId]);
      await pool.query(`INSERT INTO leave_requests (user_id, organisation_id, leave_type, start_date, end_date, status)
        VALUES ($1, $2, 'annual', $3, $3, 'approved')`, [userId, orgId, friday]);
      console.log(`  + approved full-day leave for ${t.name} on ${friday}`);
    }
  }

  // Phase 5 QA: pre-cache suburb centroids so the map works without geocoding
  // in development, plus one telehealth + one location-less session.
  const CENTROIDS = [
    ['Joondalup', -31.7443, 115.7661, '6027'], ['Wanneroo', -31.7469, 115.8034, '6065'],
    ['Kingsley', -31.8106, 115.8010, '6026'], ['Madeley', -31.8118, 115.8290, '6065'],
    ['Willetton', -32.0524, 115.8840, '6155'], ['Canning Vale', -32.0576, 115.9180, '6155'],
    ['Riverton', -32.0342, 115.8970, '6148'], ['Fremantle', -32.0569, 115.7439, '6160'],
    ['Rockingham', -32.2769, 115.7297, '6168'], ['Baldivis', -32.3298, 115.8322, '6171'],
  ];
  for (const [sub, lat, lng, pc] of CENTROIDS) {
    await pool.query(`
      INSERT INTO suburb_centroids (suburb_key, suburb, state, postcode, lat, lng, status, attempts, provider)
      VALUES ($1, $2, 'WA', $3, $4, $5, 'ok', 1, 'seed')
      ON CONFLICT (suburb_key) DO NOTHING`,
      [sub.toLowerCase() + '|WA', sub, pc, lat, lng]);
  }
  console.log(`+ ${CENTROIDS.length} suburb centroids cached for the map`);

  console.log('\n✓ Demo calendar seeded for the current Perth week (Mon-Fri).');
  console.log('  Sign in as owner@opaltherapy.dev and open Calendar → Master.');
  console.log('  Remove with: node backend/setup/seed-demo-calendar.js --clean');
}

main().then(() => pool.end()).catch((err) => { console.error('✗ ' + err.message); pool.end(); process.exit(1); });
