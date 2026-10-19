'use strict';

/**
 * FIRST-LOGIN WIZARD → THE PORTAL'S REAL DATA (Oct 2026).
 *
 * Real PostgreSQL, real routes. What a new starter enters at first sign-in
 * must land where the portal reads it:
 *   · Work location → WORK_BASES home-1, plus Mon–Fri of four weeks, merged;
 *   · Travel bases → appended homes, never overwriting the work location;
 *   · credentials → real credential records (scan optional only when asked);
 *   · My Profile → Credentials opens on the caller's own records;
 *   · the "finish your credentials" reminder, and its dismissal.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'WizardPass1';
const PDF_B64 = Buffer.from('%PDF-1.4 a wizard certificate').toString('base64');

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../register-routes'));
  app.use('/', require('../../profile-routes'));
  app.use('/', require('../../app-routes'));
  return app;
}

let ORG_ID;
async function agentFor(app, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, organisation_id: ORG_ID, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}
const step = (agent, s, data, skipped = false) =>
  agent.post('/api/auth/complete-onboarding-step').send({ step: s, data, skipped });
async function row(userId) {
  const { rows } = await db.pool.query(
    'SELECT default_work_location, work_location_schedule FROM users WHERE id = $1', [userId]);
  return rows[0];
}

beforeEach(async () => {
  await truncateAll();
  const org = await db.pool.query(`INSERT INTO organisations (name) VALUES ('Wizard Practice') RETURNING id`);
  ORG_ID = org.rows[0].id;
  require('../../auth')._resetLoginRateLimit();
});
afterAll(async () => {
  require('../../auth')._resetLoginRateLimit();
  await closePool();
});

const WEEKS = ['2026-W42', '2026-W43', '2026-W44', '2026-W45'];

describe('work location + travel bases', () => {
  test('step 4 then step 5 land in WORK_BASES and the schedule; step 5 never overwrites step 4', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);

    let r = await step(agent, 'work-location', {
      homeAddress: { address: '12 Test Rd, Willetton WA 6155, Australia', lat: -32.05, lng: 115.88, placeId: 'pid-1' },
      weekKeys: WEEKS,
    });
    expect(r.status).toBe(200);
    r = await step(agent, 'travel-bases', {
      travelBases: [{ name: 'Murdoch Clinic', address: '90 South St, Murdoch WA 6150', lat: -32.06, lng: 115.84 }],
    });
    expect(r.status).toBe(200);

    const { default_work_location: bases, work_location_schedule: sched } = await row(user.id);
    expect(Array.isArray(bases.homes)).toBe(true);
    expect(bases.homes[0]).toMatchObject({
      id: 'home-1', kind: 'local', addr: '12 Test Rd, Willetton WA 6155, Australia',
      suburb: 'Willetton', lat: -32.05, lng: 115.88,
    });
    expect(bases.homes[1]).toMatchObject({ label: 'Murdoch Clinic', kind: 'local', suburb: 'Murdoch' });
    expect(bases.homes[1].id).toMatch(/^home-/);
    for (const k of WEEKS) {
      expect(sched[k]).toEqual({ mon: 'home-1', tue: 'home-1', wed: 'home-1', thu: 'home-1', fri: 'home-1' });
    }

    // The Work Locations page reads exactly this.
    const ws = await agent.get('/api/profile/work-schedule');
    expect(ws.status).toBe(200);
    expect(ws.body.travelBases.homes[0].addr).toBe('12 Test Rd, Willetton WA 6155, Australia');
    expect(ws.body.workLocationSchedule['2026-W43'].wed).toBe('home-1');

    // Back/next re-posts are idempotent.
    await step(agent, 'travel-bases', { travelBases: [{ name: 'Murdoch Clinic', address: '90 South St, Murdoch WA 6150' }] });
    expect((await row(user.id)).default_work_location.homes).toHaveLength(2);

    const st = await agent.get('/api/profile/setup-status');
    expect(st.body.travelBaseSet).toBe(true);
  });

  test('never overwrites a day the person set, an office entry, or other homes', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    await db.pool.query(
      `UPDATE users SET default_work_location = $2::jsonb, work_location_schedule = $3::jsonb WHERE id = $1`,
      [user.id,
        JSON.stringify({ office: { id: 'office', label: 'Perth metro office', addr: '' },
          homes: [{ id: 'home-1', label: 'Home', kind: 'local', addr: '' },
            { id: 'home-abc', label: 'Partner', kind: 'local', addr: '3 C St, Leeming WA 6149' }] }),
        JSON.stringify({ '2026-W42': { mon: 'home-abc', fri: 'leave' } })]);

    await step(agent, 'work-location', { homeAddress: { address: '5 New St, Bateman WA 6150' }, weekKeys: WEEKS });

    const { default_work_location: bases, work_location_schedule: sched } = await row(user.id);
    expect(bases.office).toMatchObject({ id: 'office', label: 'Perth metro office' });
    expect(bases.homes.map((h) => h.id)).toEqual(['home-1', 'home-abc']);
    expect(bases.homes[0].addr).toBe('5 New St, Bateman WA 6150');
    expect(sched['2026-W42']).toEqual({ mon: 'home-abc', tue: 'home-1', wed: 'home-1', thu: 'home-1', fri: 'leave' });
  });

  test('a skipped or empty step 4 writes nothing; malformed week keys are ignored', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    expect((await step(agent, 'work-location', {})).status).toBe(200);
    expect((await step(agent, 'travel-bases', { travelBases: [] })).status).toBe(200);
    expect((await row(user.id)).default_work_location).toBeNull();

    await step(agent, 'work-location', { homeAddress: { address: '1 A St, Perth' }, weekKeys: ['nope', "2026-W42'; --"] });
    expect((await row(user.id)).work_location_schedule).toEqual({});
  });

  test('a profile the old wizard saved is read as WORK_BASES and healed', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    await db.pool.query(`UPDATE users SET default_work_location = $2::jsonb WHERE id = $1`,
      [user.id, JSON.stringify([{ name: 'Clinic', address: '1 B St, Applecross WA 6153' }])]);
    const ws = await agent.get('/api/profile/work-schedule');
    expect(ws.body.travelBases.homes.map((h) => h.addr)).toEqual(['', '1 B St, Applecross WA 6153']);
    expect(Array.isArray((await row(user.id)).default_work_location.homes)).toBe(true);
  });

  test('unauthenticated wizard step is refused', async () => {
    const r = await request(buildApp()).post('/api/auth/complete-onboarding-step')
      .send({ step: 'work-location', data: { homeAddress: { address: 'x' } } });
    expect(r.status).toBe(401);
  });
});

describe('credentials from the wizard', () => {
  test('scanLater creates a real record without a document; without it the scan is still required', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);

    const refused = await agent.post('/api/profile/credentials')
      .send({ credentialType: 'wwcc', credentialName: 'Working with Children Check' });
    expect(refused.status).toBe(400);

    const ok = await agent.post('/api/profile/credentials').send({
      credentialType: 'wwcc', credentialName: 'Working with Children Check',
      registrationNumber: 'WWC123', expiryDate: '2029-05-01', scanLater: true,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.credential.document_id).toBeNull();

    // A documentId is always checked, flag or not.
    const bogus = await agent.post('/api/profile/credentials').send({
      credentialType: 'police_check', credentialName: 'Police check',
      documentId: '00000000-0000-0000-0000-000000000000', scanLater: true,
    });
    expect(bogus.status).toBe(404);

    // The scan can be attached later, from the wizard or My Profile.
    const att = await agent.post(`/api/profile/credentials/${ok.body.credential.id}/scan`).send({
      fileName: 'wwc.pdf', fileMime: 'application/pdf', fileSizeBytes: 64, fileData: PDF_B64,
    });
    expect(att.status).toBe(201);
    expect(att.body.credential.document_id).toBeTruthy();

    const { rows } = await db.pool.query('SELECT * FROM credentials WHERE user_id = $1', [user.id]);
    expect(rows).toHaveLength(1);
    const audit = await db.pool.query(`SELECT metadata FROM audit_logs WHERE action = 'credential.created'`);
    expect(audit.rows[0].metadata.scanPending).toBe(true);
  });

  test('My Profile → Credentials: own by default, "All staff" only for those who may', async () => {
    const app = buildApp();
    const { agent: owner, user: ownerUser } = await agentFor(app, { role: 'owner' });
    const { agent: staff } = await agentFor(app, { role: 'therapist' });
    await staff.post('/api/profile/credentials').send({
      credentialType: 'wwcc', credentialName: 'Staff WWC', scanLater: true });

    const mine = await owner.get('/api/profile/credentials?mine=1');
    expect(mine.status).toBe(200);
    expect(mine.body.credentials).toHaveLength(0);
    expect(mine.body.scope).toBe('mine');
    expect(mine.body.canViewAll).toBe(true);

    const all = await owner.get('/api/profile/credentials');
    expect(all.body.scope).toBe('all');
    expect(all.body.credentials.map((c) => c.credential_name)).toContain('Staff WWC');
    expect(all.body.credentials.every((c) => c.user_id !== ownerUser.id)).toBe(true);

    const t = await staff.get('/api/profile/credentials');
    expect(t.body.canViewAll).toBe(false);
    expect(t.body.scope).toBe('mine');

    expect((await request(app).get('/api/profile/credentials')).status).toBe(401);
  });
});

describe('the "finish your credentials" reminder', () => {
  async function complete(agent) {
    expect((await step(agent, 'review', {})).status).toBe(200);
  }

  test('setup card and bell remind after the wizard; dismissing silences both', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app);

    let st = await agent.get('/api/profile/setup-status');
    expect(st.body.credentials.reminderDue).toBe(false); // wizard not finished yet
    await complete(agent);

    st = await agent.get('/api/profile/setup-status');
    expect(st.body.credentials.reminderDue).toBe(true);
    expect(st.body.actions.map((a) => a.key)).toContain('credentials');

    let n = await agent.get('/api/notifications');
    let mine = n.body.notifications.filter((x) => x.type === 'credentials_incomplete');
    expect(mine).toHaveLength(1);
    expect(mine[0].actionPayload).toEqual({ action: 'open_credentials' });
    n = await agent.get('/api/notifications'); // one live reminder, not one per poll
    expect(n.body.notifications.filter((x) => x.type === 'credentials_incomplete')).toHaveLength(1);

    // Dismissed in the bell → quiet on the card too.
    expect((await agent.patch(`/api/notifications/${mine[0].id}`).send({ status: 'dismissed' })).status).toBe(200);
    st = await agent.get('/api/profile/setup-status');
    expect(st.body.credentials.reminderDue).toBe(false);
    expect(st.body.actions.map((a) => a.key)).not.toContain('credentials');
    n = await agent.get('/api/notifications');
    expect(n.body.notifications.filter((x) => x.type === 'credentials_incomplete')).toHaveLength(0);
  });

  test('the dismiss route silences it, and refuses the unauthenticated', async () => {
    const app = buildApp();
    expect((await request(app).post('/api/profile/credential-reminder/dismiss')).status).toBe(401);
    const { agent } = await agentFor(app, { role: 'owner' });
    await complete(agent);
    expect((await agent.get('/api/profile/setup-status')).body.credentials.reminderDue).toBe(true);
    expect((await agent.post('/api/profile/credential-reminder/dismiss')).status).toBe(200);
    expect((await agent.get('/api/profile/setup-status')).body.credentials.reminderDue).toBe(false);
  });

  test('quiet once the key credentials are on file with their scans', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app);
    await complete(agent);
    await agent.get('/api/notifications'); // creates the reminder
    for (const [type, name] of [['ahpra_registration', 'AHPRA registration'], ['professional_indemnity', 'Professional indemnity'],
      ['wwcc', 'Working with Children Check'], ['ndis_worker_screening', 'NDIS Worker Screening Check']]) {
      const up = await agent.post('/api/profile/credentials/scans').send({
        fileName: `${type}.pdf`, fileMime: 'application/pdf', fileSizeBytes: 64,
        fileData: Buffer.from(`%PDF-1.4 ${type}`).toString('base64') });
      expect(up.status).toBe(201);
      const c = await agent.post('/api/profile/credentials').send({ credentialType: type, credentialName: name, documentId: up.body.document.id });
      expect(c.status).toBe(201);
    }
    const st = await agent.get('/api/profile/setup-status');
    expect(st.body.credentials.complete).toBe(true);
    expect(st.body.credentials.reminderDue).toBe(false);
    const n = await agent.get('/api/notifications');
    expect(n.body.notifications.filter((x) => x.type === 'credentials_incomplete')).toHaveLength(0);
  });
});
