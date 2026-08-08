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
  // Maya — northern corridor
  ['24 Grand Blvd, Joondalup WA 6027', '11 Scenic Dr, Wanneroo WA 6065', '3 Moolanda Blvd, Kingsley WA 6026',
   '8 Susan Rd, Madeley WA 6065', '18 Beach Rd, Duncraig WA 6023', '5 Flinders Ave, Hillarys WA 6025'],
  // Tom — southern suburbs
  ['52 Burrendah Blvd, Willetton WA 6155', '19 Eucalyptus Blvd, Canning Vale WA 6155', '7 Corinthian Rd, Riverton WA 6148',
   '30 High Rd, Willetton WA 6155', '12 Karel Ave, Bull Creek WA 6149', '4 Barry Marshall Pde, Murdoch WA 6150'],
  // Priya — coastal strip
  ['14 Adelaide St, Fremantle WA 6160', '6 Chalgrove Ave, Rockingham WA 6168', '22 Makybe Dr, Baldivis WA 6171',
   '9 Parry St, Fremantle WA 6160', '3 Mayor Rd, Coogee WA 6166', '15 Arcadia Dr, Safety Bay WA 6169'],
];

// Client name pools — believable variety on tiles/tooltips.
const CLIENTS = [
  ['Noah P', 'Isla R', 'Oliver T', 'Amelia K', 'Leo M', 'Grace W', 'Hunter S', 'Evie L'],
  ['Jack D', 'Charlotte B', 'Henry N', 'Mia F', 'Archie G', 'Ruby H', 'Theo C', 'Sofia V'],
  ['Lucas J', 'Ella Q', 'Mason Y', 'Harper Z', 'Finn A', 'Zoe E', 'Cooper I', 'Ivy O'],
];

// Perth-local weekly pattern per therapist index — a FULL clinical caseload:
// 4-6 client visits daily with travel, lunch, meetings, supervision, case
// notes, reports and PD. QA fixtures preserved: back-to-back pairs, one
// genuine overlap (Wed), a cancelled session (non-blocking), telehealth and
// a no-location session (Thu), Tom's Wednesday off, Priya's Friday leave.
// Tuple: [dayIdx, startH, endH, title, type, suburbIdx|'TELEHEALTH'|'NONE'|null, status?]
function weekPlan(i) {
  const C = CLIENTS[i];
  const base = [
    // ── Monday — steady home-visit day ──
    [0, 8,    8.5,  'Emails and admin',                      'admin',   null],
    [0, 8.5,  9.5,  `Client session — ${C[0]}`,              'therapy', 0],
    [0, 9.5,  9.75, 'Travel',                                'travel',  null],
    [0, 9.75, 10.75,`Client session — ${C[1]}`,              'therapy', 1],
    [0, 11,   11.75,`Initial assessment — ${C[2]}`,          'therapy', 0],
    [0, 12,   12.75,'Lunch',                                 'lunch',   null],
    [0, 13,   14,   `Client session — ${C[3]}`,              'therapy', 2],
    [0, 14,   14.25,'Travel',                                'travel',  null],
    [0, 14.25,15.25,`Client session — ${C[4]}`,              'therapy', 4],
    [0, 15.5, 16.5, 'Case notes + invoices',                 'admin',   null],
    [0, 16.5, 17,   `Report writing — ${C[0]}`,              'report',  null],
    // ── Tuesday — meetings + school visit ──
    [1, 8,    9,    'Team meeting',                          'meeting', null],
    [1, 9.25, 10.25,`Client session — ${C[5]}`,              'therapy', 2],
    [1, 10.5, 11.5, `Client session — ${C[6]}`,              'therapy', 3, i === 1 ? 'cancelled' : 'confirmed'],
    [1, 11.5, 12,   'Phone calls — families',                'admin',   null],
    [1, 12,   12.5, 'Lunch',                                 'lunch',   null],
    [1, 13,   14.5, `School visit — ${C[7]}`,                'therapy', 5],
    [1, 14.5, 14.75,'Travel',                                'travel',  null],
    [1, 15,   16,   `Client session — ${C[2]}`,              'therapy', 1],
    [1, 16,   17,   'Case notes',                            'admin',   null],
    // ── Wednesday — back-to-back morning + genuine overlap (Tom is OFF) ──
    [2, 8.5,  9.5,  `Client session — ${C[3]}`,              'therapy', 1],
    [2, 9.5,  10.5, `Client session — ${C[4]}`,              'therapy', 2],   // back-to-back
    [2, 10.5, 10.75,'Travel',                                'travel',  null],
    [2, 11,   12,   `Assessment session — ${C[5]}`,          'therapy', 3],
    [2, 12,   12.75,'Lunch',                                 'lunch',   null],
    [2, 13,   14,   `Client session — ${C[6]}`,              'therapy', 0],
    [2, 13.5, 14.5, 'MDT call — care team',                  'meeting', null], // genuine overlap
    [2, 14.75,15.75,`Client session — ${C[7]}`,              'therapy', 2],
    [2, 16,   17,   'Resource preparation',                  'admin',   null],
    // ── Thursday — community day (3+ suburbs → footprint) + telehealth ──
    [3, 8.25, 9.25, `Community visit — ${C[0]}`,             'therapy', 2],
    [3, 9.5,  10.5, `Community visit — ${C[1]}`,             'therapy', 1],
    [3, 10.75,11.75,`Community visit — ${C[2]}`,             'therapy', 3],
    [3, 12,   12.5, 'Lunch',                                 'lunch',   null],
    [3, 12.75,13.75,`Client session — ${C[3]}`,              'therapy', 0],
    [3, 14,   15,   `Telehealth session — ${C[4]}`,          'therapy', 'TELEHEALTH'],
    [3, 15,   16,   `Client session — ${C[5]} (location TBC)`,'therapy','NONE'],
    [3, 16,   17,   'Case notes + emails',                   'admin',   null],
    // ── Friday — clinical morning, PD/supervision afternoon ──
    [4, 8.5,  9.5,  `Client session — ${C[6]}`,              'therapy', 3],
    [4, 9.5,  10.5, `Client session — ${C[7]}`,              'therapy', 0],   // back-to-back
    [4, 10.75,11.75,'Supervision',                           'meeting', null],
    [4, 12,   12.5, 'Lunch',                                 'lunch',   null],
    [4, 12.75,13.75,`Client session — ${C[1]}`,              'therapy', 4],
    [4, 14,   15.5, `FCA report — ${C[2]}`,                  'report',  null],
    [4, 15.5, 17,   'Professional development',              'cpd',     null],
  ];
  let plan = base;
  if (i === 2) {
    // Priya: approved leave Friday afternoon — drop her post-13:00 Friday work
    plan = base.filter(([d, st]) => !(d === 4 && st >= 12.75));
    plan.push([4, 13, 17, 'Annual leave (afternoon)', 'leave', null]);
  }
  // Shift each therapist by i*0.25h so columns don't look cloned.
  return plan.map(([d, st, e, title, type, sub, status]) => [
    d, st + i * 0.25, e + i * 0.25, title, type,
    sub === null ? null
      : sub === 'TELEHEALTH' ? 'Telehealth — video call'
      : sub === 'NONE' ? null
      : SUBURBS[i][sub],
    status || 'confirmed',
  ]);
}

// Dev Therapist — a light part-time caseload (Mon/Wed/Fri, central suburbs)
// for contrast against the full-time demo therapists. Keeps NO work schedule,
// so the default-hours badge demo remains.
const DEV_SUBURBS = ['12 Preston St, Como WA 6152', '31 Albany Hwy, Victoria Park WA 6100', '8 Mill Point Rd, South Perth WA 6151'];
function devWeekPlan() {
  return [
    [0, 9,   10,  'Client session — Billie K', 'therapy', DEV_SUBURBS[0]],
    [0, 10.5,11.5,'Client session — Max R',    'therapy', DEV_SUBURBS[1]],
    [0, 12,  12.5,'Lunch',                     'lunch',   null],
    [0, 13,  14,  'Case notes',                'admin',   null],
    [2, 9.5, 10.5,'Client session — Poppy D',  'therapy', DEV_SUBURBS[2]],
    [2, 11,  12,  'Client session — Ezra F',   'therapy', DEV_SUBURBS[0]],
    [2, 13,  14,  'Telehealth session — Ada M','therapy', 'Telehealth — video call'],
    [4, 9,   10,  'Client session — Otis W',   'therapy', DEV_SUBURBS[1]],
    [4, 10.5,11.5,'Supervision',               'meeting', null],
    [4, 13,  14.5,'Report writing — Billie K', 'report',  null],
  ].map((row) => row.concat('confirmed'));
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
  // Seed the current week AND next week — on a weekend the current week is
  // already behind us, and the scheduler should still look fully loaded.
  const WEEK_MS = 7 * 24 * 3600e3;
  const WEEK_OFFSETS = [0, 1];

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
    for (const wk of WEEK_OFFSETS)
    for (const [dayIdx, startH, endH, title, type, location, status] of weekPlan(i)) {
      // mondayUTC is the UTC instant of Perth Mon 00:00, so just add day+hours.
      const s = new Date(mondayUTC.getTime() + wk * WEEK_MS + (dayIdx * 24 + startH) * 3600e3);
      const e = new Date(mondayUTC.getTime() + wk * WEEK_MS + (dayIdx * 24 + endH) * 3600e3);
      await pool.query(`
        INSERT INTO events (id, user_id, title, start_time, end_time, event_type, status,
                            source, created_by_source, therapist_profile_id, organisation_id, is_deleted, location)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, FALSE, $10)`,
        [userId, title, s.toISOString(), e.toISOString(), type, status || 'confirmed', DEMO_SOURCE, profileId, orgId, location]);
      count++;
    }
    console.log(`✓ ${t.name.padEnd(12)} ${t.email}  (${count} events, colour ${t.colour})`);

    // Phase 2 QA data: work schedules + leave.
    //   Maya  — full Mon-Fri schedule (configured confidence)
    //   Tom   — schedule with Wednesday OFF (not-working column)
    //   Priya — no schedule (default-hours badge) + approved Friday leave
    const weekKeyFor = (wk) => {
      const d = new Date(mondayUTC.getTime() + wk * WEEK_MS + PERTH_OFFSET_H * 3600e3);
      const t2 = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const day = (t2.getUTCDay() + 6) % 7; t2.setUTCDate(t2.getUTCDate() - day + 3);
      const ft = new Date(Date.UTC(t2.getUTCFullYear(), 0, 4));
      const fd = (ft.getUTCDay() + 6) % 7; ft.setUTCDate(ft.getUTCDate() - fd + 3);
      return `${t2.getUTCFullYear()}-W${String(1 + Math.round((t2 - ft) / 6048e5)).padStart(2, '0')}`;
    };
    const schedFor = (days) => JSON.stringify(Object.fromEntries(
      WEEK_OFFSETS.map((wk) => [weekKeyFor(wk), days])));
    if (i === 0) await pool.query('UPDATE users SET work_location_schedule = $1 WHERE id = $2',
      [schedFor({ mon: 'office', tue: 'office', wed: 'office', thu: 'office', fri: 'office' }), userId]);
    if (i === 1) await pool.query('UPDATE users SET work_location_schedule = $1 WHERE id = $2',
      [schedFor({ mon: 'office', tue: 'office', thu: 'office', fri: 'office' }), userId]);
    if (i === 2) {
      await pool.query('UPDATE users SET work_location_schedule = NULL WHERE id = $1', [userId]);
      await pool.query(`DELETE FROM leave_requests WHERE user_id = $1`, [userId]);
      for (const wk of WEEK_OFFSETS) {
        const friday = new Date(mondayUTC.getTime() + wk * WEEK_MS + (4 * 24 + PERTH_OFFSET_H) * 3600e3).toISOString().slice(0, 10);
        await pool.query(`INSERT INTO leave_requests (user_id, organisation_id, leave_type, start_date, end_date, status)
          VALUES ($1, $2, 'annual', $3, $3, 'approved')`, [userId, orgId, friday]);
        console.log(`  + approved leave for ${t.name} on ${friday}`);
      }
    }
  }

  // Dev Therapist part-time caseload (existing dev account, if present)
  const devProf = await pool.query(
    `SELECT tp.id AS profile_id, u.id AS user_id FROM therapist_profiles tp
      JOIN users u ON u.id = tp.user_id WHERE u.email = 'therapist@opaltherapy.dev'`);
  if (devProf.rows.length) {
    const dp = devProf.rows[0];
    let devCount = 0;
    for (const wk of WEEK_OFFSETS)
    for (const [dayIdx, startH, endH, title, type, location, status] of devWeekPlan()) {
      const s2 = new Date(mondayUTC.getTime() + wk * WEEK_MS + (dayIdx * 24 + startH) * 3600e3);
      const e2 = new Date(mondayUTC.getTime() + wk * WEEK_MS + (dayIdx * 24 + endH) * 3600e3);
      await pool.query(`
        INSERT INTO events (id, user_id, title, start_time, end_time, event_type, status,
                            source, created_by_source, therapist_profile_id, organisation_id, is_deleted, location)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, FALSE, $10)`,
        [dp.user_id, title, s2.toISOString(), e2.toISOString(), type, status || 'confirmed', DEMO_SOURCE, dp.profile_id, orgId, location]);
      devCount++;
    }
    console.log(`✓ Dev Therapist part-time caseload (${devCount} events)`);
  }

  // Phase 5 QA: pre-cache suburb centroids so the map works without geocoding
  // in development, plus one telehealth + one location-less session.
  const CENTROIDS = [
    ['Joondalup', -31.7443, 115.7661, '6027'], ['Wanneroo', -31.7469, 115.8034, '6065'],
    ['Kingsley', -31.8106, 115.8010, '6026'], ['Madeley', -31.8118, 115.8290, '6065'],
    ['Willetton', -32.0524, 115.8840, '6155'], ['Canning Vale', -32.0576, 115.9180, '6155'],
    ['Riverton', -32.0342, 115.8970, '6148'], ['Fremantle', -32.0569, 115.7439, '6160'],
    ['Rockingham', -32.2769, 115.7297, '6168'], ['Baldivis', -32.3298, 115.8322, '6171'],
    ['Duncraig', -31.8332, 115.7768, '6023'], ['Hillarys', -31.8069, 115.7405, '6025'],
    ['Bull Creek', -32.0552, 115.8583, '6149'], ['Murdoch', -32.0699, 115.8365, '6150'],
    ['Coogee', -32.1198, 115.7684, '6166'], ['Safety Bay', -32.3054, 115.7233, '6169'],
    ['Como', -31.9927, 115.8637, '6152'], ['Victoria Park', -31.9767, 115.9052, '6100'],
    ['South Perth', -31.9838, 115.8683, '6151'],
  ];
  for (const [sub, lat, lng, pc] of CENTROIDS) {
    await pool.query(`
      INSERT INTO suburb_centroids (suburb_key, suburb, state, postcode, lat, lng, status, attempts, provider)
      VALUES ($1, $2, 'WA', $3, $4, $5, 'ok', 1, 'seed')
      ON CONFLICT (suburb_key) DO NOTHING`,
      [sub.toLowerCase() + '|WA', sub, pc, lat, lng]);
  }
  console.log(`+ ${CENTROIDS.length} suburb centroids cached for the map`);

  console.log('\n✓ Demo calendar seeded for the current + next Perth weeks (Mon-Fri).');
  console.log('  Sign in as owner@opaltherapy.dev and open Calendar → Master.');
  console.log('  Remove with: node backend/setup/seed-demo-calendar.js --clean');
}

main().then(() => pool.end()).catch((err) => { console.error('✗ ' + err.message); pool.end(); process.exit(1); });
