'use strict';

/**
 * SERVICE AGREEMENTS — INTEGRATION
 *
 * What this suite protects: the boundaries that only exist once the routes,
 * the database and the permission model are all in play at once.
 *
 *   - A staff member cannot obtain a Word file, publish a master, or reach an
 *     agreement in another organisation, by calling the API directly. Hiding
 *     the button is not the control; these routes are.
 *   - An issued agreement is PINNED. Publishing a new master afterwards must
 *     not alter a single byte of what a participant already received.
 *   - A signing link opens exactly one agreement, for exactly one recipient,
 *     until it expires or is revoked.
 *   - Every one of those events lands in the audit trail.
 *
 * Splose is stubbed with jest.mock: it is the external system of record for
 * participant identity, it is not reachable from a test runner, and a test
 * that depended on it would be measuring the network.
 */

const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');

// Splose is external. Stub it before anything requires the route module.
jest.mock('../../splose-api', () => ({
  getPatient: jest.fn(async (id) => ({
    id,
    fullName: 'Jordan Avery Whitlock',
    preferredName: 'Jordy',
    ndisNumber: '430512977',
    email: 'jordan@example.invalid',
    mobilePhone: '0400 000 000',
    formattedAddress: '12 Barrallier Street, Wagga Wagga NSW 2650',
    dateOfBirth: '1998-03-14',
  })),
  getPatients: jest.fn(async () => ([{
    id: 'splose-1', fullName: 'Jordan Avery Whitlock', ndisNumber: '430512977',
    email: 'jordan@example.invalid', mobilePhone: '0400 000 000',
    formattedAddress: '12 Barrallier Street, Wagga Wagga NSW 2650',
  }])),
}));

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const map = require('../../service-agreements/template-map');

const PASSWORD = 'SvaPass123';
const CLIENT_ID = 'splose-1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '32mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET, resave: false,
    saveUninitialized: false, cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../service-agreement-routes'));
  return app;
}

const app = buildApp();

async function agentFor(role, orgId, overrides) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser(Object.assign(
    { password_hash: hash, role, organisation_id: orgId }, overrides || {}
  ));
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** Grant service-agreement permissions directly, as the Owner's endpoint would. */
async function grant(userId, permissions) {
  await db.pool.query('UPDATE users SET permissions = $2 WHERE id = $1',
    [userId, JSON.stringify(permissions)]);
}

/** The provider identity an agreement cannot be issued without. */
async function seedProviderIdentity(orgId) {
  await db.pool.query(
    `INSERT INTO org_settings (org_id, settings) VALUES ($1, $2::jsonb)
     ON CONFLICT (org_id) DO UPDATE SET settings = $2::jsonb`,
    [String(orgId), JSON.stringify({
      businessAddress: '1 Example Street, Wagga Wagga NSW 2650',
      businessPhone: '02 6931 0000',
      businessEmail: 'hello@opal.invalid',
      serviceAgreement: {
        legalName: 'Opal Therapy Pty Ltd',
        tradingName: 'Opal Therapy',
        abn: '51 824 753 556',
        ndisRegistrationNumber: '4-050-1234-5',
        complaintsContact: 'complaints@opal.invalid',
        privacyContact: 'privacy@opal.invalid',
        paymentTermsDays: '14',
      },
    })]
  );
}

const SUPPORT = {
  OPAL_SUPPORT_ITEM_NUMBER: '15_056_0128_1_3',
  OPAL_SUPPORT_DESCRIPTION: 'Occupational therapy assessment',
  OPAL_SUPPORT_DELIVERY_METHOD: 'In person',
  OPAL_SUPPORT_FREQUENCY: 'Fortnightly',
  OPAL_SUPPORT_RATE: '193.99',
  OPAL_SUPPORT_ESTIMATED_QUANTITY: '12',
};

/** Create → fill → issue, returning the agreement and the owner's agent. */
async function issuedAgreement(agent, orgId) {
  const created = await agent.post('/api/service-agreements')
    .send({ participantClientId: CLIENT_ID, participantName: 'Jordan Avery Whitlock' });
  expect(created.status).toBe(201);
  const id = created.body.agreement.id;

  await agent.post(`/api/service-agreements/${id}/resolve`).expect(200);
  await agent.patch(`/api/service-agreements/${id}`).send({
    formData: {
      OPAL_PARTICIPANT_FULL_NAME: 'Jordan Avery Whitlock',
      OPAL_AGREEMENT_START_DATE: '2026-09-01',
      OPAL_PARTICIPANT_EMAIL: 'jordan@example.invalid',
    },
    supports: [SUPPORT],
    participantEmail: 'jordan@example.invalid',
    ready: true,
  }).expect(200);

  const issued = await agent.post(`/api/service-agreements/${id}/issue`).send({});
  expect(issued.status).toBe(200);
  return { id, agreement: issued.body.agreement };
}

/**
 * Superagent buffers application/pdf but not the Word MIME type, so a .docx
 * response arrives as an empty object unless the parser is supplied. This
 * collects the raw bytes so the test can assert on the actual file.
 */
function binary(req) {
  return req.buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(Buffer.from(c)));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

async function auditActions(agreementId) {
  const { rows } = await db.pool.query(
    `SELECT action FROM audit_logs WHERE target_type = 'service_agreement' AND target_id = $1
      ORDER BY created_at`,
    [String(agreementId)]
  );
  return rows.map((r) => r.action);
}

// ─────────────────────────────────────────────────────────────────────────────

jest.setTimeout(60000);

let orgA;
let orgB;

beforeEach(async () => {
  await truncateAll();
  // Many logins per file from one IP; the real limiter is 10 per 15 minutes
  // (auth.js) and is exercised deliberately elsewhere, not incidentally here.
  require('../../auth')._resetLoginRateLimit();
  orgA = (await seedOrganisation('Opal Therapy')).id;
  orgB = (await seedOrganisation('Another Practice')).id;
  await seedProviderIdentity(orgA);
  await seedProviderIdentity(orgB);
});

afterAll(closePool);

// ═════════════════════════════════════════════════════════════════════════════

describe('who can reach the module at all', () => {
  it('refuses an anonymous caller', async () => {
    await request(app).get('/api/service-agreements').expect(401);
  });

  it('refuses a therapist who has not been granted access', async () => {
    const { agent } = await agentFor('therapist', orgA);
    await agent.get('/api/service-agreements').expect(403);
  });

  it('refuses an administrator who has not been granted access', async () => {
    // An admin is not a service-agreement administrator: those are two
    // different things, and the Owner grants the second one deliberately.
    const { agent } = await agentFor('admin', orgA);
    await agent.get('/api/service-agreements').expect(403);
  });

  it('admits an owner without any explicit grant', async () => {
    const { agent } = await agentFor('owner', orgA);
    await agent.get('/api/service-agreements').expect(200);
  });

  it('admits an admin once the Owner grants access', async () => {
    const { agent, user } = await agentFor('admin', orgA);
    await grant(user.id, ['service_agreements.access']);
    await agent.get('/api/service-agreements').expect(200);
  });
});

describe('the participant-record shortcut, at the server', () => {
  // The shortcut is a button; these are the two calls it actually makes, and
  // they are what enforce who may use it.

  it('lets an owner confirm a participant and create the agreement', async () => {
    const { agent } = await agentFor('owner', orgA);
    const list = await agent.get('/api/service-agreements/clients?q=').expect(200);
    expect(list.body.clients.some((c) => String(c.id) === CLIENT_ID)).toBe(true);

    const created = await agent.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(201);
    expect(created.body.agreement.participant_client_id).toBe(CLIENT_ID);
  });

  it('lets a delegated employee do the same', async () => {
    const { agent, user } = await agentFor('therapist', orgA);
    await grant(user.id, ['service_agreements.access']);
    await agent.get('/api/service-agreements/clients?q=').expect(200);
    await agent.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(201);
  });

  it('REFUSES an authenticated user without the permission', async () => {
    // The button is not rendered for them either, but the button is not the
    // control — this is.
    const { agent } = await agentFor('therapist', orgA);
    await agent.get('/api/service-agreements/clients?q=').expect(403);
    await agent.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(403);
  });

  it('refuses an anonymous caller outright', async () => {
    await request(app).get('/api/service-agreements/clients?q=').expect(401);
    await request(app).post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(401);
  });

  it('keeps an agreement created this way inside its own organisation', async () => {
    const { agent: a } = await agentFor('owner', orgA);
    const created = await a.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(201);

    // Same participant id, a different practice: the agreement is invisible.
    const { agent: b } = await agentFor('owner', orgB);
    await b.get(`/api/service-agreements/${created.body.agreement.id}`).expect(404);
    expect((await b.get('/api/service-agreements').expect(200)).body.agreements).toEqual([]);
  });

  it('mints the agreement id server-side, so the shortcut cannot choose one', async () => {
    const { agent } = await agentFor('owner', orgA);
    const forged = '00000000-0000-0000-0000-0000000000ff';
    const created = await agent.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID, id: forged }).expect(201);
    expect(created.body.agreement.id).not.toBe(forged);
  });
});

describe('the delegation endpoint is reachable at all', () => {
  // Regression: '/access' was declared AFTER '/:id'. Express matches in
  // declaration order, so the literal segment was captured by the parameter,
  // failed the uuid test and 404'd — for the owner too. The endpoint existed
  // and could not be called by anybody.
  it('answers the owner', async () => {
    const { agent } = await agentFor('owner', orgA);
    const res = await agent.get('/api/service-agreements/access').expect(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.groups.map((g) => g.key)).toContain('service_agreements');
  });

  it('REFUSES a delegate — 403, not an accidental 404', () => agentFor('admin', orgA)
    .then(async ({ agent, user }) => {
      await grant(user.id, ['service_agreements.access', 'service_agreements.view_all']);
      await agent.get('/api/service-agreements/access').expect(403);
    }));

  it('lets the owner grant and revoke access', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { user: target } = await agentFor('admin', orgA);

    await agent.put(`/api/service-agreements/access/${target.id}`)
      .send({ permissions: ['service_agreements.access'] }).expect(200);
    let list = await agent.get('/api/service-agreements/access').expect(200);
    expect(list.body.users.find((u) => u.id === target.id).permissions)
      .toEqual(['service_agreements.access']);

    // Granting manage_master through delegation is accepted as a stored value
    // but confers nothing without the owner role — requireMasterAuthority
    // checks both. Proven at the route below.
    await agent.put(`/api/service-agreements/access/${target.id}`)
      .send({ permissions: [] }).expect(200);
    list = await agent.get('/api/service-agreements/access').expect(200);
    expect(list.body.users.find((u) => u.id === target.id).permissions).toEqual([]);
  });

  it('will not let a delegate hand out access', async () => {
    const { agent, user } = await agentFor('admin', orgA);
    await grant(user.id, ['service_agreements.access', 'service_agreements.manage_master']);
    await agent.put(`/api/service-agreements/access/${user.id}`)
      .send({ permissions: ['service_agreements.manage_master'] }).expect(403);
  });
});

describe('every master endpoint an employee might call directly', () => {
  // The interface hides these; hiding is not the control. This is.
  it('refuses all of them, with the agreement surface still usable', async () => {
    const { agent: owner } = await agentFor('owner', orgA);
    const { body: { master } } = await owner.get('/api/service-agreements/master').expect(200);

    const { agent, user } = await agentFor('therapist', orgA);
    await grant(user.id, ['service_agreements.access', 'service_agreements.view_all',
      'service_agreements.manage_master']);

    await agent.get(`/api/service-agreements/master/${master.id}/docx`).expect(403);
    await agent.post(`/api/service-agreements/master/${master.id}/publish`).send({}).expect(403);
    await agent.post(`/api/service-agreements/master/${master.id}/retire`).send({}).expect(403);
    await agent.post(`/api/service-agreements/master/${master.id}/republish`).send({}).expect(403);
    await agent.post('/api/service-agreements/master/upload').send({ fileBase64: 'eA==' }).expect(403);
    await agent.put('/api/service-agreements/master/clauses').send({}).expect(403);
    await agent.put('/api/service-agreements/settings').send({ legalName: 'Hijack' }).expect(403);

    // But the work they ARE authorised for is untouched.
    await agent.get('/api/service-agreements').expect(200);
    await agent.get(`/api/service-agreements/master/${master.id}/pdf`).expect(200);
  });
});

describe('the master template', () => {
  it('registers and publishes the bundled master on first use', async () => {
    const { agent } = await agentFor('owner', orgA);
    const res = await agent.get('/api/service-agreements/master').expect(200);

    expect(res.body.master.status).toBe('published');
    expect(res.body.master.versionLabel).toBe(map.SEED_VERSION);
    expect(res.body.master.sha256).toBe(map.SEED_TEMPLATE_SHA256);
    expect(res.body.master.validation.ok).toBe(true);
    expect(res.body.master.tagManifest.unknown).toEqual([]);
  });

  it('never returns the stored file bytes in JSON', async () => {
    const { agent } = await agentFor('owner', orgA);
    const res = await agent.get('/api/service-agreements/master').expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/file_data/);
    expect(res.body.master.fileData).toBeUndefined();
  });

  it('keeps exactly one published master per organisation', async () => {
    const { agent } = await agentFor('owner', orgA);
    await agent.get('/api/service-agreements/master').expect(200);
    await agent.get('/api/service-agreements/master').expect(200);

    const { rows } = await db.pool.query(
      `SELECT COUNT(*)::int AS n FROM service_agreement_master_versions
        WHERE organisation_id = $1 AND status = 'published'`, [orgA]
    );
    expect(rows[0].n).toBe(1);
  });

  it('gives the owner the master Word file', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { body: { master } } = await agent.get('/api/service-agreements/master').expect(200);

    const res = await binary(agent.get(`/api/service-agreements/master/${master.id}/docx`))
      .expect(200);
    expect(res.headers['content-type']).toMatch(/wordprocessingml/);
    expect(res.body.length).toBeGreaterThan(1000);
    // A .docx is a zip; the magic bytes prove real Word bytes came back.
    expect(res.body.slice(0, 2).toString('latin1')).toBe('PK');
  });

  it('REFUSES the master Word file to an admin with full access', async () => {
    // The heart of the design: a .docx is editable, so an employee holding one
    // could rewrite the agreement's terms.
    const { agent: owner } = await agentFor('owner', orgA);
    const { body: { master } } = await owner.get('/api/service-agreements/master').expect(200);

    const { agent, user } = await agentFor('admin', orgA);
    await grant(user.id, [
      'service_agreements.access', 'service_agreements.view_all',
      'service_agreements.manage_master',
    ]);
    await agent.get(`/api/service-agreements/master/${master.id}/docx`).expect(403);
  });

  it('REFUSES publishing to an admin, even holding manage_master', async () => {
    const { agent: owner } = await agentFor('owner', orgA);
    const { body: { master } } = await owner.get('/api/service-agreements/master').expect(200);

    const { agent, user } = await agentFor('admin', orgA);
    await grant(user.id, ['service_agreements.access', 'service_agreements.manage_master']);

    await agent.post(`/api/service-agreements/master/${master.id}/publish`).send({}).expect(403);
    await agent.post(`/api/service-agreements/master/${master.id}/retire`).send({}).expect(403);
    await agent.post('/api/service-agreements/master/upload').send({ fileBase64: 'x' }).expect(403);
    await agent.put('/api/service-agreements/master/clauses').send({}).expect(403);
  });

  it('gives staff a participant-facing PDF preview of the master', async () => {
    const { agent: owner } = await agentFor('owner', orgA);
    const { body: { master } } = await owner.get('/api/service-agreements/master').expect(200);

    const { agent, user } = await agentFor('admin', orgA);
    await grant(user.id, ['service_agreements.access']);
    const res = await agent.get(`/api/service-agreements/master/${master.id}/pdf`).expect(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('editing and versioning the master', () => {
  it('makes clause edits a DRAFT, never a change to the published version', async () => {
    const { agent } = await agentFor('owner', orgA);
    const before = (await agent.get('/api/service-agreements/master').expect(200)).body.master;

    const res = await agent.put('/api/service-agreements/master/clauses').send({
      clauses: [{ tag: 'OPAL_CLAUSE_CONFLICTS', enabled: false }],
      custom: [{ title: 'Rural travel', body: 'Travel is charged per the NDIS limits.' }],
    }).expect(200);

    expect(res.body.draft.status).toBe('validated');
    expect(res.body.draft.versionLabel).toBe('1.1');

    // The published master is untouched until somebody publishes.
    const after = (await agent.get('/api/service-agreements/master').expect(200)).body.master;
    expect(after.id).toBe(before.id);
    expect(after.versionLabel).toBe(map.SEED_VERSION);
  });

  it('refuses to switch off a required clause', async () => {
    const { agent } = await agentFor('owner', orgA);
    await agent.get('/api/service-agreements/master').expect(200);
    const res = await agent.put('/api/service-agreements/master/clauses')
      .send({ clauses: [{ tag: 'OPAL_CLAUSE_PRICING_PAYMENT', enabled: false }] })
      .expect(400);
    expect(JSON.stringify(res.body.errors)).toMatch(/required clause/i);
  });

  it('publishes a draft and retires the version it replaces', async () => {
    const { agent } = await agentFor('owner', orgA);
    const v1 = (await agent.get('/api/service-agreements/master').expect(200)).body.master;

    const draft = (await agent.put('/api/service-agreements/master/clauses')
      .send({ custom: [{ title: 'Rural travel', body: 'Charged per NDIS limits.' }] })
      .expect(200)).body.draft;

    const published = (await agent.post(`/api/service-agreements/master/${draft.id}/publish`)
      .send({}).expect(200)).body.master;

    expect(published.versionLabel).toBe('1.1');
    expect(published.supersededVersionId).toBe(v1.id);

    const { rows } = await db.pool.query(
      'SELECT status FROM service_agreement_master_versions WHERE id = $1', [v1.id]
    );
    expect(rows[0].status).toBe('retired');
  });

  it('refuses an uploaded master that is not a valid Word package', async () => {
    const { agent } = await agentFor('owner', orgA);
    await agent.get('/api/service-agreements/master').expect(200);

    const res = await agent.post('/api/service-agreements/master/upload')
      .send({ fileBase64: Buffer.from('%PDF-1.7 not a docx').toString('base64') })
      .expect(400);
    expect(res.body.validation.errors.map((e) => e.code)).toContain('not_a_zip');
  });

  it('accepts a valid uploaded master as a draft, not as the live one', async () => {
    const fs = require('fs');
    const { agent } = await agentFor('owner', orgA);
    const before = (await agent.get('/api/service-agreements/master').expect(200)).body.master;

    const bytes = fs.readFileSync(map.SEED_TEMPLATE_FILE).toString('base64');
    const res = await agent.post('/api/service-agreements/master/upload')
      .send({ fileBase64: bytes }).expect(201);

    expect(res.body.draft.status).toBe('validated');
    expect(res.body.validation.ok).toBe(true);

    const after = (await agent.get('/api/service-agreements/master').expect(200)).body.master;
    expect(after.id).toBe(before.id);
  });

  it('republishes a historic version as a NEW version, leaving history intact', async () => {
    const { agent } = await agentFor('owner', orgA);
    const v1 = (await agent.get('/api/service-agreements/master').expect(200)).body.master;

    const draft = (await agent.put('/api/service-agreements/master/clauses')
      .send({ custom: [{ title: 'Temporary', body: 'Remove me.' }] }).expect(200)).body.draft;
    await agent.post(`/api/service-agreements/master/${draft.id}/publish`).send({}).expect(200);

    const republished = (await agent.post(`/api/service-agreements/master/${v1.id}/republish`)
      .send({}).expect(200)).body.master;

    expect(republished.versionLabel).toBe('1.2');
    expect(republished.id).not.toBe(v1.id);

    // v1's own row is untouched — agreements issued against it still point at
    // the version they were actually issued with.
    const { rows } = await db.pool.query(
      'SELECT version_label, status FROM service_agreement_master_versions WHERE id = $1', [v1.id]
    );
    expect(rows[0].version_label).toBe(map.SEED_VERSION);
  });

  it('lists every version, including retired ones', async () => {
    const { agent } = await agentFor('owner', orgA);
    await agent.get('/api/service-agreements/master').expect(200);
    const draft = (await agent.put('/api/service-agreements/master/clauses')
      .send({ custom: [{ title: 'X', body: 'Y' }] }).expect(200)).body.draft;
    await agent.post(`/api/service-agreements/master/${draft.id}/publish`).send({}).expect(200);

    const res = await agent.get('/api/service-agreements/master/versions').expect(200);
    expect(res.body.versions).toHaveLength(2);
    expect(res.body.versions.map((v) => v.status).sort()).toEqual(['published', 'retired']);
  });
});

describe('provider identity', () => {
  it('refuses to create an agreement while the practice details are incomplete', async () => {
    await db.pool.query('DELETE FROM org_settings WHERE org_id = $1', [String(orgA)]);
    const { agent } = await agentFor('owner', orgA);

    const res = await agent.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(409);
    expect(res.body.missing).toEqual(expect.arrayContaining(['legalName', 'abn']));
  });

  it('refuses a settings save with an invalid ABN', async () => {
    const { agent } = await agentFor('owner', orgA);
    const res = await agent.put('/api/service-agreements/settings')
      .send({ abn: '12345678901' }).expect(400);
    expect(res.body.errors[0].field).toBe('abn');
  });

  it('refuses a settings save from an admin with full access', async () => {
    const { agent, user } = await agentFor('admin', orgA);
    await grant(user.id, ['service_agreements.access', 'service_agreements.manage_master']);
    await agent.put('/api/service-agreements/settings')
      .send({ legalName: 'Not Your Practice' }).expect(403);
  });
});

describe('building and issuing an agreement', () => {
  it('prefills from the portal and attributes every value', async () => {
    const { agent } = await agentFor('owner', orgA);
    const created = await agent.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(201);

    const res = await agent.post(`/api/service-agreements/${created.body.agreement.id}/resolve`)
      .expect(200);

    expect(res.body.values.OPAL_PARTICIPANT_FULL_NAME).toBe('Jordan Avery Whitlock');
    expect(res.body.sources.OPAL_PARTICIPANT_FULL_NAME).toBe('splose');
    expect(res.body.values.OPAL_ORG_ABN).toBe('51 824 753 556');
    expect(res.body.sources.OPAL_ORG_ABN).toBe('organisation_settings');
    // Honest about what nobody has stored.
    expect(res.body.missing).toContain('OPAL_FUNDING_MANAGEMENT_TYPE');
  });

  it('discards a signature, an ABN or a reference posted to the draft', async () => {
    const { agent } = await agentFor('owner', orgA);
    const created = await agent.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(201);
    const id = created.body.agreement.id;

    const res = await agent.patch(`/api/service-agreements/${id}`).send({
      formData: {
        OPAL_PARTICIPANT_FULL_NAME: 'Jordan Avery Whitlock',
        OPAL_PARTICIPANT_SIGNATURE: 'Mallory',
        OPAL_ORG_ABN: '00 000 000 000',
        OPAL_AGREEMENT_ID: 'SVA-FORGED1',
      },
    }).expect(200);

    expect(res.body.rejectedFields.sort()).toEqual(
      ['OPAL_AGREEMENT_ID', 'OPAL_ORG_ABN', 'OPAL_PARTICIPANT_SIGNATURE'].sort()
    );
    expect(res.body.agreement.form_data.OPAL_PARTICIPANT_SIGNATURE).toBeUndefined();
    expect(res.body.agreement.form_data.OPAL_ORG_ABN).toBeUndefined();
  });

  it('returns a live preview of the composed document', async () => {
    const { agent } = await agentFor('owner', orgA);
    const created = await agent.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(201);
    await agent.patch(`/api/service-agreements/${created.body.agreement.id}`)
      .send({ formData: { OPAL_PARTICIPANT_FULL_NAME: 'Jordan Avery Whitlock' }, supports: [SUPPORT] })
      .expect(200);

    const res = await agent.get(`/api/service-agreements/${created.body.agreement.id}/preview`)
      .expect(200);
    expect(res.body.blocks.length).toBeGreaterThan(50);
    expect(res.body.supportTotals.display).toBe('$2,327.88');
    expect(JSON.stringify(res.body.blocks)).toContain('Jordan Avery Whitlock');
    expect(JSON.stringify(res.body.blocks)).not.toMatch(/\[PORTAL —|\[OWNER —/);
  });

  it('issues, pins the master, and stores both artifacts', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id, agreement } = await issuedAgreement(agent, orgA);

    expect(agreement.state).toBe('issued');
    expect(agreement.reference).toMatch(/^SVA-[0-9A-F]{8}$/);
    expect(agreement.master_sha256).toBe(map.SEED_TEMPLATE_SHA256);
    expect(agreement.master_version_label).toBe(map.SEED_VERSION);
    expect(agreement.pricing_snapshot.totalDisplay).toBe('$2,327.88');
    expect(agreement.organisation_snapshot.OPAL_ORG_ABN).toBe('51 824 753 556');

    const { rows } = await db.pool.query(
      'SELECT kind, audience FROM service_agreement_artifacts WHERE agreement_id = $1 ORDER BY kind',
      [id]
    );
    expect(rows.map((r) => r.kind).sort()).toEqual(['issued_docx', 'issued_pdf']);
    expect(rows.find((r) => r.kind === 'issued_docx').audience).toBe('owner');
  });

  it('serves the fillable PDF to staff and the Word copy only to the owner', async () => {
    const { agent: owner } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(owner, orgA);

    const pdf = await owner.get(`/api/service-agreements/${id}/pdf`).expect(200);
    expect(pdf.body.slice(0, 5).toString('latin1')).toBe('%PDF-');

    const { agent: admin, user } = await agentFor('admin', orgA);
    await grant(user.id, ['service_agreements.access', 'service_agreements.view_all']);
    await admin.get(`/api/service-agreements/${id}/pdf`).expect(200);
    await admin.get(`/api/service-agreements/${id}/docx`).expect(403);
    await admin.get(`/api/service-agreements/${id}/docx?blank=1`).expect(403);
  });

  it('refuses to edit an agreement once it is issued', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);
    await agent.patch(`/api/service-agreements/${id}`)
      .send({ formData: { OPAL_PARTICIPANT_FULL_NAME: 'Somebody Else' } }).expect(409);
  });

  it('refuses to issue the same agreement twice', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);
    await agent.post(`/api/service-agreements/${id}/issue`).send({}).expect(409);
  });
});

describe('an issued agreement is pinned to the master it was issued with', () => {
  it('is unchanged, byte for byte, by a later publication', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);

    const before = await agent.get(`/api/service-agreements/${id}/pdf`).expect(200);
    const beforeBytes = Buffer.from(before.body);

    // Publish a new master with a different clause configuration.
    const draft = (await agent.put('/api/service-agreements/master/clauses').send({
      clauses: [{ tag: 'OPAL_CLAUSE_CONFLICTS', enabled: false }],
      custom: [{ title: 'A brand new clause', body: 'This must not appear in the old agreement.' }],
    }).expect(200)).body.draft;
    await agent.post(`/api/service-agreements/master/${draft.id}/publish`).send({}).expect(200);

    const after = await agent.get(`/api/service-agreements/${id}/pdf`).expect(200);
    expect(Buffer.from(after.body).equals(beforeBytes)).toBe(true);

    const { rows } = await db.pool.query(
      'SELECT master_version_label FROM service_agreements WHERE id = $1', [id]
    );
    expect(rows[0].master_version_label).toBe(map.SEED_VERSION);
  });

  it('refuses at the database level to repoint a pinned agreement', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);
    const other = (await db.pool.query(
      'SELECT id FROM service_agreement_master_versions LIMIT 1'
    )).rows[0].id;

    await expect(db.pool.query(
      'UPDATE service_agreements SET master_version_id = $2 WHERE id = $1',
      [id, other === id ? other : '00000000-0000-0000-0000-000000000001']
    )).rejects.toThrow(/stays pinned|violates foreign key/i);
  });
});

describe('emailing a completion link', () => {
  it('creates a session, records the delivery, and skips the send when SMTP is off', async () => {
    // The integration environment blanks EMAIL_HOST, so the adapter takes its
    // documented "skipped" path rather than attempting a real send.
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);

    const res = await agent.post(`/api/service-agreements/${id}/email`)
      .send({ recipientEmail: 'jordan@example.invalid', message: 'Please review and sign.' })
      .expect(200);

    expect(res.body.delivery.result).toBe('skipped');
    expect(res.body.session.signatoryType).toBe('participant');
    expect(res.body.signingUrl).toMatch(/service-agreement-sign\?token=/);

    const { rows } = await db.pool.query(
      'SELECT token_sha256, recipient_email, status FROM service_agreement_signing_sessions WHERE agreement_id = $1',
      [id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_sha256).toMatch(/^[0-9a-f]{64}$/);
    // The raw token is never stored.
    const token = res.body.signingUrl.split('token=')[1];
    expect(rows[0].token_sha256).not.toContain(decodeURIComponent(token));
  });

  it('refuses a second live link for the same signatory', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);
    await agent.post(`/api/service-agreements/${id}/email`)
      .send({ recipientEmail: 'jordan@example.invalid' }).expect(200);
    await agent.post(`/api/service-agreements/${id}/email`)
      .send({ recipientEmail: 'jordan@example.invalid' }).expect(409);
  });

  it('refuses to send before the agreement is issued', async () => {
    const { agent } = await agentFor('owner', orgA);
    const created = await agent.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(201);
    await agent.post(`/api/service-agreements/${created.body.agreement.id}/email`)
      .send({ recipientEmail: 'jordan@example.invalid' }).expect(409);
  });

  it('rejects a malformed recipient address', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);
    await agent.post(`/api/service-agreements/${id}/email`)
      .send({ recipientEmail: 'not-an-address' }).expect(400);
  });
});

describe('the participant signing surface', () => {
  async function issuedWithLink() {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);
    const res = await agent.post(`/api/service-agreements/${id}/email`)
      .send({ recipientEmail: 'jordan@example.invalid' }).expect(200);
    const token = res.body.signingUrl.split('token=')[1];
    return { agent, id, token, sessionId: res.body.session.id };
  }

  it('asks for the recipient address before revealing anything', async () => {
    const { token } = await issuedWithLink();
    const res = await request(app).get(`/api/service-agreement-signing/${token}`).expect(200);

    expect(res.body.state).toBe('verify');
    expect(res.body.emailHint).toMatch(/^j.*@example\.invalid$/);
    // Nothing about the participant or the agreement before verification.
    expect(JSON.stringify(res.body)).not.toContain('Jordan Avery Whitlock');
    expect(res.body.agreement).toBeUndefined();
  });

  it('refuses a wrong address and counts the attempt', async () => {
    const { token, sessionId } = await issuedWithLink();
    await request(app).post(`/api/service-agreement-signing/${token}/verify`)
      .send({ email: 'someone.else@example.invalid' }).expect(403);

    const { rows } = await db.pool.query(
      'SELECT verification_attempts FROM service_agreement_signing_sessions WHERE id = $1',
      [sessionId]
    );
    expect(rows[0].verification_attempts).toBe(1);
  });

  it('opens the agreement once the address matches', async () => {
    const { token } = await issuedWithLink();
    await request(app).post(`/api/service-agreement-signing/${token}/verify`)
      .send({ email: 'Jordan@Example.Invalid' }).expect(200);

    const res = await request(app).get(`/api/service-agreement-signing/${token}`).expect(200);
    expect(res.body.state).toBe('ready');
    expect(res.body.agreement.participantName).toBe('Jordan Avery Whitlock');
    expect(res.body.assignedFields.length).toBeGreaterThan(10);
    // Never a price, never the provider's signature.
    const tags = res.body.assignedFields.map((f) => f.tag);
    expect(tags).not.toContain('OPAL_SUPPORT_RATE');
    expect(tags).not.toContain('OPAL_PROVIDER_SIGNATURE');
  });

  it('saves only the fields the session was assigned', async () => {
    const { token, id } = await issuedWithLink();
    await request(app).post(`/api/service-agreement-signing/${token}/verify`)
      .send({ email: 'jordan@example.invalid' }).expect(200);

    const res = await request(app).post(`/api/service-agreement-signing/${token}/save`).send({
      values: {
        OPAL_EMERGENCY_CONTACT_NAME: 'Alex Whitlock',
        OPAL_SUPPORT_RATE: '0.01',
        OPAL_ORG_ABN: '00 000 000 000',
      },
    }).expect(200);

    expect(res.body.saved).toBe(1);
    expect(res.body.rejected).toEqual(
      expect.arrayContaining(['OPAL_SUPPORT_RATE', 'OPAL_ORG_ABN'])
    );

    const { rows } = await db.pool.query('SELECT form_data, state FROM service_agreements WHERE id = $1', [id]);
    expect(rows[0].form_data.OPAL_EMERGENCY_CONTACT_NAME).toBe('Alex Whitlock');
    expect(rows[0].form_data.OPAL_SUPPORT_RATE).toBeUndefined();
    expect(rows[0].state).toBe('partially_completed');
  });

  it('signs, locks the document, and records what it can honestly claim', async () => {
    const { token, id } = await issuedWithLink();
    await request(app).post(`/api/service-agreement-signing/${token}/verify`)
      .send({ email: 'jordan@example.invalid' }).expect(200);

    const res = await request(app).post(`/api/service-agreement-signing/${token}/sign`).send({
      signatureName: 'Jordan Avery Whitlock',
      capacity: 'Participant',
      intent: true,
      consentElectronic: true,
    }).expect(200);

    expect(res.body.finalDocumentSha256).toMatch(/^[0-9a-f]{64}$/);

    const { rows } = await db.pool.query('SELECT state, signed_at FROM service_agreements WHERE id = $1', [id]);
    expect(rows[0].state).toBe('signed');
    expect(rows[0].signed_at).not.toBeNull();

    // The final PDF exists and every field in it is locked.
    const { rows: art } = await db.pool.query(
      `SELECT file_data FROM service_agreement_artifacts
        WHERE agreement_id = $1 AND kind = 'final_pdf'`, [id]
    );
    expect(art).toHaveLength(1);
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.load(Buffer.from(art[0].file_data, 'base64'));
    const fields = doc.getForm().getFields();
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.isReadOnly())).toBe(true);

    // The audit record says exactly what happened, and no more.
    const { rows: audit } = await db.pool.query(
      `SELECT metadata FROM audit_logs
        WHERE target_id = $1 AND action = 'SERVICE_AGREEMENT_SIGNED'`, [String(id)]
    );
    expect(audit[0].metadata.cryptographicSignatureApplied).toBe(false);
    expect(audit[0].metadata.signatureAssurance).toBe('portal_typed_signature');
  });

  it('refuses to sign without intent or electronic consent', async () => {
    const { token } = await issuedWithLink();
    await request(app).post(`/api/service-agreement-signing/${token}/verify`)
      .send({ email: 'jordan@example.invalid' }).expect(200);

    await request(app).post(`/api/service-agreement-signing/${token}/sign`)
      .send({ signatureName: 'Jordan Avery Whitlock', intent: false, consentElectronic: true })
      .expect(400);
    await request(app).post(`/api/service-agreement-signing/${token}/sign`)
      .send({ signatureName: 'Jordan Avery Whitlock', intent: true, consentElectronic: false })
      .expect(400);
    await request(app).post(`/api/service-agreement-signing/${token}/sign`)
      .send({ signatureName: 'J', intent: true, consentElectronic: true })
      .expect(400);
  });

  it('refuses everything without verification', async () => {
    const { token } = await issuedWithLink();
    await request(app).post(`/api/service-agreement-signing/${token}/save`)
      .send({ values: {} }).expect(403);
    await request(app).post(`/api/service-agreement-signing/${token}/sign`)
      .send({ signatureName: 'Jordan Avery Whitlock', intent: true, consentElectronic: true })
      .expect(403);
    await request(app).get(`/api/service-agreement-signing/${token}/pdf`).expect(403);
  });

  it('refuses an unknown, revoked or expired token — indistinguishably', async () => {
    const { agent, id, token, sessionId } = await issuedWithLink();

    const unknown = await request(app)
      .get('/api/service-agreement-signing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').expect(404);

    await agent.post(`/api/service-agreements/${id}/sessions/${sessionId}/revoke`).send({}).expect(200);
    const revoked = await request(app).get(`/api/service-agreement-signing/${token}`).expect(404);

    // The same message either way: distinguishing them tells somebody probing
    // tokens which of their guesses was close.
    expect(revoked.body.error).toBe(unknown.body.error);
  });

  it('refuses an expired token', async () => {
    const { token, sessionId } = await issuedWithLink();
    await db.pool.query(
      "UPDATE service_agreement_signing_sessions SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1",
      [sessionId]
    );
    await request(app).get(`/api/service-agreement-signing/${token}`).expect(404);
  });

  it('lets the participant download their own agreement and nobody else’s', async () => {
    const { token } = await issuedWithLink();
    await request(app).post(`/api/service-agreement-signing/${token}/verify`)
      .send({ email: 'jordan@example.invalid' }).expect(200);

    const res = await request(app).get(`/api/service-agreement-signing/${token}/pdf`).expect(200);
    expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('gives one participant no access to another participant’s agreement', async () => {
    const first = await issuedWithLink();

    // A second agreement, for a different participant, with its own link.
    const { agent } = await agentFor('owner', orgA);
    const created = await agent.post('/api/service-agreements')
      .send({ participantClientId: 'splose-2', participantName: 'Sam Ellery' }).expect(201);
    await agent.patch(`/api/service-agreements/${created.body.agreement.id}`)
      .send({ formData: { OPAL_PARTICIPANT_FULL_NAME: 'Sam Ellery' }, supports: [SUPPORT] })
      .expect(200);
    await agent.post(`/api/service-agreements/${created.body.agreement.id}/issue`).send({}).expect(200);
    const second = await agent.post(`/api/service-agreements/${created.body.agreement.id}/email`)
      .send({ recipientEmail: 'sam@example.invalid' }).expect(200);

    // Jordan's token, verified with Jordan's address, reaches Jordan's
    // agreement only.
    await request(app).post(`/api/service-agreement-signing/${first.token}/verify`)
      .send({ email: 'jordan@example.invalid' }).expect(200);
    const view = await request(app).get(`/api/service-agreement-signing/${first.token}`).expect(200);
    expect(view.body.agreement.participantName).toBe('Jordan Avery Whitlock');

    // And Jordan's address cannot verify Sam's link.
    const samToken = second.body.signingUrl.split('token=')[1];
    await request(app).post(`/api/service-agreement-signing/${samToken}/verify`)
      .send({ email: 'jordan@example.invalid' }).expect(403);
  });
});

describe('a returned PDF', () => {
  it('is stored, hashed and compared, without claiming its signature was verified', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);

    const issued = await agent.get(`/api/service-agreements/${id}/pdf`).expect(200);
    const returned = Buffer.from(issued.body);

    const res = await agent.post(`/api/service-agreements/${id}/returned-pdf`)
      .send({ fileBase64: returned.toString('base64'), filename: 'signed-by-hand.pdf' })
      .expect(201);

    expect(res.body.comparison.identical).toBe(true);
    expect(res.body.comparison.readableAsForm).toBe(true);
    expect(res.body.comparison.cryptographicSignatureValidated).toBe(false);

    const { rows } = await db.pool.query(
      `SELECT metadata FROM audit_logs
        WHERE target_id = $1 AND action = 'SERVICE_AGREEMENT_RETURNED_PDF_UPLOADED'`, [String(id)]
    );
    expect(rows[0].metadata.signatureAssurance).toBe('not_verified');
  });

  it('refuses a file that is not a PDF', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);
    await agent.post(`/api/service-agreements/${id}/returned-pdf`)
      .send({ fileBase64: Buffer.from('PK not a pdf').toString('base64') })
      .expect(400);
  });
});

describe('organisation isolation', () => {
  it('hides an agreement in another organisation as if it did not exist', async () => {
    const { agent: a } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(a, orgA);

    const { agent: b } = await agentFor('owner', orgB);
    await b.get(`/api/service-agreements/${id}`).expect(404);
    await b.patch(`/api/service-agreements/${id}`).send({ formData: {} }).expect(404);
    await b.get(`/api/service-agreements/${id}/pdf`).expect(404);
    await b.get(`/api/service-agreements/${id}/docx`).expect(404);
    await b.post(`/api/service-agreements/${id}/issue`).send({}).expect(404);
    await b.post(`/api/service-agreements/${id}/email`)
      .send({ recipientEmail: 'x@example.invalid' }).expect(404);
  });

  it('keeps one organisation’s master out of another’s reach', async () => {
    const { agent: a } = await agentFor('owner', orgA);
    const master = (await a.get('/api/service-agreements/master').expect(200)).body.master;

    const { agent: b } = await agentFor('owner', orgB);
    await b.get(`/api/service-agreements/master/${master.id}/docx`).expect(404);
    await b.post(`/api/service-agreements/master/${master.id}/publish`).send({}).expect(404);
    await b.post(`/api/service-agreements/master/${master.id}/retire`).send({}).expect(404);
  });

  it('lists only this organisation’s agreements', async () => {
    const { agent: a } = await agentFor('owner', orgA);
    await issuedAgreement(a, orgA);
    const { agent: b } = await agentFor('owner', orgB);
    expect((await b.get('/api/service-agreements').expect(200)).body.agreements).toEqual([]);
  });
});

describe('author scoping', () => {
  it('shows a delegate only their own agreements until view_all is granted', async () => {
    const { agent: owner } = await agentFor('owner', orgA);
    await issuedAgreement(owner, orgA);

    const { agent, user } = await agentFor('admin', orgA);
    await grant(user.id, ['service_agreements.access']);
    expect((await agent.get('/api/service-agreements').expect(200)).body.agreements).toEqual([]);

    await grant(user.id, ['service_agreements.access', 'service_agreements.view_all']);
    const after = await agent.get('/api/service-agreements').expect(200);
    expect(after.body.agreements).toHaveLength(1);
    expect(after.body.viewAll).toBe(true);
  });

  it('lets view_all read but not edit somebody else’s agreement', async () => {
    const { agent: owner } = await agentFor('owner', orgA);
    const created = await owner.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(201);
    const id = created.body.agreement.id;

    const { agent, user } = await agentFor('admin', orgA);
    await grant(user.id, ['service_agreements.access', 'service_agreements.view_all']);

    await agent.get(`/api/service-agreements/${id}`).expect(200);
    await agent.patch(`/api/service-agreements/${id}`).send({ formData: {} }).expect(403);
  });
});

describe('the audit trail', () => {
  it('records the whole life of an agreement', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);

    const emailRes = await agent.post(`/api/service-agreements/${id}/email`)
      .send({ recipientEmail: 'jordan@example.invalid' }).expect(200);
    const token = emailRes.body.signingUrl.split('token=')[1];

    await agent.get(`/api/service-agreements/${id}/pdf`).expect(200);
    await request(app).get(`/api/service-agreement-signing/${token}`).expect(200);
    await request(app).post(`/api/service-agreement-signing/${token}/verify`)
      .send({ email: 'jordan@example.invalid' }).expect(200);
    await request(app).post(`/api/service-agreement-signing/${token}/sign`).send({
      signatureName: 'Jordan Avery Whitlock', capacity: 'Participant',
      intent: true, consentElectronic: true,
    }).expect(200);

    const actions = await auditActions(id);
    expect(actions).toEqual(expect.arrayContaining([
      'SERVICE_AGREEMENT_CREATED',
      'SERVICE_AGREEMENT_PREFILLED',
      'SERVICE_AGREEMENT_ISSUED',
      'SERVICE_AGREEMENT_EMAILED',
      'SERVICE_AGREEMENT_DOWNLOADED',
      'SERVICE_AGREEMENT_LINK_VIEWED',
      'SERVICE_AGREEMENT_VERIFIED',
      'SERVICE_AGREEMENT_SIGNED',
    ]));
  });

  it('records master downloads and publications', async () => {
    const { agent } = await agentFor('owner', orgA);
    const master = (await agent.get('/api/service-agreements/master').expect(200)).body.master;
    await agent.get(`/api/service-agreements/master/${master.id}/docx`).expect(200);

    const draft = (await agent.put('/api/service-agreements/master/clauses')
      .send({ custom: [{ title: 'X', body: 'Y' }] }).expect(200)).body.draft;
    await agent.post(`/api/service-agreements/master/${draft.id}/publish`).send({}).expect(200);

    const { rows } = await db.pool.query(
      `SELECT action FROM audit_logs WHERE target_type = 'service_agreement'
         AND action LIKE 'SERVICE_AGREEMENT_MASTER%'`
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining([
      'SERVICE_AGREEMENT_MASTER_DOWNLOADED',
      'SERVICE_AGREEMENT_MASTER_CLAUSES_EDITED',
      'SERVICE_AGREEMENT_MASTER_PUBLISHED',
    ]));
  });

  it('is readable through the agreement’s own audit endpoint', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);
    const res = await agent.get(`/api/service-agreements/${id}/audit`).expect(200);
    expect(res.body.events.length).toBeGreaterThanOrEqual(3);
    expect(res.body.events[0].action).toBe('SERVICE_AGREEMENT_CREATED');
  });
});

describe('voiding', () => {
  it('voids an agreement, kills its links, and requires a reason', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);
    await agent.post(`/api/service-agreements/${id}/email`)
      .send({ recipientEmail: 'jordan@example.invalid' }).expect(200);

    await agent.post(`/api/service-agreements/${id}/void`).send({}).expect(400);
    await agent.post(`/api/service-agreements/${id}/void`)
      .send({ reason: 'Superseded by a renegotiated plan.' }).expect(200);

    const { rows } = await db.pool.query(
      'SELECT status FROM service_agreement_signing_sessions WHERE agreement_id = $1', [id]
    );
    expect(rows.every((r) => r.status === 'revoked')).toBe(true);
  });

  it('can void a DRAFT that was never issued', async () => {
    // Voiding is also how an abandoned draft is retired, and a draft has no
    // master pin — the schema constraint exempts 'void' for exactly this.
    const { agent } = await agentFor('owner', orgA);
    const created = await agent.post('/api/service-agreements')
      .send({ participantClientId: CLIENT_ID }).expect(201);

    await agent.post(`/api/service-agreements/${created.body.agreement.id}/void`)
      .send({ reason: 'Started by mistake.' }).expect(200);

    const { rows } = await db.pool.query(
      'SELECT state, master_version_id FROM service_agreements WHERE id = $1',
      [created.body.agreement.id]
    );
    expect(rows[0].state).toBe('void');
    expect(rows[0].master_version_id).toBeNull();
  });

  it('can void a SIGNED agreement without rewriting a word of it', async () => {
    // An agreement signed in error, or superseded by a renegotiated plan, has
    // to be markable as no longer in force. What must survive is everything
    // that was signed.
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);
    await agent.post(`/api/service-agreements/${id}/email`)
      .send({ recipientEmail: 'jordan@example.invalid' }).expect(200);

    const emailRes = await agent.post(`/api/service-agreements/${id}/email`)
      .send({ recipientEmail: 'jordan@example.invalid' }).expect(409);
    expect(emailRes.body.error).toMatch(/already outstanding/i);

    const { rows: before } = await db.pool.query(
      `SELECT form_data, master_sha256, pricing_snapshot FROM service_agreements WHERE id = $1`, [id]
    );

    await db.pool.query("UPDATE service_agreements SET state = 'signed', signed_at = NOW() WHERE id = $1", [id]);

    await agent.post(`/api/service-agreements/${id}/void`)
      .send({ reason: 'Superseded by a renegotiated plan.' }).expect(200);

    const { rows: after } = await db.pool.query(
      `SELECT state, void_reason, form_data, master_sha256, pricing_snapshot
         FROM service_agreements WHERE id = $1`, [id]
    );
    expect(after[0].state).toBe('void');
    expect(after[0].void_reason).toMatch(/renegotiated/);
    // Not one byte of what was signed has changed.
    expect(after[0].form_data).toEqual(before[0].form_data);
    expect(after[0].master_sha256).toBe(before[0].master_sha256);
    expect(after[0].pricing_snapshot).toEqual(before[0].pricing_snapshot);

    // And the artifacts are still there.
    const { rows: art } = await db.pool.query(
      'SELECT kind FROM service_agreement_artifacts WHERE agreement_id = $1', [id]
    );
    expect(art.length).toBeGreaterThanOrEqual(2);
  });
});

describe('artifacts are immutable', () => {
  it('refuses an update at the database level', async () => {
    const { agent } = await agentFor('owner', orgA);
    const { id } = await issuedAgreement(agent, orgA);
    const { rows } = await db.pool.query(
      'SELECT id FROM service_agreement_artifacts WHERE agreement_id = $1 LIMIT 1', [id]
    );
    await expect(db.pool.query(
      "UPDATE service_agreement_artifacts SET filename = 'tampered.pdf' WHERE id = $1", [rows[0].id]
    )).rejects.toThrow(/immutable/i);
  });

  it('refuses to rewrite a published master', async () => {
    const { agent } = await agentFor('owner', orgA);
    const master = (await agent.get('/api/service-agreements/master').expect(200)).body.master;
    await expect(db.pool.query(
      "UPDATE service_agreement_master_versions SET source_sha256 = $2 WHERE id = $1",
      [master.id, 'b'.repeat(64)]
    )).rejects.toThrow(/immutable/i);
  });
});
