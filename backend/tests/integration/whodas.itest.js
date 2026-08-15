'use strict';

/**
 * WHODAS 2.0 — integration tests (real Express, real sessions, real SQL, real
 * PDF bytes, real template hashes).
 *
 * Nothing is stubbed. The instrument templates are the actual WHO documents on
 * disk, the scores come from the real engine, and the completed PDF is really
 * generated and really stored. What is tested here is everything that only
 * exists above the engine: the licensing gate, RBAC, organisation isolation,
 * autosave with optimistic concurrency, completion validation, the freeze on a
 * completed assessment, amendment, and the audit trail.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { PDFDocument } = require('pdf-lib');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const registry = require('../../whodas/template-registry');
const instrument = require('../../whodas/instrument');

const PASSWORD = 'WhodasPass123';
const CLIENT_A = 'splose-client-a';
const CLIENT_B = 'splose-client-b';

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '8mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET, resave: false,
    saveUninitialized: false, cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../whodas-routes'));
  return app;
}

let app;

async function agentFor(role, { organisation_id = null } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role });
  const { rows } = await db.pool.query(
    'UPDATE users SET organisation_id = $2 WHERE id = $1 RETURNING *',
    [user.id, organisation_id]
  );
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user: rows[0] };
}

const allAnswers = (v) => Object.fromEntries(instrument.ITEM_IDS.map((id) => [id, v]));

async function startDraft(agent, clientId = CLIENT_A, method = 'self') {
  const res = await agent.post('/api/whodas/assessments')
    .send({ clientId, administrationMethod: method });
  expect(res.status).toBe(201);
  return res.body.assessment;
}

/** Answer everything and declare work status, leaving the draft completable. */
async function fillDraft(agent, assessment, { workSchoolApplicable = true, value = 'moderate' } = {}) {
  let current = assessment;
  let res = await agent.patch(`/api/whodas/assessments/${current.id}`)
    .send({ version: current.version, workSchoolApplicable });
  expect(res.status).toBe(200);
  current = res.body.assessment;

  const responses = allAnswers(value);
  if (!workSchoolApplicable) instrument.WORK_SCHOOL_ITEMS.forEach((id) => delete responses[id]);

  res = await agent.patch(`/api/whodas/assessments/${current.id}`)
    .send({ version: current.version, responses });
  expect(res.status).toBe(200);
  return res.body.assessment;
}

beforeAll(async () => {
  process.env.ENABLE_WHODAS_ASSESSMENT = 'true';
  app = buildApp();
});

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit?.();
  process.env.ENABLE_WHODAS_ASSESSMENT = 'true';
  await registry.syncTemplates(db.pool);
});

afterAll(closePool);

// ═══════════════════════════════════════════════════════════════════════════
//  Licensing gate
// ═══════════════════════════════════════════════════════════════════════════

describe('feature gate', () => {
  test('every route 404s when ENABLE_WHODAS_ASSESSMENT is not exactly "true"', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    for (const value of ['false', '', 'TRUE', '1']) {
      process.env.ENABLE_WHODAS_ASSESSMENT = value;
      const res = await agent.get('/api/whodas/instrument');
      expect(`${value}:${res.status}`).toBe(`${value}:404`);
    }
  });

  test('the gate hides the feature rather than advertising it as forbidden', async () => {
    process.env.ENABLE_WHODAS_ASSESSMENT = 'false';
    const res = await request(app).get('/api/whodas/instrument');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Access control
// ═══════════════════════════════════════════════════════════════════════════

describe('access control', () => {
  test('unauthenticated requests are refused', async () => {
    const res = await request(app).get('/api/whodas/instrument');
    expect([401, 403]).toContain(res.status);
  });

  test('admin — a non-clinical scheduling role here — has no access', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('admin', { organisation_id: org.id });
    expect((await agent.get('/api/whodas/instrument')).status).toBe(403);
    expect((await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' })).status).toBe(403);
  });

  test('read_only may read the instrument and blank forms but never write', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('read_only', { organisation_id: org.id });

    expect((await agent.get('/api/whodas/instrument')).status).toBe(200);
    expect((await agent.get('/api/whodas/templates/whodas-36-self/blank')).status).toBe(200);

    const res = await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });
    expect(res.status).toBe(403);
  });

  test('a user with no organisation is refused', async () => {
    const { agent } = await agentFor('therapist', { organisation_id: null });
    expect((await agent.get('/api/whodas/instrument')).status).toBe(403);
  });

  test('an assessment in another organisation is 404, not 403', async () => {
    const orgA = await seedOrganisation('Org A');
    const orgB = await seedOrganisation('Org B');
    const a = await agentFor('therapist', { organisation_id: orgA.id });
    const b = await agentFor('therapist', { organisation_id: orgB.id });

    const draft = await startDraft(a.agent);
    const res = await b.agent.get(`/api/whodas/assessments/${draft.id}`);
    expect(res.status).toBe(404);
  });

  test('another organisation cannot list or patch this client\'s assessments', async () => {
    const orgA = await seedOrganisation('Org A');
    const orgB = await seedOrganisation('Org B');
    const a = await agentFor('therapist', { organisation_id: orgA.id });
    const b = await agentFor('therapist', { organisation_id: orgB.id });

    const draft = await startDraft(a.agent);

    const list = await b.agent.get(`/api/whodas/clients/${CLIENT_A}/assessments`);
    expect(list.status).toBe(200);
    expect(list.body.assessments).toEqual([]);

    const patch = await b.agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ responses: { 'D1.1': 'severe' } });
    expect(patch.status).toBe(404);
  });

  test('a malformed or unknown assessment id is 404, never a 500', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    for (const id of ['not-a-uuid', '../../etc/passwd', '00000000-0000-0000-0000-000000000000']) {
      const res = await agent.get(`/api/whodas/assessments/${encodeURIComponent(id)}`);
      expect(`${id}:${res.status}`).toBe(`${id}:404`);
    }
  });

  test('a draft belongs to the clinician who started it', async () => {
    const org = await seedOrganisation('Org A');
    const a = await agentFor('therapist', { organisation_id: org.id });
    const b = await agentFor('therapist', { organisation_id: org.id });

    const draft = await startDraft(a.agent);

    // Another clinician in the same organisation cannot see or edit it.
    expect((await b.agent.get(`/api/whodas/assessments/${draft.id}`)).status).toBe(404);
    expect((await b.agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ responses: { 'D1.1': 'mild' } })).status).toBe(404);
  });

  test('a COMPLETED assessment is visible across the organisation', async () => {
    const org = await seedOrganisation('Org A');
    const a = await agentFor('therapist', { organisation_id: org.id });
    const b = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(a.agent);
    draft = await fillDraft(a.agent, draft);
    const done = await a.agent.post(`/api/whodas/assessments/${draft.id}/complete`);
    expect(done.status).toBe(200);

    // Filed clinical records are org-visible; drafts in progress are not.
    expect((await b.agent.get(`/api/whodas/assessments/${draft.id}`)).status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Blank forms
// ═══════════════════════════════════════════════════════════════════════════

describe('blank official forms', () => {
  test.each([
    ['whodas-36-interviewer', 10],
    ['whodas-36-self', 4],
    ['whodas-36-proxy', 5],
    ['whodas-36-flashcards', 2],
  ])('%s streams the official document unchanged', async (key, pages) => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const res = await agent.get(`/api/whodas/templates/${key}/blank`).buffer().parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);

    // Byte-identical to the registered template — no header, footer or rescale.
    expect(registry.sha256(res.body)).toBe(registry.templateByKey(key).sha256);
    expect((await PDFDocument.load(res.body)).getPageCount()).toBe(pages);
  });

  test('an unknown template key is 404', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    expect((await agent.get('/api/whodas/templates/whodas-99/blank')).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe('draft lifecycle', () => {
  test('a draft is created against the pinned template and its hash', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await startDraft(agent, CLIENT_A, 'proxy');
    expect(draft.status).toBe('draft');
    expect(draft.administrationMethod).toBe('proxy');
    expect(draft.templateKey).toBe('whodas-36-proxy');
    expect(draft.templateSha256).toBe(registry.templateByKey('whodas-36-proxy').sha256);
    expect(draft.version).toBe(1);
    expect(draft.workSchoolApplicable).toBeNull();
  });

  test('each administration method loads its own official template', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    for (const [method, key] of [['interviewer', 'whodas-36-interviewer'], ['self', 'whodas-36-self'], ['proxy', 'whodas-36-proxy']]) {
      const draft = await startDraft(agent, `client-${method}`, method);
      expect(`${method}:${draft.templateKey}`).toBe(`${method}:${key}`);

      const full = await agent.get(`/api/whodas/assessments/${draft.id}`);
      expect(full.body.fieldMap.templateKey).toBe(key);
      expect(full.body.fieldMap.templateSha256).toBe(registry.templateByKey(key).sha256);
    }
  });

  test('a second draft of the same type for the same client is refused, not duplicated', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const first = await startDraft(agent);
    const second = await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('draft_exists');
    expect(second.body.assessment.id).toBe(first.id);

    const { rows } = await db.pool.query('SELECT COUNT(*)::int AS n FROM whodas_assessments');
    expect(rows[0].n).toBe(1);
  });

  test('an invalid administration method is refused', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const res = await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'telepathic' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_method');
  });

  test('responses save, survive a reload, and can be resumed', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await startDraft(agent);
    const saved = await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: draft.version, responses: { 'D1.1': 'severe', 'D2.3': 'none' } });

    expect(saved.status).toBe(200);
    expect(saved.body.assessment.version).toBe(2);

    const reloaded = await agent.get(`/api/whodas/assessments/${draft.id}`);
    expect(reloaded.body.assessment.responses).toEqual({ 'D1.1': 'severe', 'D2.3': 'none' });
    expect(reloaded.body.assessment.status).toBe('draft');
  });

  test('field-level saves merge rather than replace', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    let res = await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: draft.version, responses: { 'D1.1': 'mild' } });
    res = await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: res.body.assessment.version, responses: { 'D1.2': 'severe' } });

    expect(res.body.assessment.responses).toEqual({ 'D1.1': 'mild', 'D1.2': 'severe' });
  });

  test('an unrecognised response value is refused and nothing is stored', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await startDraft(agent);
    const res = await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: draft.version, responses: { 'D1.1': 'catastrophic' } });

    expect(res.status).toBe(400);
    expect(res.body.itemIds).toEqual(['D1.1']);

    const after = await agent.get(`/api/whodas/assessments/${draft.id}`);
    expect(after.body.assessment.responses).toEqual({});
  });

  test('a numeric response code is refused — only semantic values are accepted', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await startDraft(agent);

    const res = await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: draft.version, responses: { 'D1.1': 2 } });
    expect(res.status).toBe(400);
  });

  test('declaring the respondent does not work clears any work-block answers', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    let res = await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: draft.version, responses: { 'D5.5': 'severe', 'D1.1': 'mild' } });

    res = await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: res.body.assessment.version, workSchoolApplicable: false });

    // A stale work answer must never reach the scoring engine.
    expect(res.body.assessment.responses['D5.5']).toBeUndefined();
    expect(res.body.assessment.responses['D1.1']).toBe('mild');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Concurrency
// ═══════════════════════════════════════════════════════════════════════════

describe('optimistic concurrency', () => {
  test('a stale version conflicts instead of overwriting newer responses', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await startDraft(agent);
    const staleVersion = draft.version;

    const first = await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: staleVersion, responses: { 'D1.1': 'severe' } });
    expect(first.status).toBe(200);

    // A second tab still holding the old version.
    const second = await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: staleVersion, responses: { 'D1.1': 'none' } });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('stale_version');
    expect(second.body.currentVersion).toBe(first.body.assessment.version);

    const after = await agent.get(`/api/whodas/assessments/${draft.id}`);
    expect(after.body.assessment.responses['D1.1']).toBe('severe');
  });

  test('the version never goes backwards', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await startDraft(agent);

    await expect(db.pool.query(
      'UPDATE whodas_assessments SET version = 0 WHERE id = $1', [draft.id]
    )).rejects.toThrow(/cannot go backwards/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Completion
// ═══════════════════════════════════════════════════════════════════════════

describe('completion', () => {
  test('an incomplete assessment is refused and the gaps are named', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    const res0 = await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: draft.version, workSchoolApplicable: true });

    const responses = allAnswers('mild');
    delete responses['D3.2'];
    delete responses['D6.7'];
    await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: res0.body.assessment.version, responses });

    const res = await agent.post(`/api/whodas/assessments/${draft.id}/complete`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('incomplete');
    expect(res.body.missingItemIds.sort()).toEqual(['D3.2', 'D6.7']);

    // Nothing was scored or frozen.
    const after = await agent.get(`/api/whodas/assessments/${draft.id}`);
    expect(after.body.assessment.status).toBe('draft');
    expect(after.body.assessment.scores).toEqual({});
  });

  test('completion is refused until work/school status is declared', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await startDraft(agent);
    await agent.patch(`/api/whodas/assessments/${draft.id}`)
      .send({ version: draft.version, responses: allAnswers('mild') });

    const res = await agent.post(`/api/whodas/assessments/${draft.id}/complete`);
    expect(res.status).toBe(422);
    expect(res.body.problems.map((p) => p.code)).toContain('work_school_undeclared');
  });

  test('a complete assessment scores all three methods, each labelled', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    draft = await fillDraft(agent, draft, { value: 'severe' });

    const res = await agent.post(`/api/whodas/assessments/${draft.id}/complete`);
    expect(res.status).toBe(200);

    const a = res.body.assessment;
    expect(a.status).toBe('completed');
    expect(a.itemSet).toBe('36-item');
    expect(a.defaultScoringMethod).toBe('irt');
    expect(Object.keys(a.scores).sort()).toEqual(['domain_mean', 'irt', 'simple_sum']);

    for (const key of ['irt', 'simple_sum', 'domain_mean']) {
      const r = a.scores[key];
      expect(`${key}:${r.method}`).toBe(`${key}:${key}`);
      expect(r.label).toBeTruthy();
      expect(r.sourceMethodology).toBeTruthy();
      expect(r.scoringVersion).toBeTruthy();
      expect(r.calculatedAt).toBeTruthy();
    }

    // 'severe' on every item: simple sum = 3/4 of maximum.
    expect(a.scores.simple_sum.overall.value).toBe(75);
    expect(a.scores.irt.summaryVariable).toBe('st_s36');
    expect(a.scores.irt.overall.denominator).toBe(106);
  });

  test('a non-working respondent scores on the 32-item pathway', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    draft = await fillDraft(agent, draft, { workSchoolApplicable: false, value: 'extreme' });

    const res = await agent.post(`/api/whodas/assessments/${draft.id}/complete`);
    expect(res.status).toBe(200);

    const a = res.body.assessment;
    expect(a.itemSet).toBe('32-item');
    expect(a.scores.irt.summaryVariable).toBe('st_s32');
    expect(a.scores.irt.overall.denominator).toBe(92);
    expect(a.scores.irt.overall.value).toBe(100);

    // The workbook methods define no 32-item denominator and refuse to guess.
    expect(a.scores.simple_sum.scorable).toBe(false);
    expect(a.scores.simple_sum.refusal.reason).toBe('no_32_item_pathway');
    expect(a.scores.domain_mean.scorable).toBe(false);
  });

  test('scores persist and are returned on reload', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    draft = await fillDraft(agent, draft, { value: 'moderate' });
    const done = await agent.post(`/api/whodas/assessments/${draft.id}/complete`);

    const reloaded = await agent.get(`/api/whodas/assessments/${draft.id}`);
    expect(reloaded.body.assessment.scores.irt.overall.value)
      .toBe(done.body.assessment.scores.irt.overall.value);
    expect(reloaded.body.assessment.scoresCalculatedAt).toBeTruthy();
  });

  test('no result carries an invented severity label', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    draft = await fillDraft(agent, draft, { value: 'extreme' });
    const res = await agent.post(`/api/whodas/assessments/${draft.id}/complete`);

    expect(JSON.stringify(res.body.assessment.scores))
      .not.toMatch(/\b(mild|moderate|severe|extreme)\s+disability\b|severityLabel|classification/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Completed assessments are frozen
// ═══════════════════════════════════════════════════════════════════════════

describe('completed assessments cannot be silently modified', () => {
  async function completed(agent) {
    let draft = await startDraft(agent);
    draft = await fillDraft(agent, draft, { value: 'mild' });
    const res = await agent.post(`/api/whodas/assessments/${draft.id}/complete`);
    expect(res.status).toBe(200);
    return res.body.assessment;
  }

  test('the API refuses further edits', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const a = await completed(agent);

    const res = await agent.patch(`/api/whodas/assessments/${a.id}`)
      .send({ version: a.version, responses: { 'D1.1': 'extreme' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_editable');
  });

  test('completing twice is refused', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const a = await completed(agent);
    expect((await agent.post(`/api/whodas/assessments/${a.id}/complete`)).status).toBe(409);
  });

  test('the DATABASE refuses a content change, not just the route layer', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const a = await completed(agent);

    await expect(db.pool.query(
      `UPDATE whodas_assessments SET responses = '{"D1.1":"extreme"}'::jsonb WHERE id = $1`,
      [a.id]
    )).rejects.toThrow(/immutable/);

    await expect(db.pool.query(
      `UPDATE whodas_assessments SET scores = '{}'::jsonb WHERE id = $1`, [a.id]
    )).rejects.toThrow(/immutable/);
  });

  test('a registered template cannot be rewritten once an assessment uses it', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    await startDraft(agent);

    await expect(db.pool.query(
      `UPDATE whodas_templates SET sha256 = $1 WHERE template_key = 'whodas-36-self'`,
      ['a'.repeat(64)]
    )).rejects.toThrow(/immutable/);

    // Retiring a version is a status change, not a content change, so it stays allowed.
    await expect(db.pool.query(
      `UPDATE whodas_templates SET is_active = FALSE WHERE template_key = 'whodas-36-self'`
    )).resolves.toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Amendment and voiding
// ═══════════════════════════════════════════════════════════════════════════

describe('amendment and voiding', () => {
  test('amending creates a new linked draft and leaves the original intact', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    draft = await fillDraft(agent, draft, { value: 'mild' });
    const original = (await agent.post(`/api/whodas/assessments/${draft.id}/complete`)).body.assessment;

    const res = await agent.post(`/api/whodas/assessments/${original.id}/amend`)
      .send({ reason: 'D2.1 recorded against the wrong row' });

    expect(res.status).toBe(201);
    const amendment = res.body.assessment;
    expect(amendment.status).toBe('draft');
    expect(amendment.amendsAssessmentId).toBe(original.id);
    expect(amendment.responses).toEqual(original.responses);

    const before = await agent.get(`/api/whodas/assessments/${original.id}`);
    expect(before.body.assessment.status).toBe('amended');
    expect(before.body.assessment.amendedByAssessmentId).toBe(amendment.id);
    expect(before.body.assessment.scores.irt.overall.value)
      .toBe(original.scores.irt.overall.value);
  });

  test('an amendment requires a reason', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    draft = await fillDraft(agent, draft, { value: 'mild' });
    const original = (await agent.post(`/api/whodas/assessments/${draft.id}/complete`)).body.assessment;

    const res = await agent.post(`/api/whodas/assessments/${original.id}/amend`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('reason_required');
  });

  test('only a completed assessment can be amended', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await startDraft(agent);

    const res = await agent.post(`/api/whodas/assessments/${draft.id}/amend`).send({ reason: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_amendable');
  });

  test('voiding requires a reason and retains the record', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await startDraft(agent);

    expect((await agent.post(`/api/whodas/assessments/${draft.id}/void`).send({})).status).toBe(400);

    const res = await agent.post(`/api/whodas/assessments/${draft.id}/void`)
      .send({ reason: 'Started against the wrong client' });
    expect(res.status).toBe(200);
    expect(res.body.assessment.status).toBe('voided');

    const { rows } = await db.pool.query('SELECT status FROM whodas_assessments WHERE id = $1', [draft.id]);
    expect(rows[0].status).toBe('voided');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Completed document
// ═══════════════════════════════════════════════════════════════════════════

describe('completed PDF', () => {
  const asBuffer = (req) => req.buffer().parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });

  test('completion generates and stores a completed PDF', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    draft = await fillDraft(agent, draft, { value: 'moderate' });
    const done = await agent.post(`/api/whodas/assessments/${draft.id}/complete`);

    expect(done.body.documentGenerated).toBe(true);

    const { rows } = await db.pool.query(
      'SELECT * FROM whodas_generated_documents WHERE assessment_id = $1', [draft.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].page_count).toBe(4);
    expect(rows[0].template_sha256).toBe(registry.templateByKey('whodas-36-self').sha256);
    // No client identity in a filename that lands in a downloads folder.
    expect(rows[0].filename).not.toMatch(new RegExp(CLIENT_A));
  });

  test('the completed PDF downloads, opens, and matches the source page count', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent, CLIENT_A, 'proxy');
    draft = await fillDraft(agent, draft, { value: 'severe' });
    await agent.post(`/api/whodas/assessments/${draft.id}/complete`);

    const res = await asBuffer(agent.get(`/api/whodas/assessments/${draft.id}/document`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['cache-control']).toMatch(/no-store/);

    const pdf = await PDFDocument.load(res.body);
    expect(pdf.getPageCount()).toBe(registry.templateByKey('whodas-36-proxy').pageCount);

    // Distinct from the blank source, and the source is untouched.
    expect(registry.sha256(res.body)).not.toBe(registry.templateByKey('whodas-36-proxy').sha256);
    expect(registry.verifyTemplates().ok).toBe(true);
  });

  test('a draft has no document to download', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await startDraft(agent);

    const res = await agent.get(`/api/whodas/assessments/${draft.id}/document`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_document');
  });

  test('another organisation cannot download the document', async () => {
    const orgA = await seedOrganisation('Org A');
    const orgB = await seedOrganisation('Org B');
    const a = await agentFor('therapist', { organisation_id: orgA.id });
    const b = await agentFor('therapist', { organisation_id: orgB.id });

    let draft = await startDraft(a.agent);
    draft = await fillDraft(a.agent, draft, { value: 'mild' });
    await a.agent.post(`/api/whodas/assessments/${draft.id}/complete`);

    expect((await b.agent.get(`/api/whodas/assessments/${draft.id}/document`)).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  History and audit
// ═══════════════════════════════════════════════════════════════════════════

describe('history', () => {
  test('the client list shows date, clinician, method, status and score', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent, CLIENT_A, 'self');
    draft = await fillDraft(agent, draft, { value: 'severe' });
    await agent.post(`/api/whodas/assessments/${draft.id}/complete`);
    await startDraft(agent, CLIENT_A, 'interviewer');

    const res = await agent.get(`/api/whodas/clients/${CLIENT_A}/assessments`);
    expect(res.status).toBe(200);
    expect(res.body.assessments).toHaveLength(2);

    const done = res.body.assessments.find((a) => a.status === 'completed');
    expect(done.administrationMethod).toBe('self');
    expect(done.completedByName).toBeTruthy();
    expect(done.overallScore).not.toBeNull();
    // The score is never shown without the method that produced it.
    expect(done.overallScoreLabel).toMatch(/IRT/);
    expect(done.hasDocument).toBe(true);
  });

  test('one client\'s assessments never appear under another', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    await startDraft(agent, CLIENT_A, 'self');

    const res = await agent.get(`/api/whodas/clients/${CLIENT_B}/assessments`);
    expect(res.body.assessments).toEqual([]);
  });
});

describe('audit', () => {
  const actions = async () => {
    const { rows } = await db.pool.query(
      `SELECT action, target_type, target_id, metadata FROM audit_logs
        WHERE action LIKE 'WHODAS%' ORDER BY created_at`
    );
    return rows;
  };

  test('the clinically material actions are all recorded', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    draft = await fillDraft(agent, draft, { value: 'mild' });
    await agent.post(`/api/whodas/assessments/${draft.id}/complete`);
    await agent.get(`/api/whodas/assessments/${draft.id}/document`).buffer();
    await agent.post(`/api/whodas/assessments/${draft.id}/amend`).send({ reason: 'correction' });

    const names = (await actions()).map((r) => r.action);
    expect(names).toEqual(expect.arrayContaining([
      'WHODAS_ASSESSMENT_STARTED',
      'WHODAS_RESPONSE_UPDATED',
      'WHODAS_ASSESSMENT_COMPLETED',
      'WHODAS_PDF_GENERATED',
      'WHODAS_PDF_DOWNLOADED',
      'WHODAS_ASSESSMENT_AMENDED',
    ]));
  });

  test('voiding is audited', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await startDraft(agent);
    await agent.post(`/api/whodas/assessments/${draft.id}/void`).send({ reason: 'wrong client' });

    expect((await actions()).map((r) => r.action)).toContain('WHODAS_ASSESSMENT_VOIDED');
  });

  test('audit metadata carries ids, versions and counts — never clinical content', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    let draft = await startDraft(agent);
    draft = await fillDraft(agent, draft, { value: 'extreme' });
    await agent.post(`/api/whodas/assessments/${draft.id}/complete`);

    const rows = await actions();
    for (const row of rows) {
      const blob = JSON.stringify(row.metadata || {});
      // No response values, no item ids, no score, no client identifier.
      expect(blob).not.toMatch(/\b(none|mild|moderate|severe|extreme)\b/);
      expect(blob).not.toMatch(/D[1-6]\.\d/);
      expect(blob).not.toMatch(new RegExp(CLIENT_A));
      expect(blob).not.toMatch(/"overall"/);
      expect(row.target_type).toBe('whodas_assessment');
    }

    const completed = rows.find((r) => r.action === 'WHODAS_ASSESSMENT_COMPLETED');
    expect(completed.metadata.itemSet).toBe('36-item');
    expect(completed.metadata.scoringVersion).toBeTruthy();
    expect(completed.metadata.answeredCount).toBe(36);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Template registry
// ═══════════════════════════════════════════════════════════════════════════

describe('template registry', () => {
  test('syncing registers every template with its hash and provenance', async () => {
    const { rows } = await db.pool.query('SELECT * FROM whodas_templates ORDER BY template_key');
    expect(rows).toHaveLength(registry.allTemplates().length);

    for (const row of rows) {
      const tpl = registry.templateByKey(row.template_key);
      expect(row.sha256).toBe(tpl.sha256);
      expect(row.page_count).toBe(tpl.pageCount);
      expect(row.source_provenance.sourceSha256)
        .toBe('a78fcb2503c726c84be7e74361aa225d0e2a34de7ecd4cbecac4e4d1ec22da6d');
      expect(row.source_provenance.sourcePages).toBeTruthy();
    }
  });

  test('syncing is idempotent', async () => {
    const before = await db.pool.query('SELECT COUNT(*)::int AS n FROM whodas_templates');
    const result = await registry.syncTemplates(db.pool);
    const after = await db.pool.query('SELECT COUNT(*)::int AS n FROM whodas_templates');

    expect(result.inserted).toBe(0);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  test('a registered hash that no longer matches disk is a hard stop', async () => {
    await db.pool.query(
      `UPDATE whodas_templates SET sha256 = $1 WHERE template_key = 'whodas-36-flashcards'`,
      ['b'.repeat(64)]
    );
    await expect(registry.syncTemplates(db.pool)).rejects.toThrow(/no longer match the files on disk/);
  });
});
