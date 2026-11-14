'use strict';

/**
 * Case Notes workspace (migration 088): a week's case-noting blocks, and a
 * client note written from one of them. Real Postgres. The model is stubbed
 * at the provider seam and the caseload check at the Splose seam; everything
 * else — ownership, the block/client check, the stored link — is real.
 */
jest.mock('../../splose-api', () => ({ getPatients: jest.fn(async () => []), fetchAllCases: jest.fn(async () => []), getPatient: jest.fn() }));
jest.mock('../../outlook-oauth', () => ({ MICROSOFT_OAUTH_CONFIG: { scopes: [] }, getAuthorizationUrl: jest.fn(), getAccessToken: jest.fn(), getMicrosoftUser: jest.fn(), refreshAccessToken: jest.fn() }));
jest.mock('../../splose-caseload', () => {
  const actual = jest.requireActual('../../splose-caseload');
  return { ...actual, loadOwnClient: jest.fn(async (req, id) => (['11', '12', '99'].includes(String(id))
    ? { id: String(id), fullName: 'Client ' + id, formattedAddress: null } : null)) };
});

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const provider = require('../../clinical-note-provider');

const PASSWORD = 'NotesPass1';
const SECTIONS = { identify: 'Therapist completed case noting.', sessionDetails: 'Reviewed the goals and updated the plan.', plan: ['Send the report.'], warnings: [] };

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
  process.env.CLINICAL_NOTE_AI_ENABLED = 'true';
  process.env.AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'au.anthropic.test-profile-synthetic';
  provider._setProviderForTests(async () => ({ ...SECTIONS, plan: [...SECTIONS.plan], warnings: [] }));
});
afterEach(() => { provider._setProviderForTests(null); delete process.env.CLINICAL_NOTE_AI_ENABLED; });
afterAll(async () => { require('../../auth')._resetLoginRateLimit(); await closePool(); });

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../nf2f-routes'));
  app.use('/', require('../../case-note-routes'));
  return app;
}
async function agentFor(app, role, orgId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: orgId || null });
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(200);
  return { agent, user };
}
const clients = [{ clientId: '11', clientName: 'Client 11' }, { clientId: '12', clientName: 'Client 12' }];
const block = (startIso, over = {}) => ({ title: 'Case noting', startTime: startIso, endTime: new Date(Date.parse(startIso) + 3600000).toISOString(),
  categories: ['Case Management'], booking: { kind: 'case-noting', clients }, ...over });

describe('Case Notes workspace', () => {
  test('the week lists my case-noting blocks only, with their clients and timer', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await agentFor(app, 'therapist', org.id);
    const { agent: other } = await agentFor(app, 'therapist', org.id);
    const inWeek = (await agent.post('/api/outlook/events').send(block('2026-11-10T02:00:00.000Z'))).body.dbId;   // Tue 10am Perth
    await agent.post('/api/outlook/events').send(block('2026-11-18T02:00:00.000Z'));                                 // next week
    await agent.post('/api/outlook/events').send({ title: 'Lunch', startTime: '2026-11-11T04:00:00.000Z', endTime: '2026-11-11T04:30:00.000Z', categories: ['Admin'] });
    await other.post('/api/outlook/events').send(block('2026-11-12T02:00:00.000Z'));

    const r = await agent.get('/api/nf2f/blocks?from=2026-11-09&to=2026-11-15');
    expect(r.status).toBe(200);
    expect(r.body.blocks.map((b) => b.eventId)).toEqual([inWeek]);
    expect(r.body.blocks[0]).toMatchObject({ kind: 'case-noting', clients, timer: { status: 'IDLE', limitSeconds: 3600 }, notes: {} });

    expect((await agent.get('/api/nf2f/blocks?from=2026-11-09&to=2026-12-31')).status).toBe(400);
    expect((await agent.get('/api/nf2f/blocks?from=bad&to=2026-11-15')).status).toBe(400);
    expect((await request(app).get('/api/nf2f/blocks?from=2026-11-09&to=2026-11-15')).status).toBe(401);
  });

  test('a note written from a block stays client-linked, records the block, and shows on the block', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent, user } = await agentFor(app, 'therapist', org.id);
    const id = (await agent.post('/api/outlook/events').send(block('2026-11-10T02:00:00.000Z'))).body.dbId;

    const g = await agent.post('/api/mobile/case-note-drafts/generate')
      .send({ transcript: 'Updated the goals for the review.', linkedClientId: '12', nf2fEventId: id });
    expect(g.status).toBe(201);
    expect(g.body.caseNoteDraft).toMatchObject({ linkedClientId: '12', linkedEventId: null, nf2fEventId: id });
    expect(g.body.caseNoteDraft.header.sessionDateLabel).toBe('10/11/2026');   // dated by the block

    const { rows: [row] } = await db.pool.query('SELECT nf2f_event_id, linked_event_id, user_id FROM case_note_drafts WHERE id = $1', [g.body.draftId]);
    expect(row).toMatchObject({ nf2f_event_id: id, linked_event_id: null, user_id: user.id });

    const list = (await agent.get(`/api/mobile/case-note-drafts?nf2fEventId=${id}`)).body.caseNoteDrafts;
    expect(list.map((d) => d.id)).toEqual([g.body.draftId]);
    const week = (await agent.get('/api/nf2f/blocks?from=2026-11-09&to=2026-11-15')).body.blocks;
    expect(week[0].notes).toEqual({ 12: { draftId: g.body.draftId, reviewStatus: 'review_required' } });
  });

  test('the block must be mine and must name the client; an event link cannot carry a block', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await agentFor(app, 'therapist', org.id);
    const { agent: other } = await agentFor(app, 'therapist', org.id);
    const mine = (await agent.post('/api/outlook/events').send(block('2026-11-10T02:00:00.000Z'))).body.dbId;
    const theirs = (await other.post('/api/outlook/events').send(block('2026-11-10T02:00:00.000Z'))).body.dbId;
    const send = (body) => agent.post('/api/mobile/case-note-drafts/generate').send({ transcript: 'Notes.', ...body });

    expect((await send({ linkedClientId: '99', nf2fEventId: mine })).body.code).toBe('invalid_link');     // not on this block
    expect((await send({ linkedClientId: '11', nf2fEventId: theirs })).body.code).toBe('invalid_link');   // someone else's block
    expect((await send({ linkedEventId: mine, nf2fEventId: mine })).body.code).toBe('invalid_link');      // block only with a client
    const check = await agent.post('/api/mobile/case-note-drafts/names-check').send({ transcript: 'Notes.', linkedClientId: '99', nf2fEventId: mine });
    expect(check.status).toBe(400);
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM case_note_drafts');
    expect(rows[0].n).toBe(0);
    expect((await agent.get('/api/mobile/case-note-drafts?nf2fEventId=nope')).status).toBe(400);
  });
});
