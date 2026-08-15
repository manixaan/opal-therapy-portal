'use strict';

/**
 * FCA REPORT GENERATION — integration tests (real Express, real sessions,
 * real SQL, real DOCX bytes).
 *
 * Splose is the one thing stubbed: it is an external system, and the tests must
 * be able to assert exactly what the "live" layer returned for each client.
 * Everything else — routing, RBAC, org isolation, the profile layer, plan
 * versioning, generation, storage and audit — runs for real.
 *
 * Covers the acceptance items that only exist above the engine: required
 * sections undeselectable through the API, missing data flagged not fabricated,
 * preview and document sharing one manifest, audit capturing client/therapist/
 * user/template version, plus the profile-layer requirements: ORGANISATION
 * ISOLATION, CROSS-CLIENT LEAKAGE, precedence with correct sources, PLAN
 * VERSIONING, and save-back being explicit, field-scoped and never implicit.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const JSZip = require('jszip');

// Splose is stubbed before the route module loads. The state object is declared
// out here (jest allows out-of-scope names prefixed "mock") so the tests can
// drive it — a factory-local closure would be unreachable from the test body.
const mockSplose = { patients: new Map(), fail: false };

jest.mock('../../splose-api', () => ({
  getPatients: jest.fn(async () => {
    if (mockSplose.fail) throw new Error('splose down');
    return [...mockSplose.patients.values()];
  }),
  getPatient: jest.fn(async (id) => {
    if (mockSplose.fail) throw new Error('splose down');
    const p = mockSplose.patients.get(String(id));
    if (!p) { const e = new Error('not found'); e.response = { status: 404 }; throw e; }
    return p;
  }),
}));

const setPatients = (list) => {
  mockSplose.patients.clear();
  for (const p of list) mockSplose.patients.set(String(p.id), p);
};
const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const tm = require('../../fca/template-map');

const PASSWORD = 'FcaPass123';

const CLIENT_X = {
  id: 'splose-x', firstname: 'Xavier', lastname: 'Ex', fullName: 'Xavier Ex',
  email: 'x@example.invalid', mobilePhone: '0400 111 111', ndisNumber: '431111111',
  formattedAddress: '1 X St, Perth WA 6000',
};
const CLIENT_Y = {
  id: 'splose-y', firstname: 'Yvonne', lastname: 'Why', fullName: 'Yvonne Why',
  email: 'y@example.invalid', mobilePhone: '0400 222 222', ndisNumber: '432222222',
  formattedAddress: '2 Y St, Perth WA 6000',
};

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '8mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET, resave: false,
    saveUninitialized: false, cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../fca-routes'));
  return app;
}

let app;

/**
 * seedUser() only writes the columns it declares, so organisation membership
 * and the assessor's own contact details are applied here — this feature is
 * organisation-scoped and reads therapist facts off the user row.
 */
async function agentFor(role, { organisation_id = null, name = null, phone = null } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role });

  const { rows } = await db.pool.query(
    `UPDATE users SET organisation_id = $2,
            name = COALESCE($3, name), phone = COALESCE($4, phone)
      WHERE id = $1 RETURNING *`,
    [user.id, organisation_id, name, phone]
  );

  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user: rows[0] };
}

async function createDraft(agent, clientId) {
  const res = await agent.post('/api/fca/drafts').send({ clientId });
  expect(res.status).toBe(201);
  return res.body.draft;
}

beforeAll(() => { app = buildApp(); });

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit?.();
  mockSplose.fail = false;
  setPatients([CLIENT_X, CLIENT_Y]);
});

afterAll(closePool);

// ═══════════════════════════════════════════════════════════════════════════
//  Access control
// ═══════════════════════════════════════════════════════════════════════════

describe('access control', () => {
  test('unauthenticated requests are refused', async () => {
    const res = await request(app).get('/api/fca/template');
    expect([401, 403]).toContain(res.status);
  });

  test('admin — a non-clinical scheduling role here — has no access at all', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('admin', { organisation_id: org.id });

    expect((await agent.get('/api/fca/template')).status).toBe(403);
    expect((await agent.get('/api/fca/clients')).status).toBe(403);
    expect((await agent.post('/api/fca/drafts').send({ clientId: CLIENT_X.id })).status).toBe(403);
  });

  test('read_only can read the template but cannot create or generate', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('read_only', { organisation_id: org.id });

    expect((await agent.get('/api/fca/template')).status).toBe(200);
    expect((await agent.post('/api/fca/drafts').send({ clientId: CLIENT_X.id })).status).toBe(403);
    expect((await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({ pronouns: 'she/her' })).status).toBe(403);
  });

  test('a draft is own-only — not even an owner reads another user\'s draft', async () => {
    const org = await seedOrganisation('Org A');
    const { agent: therapist } = await agentFor('therapist', { organisation_id: org.id });
    const { agent: owner } = await agentFor('owner', { organisation_id: org.id });

    const draft = await createDraft(therapist, CLIENT_X.id);

    expect((await owner.get(`/api/fca/drafts/${draft.id}`)).status).toBe(404);
    expect((await owner.patch(`/api/fca/drafts/${draft.id}`).send({ selectedSections: [] })).status).toBe(404);
    expect((await owner.post(`/api/fca/drafts/${draft.id}/generate`)).status).toBe(404);
    expect((await owner.get('/api/fca/drafts')).body.drafts).toHaveLength(0);
  });

  test('a user with no organisation is refused', async () => {
    const { agent } = await agentFor('therapist', { organisation_id: null });
    expect((await agent.get('/api/fca/template')).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Organisation isolation
// ═══════════════════════════════════════════════════════════════════════════

describe('organisation isolation', () => {
  test('org A cannot read, overwrite or see org B\'s client profile', async () => {
    const orgA = await seedOrganisation('Org A');
    const orgB = await seedOrganisation('Org B');
    const { agent: a } = await agentFor('therapist', { organisation_id: orgA.id });
    const { agent: b } = await agentFor('therapist', { organisation_id: orgB.id });

    // B records durable facts for the same Splose client.
    const put = await b.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({
      preferredName: 'B-ONLY-NAME',
      primaryDisability: 'B-ONLY-DISABILITY',
      currentPlan: { planStart: '2026-01-01', planEnd: '2026-12-31', goals: ['B-ONLY-GOAL'] },
    });
    expect(put.status).toBe(200);

    // A sees nothing of it — not a 403, which would confirm it exists.
    const read = await a.get(`/api/fca/clients/${CLIENT_X.id}/profile`);
    expect(read.status).toBe(200);
    expect(read.body.profile).toBeNull();
    expect(read.body.plans).toEqual([]);
    expect(JSON.stringify(read.body)).not.toContain('B-ONLY');

    // A writing its own profile does not touch B's row.
    await a.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({ preferredName: 'A-ONLY-NAME' });
    const bAgain = await b.get(`/api/fca/clients/${CLIENT_X.id}/profile`);
    expect(bAgain.body.profile.preferredName).toBe('B-ONLY-NAME');
    expect(bAgain.body.profile.primaryDisability).toBe('B-ONLY-DISABILITY');

    const rows = await db.pool.query('SELECT organisation_id, preferred_name FROM fca_client_profiles ORDER BY preferred_name');
    expect(rows.rows).toHaveLength(2); // two orgs, two independent profiles
  });

  test('org A cannot read or save back to a draft in org B', async () => {
    const orgA = await seedOrganisation('Org A');
    const orgB = await seedOrganisation('Org B');
    const { agent: a } = await agentFor('therapist', { organisation_id: orgA.id });
    const { agent: b } = await agentFor('therapist', { organisation_id: orgB.id });

    const draftB = await createDraft(b, CLIENT_X.id);

    expect((await a.get(`/api/fca/drafts/${draftB.id}`)).status).toBe(404);
    expect((await a.patch(`/api/fca/drafts/${draftB.id}`).send({ selectedSections: [] })).status).toBe(404);
    expect((await a.post(`/api/fca/drafts/${draftB.id}/save-to-profile`).send({ fields: ['OPAL_CLIENT_PRONOUNS'] })).status).toBe(404);
    expect((await a.delete(`/api/fca/drafts/${draftB.id}`)).status).toBe(404);
  });

  test('a generated document cannot be downloaded across organisations', async () => {
    const orgA = await seedOrganisation('Org A');
    const orgB = await seedOrganisation('Org B');
    const { agent: a } = await agentFor('therapist', { organisation_id: orgA.id });
    const { agent: b } = await agentFor('therapist', { organisation_id: orgB.id });

    const draftB = await createDraft(b, CLIENT_X.id);
    const gen = await b.post(`/api/fca/drafts/${draftB.id}/generate`);
    expect(gen.status).toBe(200);

    expect((await a.get(`/api/fca/documents/${gen.body.documentId}/download`)).status).toBe(404);
    expect((await b.get(`/api/fca/documents/${gen.body.documentId}/download`)).status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Cross-client leakage
// ═══════════════════════════════════════════════════════════════════════════

describe('cross-client leakage', () => {
  test('client X\'s profile never appears in a draft for client Y', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({
      preferredName: 'XPREF', pronouns: 'xe/xem', primaryDisability: 'XDISABILITY',
      nomineeDetails: 'XNOMINEE',
      currentPlan: { planStart: '2026-01-01', planEnd: '2026-12-31', goals: ['XGOAL1', 'XGOAL2'] },
    });

    const draftY = await createDraft(agent, CLIENT_Y.id);
    const body = JSON.stringify(draftY);
    for (const leak of ['XPREF', 'xe/xem', 'XDISABILITY', 'XNOMINEE', 'XGOAL1', 'XGOAL2', CLIENT_X.ndisNumber]) {
      expect(body).not.toContain(leak);
    }
    expect(draftY.manifest.scalarData.OPAL_CLIENT_FULL_NAME).toBe('Yvonne Why');
    expect(draftY.manifest.scalarSources.OPAL_CLIENT_PREFERRED_NAME).toBe('missing');
  });

  test('generated documents for two clients never share data', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({ preferredName: 'XPREF' });
    await agent.put(`/api/fca/clients/${CLIENT_Y.id}/profile`).send({ preferredName: 'YPREF' });

    const dx = await createDraft(agent, CLIENT_X.id);
    const dy = await createDraft(agent, CLIENT_Y.id);
    const gx = await agent.post(`/api/fca/drafts/${dx.id}/generate`);
    const gy = await agent.post(`/api/fca/drafts/${dy.id}/generate`);

    const readDoc = async (documentId) => {
      const res = await agent.get(`/api/fca/documents/${documentId}/download`).buffer().parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      const zip = await JSZip.loadAsync(res.body);
      return {
        body: await zip.file('word/document.xml').async('string'),
        header: await zip.file('word/header6.xml').async('string'),
      };
    };

    const docX = await readDoc(gx.body.documentId);
    const docY = await readDoc(gy.body.documentId);

    expect(docX.body).toContain('Xavier Ex');
    expect(docX.header).toContain('XPREF');
    expect(docY.body).toContain('Yvonne Why');
    expect(docY.header).toContain('YPREF');

    expect(docY.body).not.toContain('Xavier Ex');
    expect(docY.body).not.toContain(CLIENT_X.ndisNumber);
    expect(docY.header).not.toContain('XPREF');
    expect(docX.body).not.toContain('Yvonne Why');
    expect(docX.header).not.toContain('YPREF');
  });

  test('a save-back for client X does not reach client Y', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const dx = await createDraft(agent, CLIENT_X.id);
    await agent.patch(`/api/fca/drafts/${dx.id}`).send({
      scalarOverrides: { OPAL_CLIENT_PRONOUNS: 'xe/xem', OPAL_CLIENT_PRIMARY_DISABILITY: 'XDISABILITY' },
    });
    const saved = await agent.post(`/api/fca/drafts/${dx.id}/save-to-profile`)
      .send({ fields: ['OPAL_CLIENT_PRONOUNS', 'OPAL_CLIENT_PRIMARY_DISABILITY'] });
    expect(saved.status).toBe(200);
    expect(saved.body.savedFields.sort()).toEqual(['OPAL_CLIENT_PRIMARY_DISABILITY', 'OPAL_CLIENT_PRONOUNS']);

    const yProfile = await agent.get(`/api/fca/clients/${CLIENT_Y.id}/profile`);
    expect(yProfile.body.profile).toBeNull();

    const dy = await createDraft(agent, CLIENT_Y.id);
    expect(JSON.stringify(dy)).not.toContain('xe/xem');
    expect(JSON.stringify(dy)).not.toContain('XDISABILITY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Precedence, end to end
// ═══════════════════════════════════════════════════════════════════════════

describe('four-layer precedence through the API', () => {
  test('each layer reports the correct source', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', {
      organisation_id: org.id, name: 'Sam Therapist', phone: '08 9000 0000',
    });

    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({
      preferredName: 'Xav', pronouns: 'xe/xem',
      currentPlan: { planStart: '2026-02-01', planEnd: '2026-11-30', goals: ['Goal one', 'Goal two'] },
    });

    const draft = await createDraft(agent, CLIENT_X.id);
    const patched = await agent.patch(`/api/fca/drafts/${draft.id}`).send({
      scalarOverrides: { OPAL_REPORT_REVIEWER_NAME: 'Dr Reviewer' },
    });
    const { scalarData, scalarSources } = patched.body.draft.manifest;

    // 1. Splose
    expect(scalarSources.OPAL_CLIENT_FULL_NAME).toBe('splose');
    expect(scalarData.OPAL_CLIENT_FULL_NAME).toBe('Xavier Ex');
    // 2. Client profile
    expect(scalarSources.OPAL_CLIENT_PREFERRED_NAME).toBe('client_profile');
    expect(scalarData.OPAL_CLIENT_NDIS_GOAL_1).toBe('Goal one');
    expect(scalarData.OPAL_CLIENT_NDIS_PLAN_START).toBe('01/02/2026');
    // 3. Report override
    expect(scalarSources.OPAL_REPORT_REVIEWER_NAME).toBe('report_override');
    // Portal
    expect(scalarSources.OPAL_THERAPIST_FULL_NAME).toBe('portal');
    expect(scalarData.OPAL_THERAPIST_FULL_NAME).toBe('Sam Therapist');
    // Missing, flagged not fabricated
    expect(scalarSources.OPAL_CLIENT_NOMINEE_DETAILS).toBe('missing');
    expect(scalarData.OPAL_CLIENT_NOMINEE_DETAILS).toBeNull();
    expect(patched.body.draft.missingFields).toContain('OPAL_CLIENT_NOMINEE_DETAILS');
  });

  test('the snapshot is frozen at generate and never re-resolved', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({ preferredName: 'BeforeName' });
    const draft = await createDraft(agent, CLIENT_X.id);
    const gen = await agent.post(`/api/fca/drafts/${draft.id}/generate`);
    expect(gen.status).toBe(200);

    // Both layers change after the fact.
    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({ preferredName: 'AfterName' });
    setPatients([{ ...CLIENT_X, fullName: 'Renamed Person' }, CLIENT_Y]);

    const after = await agent.get(`/api/fca/drafts/${draft.id}`);
    expect(after.body.draft.manifest.scalarData.OPAL_CLIENT_PREFERRED_NAME).toBe('BeforeName');
    expect(after.body.draft.manifest.scalarData.OPAL_CLIENT_FULL_NAME).toBe('Xavier Ex');

    // And the stored bytes still say what they said when it was issued.
    const dl = await agent.get(`/api/fca/documents/${gen.body.documentId}/download`)
      .buffer().parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const zip = await JSZip.loadAsync(dl.body);
    const body = await zip.file('word/document.xml').async('string');
    expect(body).toContain('Xavier Ex');
    expect(body).not.toContain('Renamed Person');
  });

  test('the document-control fields are ISSUED at creation, not at generate', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    // Straight off POST /drafts — before any PATCH, before any generate.
    const draft = await createDraft(agent, CLIENT_X.id);
    const { scalarData, scalarSources } = draft.manifest;

    expect(scalarData.OPAL_REPORT_DOCUMENT_ID).toBe(`FCA-${draft.id.slice(0, 8).toUpperCase()}`);
    expect(scalarData.OPAL_REPORT_DATE).toMatch(/^\d{2}\/\d{2}\/\d{4}$/); // dd/mm/yyyy
    expect(scalarData.OPAL_REPORT_VERSION).toBe('1.0');
    expect(scalarData.OPAL_REPORT_STATUS).toBe('Draft');

    for (const tag of tm.SERVER_TAGS) {
      expect([tag, scalarSources[tag]]).toEqual([tag, 'server']);
      expect(draft.missingFields).not.toContain(tag);
    }

    // Persisted, so it is a fact about the row rather than a recomputation.
    const row = await db.pool.query(
      'SELECT document_control FROM fca_report_drafts WHERE id = $1', [draft.id]
    );
    expect(row.rows[0].document_control.documentReference).toBe(scalarData.OPAL_REPORT_DOCUMENT_ID);
  });

  test('Opal issues only what is Opal\'s to issue — reviewer and recipients stay missing', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, CLIENT_X.id);

    for (const tag of [
      'OPAL_REPORT_ISSUE_DATE',
      'OPAL_REPORT_REVIEWER_NAME',
      'OPAL_REPORT_REVIEWER_ROLE',
      'OPAL_REPORT_AUTHORISED_RECIPIENTS',
    ]) {
      expect([tag, draft.manifest.scalarData[tag]]).toEqual([tag, null]);
      expect([tag, draft.manifest.scalarSources[tag]]).toEqual([tag, 'missing']);
      expect(draft.missingFields).toContain(tag);
    }
  });

  test('an override beats the issued default, and the Document ID is stable', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, CLIENT_X.id);
    const issuedId = draft.manifest.scalarData.OPAL_REPORT_DOCUMENT_ID;

    const patched = await agent.patch(`/api/fca/drafts/${draft.id}`).send({
      scalarOverrides: { OPAL_REPORT_VERSION: '2.0', OPAL_REPORT_STATUS: 'Final' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.draft.manifest.scalarData.OPAL_REPORT_VERSION).toBe('2.0');
    expect(patched.body.draft.manifest.scalarSources.OPAL_REPORT_VERSION).toBe('report_override');
    expect(patched.body.draft.manifest.scalarData.OPAL_REPORT_STATUS).toBe('Final');
    // The id the therapist read in review is the id that ships.
    expect(patched.body.draft.manifest.scalarData.OPAL_REPORT_DOCUMENT_ID).toBe(issuedId);

    const gen = await agent.post(`/api/fca/drafts/${draft.id}/generate`);
    expect(gen.status).toBe(200);
    const after = await agent.get(`/api/fca/drafts/${draft.id}`);
    expect(after.body.draft.manifest.scalarData.OPAL_REPORT_DOCUMENT_ID).toBe(issuedId);
    expect(after.body.draft.manifest.scalarData.OPAL_REPORT_VERSION).toBe('2.0');
  });

  test('Splose being down is reported honestly, never fabricated', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    mockSplose.fail = true;
    const list = await agent.get('/api/fca/clients');
    expect(list.status).toBe(503);
    expect(list.body.error).toBe('splose_unavailable');
    expect(list.body.clients).toBeUndefined();

    const create = await agent.post('/api/fca/drafts').send({ clientId: CLIENT_X.id });
    expect(create.status).toBe(503);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Plan versioning
// ═══════════════════════════════════════════════════════════════════════════

describe('NDIS plan versioning', () => {
  test('superseding retains the old plan dates and its goals', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({
      currentPlan: { planStart: '2025-01-01', planEnd: '2025-12-31', goals: ['Old goal A', 'Old goal B'] },
    });
    const second = await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({
      currentPlan: { planStart: '2026-01-01', planEnd: '2026-12-31', goals: ['New goal A'] },
    });
    expect(second.status).toBe(200);

    const plans = second.body.plans;
    expect(plans).toHaveLength(2);

    const current = plans.find((p) => p.isCurrent);
    const old = plans.find((p) => !p.isCurrent);

    expect(current.goals.map((g) => g.goalText)).toEqual(['New goal A']);
    expect(String(current.planStart)).toContain('2026-01-01');

    // The old plan was superseded, not overwritten.
    expect(String(old.planStart)).toContain('2025-01-01');
    expect(String(old.planEnd)).toContain('2025-12-31');
    expect(old.goals.map((g) => g.goalText)).toEqual(['Old goal A', 'Old goal B']);

    // One current plan per profile, enforced by a partial unique index.
    const rows = await db.pool.query(
      'SELECT count(*)::int AS n FROM fca_client_ndis_plans WHERE is_current');
    expect(rows.rows[0].n).toBe(1);
  });

  test('only the current plan feeds the report', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({
      currentPlan: { planStart: '2025-01-01', planEnd: '2025-12-31', goals: ['Old goal A'] },
    });
    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({
      currentPlan: { planStart: '2026-01-01', planEnd: '2026-12-31', goals: ['New goal A', 'New goal B'] },
    });

    const draft = await createDraft(agent, CLIENT_X.id);
    const { scalarData } = draft.manifest;
    expect(scalarData.OPAL_CLIENT_NDIS_PLAN_START).toBe('01/01/2026');
    expect(scalarData.OPAL_CLIENT_NDIS_GOAL_1).toBe('New goal A');
    expect(scalarData.OPAL_CLIENT_NDIS_GOAL_2).toBe('New goal B');
    expect(JSON.stringify(scalarData)).not.toContain('Old goal A');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Save-back
// ═══════════════════════════════════════════════════════════════════════════

describe('save-to-profile', () => {
  test('writes only profile-eligible fields', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await createDraft(agent, CLIENT_X.id);
    await agent.patch(`/api/fca/drafts/${draft.id}`).send({
      scalarOverrides: {
        OPAL_CLIENT_PRONOUNS: 'xe/xem',
        OPAL_CLIENT_PRIMARY_DISABILITY: 'Multiple sclerosis',
      },
    });

    const res = await agent.post(`/api/fca/drafts/${draft.id}/save-to-profile`)
      .send({ fields: ['OPAL_CLIENT_PRONOUNS', 'OPAL_CLIENT_PRIMARY_DISABILITY'] });

    expect(res.status).toBe(200);
    expect(res.body.savedFields.sort()).toEqual(['OPAL_CLIENT_PRIMARY_DISABILITY', 'OPAL_CLIENT_PRONOUNS']);
    expect(res.body.profile.pronouns).toBe('xe/xem');
    expect(res.body.profile.primaryDisability).toBe('Multiple sclerosis');
  });

  test('rejects report-specific fields and writes NOTHING', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await createDraft(agent, CLIENT_X.id);
    await agent.patch(`/api/fca/drafts/${draft.id}`).send({
      scalarOverrides: {
        OPAL_CLIENT_PRONOUNS: 'xe/xem',
        OPAL_REPORT_REVIEWER_NAME: 'Dr Reviewer',
        OPAL_REPORT_AUTHORISED_RECIPIENTS: 'Plan manager',
      },
    });

    const res = await agent.post(`/api/fca/drafts/${draft.id}/save-to-profile`).send({
      fields: ['OPAL_CLIENT_PRONOUNS', 'OPAL_REPORT_REVIEWER_NAME', 'OPAL_REPORT_AUTHORISED_RECIPIENTS'],
    });

    expect(res.status).toBe(400);
    expect(res.body.savedFields).toEqual([]);
    expect(res.body.rejected.map((r) => r.tag).sort())
      .toEqual(['OPAL_REPORT_AUTHORISED_RECIPIENTS', 'OPAL_REPORT_REVIEWER_NAME']);
    for (const r of res.body.rejected) expect(r.reason).toBe('report_specific');

    // The eligible field in the same request was NOT written either.
    const profile = await agent.get(`/api/fca/clients/${CLIENT_X.id}/profile`);
    expect(profile.body.profile).toBeNull();
    const rows = await db.pool.query('SELECT count(*)::int AS n FROM fca_client_profiles');
    expect(rows.rows[0].n).toBe(0);
  });

  test('rejects Splose-authoritative and server-issued fields with the right reason', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, CLIENT_X.id);

    const res = await agent.post(`/api/fca/drafts/${draft.id}/save-to-profile`).send({
      fields: ['OPAL_CLIENT_FULL_NAME', 'OPAL_REPORT_DOCUMENT_ID', 'OPAL_THERAPIST_FULL_NAME', 'NOT_A_TAG'],
    });

    expect(res.status).toBe(400);
    expect(res.body.savedFields).toEqual([]);
    const byTag = Object.fromEntries(res.body.rejected.map((r) => [r.tag, r.reason]));
    expect(byTag.OPAL_CLIENT_FULL_NAME).toBe('splose_authoritative');
    expect(byTag.OPAL_REPORT_DOCUMENT_ID).toBe('server_issued');
    expect(byTag.OPAL_THERAPIST_FULL_NAME).toBe('not_client_data');
    expect(byTag.NOT_A_TAG).toBe('unknown_tag');
  });

  test('plan and goal fields create a NEW plan version, keeping the old one', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({
      currentPlan: { planStart: '2025-01-01', planEnd: '2025-12-31', goals: ['Original goal'] },
    });

    const draft = await createDraft(agent, CLIENT_X.id);
    await agent.patch(`/api/fca/drafts/${draft.id}`).send({
      scalarOverrides: { OPAL_CLIENT_NDIS_GOAL_1: 'Revised goal' },
    });

    const res = await agent.post(`/api/fca/drafts/${draft.id}/save-to-profile`)
      .send({ fields: ['OPAL_CLIENT_NDIS_GOAL_1'] });

    expect(res.status).toBe(200);
    expect(res.body.plans).toHaveLength(2);
    const current = res.body.plans.find((p) => p.isCurrent);
    const old = res.body.plans.find((p) => !p.isCurrent);
    expect(current.goals.map((g) => g.goalText)).toEqual(['Revised goal']);
    expect(old.goals.map((g) => g.goalText)).toEqual(['Original goal']);
    expect(String(old.planStart)).toContain('2025-01-01');
  });

  test('save-back NEVER fires implicitly from PATCH', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await createDraft(agent, CLIENT_X.id);
    await agent.patch(`/api/fca/drafts/${draft.id}`).send({
      scalarOverrides: { OPAL_CLIENT_PRONOUNS: 'xe/xem', OPAL_CLIENT_PRIMARY_DISABILITY: 'Implicit' },
    });

    const profile = await agent.get(`/api/fca/clients/${CLIENT_X.id}/profile`);
    expect(profile.body.profile).toBeNull();
    const rows = await db.pool.query('SELECT count(*)::int AS n FROM fca_client_profiles');
    expect(rows.rows[0].n).toBe(0);
  });

  test('save-back NEVER fires implicitly from generate', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await createDraft(agent, CLIENT_X.id);
    await agent.patch(`/api/fca/drafts/${draft.id}`).send({
      scalarOverrides: { OPAL_CLIENT_PRONOUNS: 'xe/xem' },
    });
    const gen = await agent.post(`/api/fca/drafts/${draft.id}/generate`);
    expect(gen.status).toBe(200);

    const rows = await db.pool.query('SELECT count(*)::int AS n FROM fca_client_profiles');
    expect(rows.rows[0].n).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Composition, generation and audit
// ═══════════════════════════════════════════════════════════════════════════

describe('composition and generation', () => {
  test('required sections cannot be deselected through the API', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, CLIENT_X.id);

    const res = await agent.patch(`/api/fca/drafts/${draft.id}`).send({ selectedSections: [] });
    expect(res.status).toBe(200);

    for (const tag of tm.REQUIRED_SECTION_TAGS) {
      expect(res.body.draft.selectedSections).toContain(tag);
    }
    const required = res.body.draft.manifest.sections.filter((s) => s.kind === 'required');
    expect(required).toHaveLength(tm.REQUIRED_SECTION_TAGS.length);
    for (const s of required) expect(s.included).toBe(true);
  });

  test('the preview manifest and the generated document agree', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await createDraft(agent, CLIENT_X.id);
    const selected = tm.OPTIONAL_SECTION_TAGS.filter((t) => t !== 'OPAL_SECTION_APPENDICES'
      && t !== 'OPAL_SECTION_ASSESSMENT_TOOL_MOCA');

    const patched = await agent.patch(`/api/fca/drafts/${draft.id}`).send({
      selectedSections: selected,
      customSections: [{ title: 'Fatigue and Daily Routines', guidance: 'Describe fatigue.' }],
    });
    const manifest = patched.body.draft.manifest;

    const gen = await agent.post(`/api/fca/drafts/${draft.id}/generate`);
    expect(gen.status).toBe(200);

    const dl = await agent.get(`/api/fca/documents/${gen.body.documentId}/download`)
      .buffer().parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const zip = await JSZip.loadAsync(dl.body);
    const body = await zip.file('word/document.xml').async('string');

    // Everything the preview said was in, is in; everything it said was out, is out.
    for (const s of manifest.sections.filter((x) => x.kind !== 'custom')) {
      expect([s.tag, body.includes(s.tag)]).toEqual([s.tag, s.included]);
    }
    for (const s of manifest.sections.filter((x) => x.kind === 'custom')) {
      expect(body).toContain(s.tag);
      expect(body).toContain(s.title);
    }
  });

  test('the filename uses the preferred name and the generation date', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({ preferredName: 'Xav' });
    const draft = await createDraft(agent, CLIENT_X.id);
    const gen = await agent.post(`/api/fca/drafts/${draft.id}/generate`);

    expect(gen.body.filename).toMatch(/^FCA - Xav - \d{4}-\d{2}-\d{2}\.docx$/);
  });

  test('the filename falls back to the full name when there is no preferred name', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, CLIENT_X.id);
    const gen = await agent.post(`/api/fca/drafts/${draft.id}/generate`);
    expect(gen.body.filename).toMatch(/^FCA - Xavier Ex - \d{4}-\d{2}-\d{2}\.docx$/);
  });

  test('missing data is flagged, never fabricated', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await createDraft(agent, CLIENT_X.id);
    const gen = await agent.post(`/api/fca/drafts/${draft.id}/generate`);

    expect(gen.body.missingFields.length).toBeGreaterThan(0);
    expect(gen.body.missingFields).toContain('OPAL_CLIENT_PRONOUNS');
    expect(gen.body.warnings.join(' ')).toMatch(/had no data/);

    const dl = await agent.get(`/api/fca/documents/${gen.body.documentId}/download`)
      .buffer().parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const zip = await JSZip.loadAsync(dl.body);
    const body = await zip.file('word/document.xml').async('string');
    expect(body).not.toMatch(/>null</);
    expect(body).not.toMatch(/>undefined</);
    // The control survives so the gap is visible to the therapist.
    expect(body).toContain('OPAL_CLIENT_PRONOUNS');
  });

  test('excludedFields round-trips through PATCH and is frozen into the snapshot', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, CLIENT_X.id);

    const patched = await agent.patch(`/api/fca/drafts/${draft.id}`).send({
      excludedFields: ['OPAL_REPORT_REVIEWER_NAME', 'NOT_A_REAL_TAG'],
    });
    expect(patched.status).toBe(200);
    // Unknown tags are dropped rather than trusted.
    expect(patched.body.draft.excludedFields).toEqual(['OPAL_REPORT_REVIEWER_NAME']);
    expect(patched.body.draft.manifest.excludedTags).toEqual(['OPAL_REPORT_REVIEWER_NAME']);

    const reread = await agent.get(`/api/fca/drafts/${draft.id}`);
    expect(reread.body.draft.manifest.excludedTags).toEqual(['OPAL_REPORT_REVIEWER_NAME']);

    const gen = await agent.post(`/api/fca/drafts/${draft.id}/generate`);
    expect(gen.status).toBe(200);
    expect(gen.body.excludedFields).toEqual(['OPAL_REPORT_REVIEWER_NAME']);

    const row = await db.pool.query(
      'SELECT excluded_fields FROM fca_report_drafts WHERE id = $1', [draft.id]
    );
    expect(row.rows[0].excluded_fields).toEqual(['OPAL_REPORT_REVIEWER_NAME']);
    // And it survives on the frozen read.
    const frozen = await agent.get(`/api/fca/drafts/${draft.id}`);
    expect(frozen.body.draft.manifest.excludedTags).toEqual(['OPAL_REPORT_REVIEWER_NAME']);
  });

  test('excluding a field CLEARS its override, and un-excluding restores the resolved value', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({ pronouns: 'xe/xem' });
    const draft = await createDraft(agent, CLIENT_X.id);

    const typed = await agent.patch(`/api/fca/drafts/${draft.id}`)
      .send({ scalarOverrides: { OPAL_CLIENT_PRONOUNS: 'they/them' } });
    expect(typed.body.draft.manifest.scalarData.OPAL_CLIENT_PRONOUNS).toBe('they/them');
    expect(typed.body.draft.manifest.scalarSources.OPAL_CLIENT_PRONOUNS).toBe('report_override');

    const excluded = await agent.patch(`/api/fca/drafts/${draft.id}`)
      .send({ excludedFields: ['OPAL_CLIENT_PRONOUNS'] });
    const stored = await db.pool.query(
      'SELECT scalar_overrides FROM fca_report_drafts WHERE id = $1', [draft.id]
    );
    expect(stored.rows[0].scalar_overrides).not.toHaveProperty('OPAL_CLIENT_PRONOUNS');
    expect(excluded.body.draft.manifest.excludedTags).toEqual(['OPAL_CLIENT_PRONOUNS']);

    // Un-excluding falls back to the layers — never to the value that was
    // struck through, which the therapist has not seen since.
    const restored = await agent.patch(`/api/fca/drafts/${draft.id}`).send({ excludedFields: [] });
    expect(restored.body.draft.manifest.excludedTags).toEqual([]);
    expect(restored.body.draft.manifest.scalarData.OPAL_CLIENT_PRONOUNS).toBe('xe/xem');
    expect(restored.body.draft.manifest.scalarSources.OPAL_CLIENT_PRONOUNS).toBe('client_profile');
  });

  test('an excluded field renders EMPTY in the document, with no placeholder', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, CLIENT_X.id);

    // One auto-issued field and one genuinely missing one.
    await agent.patch(`/api/fca/drafts/${draft.id}`).send({
      excludedFields: ['OPAL_REPORT_DOCUMENT_ID', 'OPAL_REPORT_REVIEWER_NAME'],
    });
    const gen = await agent.post(`/api/fca/drafts/${draft.id}/generate`);
    expect(gen.status).toBe(200);

    const dl = await agent.get(`/api/fca/documents/${gen.body.documentId}/download`)
      .buffer().parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const zip = await JSZip.loadAsync(dl.body);
    const body = await zip.file('word/document.xml').async('string');
    const footer = await zip.file('word/footer6.xml').async('string');

    // Neither the value nor the template's own placeholder.
    expect(body).not.toContain('[PORTAL — REPORT ID]');
    expect(body).not.toContain('[PORTAL — REVIEWER NAME]');
    expect(footer).not.toContain('[PORTAL — REPORT ID]');
    expect(footer).not.toContain(`FCA-${draft.id.slice(0, 8).toUpperCase()}`);
    // But the controls survive, so the therapist can still type in Word.
    expect(body).toContain('OPAL_REPORT_REVIEWER_NAME');
    expect(footer).toContain('OPAL_REPORT_DOCUMENT_ID');

    // A field that is merely missing keeps its prompt — the distinction holds.
    expect(body).toContain('[PORTAL — REVIEWER ROLE]');

    // The generate response separates a decision from an omission.
    expect(gen.body.missingFields).toContain('OPAL_REPORT_REVIEWER_ROLE');
    expect(gen.body.warnings.join(' ')).toMatch(/excluded/);
  });

  test('the download is a real, openable docx package', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, CLIENT_X.id);
    const gen = await agent.post(`/api/fca/drafts/${draft.id}/generate`);

    const dl = await agent.get(`/api/fca/documents/${gen.body.documentId}/download`)
      .buffer().parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(dl.headers['content-type']).toMatch(/wordprocessingml\.document/);
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');

    const zip = await JSZip.loadAsync(dl.body);
    for (const part of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml',
      'word/header6.xml', 'word/footer6.xml', 'word/settings.xml']) {
      expect(zip.file(part)).toBeTruthy();
    }
  });

  test('a generated draft is no longer editable', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, CLIENT_X.id);
    await agent.post(`/api/fca/drafts/${draft.id}/generate`);

    const res = await agent.patch(`/api/fca/drafts/${draft.id}`).send({ selectedSections: [] });
    expect(res.status).toBe(409);
  });

  test('delete archives rather than destroys', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, CLIENT_X.id);

    expect((await agent.delete(`/api/fca/drafts/${draft.id}`)).body).toEqual({ ok: true });
    const rows = await db.pool.query('SELECT status FROM fca_report_drafts WHERE id = $1', [draft.id]);
    expect(rows.rows[0].status).toBe('archived');
  });
});

describe('audit trail', () => {
  test('generation records client, therapist, user and template version — and no content', async () => {
    const org = await seedOrganisation('Org A');
    const { agent, user } = await agentFor('therapist', { organisation_id: org.id });

    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({ preferredName: 'Xav' });
    const draft = await createDraft(agent, CLIENT_X.id);
    await agent.patch(`/api/fca/drafts/${draft.id}`).send({
      customSections: [{ title: 'Fatigue and Daily Routines' }],
    });
    await agent.post(`/api/fca/drafts/${draft.id}/generate`);

    const { rows } = await db.pool.query(
      "SELECT * FROM audit_logs WHERE action = 'fca.report_generated'");
    expect(rows).toHaveLength(1);

    const meta = rows[0].metadata;
    expect(rows[0].actor_user_id).toBe(user.id);
    expect(rows[0].organisation_id).toBe(org.id);
    expect(meta.draftId).toBe(draft.id);
    expect(meta.clientId).toBe(CLIENT_X.id);
    expect(meta.templateVersion).toBe(tm.TEMPLATE_VERSION);
    expect(meta.sectionCount).toBeGreaterThan(0);
    expect(meta.customSectionCount).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(meta, 'therapistProfileId')).toBe(true);

    // No names, no clinical content, anywhere in the audit payload.
    const json = JSON.stringify(meta);
    for (const leak of ['Xavier', 'Xav', 'Fatigue', CLIENT_X.ndisNumber, CLIENT_X.email]) {
      expect(json).not.toContain(leak);
    }
  });

  test('a profile update records field NAMES only, never values', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    await agent.put(`/api/fca/clients/${CLIENT_X.id}/profile`).send({
      preferredName: 'SECRETNAME', primaryDisability: 'SECRETDIAGNOSIS',
      currentPlan: { planStart: '2026-01-01', planEnd: '2026-12-31', goals: ['SECRETGOAL'] },
    });

    const { rows } = await db.pool.query(
      "SELECT * FROM audit_logs WHERE action = 'fca.client_profile_updated'");
    expect(rows).toHaveLength(1);

    const meta = rows[0].metadata;
    expect(meta.fields).toEqual(expect.arrayContaining(['preferred_name', 'primary_disability', 'ndis_plan']));
    expect(meta.planSuperseded).toBe(true);

    const json = JSON.stringify(meta);
    for (const leak of ['SECRETNAME', 'SECRETDIAGNOSIS', 'SECRETGOAL']) {
      expect(json).not.toContain(leak);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Template registry and presets
// ═══════════════════════════════════════════════════════════════════════════

describe('template registry', () => {
  test('the descriptor exposes sections, scalars and profile-eligible tags', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const { body } = await agent.get('/api/fca/template');
    expect(body.template.id).toBe(tm.TEMPLATE_ID);
    expect(body.template.version).toBe(tm.TEMPLATE_VERSION);
    expect(body.template.sections).toHaveLength(tm.SECTIONS.length);
    expect(body.template.scalarTags).toHaveLength(33);
    expect(new Set(body.template.profileEligibleTags)).toEqual(new Set(tm.PROFILE_ELIGIBLE_TAGS));
    for (const s of body.template.sections) {
      expect(s).toHaveProperty('group');
      expect(s).toHaveProperty('label');
      expect(s).toHaveProperty('required');
      expect(s).toHaveProperty('defaultSelected');
      expect(s).toHaveProperty('defaultOrder');
    }
  });

  test('a template row that documents exist for cannot be edited', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, CLIENT_X.id);
    await agent.post(`/api/fca/drafts/${draft.id}/generate`);

    await expect(
      db.pool.query("UPDATE fca_templates SET storage_path = 'tampered.docx'")
    ).rejects.toThrow(/immutable/i);

    // Retiring a version is still allowed — that is a status change.
    await expect(
      db.pool.query('UPDATE fca_templates SET is_active = FALSE')
    ).resolves.toBeTruthy();
  });
});

describe('section presets', () => {
  test('round-trip and delete, scoped to the user', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const { agent: other } = await agentFor('therapist', { organisation_id: org.id });

    const created = await agent.post('/api/fca/presets').send({
      name: 'Cognition focus',
      selectedSections: ['OPAL_SECTION_DOMAIN_COGNITION'],
    });
    expect(created.status).toBe(201);
    expect(created.body.preset.selectedSections).toContain('OPAL_SECTION_DOMAIN_COGNITION');
    // Required sections are folded in here too.
    for (const tag of tm.REQUIRED_SECTION_TAGS) {
      expect(created.body.preset.selectedSections).toContain(tag);
    }

    expect((await other.get('/api/fca/presets')).body.presets).toHaveLength(0);
    expect((await other.delete(`/api/fca/presets/${created.body.preset.id}`)).status).toBe(404);

    expect((await agent.get('/api/fca/presets')).body.presets).toHaveLength(1);
    expect((await agent.delete(`/api/fca/presets/${created.body.preset.id}`)).status).toBe(200);
    expect((await agent.get('/api/fca/presets')).body.presets).toHaveLength(0);
  });
});
