'use strict';

/**
 * INTERVIEW PREPARATION — full-lifecycle integration tests.
 * Real Express routes, real sessions, real SQL (migration 036).
 *
 * The scenario these tests encode is the Definition of Done, end to end:
 *
 *   the Owner opens Interview Preparation, sees the OT template, starts an
 *   interview for an applicant, types answers of every kind including one
 *   very long one, saves, exits, reopens and finds every character intact,
 *   scores the candidate, recommends, completes, downloads a PDF that
 *   contains the whole interview — and then grants that same capability to
 *   one administrator and takes it back again, while every other role, and
 *   the unauthorised administrator, are refused at the API and not merely in
 *   the navigation.
 *
 * The boundary tests matter most. An interview record holds employment
 * information about somebody who is not an employee; "the tab is hidden" is
 * not a security control, so every one of them calls the API directly.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { PDFDocument } = require('pdf-lib');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'InterviewPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '4mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../interview-routes'));
  return app;
}

let app;
let org;

async function agentFor(role, orgId, overrides) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser(Object.assign(
    { password_hash: hash, role, organisation_id: orgId }, overrides || {}));
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** Grant interview permissions directly, as the Owner's PUT endpoint would. */
async function grant(userId, permissions) {
  await db.pool.query('UPDATE users SET permissions = $2 WHERE id = $1',
    [userId, JSON.stringify(permissions)]);
}

async function startInterview(who, over) {
  const res = await who.agent.post('/api/interviews/records').send(Object.assign({
    templateKey: 'ot-interview',
    candidateName: 'Test Applicant',
    position: 'Occupational Therapist',
    interviewDate: '2026-08-20',
  }, over || {}));
  expect(res.status).toBe(201);
  return res.body.record;
}

/** The deliberately enormous answer from the manual verification scenario. */
const HUGE = Array.from({ length: 40 }, (_, i) =>
  `Paragraph ${i + 1}. The candidate gave a long, detailed and specific account of a community `
  + 'visit, the escalation that followed, the environmental assessment they completed and the '
  + 'follow-up they arranged with the support coordinator afterwards. '.repeat(4)).join('\n\n');

const MULTI_PARA = 'Two years paediatrics.\n\nOne year adult community.\n\nA short rehab placement.';

beforeAll(() => { app = buildApp(); });
beforeEach(async () => {
  await truncateAll();
  // Many logins per file from one IP; the real limiter is 10 per 15 minutes
  // (auth.js) and is exercised deliberately elsewhere, not incidentally here.
  require('../../auth')._resetLoginRateLimit();
  org = await seedOrganisation('Opal Therapy');
});
afterAll(async () => {
  // The limiter is per-IP, in-memory and PROCESS-wide, and the integration
  // suite runs every file in one worker (jest.integration.config.js sets
  // maxWorkers: 1). This file logs in ~60 times; leaving the counter
  // exhausted would 429 the first logins of whichever file runs next, and
  // that file would then see 401s from an agent that never got a session.
  require('../../auth')._resetLoginRateLimit();
  await closePool();
});

// ═══════════════════════════════════════════════════════════════════════════
//  ACCESS
// ═══════════════════════════════════════════════════════════════════════════

describe('who may reach Interview Preparation at all', () => {
  test('the owner can, without anybody granting them anything', async () => {
    const owner = await agentFor('owner', org.id);
    const res = await owner.agent.get('/api/interviews/templates');
    expect(res.status).toBe(200);
    expect(res.body.templates.map((t) => t.key)).toContain('ot-interview');
    expect(res.body.capabilities).toEqual({ viewAll: true, manageAccess: true, delete: true });
  });

  test('an admin CANNOT, until the owner says so', async () => {
    const admin = await agentFor('admin', org.id);
    const res = await admin.agent.get('/api/interviews/templates');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/interviews\.access/);
  });

  test('an authorised admin can', async () => {
    const admin = await agentFor('admin', org.id);
    await grant(admin.user.id, ['interviews.access']);
    const res = await admin.agent.get('/api/interviews/templates');
    expect(res.status).toBe(200);
    // Access to conduct interviews is not access to everybody else's.
    expect(res.body.capabilities).toEqual({ viewAll: false, manageAccess: false, delete: false });
  });

  test('a therapist cannot — recruitment is not a clinical surface', async () => {
    const therapist = await agentFor('therapist', org.id);
    expect((await therapist.agent.get('/api/interviews/templates')).status).toBe(403);
    expect((await therapist.agent.get('/api/interviews/records')).status).toBe(403);
  });

  test('a read-only account cannot', async () => {
    const ro = await agentFor('read_only', org.id);
    expect((await ro.agent.get('/api/interviews/templates')).status).toBe(403);
  });

  test('a pre-employee cannot — they are a recruitment subject, not a reader', async () => {
    const pre = await agentFor('pre_employee', org.id);
    const res = await pre.agent.get('/api/interviews/records');
    expect(res.status).toBe(403);
  });

  test('an anonymous caller gets 401, not a hint about what exists', async () => {
    const anon = request.agent(app);
    for (const path of [
      '/api/interviews/templates',
      '/api/interviews/templates/ot-interview',
      '/api/interviews/templates/ot-interview/pdf',
      '/api/interviews/records',
      '/api/interviews/permissions',
    ]) {
      expect(`${path}:${(await anon.get(path)).status}`).toBe(`${path}:401`);
    }
  });

  test('EVERY route is refused to an unauthorised admin, not just the listing', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);
    const admin = await agentFor('admin', org.id);

    const attempts = [
      ['get', '/api/interviews/templates'],
      ['get', '/api/interviews/templates/ot-interview'],
      ['get', '/api/interviews/templates/ot-interview/pdf'],
      ['get', '/api/interviews/records'],
      ['post', '/api/interviews/records'],
      ['get', `/api/interviews/records/${record.id}`],
      ['patch', `/api/interviews/records/${record.id}`],
      ['post', `/api/interviews/records/${record.id}/complete`],
      ['post', `/api/interviews/records/${record.id}/reopen`],
      ['post', `/api/interviews/records/${record.id}/archive`],
      ['post', `/api/interviews/records/${record.id}/restore`],
      ['delete', `/api/interviews/records/${record.id}`],
      ['get', `/api/interviews/records/${record.id}/pdf`],
      ['get', '/api/interviews/permissions'],
      ['put', `/api/interviews/permissions/${admin.user.id}`],
    ];
    for (const [method, path] of attempts) {
      const res = await admin.agent[method](path).send({});
      expect(`${method} ${path}:${res.status}`).toBe(`${method} ${path}:403`);
    }
  });

  test('the PDF endpoints are not a back door — no unauthenticated download', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);
    const anon = request.agent(app);
    expect((await anon.get(`/api/interviews/records/${record.id}/pdf`)).status).toBe(401);
    const therapist = await agentFor('therapist', org.id);
    expect((await therapist.agent.get(`/api/interviews/records/${record.id}/pdf`)).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  DELEGATION
// ═══════════════════════════════════════════════════════════════════════════

describe('the owner grants and revokes Interview Preparation', () => {
  test('the delegation screen lists administrators and shows the owner as implicit', async () => {
    const owner = await agentFor('owner', org.id, { name: 'Owner O' });
    const admin = await agentFor('admin', org.id, { name: 'Admin A' });
    await agentFor('therapist', org.id, { name: 'Therapist T' });

    const res = await owner.agent.get('/api/interviews/permissions');
    expect(res.status).toBe(200);
    expect(res.body.available).toEqual(['interviews.access', 'interviews.view_all']);
    const byId = Object.fromEntries(res.body.users.map((u) => [u.id, u]));
    expect(byId[owner.user.id].implicit).toBe(true);
    expect(byId[owner.user.id].granted).toEqual(['interviews.access', 'interviews.view_all']);
    expect(byId[admin.user.id].implicit).toBe(false);
    expect(byId[admin.user.id].granted).toEqual([]);
    // Clinicians are not even offered — they cannot hold this.
    expect(res.body.users.map((u) => u.role).sort()).toEqual(['admin', 'owner']);
  });

  test('a grant takes effect immediately, and a revoke takes it away again', async () => {
    const owner = await agentFor('owner', org.id);
    const admin = await agentFor('admin', org.id);

    expect((await admin.agent.get('/api/interviews/records')).status).toBe(403);

    const granted = await owner.agent.put(`/api/interviews/permissions/${admin.user.id}`)
      .send({ permissions: ['interviews.access'] });
    expect(granted.status).toBe(200);
    expect((await admin.agent.get('/api/interviews/records')).status).toBe(200);

    const revoked = await owner.agent.put(`/api/interviews/permissions/${admin.user.id}`)
      .send({ permissions: [] });
    expect(revoked.status).toBe(200);
    expect((await admin.agent.get('/api/interviews/records')).status).toBe(403);
  });

  test('a revoked admin loses the records they could previously open', async () => {
    const owner = await agentFor('owner', org.id);
    const admin = await agentFor('admin', org.id);
    await owner.agent.put(`/api/interviews/permissions/${admin.user.id}`)
      .send({ permissions: ['interviews.access'] });

    const mine = await startInterview(admin, { candidateName: 'Admin Applicant' });
    expect((await admin.agent.get(`/api/interviews/records/${mine.id}`)).status).toBe(200);

    await owner.agent.put(`/api/interviews/permissions/${admin.user.id}`).send({ permissions: [] });

    expect((await admin.agent.get(`/api/interviews/records/${mine.id}`)).status).toBe(403);
    expect((await admin.agent.get(`/api/interviews/records/${mine.id}/pdf`)).status).toBe(403);
    // And the record itself is untouched — revoking access is not deletion.
    expect((await owner.agent.get(`/api/interviews/records/${mine.id}`)).status).toBe(200);
  });

  test('an admin cannot grant themselves, or anybody else, access', async () => {
    const admin = await agentFor('admin', org.id);
    await grant(admin.user.id, ['interviews.access', 'interviews.view_all']);
    const other = await agentFor('admin', org.id);

    expect((await admin.agent.get('/api/interviews/permissions')).status).toBe(403);
    const self = await admin.agent.put(`/api/interviews/permissions/${admin.user.id}`)
      .send({ permissions: ['interviews.access', 'interviews.view_all'] });
    expect(self.status).toBe(403);
    const colleague = await admin.agent.put(`/api/interviews/permissions/${other.user.id}`)
      .send({ permissions: ['interviews.access'] });
    expect(colleague.status).toBe(403);
    // …and the colleague really did not get it.
    expect((await other.agent.get('/api/interviews/records')).status).toBe(403);
  });

  test('a clinician cannot be given interview access even by the owner', async () => {
    const owner = await agentFor('owner', org.id);
    const therapist = await agentFor('therapist', org.id);
    const res = await owner.agent.put(`/api/interviews/permissions/${therapist.user.id}`)
      .send({ permissions: ['interviews.access'] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('role_not_delegable');
    expect((await therapist.agent.get('/api/interviews/templates')).status).toBe(403);
  });

  test('an unknown permission string is refused, not stored', async () => {
    const owner = await agentFor('owner', org.id);
    const admin = await agentFor('admin', org.id);
    const res = await owner.agent.put(`/api/interviews/permissions/${admin.user.id}`)
      .send({ permissions: ['interviews.superuser'] });
    expect(res.status).toBe(400);
    const { rows } = await db.pool.query('SELECT permissions FROM users WHERE id = $1', [admin.user.id]);
    expect(rows[0].permissions || []).toEqual([]);
  });

  test('view_all without access is refused as the unusable combination it is', async () => {
    const owner = await agentFor('owner', org.id);
    const admin = await agentFor('admin', org.id);
    const res = await owner.agent.put(`/api/interviews/permissions/${admin.user.id}`)
      .send({ permissions: ['interviews.view_all'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_combination');
  });

  test('granting interviews never disturbs an onboarding grant on the same person', async () => {
    const owner = await agentFor('owner', org.id);
    const admin = await agentFor('admin', org.id);
    await grant(admin.user.id, ['onboarding.view', 'onboarding.assign']);

    await owner.agent.put(`/api/interviews/permissions/${admin.user.id}`)
      .send({ permissions: ['interviews.access'] });
    let { rows } = await db.pool.query('SELECT permissions FROM users WHERE id = $1', [admin.user.id]);
    expect(rows[0].permissions.sort()).toEqual(
      ['interviews.access', 'onboarding.assign', 'onboarding.view']);

    // …and revoking interviews leaves onboarding exactly as it was.
    await owner.agent.put(`/api/interviews/permissions/${admin.user.id}`).send({ permissions: [] });
    ({ rows } = await db.pool.query('SELECT permissions FROM users WHERE id = $1', [admin.user.id]));
    expect(rows[0].permissions.sort()).toEqual(['onboarding.assign', 'onboarding.view']);
  });

  test('an owner cannot be stripped of their own implicit access', async () => {
    const owner = await agentFor('owner', org.id);
    const res = await owner.agent.put(`/api/interviews/permissions/${owner.user.id}`)
      .send({ permissions: [] });
    expect(res.status).toBe(409);
    expect((await owner.agent.get('/api/interviews/templates')).status).toBe(200);
  });

  test('the delegation change is audited, with ids and no candidate content', async () => {
    const owner = await agentFor('owner', org.id);
    const admin = await agentFor('admin', org.id);
    await owner.agent.put(`/api/interviews/permissions/${admin.user.id}`)
      .send({ permissions: ['interviews.access'] });
    await owner.agent.put(`/api/interviews/permissions/${admin.user.id}`).send({ permissions: [] });

    const { rows } = await db.pool.query(
      "SELECT action, target_id, metadata FROM audit_logs WHERE action = 'INTERVIEW_ACCESS_CHANGED' ORDER BY created_at");
    expect(rows).toHaveLength(2);
    expect(rows[0].metadata.granted).toEqual(['interviews.access']);
    expect(rows[1].metadata.revoked).toEqual(['interviews.access']);
    expect(rows[0].target_id).toBe(admin.user.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE INTERVIEW ITSELF
// ═══════════════════════════════════════════════════════════════════════════

describe('conducting an interview', () => {
  test('starting one creates a record with sensible defaults and a frozen template', async () => {
    const owner = await agentFor('owner', org.id, { name: 'Ann Owner' });
    const res = await owner.agent.post('/api/interviews/records')
      .send({ templateKey: 'ot-interview', candidateName: 'Jane Smith' });

    expect(res.status).toBe(201);
    const r = res.body.record;
    expect(r.candidateName).toBe('Jane Smith');
    expect(r.status).toBe('draft');
    expect(r.position).toBe('Occupational Therapist');       // the template's default
    expect(r.interviewers).toBe('Ann Owner');                 // the signed-in user
    expect(r.interviewDate).toBeTruthy();                     // today
    expect(r.templateVersion).toBe(1);
    expect(r.canEdit).toBe(true);
    expect(r.route).toBe(`#interviews/record/${r.id}`);
    // The whole template is frozen onto the record, not referenced.
    expect(r.template.sections).toHaveLength(8);
    expect(r.progress.total).toBeGreaterThan(35);
  });

  test('an interview cannot be started without a candidate, or on a template that does not exist', async () => {
    const owner = await agentFor('owner', org.id);
    expect((await owner.agent.post('/api/interviews/records')
      .send({ templateKey: 'ot-interview' })).status).toBe(400);
    expect((await owner.agent.post('/api/interviews/records')
      .send({ templateKey: 'ot-interview', candidateName: '   ' })).status).toBe(400);
    expect((await owner.agent.post('/api/interviews/records')
      .send({ templateKey: 'senior-ot', candidateName: 'X' })).status).toBe(400);
  });

  test('THE FULL SCENARIO — save, exit, reopen, and every answer is exactly as typed', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner, { candidateName: 'Test Applicant' });

    const saved = await owner.agent.patch(`/api/interviews/records/${record.id}`).send({
      responses: {
        client_groups: ['paediatrics', 'disability', 'neurological'],
        client_groups_notes: MULTI_PARA,
        independent_visits: HUGE,
        mixed_caseload: 'Comfortable.',
        availability: { option: 'other', detail: '0.8 FTE, school hours' },
        expected_salary: '$95,000 + super',
        key_strengths: 'Reflective; safe; warm.',
        support_required: 'Complex seating; assistive technology.',
        overall_comments: 'Would suit the community team.',
        next_steps: 'Offer subject to references — NDIS worker screening required.',
      },
      ratings: {
        clinical_reasoning: 4, communication: 5, self_awareness: 3,
        community_readiness: 4, culture_fit: 5,
      },
      recommendation: 'progress',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.record.status).toBe('in_progress');   // Save & Exit moved it along

    // Reopen — a fresh request, nothing cached.
    const reopened = await owner.agent.get(`/api/interviews/records/${record.id}`);
    expect(reopened.status).toBe(200);
    const r = reopened.body.record;

    expect(r.responses.client_groups).toEqual(['paediatrics', 'disability', 'neurological']);
    expect(r.responses.client_groups_notes).toBe(MULTI_PARA);
    expect(r.responses.independent_visits).toBe(HUGE);        // character for character
    expect(r.responses.independent_visits.length).toBeGreaterThan(11000);
    expect(r.responses.availability).toEqual({ option: 'other', detail: '0.8 FTE, school hours' });
    expect(r.responses.expected_salary).toBe('$95,000 + super');
    expect(r.ratings).toEqual({
      clinical_reasoning: 4, communication: 5, self_awareness: 3,
      community_readiness: 4, culture_fit: 5,
    });
    expect(r.recommendation).toBe('progress');
    expect(r.recommendationLabel).toBe('Progress to next stage / reference checks');
  });

  test('a partial save merges rather than replacing — autosave never wipes an earlier answer', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);

    await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ responses: { key_strengths: 'First answer.' } });
    await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ responses: { overall_comments: 'Second answer.' } });

    const res = await owner.agent.get(`/api/interviews/records/${record.id}`);
    expect(res.body.record.responses).toEqual({
      key_strengths: 'First answer.',
      overall_comments: 'Second answer.',
    });
  });

  test('the candidate\'s details can be corrected mid-interview', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner, { candidateName: 'Jane Smyth' });
    const res = await owner.agent.patch(`/api/interviews/records/${record.id}`).send({
      candidateName: 'Jane Smith',
      position: 'Senior Occupational Therapist',
      interviewers: 'Ann Owner and Bo Admin',
      interviewDate: '2026-09-01',
    });
    expect(res.status).toBe(200);
    expect(res.body.record.candidateName).toBe('Jane Smith');
    expect(res.body.record.interviewers).toBe('Ann Owner and Bo Admin');
    expect(String(res.body.record.interviewDate)).toContain('2026-09-01');
  });

  test('an answer to a question the template does not have is dropped, never stored', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);
    await owner.agent.patch(`/api/interviews/records/${record.id}`).send({
      responses: { key_strengths: 'kept', invented_question: 'dropped', __proto__: { x: 1 } },
    });
    const res = await owner.agent.get(`/api/interviews/records/${record.id}`);
    expect(res.body.record.responses).toEqual({ key_strengths: 'kept' });
  });

  test('an out-of-scale rating and an invented recommendation are refused or dropped', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);

    await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ ratings: { clinical_reasoning: 9, communication: 3, invented: 5 } });
    const bad = await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ recommendation: 'hire_immediately' });
    expect(bad.status).toBe(400);

    const res = await owner.agent.get(`/api/interviews/records/${record.id}`);
    expect(res.body.record.ratings).toEqual({ communication: 3 });
    expect(res.body.record.recommendation).toBeNull();
  });

  test('an invalid date is refused rather than silently discarded', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);
    const res = await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ interviewDate: 'next Tuesday' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_date');
  });

  test('a stale save is refused with the current record attached, not silently overwritten', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);
    await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ responses: { key_strengths: 'from the other tab' } });

    const res = await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ expectedUpdatedAt: record.updatedAt, responses: { key_strengths: 'stale' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('stale');
    expect(res.body.record.responses.key_strengths).toBe('from the other tab');
  });

  test('completion requires the four identifying facts and NOTHING else', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner, { position: null });
    // Every question blank; only the position missing.
    await owner.agent.patch(`/api/interviews/records/${record.id}`).send({ position: '' });

    const refused = await owner.agent.post(`/api/interviews/records/${record.id}/complete`);
    expect(refused.status).toBe(422);
    expect(refused.body.missing).toEqual(['Role / position']);

    await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ position: 'Occupational Therapist' });
    const done = await owner.agent.post(`/api/interviews/records/${record.id}/complete`);
    // An interview note is allowed to be partial: 38 blank questions and it
    // still completes, with the blank count reported rather than enforced.
    expect(done.status).toBe(200);
    expect(done.body.record.status).toBe('completed');
    expect(done.body.blankQuestions).toBeGreaterThan(30);
  });

  test('a completed interview stays readable, and reopening records that it changed', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);
    await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ responses: { key_strengths: 'Original.' } });
    await owner.agent.post(`/api/interviews/records/${record.id}/complete`);

    // Still fully readable.
    let res = await owner.agent.get(`/api/interviews/records/${record.id}`);
    expect(res.body.record.status).toBe('completed');
    expect(res.body.record.responses.key_strengths).toBe('Original.');

    // Editing a completed record is allowed, and leaves a mark.
    res = await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ responses: { key_strengths: 'Amended after the panel met.' } });
    expect(res.status).toBe(200);
    expect(res.body.record.status).toBe('completed');
    expect(res.body.record.postCompletionEdits).toBe(1);

    const { rows } = await db.pool.query(
      "SELECT action FROM audit_logs WHERE action = 'INTERVIEW_EDITED_AFTER_COMPLETION'");
    expect(rows).toHaveLength(1);

    // Reopening puts it back in progress without losing the completion date.
    const reopened = await owner.agent.post(`/api/interviews/records/${record.id}/reopen`);
    expect(reopened.body.record.status).toBe('in_progress');
    expect(reopened.body.record.completedAt).toBeTruthy();
    expect(reopened.body.record.reopenedAt).toBeTruthy();
  });

  test('archive hides from the working list without losing anything; restore brings it back', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);
    await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ responses: { key_strengths: 'Kept through the archive.' } });
    await owner.agent.post(`/api/interviews/records/${record.id}/complete`);
    await owner.agent.post(`/api/interviews/records/${record.id}/archive`);

    let list = await owner.agent.get('/api/interviews/records');
    expect(list.body.records.map((r) => r.id)).not.toContain(record.id);
    list = await owner.agent.get('/api/interviews/records?status=archived');
    expect(list.body.records.map((r) => r.id)).toContain(record.id);

    // An archived record is read-only until restored.
    const blocked = await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ responses: { key_strengths: 'nope' } });
    expect(blocked.status).toBe(409);

    const restored = await owner.agent.post(`/api/interviews/records/${record.id}/restore`);
    expect(restored.body.record.status).toBe('completed');   // back to what it was
    const res = await owner.agent.get(`/api/interviews/records/${record.id}`);
    expect(res.body.record.responses.key_strengths).toBe('Kept through the archive.');
  });

  test('the portal keeps the structured record — the PDF is an export, not the storage', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);
    await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ responses: { independent_visits: HUGE } });

    const { rows } = await db.pool.query(
      'SELECT responses, template_schema FROM interview_records WHERE id = $1', [record.id]);
    expect(rows[0].responses.independent_visits).toBe(HUGE);
    expect(rows[0].template_schema.sections).toHaveLength(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  VISIBILITY
// ═══════════════════════════════════════════════════════════════════════════

describe('who sees which records', () => {
  test('the owner sees interviews conducted by an authorised admin', async () => {
    const owner = await agentFor('owner', org.id, { name: 'Ann Owner' });
    const admin = await agentFor('admin', org.id, { name: 'Bo Admin' });
    await grant(admin.user.id, ['interviews.access']);

    const theirs = await startInterview(admin, { candidateName: 'Admin Applicant' });

    const list = await owner.agent.get('/api/interviews/records');
    expect(list.body.scope).toBe('practice');
    const row = list.body.records.find((r) => r.id === theirs.id);
    expect(row).toBeTruthy();
    // …and it says who actually conducted it.
    expect(row.createdByName).toBe('Bo Admin');
    expect((await owner.agent.get(`/api/interviews/records/${theirs.id}`)).status).toBe(200);
    expect((await owner.agent.get(`/api/interviews/records/${theirs.id}/pdf`)).status).toBe(200);
  });

  test('an authorised admin sees only their own, unless the owner widened it', async () => {
    const owner = await agentFor('owner', org.id);
    const admin = await agentFor('admin', org.id);
    await grant(admin.user.id, ['interviews.access']);

    const ownersRecord = await startInterview(owner, { candidateName: 'Owner Applicant' });
    const adminsRecord = await startInterview(admin, { candidateName: 'Admin Applicant' });

    let list = await admin.agent.get('/api/interviews/records');
    expect(list.body.scope).toBe('own');
    expect(list.body.records.map((r) => r.id)).toEqual([adminsRecord.id]);
    // Somebody else's record is a 404 — indistinguishable from absent.
    expect((await admin.agent.get(`/api/interviews/records/${ownersRecord.id}`)).status).toBe(404);
    expect((await admin.agent.get(`/api/interviews/records/${ownersRecord.id}/pdf`)).status).toBe(404);

    await grant(admin.user.id, ['interviews.access', 'interviews.view_all']);
    list = await admin.agent.get('/api/interviews/records');
    expect(list.body.scope).toBe('practice');
    expect(list.body.records.map((r) => r.id).sort())
      .toEqual([ownersRecord.id, adminsRecord.id].sort());
    expect((await admin.agent.get(`/api/interviews/records/${ownersRecord.id}`)).status).toBe(200);
  });

  test('view_all is READ — it never confers the right to change somebody else\'s interview', async () => {
    const owner = await agentFor('owner', org.id);
    const admin = await agentFor('admin', org.id);
    await grant(admin.user.id, ['interviews.access', 'interviews.view_all']);
    const ownersRecord = await startInterview(owner, { candidateName: 'Owner Applicant' });

    const read = await admin.agent.get(`/api/interviews/records/${ownersRecord.id}`);
    expect(read.status).toBe(200);
    expect(read.body.record.canEdit).toBe(false);
    expect(read.body.record.canDelete).toBe(false);

    for (const [method, suffix] of [
      ['patch', ''], ['post', '/complete'], ['post', '/reopen'], ['post', '/archive'],
    ]) {
      const res = await admin.agent[method](`/api/interviews/records/${ownersRecord.id}${suffix}`).send({});
      expect(`${method}${suffix}:${res.status}`).toBe(`${method}${suffix}:403`);
    }
  });

  test('a record in another organisation is a 404, even for that org\'s owner', async () => {
    const otherOrg = await seedOrganisation('Another Practice');
    const owner = await agentFor('owner', org.id);
    const foreignOwner = await agentFor('owner', otherOrg.id);
    const record = await startInterview(owner);

    expect((await foreignOwner.agent.get(`/api/interviews/records/${record.id}`)).status).toBe(404);
    expect((await foreignOwner.agent.get(`/api/interviews/records/${record.id}/pdf`)).status).toBe(404);
    expect((await foreignOwner.agent.delete(`/api/interviews/records/${record.id}`)).status).toBe(404);
    expect((await foreignOwner.agent.get('/api/interviews/records')).body.records).toEqual([]);
    // …and the foreign owner cannot change that org's permissions either.
    const localAdmin = await agentFor('admin', org.id);
    expect((await foreignOwner.agent.put(`/api/interviews/permissions/${localAdmin.user.id}`)
      .send({ permissions: ['interviews.access'] })).status).toBe(404);
  });

  test('a malformed or unknown record id is a plain 404, never a 500', async () => {
    const owner = await agentFor('owner', org.id);
    for (const id of ['not-a-uuid', '../../etc/passwd', '00000000-0000-0000-0000-000000000000', '1 OR 1=1']) {
      const res = await owner.agent.get(`/api/interviews/records/${encodeURIComponent(id)}`);
      expect(`${id}:${res.status}`).toBe(`${id}:404`);
    }
  });

  test('deletion is the owner\'s alone; everybody else archives', async () => {
    const owner = await agentFor('owner', org.id);
    const admin = await agentFor('admin', org.id);
    await grant(admin.user.id, ['interviews.access']);
    const theirs = await startInterview(admin);

    expect((await admin.agent.delete(`/api/interviews/records/${theirs.id}`)).status).toBe(403);
    expect((await owner.agent.delete(`/api/interviews/records/${theirs.id}`)).status).toBe(200);
    const { rows } = await db.pool.query('SELECT id FROM interview_records WHERE id = $1', [theirs.id]);
    expect(rows).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  SEARCH AND FILTERING
// ═══════════════════════════════════════════════════════════════════════════

describe('finding a record', () => {
  test('by applicant, position, status and date', async () => {
    const owner = await agentFor('owner', org.id);
    const jane = await startInterview(owner, {
      candidateName: 'Jane Smith', position: 'Occupational Therapist', interviewDate: '2026-08-01' });
    const raj = await startInterview(owner, {
      candidateName: 'Raj Patel', position: 'Therapy Assistant', interviewDate: '2026-09-01' });
    await owner.agent.post(`/api/interviews/records/${jane.id}/complete`);

    const only = async (qs) => (await owner.agent.get(`/api/interviews/records${qs}`)).body.records.map((r) => r.id);

    expect(await only('?q=jane')).toEqual([jane.id]);
    expect(await only('?q=SMITH')).toEqual([jane.id]);
    expect(await only('?q=assistant')).toEqual([raj.id]);
    expect(await only('?status=completed')).toEqual([jane.id]);
    expect(await only('?status=draft')).toEqual([raj.id]);
    expect(await only('?from=2026-08-15')).toEqual([raj.id]);
    expect(await only('?to=2026-08-15')).toEqual([jane.id]);
    expect((await only('?q=nobody')).length).toBe(0);
  });

  test('a search term with SQL metacharacters matches literally', async () => {
    const owner = await agentFor('owner', org.id);
    await startInterview(owner, { candidateName: "O'Brien 100% sure" });
    await startInterview(owner, { candidateName: 'Someone Else' });

    const res = await owner.agent.get(`/api/interviews/records?q=${encodeURIComponent("O'Brien")}`);
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(1);

    // '%' is a LIKE wildcard; passed as a parameter it is still just a character.
    const wild = await owner.agent.get('/api/interviews/records?q=%25');
    expect(wild.body.records.map((r) => r.candidateName)).toEqual(["O'Brien 100% sure"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  DOCUMENTS
// ═══════════════════════════════════════════════════════════════════════════

describe('PDF export', () => {
  async function fieldsOf(buffer) {
    const doc = await PDFDocument.load(buffer);
    const form = doc.getForm();
    const names = form.getFields().map((f) => f.getName());
    const textOf = (n) => { try { return form.getTextField(n).getText() || ''; } catch (_) { return null; } };
    const whole = (key) => names.filter((n) => n === key || n.startsWith(`${key}__cont`))
      .sort((a, b) => (a.length - b.length) || a.localeCompare(b)).map(textOf).join('\n');
    return { doc, form, names, textOf, whole, pageCount: doc.getPageCount() };
  }

  test('the blank template downloads as a fillable PDF with a sensible filename', async () => {
    const owner = await agentFor('owner', org.id);
    const res = await owner.agent.get('/api/interviews/templates/ot-interview/pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition'])
      .toBe('attachment; filename="Opal_Therapy_Occupational_Therapist_Interview_Template.pdf"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    const f = await fieldsOf(res.body);
    expect(f.names).toContain('candidate_name');
    expect(f.names).toContain('overall_observations');
    expect(f.pageCount).toBeGreaterThanOrEqual(5);
  });

  test('?disposition=inline serves the SAME document for printing', async () => {
    const owner = await agentFor('owner', org.id);
    const res = await owner.agent.get('/api/interviews/templates/ot-interview/pdf?disposition=inline');
    expect(res.headers['content-disposition']).toMatch(/^inline; filename=/);
  });

  test('a completed interview exports with everything on it and nothing clipped', async () => {
    const owner = await agentFor('owner', org.id, { name: 'Ann Owner' });
    const record = await startInterview(owner, { candidateName: 'Test Applicant' });
    await owner.agent.patch(`/api/interviews/records/${record.id}`).send({
      responses: {
        client_groups: ['paediatrics', 'disability'],
        client_groups_notes: MULTI_PARA,
        independent_visits: HUGE,
        key_strengths: 'Reflective; safe; warm.',
        support_required: 'Complex seating.',
        overall_comments: 'Would suit the community team.',
        next_steps: 'Offer subject to references.',
      },
      ratings: {
        clinical_reasoning: 4, communication: 5, self_awareness: 3,
        community_readiness: 4, culture_fit: 5,
      },
      recommendation: 'progress',
    });
    await owner.agent.post(`/api/interviews/records/${record.id}/complete`);

    const res = await owner.agent.get(`/api/interviews/records/${record.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition'])
      .toBe('attachment; filename="Opal_Therapy_OT_Interview_Test_Applicant_2026-08-20.pdf"');
    expect(res.headers['cache-control']).toBe('no-store, private');

    const f = await fieldsOf(res.body);
    expect(f.textOf('candidate_name')).toBe('Test Applicant');
    expect(f.textOf('role_position')).toBe('Occupational Therapist');
    expect(f.textOf('client_groups_notes')).toBe(MULTI_PARA);
    expect(f.form.getCheckBox('client_groups__paediatrics').isChecked()).toBe(true);
    expect(f.form.getCheckBox('client_groups__adults').isChecked()).toBe(false);
    expect(f.form.getRadioGroup('ratings__communication').getSelected()).toBe('5');
    expect(f.form.getRadioGroup('recommendation').getSelected()).toBe('progress');
    expect(f.textOf('next_steps')).toBe('Offer subject to references.');

    // The very long answer is present in full and paginated onto extra pages.
    const strip = (s) => s.replace(/\s+/g, ' ').trim();
    expect(strip(f.whole('independent_visits'))).toBe(strip(HUGE));
    expect(f.pageCount).toBeGreaterThan(8);
  }, 30000);

  test('a hostile candidate name cannot rewrite the Content-Disposition header', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner, {
      candidateName: '"; attachment; filename="payroll.csv',
      interviewDate: '2026-08-20',
    });
    const res = await owner.agent.get(`/api/interviews/records/${record.id}/pdf`);
    expect(res.status).toBe(200);
    const cd = res.headers['content-disposition'];
    expect(cd).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.pdf"$/);
    expect(cd).not.toContain('payroll.csv"');
  });

  test('every export is audited, and the audit carries no answers', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);
    await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ responses: { key_strengths: 'a secret about the candidate' } });
    await owner.agent.get(`/api/interviews/records/${record.id}/pdf`);
    await owner.agent.get('/api/interviews/templates/ot-interview/pdf');

    const { rows } = await db.pool.query(
      "SELECT action, target_id, metadata FROM audit_logs WHERE action LIKE 'INTERVIEW%' ORDER BY created_at");
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('INTERVIEW_CREATED');
    expect(actions).toContain('INTERVIEW_PDF_EXPORTED');
    expect(actions).toContain('INTERVIEW_TEMPLATE_EXPORTED');
    for (const row of rows) {
      expect(JSON.stringify(row.metadata || {})).not.toContain('a secret about the candidate');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  VERSIONING
// ═══════════════════════════════════════════════════════════════════════════

describe('template versioning', () => {
  test('a record keeps the questions it was created with, whatever the module later says', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);
    await owner.agent.patch(`/api/interviews/records/${record.id}`)
      .send({ responses: { good_supervision: 'Regular, planned, and about my learning.' } });

    // Simulate the template being edited after this record was created: the
    // snapshot on the row is what everything reads, so the record is
    // untouched by a later reword.
    await db.pool.query(
      `UPDATE interview_records
          SET template_schema = jsonb_set(template_schema, '{name}', '"Renamed Template"')
        WHERE id = $1`, [record.id]);

    const res = await owner.agent.get(`/api/interviews/records/${record.id}`);
    expect(res.body.record.template.name).toBe('Renamed Template');
    expect(res.body.record.responses.good_supervision)
      .toBe('Regular, planned, and about my learning.');

    // A brand-new interview still gets the LIVE template.
    const fresh = await startInterview(owner, { candidateName: 'Second Applicant' });
    expect(fresh.template.name).toBe('Occupational Therapist Interview');
  });

  test('an answer is coerced against the record\'s own snapshot, not the live template', async () => {
    const owner = await agentFor('owner', org.id);
    const record = await startInterview(owner);

    // An older, smaller template: only section 1 was ever asked.
    await db.pool.query(
      `UPDATE interview_records
          SET template_schema = jsonb_set(template_schema, '{sections}',
                (template_schema -> 'sections') - 1 - 1 - 1 - 1 - 1 - 1 - 1)
        WHERE id = $1`, [record.id]);

    const res = await owner.agent.patch(`/api/interviews/records/${record.id}`).send({
      responses: {
        client_groups_notes: 'asked in this version',
        key_strengths: 'added to the template later',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.record.responses).toEqual({ client_groups_notes: 'asked in this version' });
  });
});
