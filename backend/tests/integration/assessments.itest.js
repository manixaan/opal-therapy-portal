'use strict';

/**
 * THE ASSESSMENT FRAMEWORK — integration tests (real Express, real sessions,
 * real SQL, real WHO template hashes, real scoring engine).
 *
 * Nothing is stubbed. These exercise the workflow a clinician actually walks:
 * browse the catalogue → open an assessment's information page → start it for a
 * client → save a draft → resume it → complete and score it → read the results
 * → see it in the client's history → prepare it for sharing.
 *
 * What is tested here that the unit tests cannot reach:
 *   - the catalogue answers even when an instrument's module is switched off,
 *     which is the whole point of not feature-gating it;
 *   - a draft is personal and a filed record is the organisation's;
 *   - another organisation's record is a 404, not a 403;
 *   - the share route prepares and audits, and sends nothing;
 *   - a completed assessment really does appear in the client's history, tied
 *     to the exact template version it was completed against.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const instrument = require('../../whodas/instrument');
const registry = require('../../whodas/template-registry');

const PASSWORD = 'AssessPass123';
const CLIENT_A = 'splose-client-a';
const CLIENT_B = 'splose-client-b';
const WHODAS_KEY = 'whodas-2.0-36';

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '8mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET, resave: false,
    saveUninitialized: false, cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../whodas-routes'));
  app.use('/', require('../../assessments-routes'));
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
  // Every test signs several users in from one IP, which is exactly what the
  // login rate limiter exists to stop. Clear it between logins rather than
  // weakening the limiter for the sake of the suite.
  require('../../auth')._resetLoginRateLimit();
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed (${res.status}) for role ${role}`);
  return { agent, user: rows[0] };
}

/** Answer every applicable item so completion validation passes. */
function fullResponses() {
  const responses = {};
  instrument.ITEM_IDS.forEach((id) => { responses[id] = 'mild'; });
  return responses;
}

beforeAll(() => {
  process.env.ENABLE_WHODAS_ASSESSMENT = 'true';
  app = buildApp();
});

beforeEach(async () => {
  await truncateAll();
  // truncateAll clears whodas_templates too, and an assessment pins the exact
  // WHO document it was rendered from. Re-register the real templates from
  // disk, hashes and all, exactly as application boot does.
  await registry.syncTemplates(db.pool);
});

afterAll(closePool);

// ── Catalogue ───────────────────────────────────────────────────────────────

describe('the catalogue', () => {
  test('lists every configured assessment with an availability state', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const res = await agent.get('/api/assessments/catalogue');
    expect(res.status).toBe(200);
    expect(res.body.assessments.length).toBeGreaterThanOrEqual(28);

    for (const a of res.body.assessments) {
      expect(typeof a.availability.state).toBe('string');
      expect(typeof a.availability.label).toBe('string');
      // No entry is gated on a rights review any more.
      expect(JSON.stringify(a.availability)).not.toMatch(/awaiting human confirmation/i);
    }

    const whodas = res.body.assessments.find((a) => a.key === WHODAS_KEY);
    expect(whodas.availability.state).toBe('electronic-and-pdf');
    expect(whodas.availability.canStart).toBe(true);
    expect(whodas.attribution.rightsHolder).toBe('World Health Organization');
  });

  test('an unheld instrument stays visible and names what is missing', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const res = await agent.get('/api/assessments/catalogue/copm');
    expect(res.status).toBe(200);
    expect(res.body.assessment.availability.state).toBe('source-required');
    expect(res.body.assessment.availability.missingSources.length).toBeGreaterThan(0);
  });

  test('it carries no item wording and no scoring rule', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const res = await agent.get('/api/assessments/catalogue');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/Concentrating on doing something/);
    expect(body).not.toMatch(/Extreme or cannot do/);
    expect(body).not.toMatch(/st_s3[26]/);
  });

  test('it still answers when the instrument module is switched off', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    process.env.ENABLE_WHODAS_ASSESSMENT = 'false';
    try {
      const res = await agent.get('/api/assessments/catalogue');
      expect(res.status).toBe(200);                 // NOT 404 — see the route header
      const whodas = res.body.assessments.find((a) => a.key === WHODAS_KEY);
      expect(whodas.availability.state).toBe('temporarily-unavailable');
      expect(whodas.availability.reason).toMatch(/ENABLE_WHODAS_ASSESSMENT/);
      expect(whodas.availability.canStart).toBe(false);
    } finally {
      process.env.ENABLE_WHODAS_ASSESSMENT = 'true';
    }
  });

  test('an unknown key is a 404, not an invented assessment', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    expect((await agent.get('/api/assessments/catalogue/not-an-instrument')).status).toBe(404);
  });

  test('signing out closes it', async () => {
    expect((await request(app).get('/api/assessments/catalogue')).status).toBe(401);
  });
});

// ── The clinician's workflow ────────────────────────────────────────────────

describe('start → draft → resume → complete → history', () => {
  test('the whole workflow, end to end', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    // 1. Nothing recorded yet.
    let hist = await agent.get(`/api/assessments/clients/${CLIENT_A}/records`);
    expect(hist.status).toBe(200);
    expect(hist.body.records).toEqual([]);

    // 2. Start it. The instrument's own module owns creation.
    const created = await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, clientName: 'Jordan Avery', administrationMethod: 'self' });
    expect(created.status).toBe(201);
    const id = created.body.assessment.id;

    // 3. It is a draft, and it is already in this client's history with the
    //    address the surface will navigate to.
    hist = await agent.get(`/api/assessments/clients/${CLIENT_A}/records`);
    expect(hist.body.records).toHaveLength(1);
    expect(hist.body.records[0]).toMatchObject({
      id, status: 'draft', assessmentKey: WHODAS_KEY, module: 'whodas',
      route: `#assessment/record/${id}`,
    });

    // 4. Save a partial draft, then resume it and find the answers still there.
    const partial = await agent.patch(`/api/whodas/assessments/${id}`)
      .send({ version: created.body.assessment.version, responses: { 'D1.1': 'moderate' } });
    expect(partial.status).toBe(200);

    const resumed = await agent.get(`/api/whodas/assessments/${id}`);
    expect(resumed.body.assessment.responses['D1.1']).toBe('moderate');
    expect(resumed.body.assessment.status).toBe('draft');

    // 5. Completion is refused while anything applicable is unanswered.
    const tooEarly = await agent.post(`/api/whodas/assessments/${id}/complete`);
    expect(tooEarly.status).toBe(422);

    // 6. Answer everything, record work/school applicability, complete.
    const filled = await agent.patch(`/api/whodas/assessments/${id}`)
      .send({
        version: resumed.body.assessment.version,
        responses: fullResponses(),
        workSchoolApplicable: true,
      });
    expect(filled.status).toBe(200);

    const done = await agent.post(`/api/whodas/assessments/${id}/complete`);
    expect(done.status).toBe(200);
    expect(done.body.assessment.status).toBe('completed');

    // 7. It is scored — by the server, with the method travelling with the
    //    number, and no invented severity band.
    const scores = done.body.assessment.scores;
    expect(Object.keys(scores)).toEqual(expect.arrayContaining(['irt', 'simple_sum', 'domain_mean']));
    expect(scores.irt.overall.value).toBeGreaterThan(0);
    expect(scores.irt.sourceMethodology).toMatch(/World Health Organization|WHO/);
    expect(JSON.stringify(scores)).not.toMatch(/\b(mild|moderate|severe)\s+disability\b/i);

    // 8. It appears in the client's history as a completed record, carrying the
    //    exact template version it was completed against.
    hist = await agent.get(`/api/assessments/clients/${CLIENT_A}/records`);
    const row = hist.body.records[0];
    expect(row.status).toBe('completed');
    expect(row.overallScore).toBe(scores.irt.overall.value);
    expect(row.overallScoreLabel).toBe(scores.irt.label);
    expect(row.templateKey).toBe('whodas-36-self');
    expect(row.templateVersion).toBeTruthy();
    expect(row.hasDocument).toBe(true);

    // 9. And it is reopenable, read-only.
    const reopened = await agent.get(`/api/whodas/assessments/${id}`);
    expect(reopened.body.assessment.status).toBe('completed');
    const frozen = await agent.patch(`/api/whodas/assessments/${id}`)
      .send({ version: reopened.body.assessment.version, responses: { 'D1.1': 'none' } });
    expect(frozen.status).toBe(409);
  });

  test('history is per client, never leaked across them', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });

    const other = await agent.get(`/api/assessments/clients/${CLIENT_B}/records`);
    expect(other.body.records).toEqual([]);
  });

  test('a draft is the author\'s; a filed record is the organisation\'s', async () => {
    const org = await seedOrganisation();
    const author = await agentFor('therapist', { organisation_id: org.id });
    const colleague = await agentFor('therapist', { organisation_id: org.id });

    const created = await author.agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });
    const id = created.body.assessment.id;

    // The colleague cannot see the draft.
    let theirs = await colleague.agent.get(`/api/assessments/clients/${CLIENT_A}/records`);
    expect(theirs.body.records).toEqual([]);

    await author.agent.patch(`/api/whodas/assessments/${id}`)
      .send({ version: created.body.assessment.version, responses: fullResponses(), workSchoolApplicable: true });
    await author.agent.post(`/api/whodas/assessments/${id}/complete`);

    // Once filed, it is the organisation's record.
    theirs = await colleague.agent.get(`/api/assessments/clients/${CLIENT_A}/records`);
    expect(theirs.body.records).toHaveLength(1);
    expect(theirs.body.records[0].status).toBe('completed');
  });

  test('another organisation\'s records are invisible', async () => {
    const orgA = await seedOrganisation('A');
    const orgB = await seedOrganisation('B');
    const a = await agentFor('therapist', { organisation_id: orgA.id });
    const b = await agentFor('therapist', { organisation_id: orgB.id });

    const created = await a.agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });
    await a.agent.patch(`/api/whodas/assessments/${created.body.assessment.id}`)
      .send({
        version: created.body.assessment.version,
        responses: fullResponses(),
        workSchoolApplicable: true,
      });
    await a.agent.post(`/api/whodas/assessments/${created.body.assessment.id}/complete`);

    const seen = await b.agent.get(`/api/assessments/clients/${CLIENT_A}/records`);
    expect(seen.body.records).toEqual([]);

    // And sharing it is a 404, not a 403 — "you may not see this" already
    // leaks that it exists.
    const share = await b.agent.post(`/api/assessments/records/${created.body.assessment.id}/share`);
    expect(share.status).toBe(404);
  });
});

// ── Share ───────────────────────────────────────────────────────────────────

describe('email / share preparation', () => {
  test('a completed record produces a reviewable draft and sends nothing', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('therapist', { organisation_id: org.id });

    const created = await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, clientName: 'Jordan Avery', administrationMethod: 'self' });
    const id = created.body.assessment.id;
    await agent.patch(`/api/whodas/assessments/${id}`).send({
      version: created.body.assessment.version,
      responses: fullResponses(),
      workSchoolApplicable: true,
    });
    await agent.post(`/api/whodas/assessments/${id}/complete`);

    const res = await agent.post(`/api/assessments/records/${id}/share`);
    expect(res.status).toBe(200);

    const share = res.body.share;
    expect(share.sent).toBe(false);
    expect(share.requiresReview).toBe(true);
    expect(share.to).toEqual([]);
    expect(share.subject).not.toMatch(/Jordan|Avery/);        // no identity in the subject
    expect(share.body).toMatch(/Jordan Avery/);               // named to the recipient
    expect(share.body).not.toMatch(/\b\d{1,3}\.\d{2}\b/);     // never a score
    expect(share.attachment.downloadPath).toBe(`/api/whodas/assessments/${id}/document`);
    expect(share.delivery.configured).toBe(false);

    // The event that happened was "prepared", and the audit row says so
    // without carrying a name, a response or a score.
    const { rows } = await db.pool.query(
      `SELECT action, metadata FROM audit_logs
        WHERE actor_user_id = $1 AND action = 'assessment_share_prepared'`,
      [user.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ assessmentKey: WHODAS_KEY, sent: false });
    expect(JSON.stringify(rows[0].metadata)).not.toMatch(/Jordan|Avery|mild/);
  });

  test('a draft cannot be shared', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const created = await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });

    const res = await agent.post(`/api/assessments/records/${created.body.assessment.id}/share`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_completed');
  });

  test('a blank form can be shared, and mentions no client', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const res = await agent.post(`/api/assessments/catalogue/${WHODAS_KEY}/share`)
      .send({ administrationMethod: 'self' });
    expect(res.status).toBe(200);
    expect(res.body.share.kind).toBe('blank');
    expect(res.body.share.sent).toBe(false);
    expect(res.body.share.attachment.downloadPath)
      .toBe('/api/whodas/templates/whodas-36-self/blank');
  });

  test('an assessment with no blank form cannot be shared as one', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const res = await agent.post('/api/assessments/catalogue/copm/share');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_blank_form');
  });
});

// ── Roles ───────────────────────────────────────────────────────────────────

describe('roles', () => {
  test('read_only may read the catalogue and filed records but not share', async () => {
    const org = await seedOrganisation();
    const author = await agentFor('therapist', { organisation_id: org.id });
    const reader = await agentFor('read_only', { organisation_id: org.id });

    const created = await author.agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });
    const id = created.body.assessment.id;
    await author.agent.patch(`/api/whodas/assessments/${id}`).send({
      version: created.body.assessment.version,
      responses: fullResponses(),
      workSchoolApplicable: true,
    });
    await author.agent.post(`/api/whodas/assessments/${id}/complete`);

    expect((await reader.agent.get('/api/assessments/catalogue')).status).toBe(200);
    const hist = await reader.agent.get(`/api/assessments/clients/${CLIENT_A}/records`);
    expect(hist.body.records).toHaveLength(1);
    expect((await reader.agent.post(`/api/assessments/records/${id}/share`)).status).toBe(403);
  });

  test('admin sees the catalogue but no client\'s records', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('admin', { organisation_id: org.id });
    expect((await agent.get('/api/assessments/catalogue')).status).toBe(200);
    expect((await agent.get(`/api/assessments/clients/${CLIENT_A}/records`)).status).toBe(403);
  });
});

// ── The catalogue never promises what the caller cannot do ──────────────────

describe('availability is overlaid with what THIS caller may do', () => {
  test('a therapist with no organisation is not offered a Start button', () => {
    // requireCatalogue deliberately has no organisation check — the catalogue
    // must still answer, because "why you cannot use this" is what a clinician
    // needs told. What must not happen is advertising canStart:true to someone
    // whose every request behind it would 403.
    return (async () => {
      const { agent } = await agentFor('therapist', { organisation_id: null });
      const res = await agent.get('/api/assessments/catalogue');
      expect(res.status).toBe(200);                       // still answers
      const whodas = res.body.assessments.find((a) => a.key === WHODAS_KEY);
      expect(whodas.availability.state).toBe('electronic-and-pdf');  // the instrument is fine
      expect(whodas.availability.canStart).toBe(false);              // this caller is not
      expect(whodas.availability.canDownloadBlank).toBe(false);
      expect(whodas.availability.actorReason).toMatch(/not linked to an organisation/);
    })();
  });

  test('admin gets the catalogue but is never offered an action', () => {
    return (async () => {
      const org = await seedOrganisation();
      const { agent } = await agentFor('admin', { organisation_id: org.id });
      const res = await agent.get('/api/assessments/catalogue');
      expect(res.status).toBe(200);
      const whodas = res.body.assessments.find((a) => a.key === WHODAS_KEY);
      expect(whodas.availability.canStart).toBe(false);
      expect(whodas.availability.actorReason).toMatch(/cannot administer/);
    })();
  });

  test('a therapist in an organisation is offered it', () => {
    return (async () => {
      const org = await seedOrganisation();
      const { agent } = await agentFor('therapist', { organisation_id: org.id });
      const res = await agent.get('/api/assessments/catalogue/' + WHODAS_KEY);
      expect(res.body.assessment.availability.canStart).toBe(true);
      expect(res.body.assessment.availability.actorReason).toBeUndefined();
    })();
  });
});

describe('every refusal reaches the user as a sentence', () => {
  test('an unknown catalogue key explains itself', () => {
    return (async () => {
      const org = await seedOrganisation();
      const { agent } = await agentFor('therapist', { organisation_id: org.id });
      const res = await agent.get('/api/assessments/catalogue/not-a-real-key');
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/No assessment with that key is registered/);
    })();
  });

  test('a stale record deep link explains itself without saying whose it is', () => {
    return (async () => {
      const org = await seedOrganisation();
      const { agent } = await agentFor('therapist', { organisation_id: org.id });
      const res = await agent.get('/api/whodas/assessments/11111111-2222-3333-4444-555555555555');
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/could not be found, or is no longer available to you/);
      expect(res.body.message).not.toMatch(/organisation|another user/i);
    })();
  });

  test('the switched-off module explains itself', () => {
    return (async () => {
      const org = await seedOrganisation();
      const { agent } = await agentFor('therapist', { organisation_id: org.id });
      process.env.ENABLE_WHODAS_ASSESSMENT = 'false';
      try {
        const res = await agent.get('/api/whodas/instrument');
        expect(res.status).toBe(404);
        expect(res.body.message).toMatch(/not enabled in this environment/);
      } finally {
        process.env.ENABLE_WHODAS_ASSESSMENT = 'true';
      }
    })();
  });
});

// ── Deleting a draft ────────────────────────────────────────────────────────
//
// "Delete" in the UI; a soft delete underneath, per migration 021's rule that
// a voided assessment is retained, never deleted. What these prove: exactly
// one record leaves exactly the lists it should, the row and the audit trail
// survive, and the one-draft-per-client-and-method slot is freed.

describe('deleting a draft', () => {
  test('the full save → delete → gone → start-again workflow', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('therapist', { organisation_id: org.id });

    // Start and partially complete, as Save & Exit leaves it.
    const created = await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });
    const id = created.body.assessment.id;
    await agent.patch(`/api/whodas/assessments/${id}`)
      .send({ version: created.body.assessment.version, responses: { 'D1.1': 'moderate', 'D1.2': 'mild' } });

    // It is on both lists.
    expect((await agent.get(`/api/whodas/clients/${CLIENT_A}/assessments`)).body.assessments).toHaveLength(1);
    expect((await agent.get(`/api/assessments/clients/${CLIENT_A}/records`)).body.records).toHaveLength(1);

    // Delete it.
    const del = await agent.delete(`/api/whodas/assessments/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);

    // Gone from BOTH lists — the module's and the framework's.
    expect((await agent.get(`/api/whodas/clients/${CLIENT_A}/assessments`)).body.assessments).toEqual([]);
    expect((await agent.get(`/api/assessments/clients/${CLIENT_A}/records`)).body.records).toEqual([]);

    // But retained in the database: soft delete, with who/when/why.
    const { rows } = await db.pool.query(
      'SELECT status, voided_by_user_id, voided_at, void_reason, responses FROM whodas_assessments WHERE id = $1', [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('voided');
    expect(rows[0].voided_by_user_id).toBe(user.id);
    expect(rows[0].voided_at).not.toBeNull();
    expect(rows[0].void_reason).toMatch(/deleted by its author/i);

    // Audited, counts only.
    const audit = await db.pool.query(
      `SELECT metadata FROM audit_logs WHERE action = 'WHODAS_DRAFT_DELETED' AND target_id = $1`, [id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata.responsesDiscarded).toBe(2);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toMatch(/moderate|mild|D1\.1/);

    // The one-draft slot is free: the same client and method starts cleanly.
    const again = await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });
    expect(again.status).toBe(201);
    expect(again.body.assessment.id).not.toBe(id);
    expect(again.body.assessment.responses).toEqual({});
  });

  test('only that instance disappears — other drafts and other clients are untouched', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const a = (await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' })).body.assessment;
    const b = (await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'interviewer' })).body.assessment;
    const c = (await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_B, administrationMethod: 'self' })).body.assessment;

    expect((await agent.delete(`/api/whodas/assessments/${a.id}`)).status).toBe(200);

    const listA = (await agent.get(`/api/whodas/clients/${CLIENT_A}/assessments`)).body.assessments;
    expect(listA.map((r) => r.id)).toEqual([b.id]);
    const listB = (await agent.get(`/api/whodas/clients/${CLIENT_B}/assessments`)).body.assessments;
    expect(listB.map((r) => r.id)).toEqual([c.id]);
  });

  test('a completed assessment refuses to be deleted', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const created = await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });
    const id = created.body.assessment.id;
    await agent.patch(`/api/whodas/assessments/${id}`).send({
      version: created.body.assessment.version,
      responses: fullResponses(),
      workSchoolApplicable: true,
    });
    await agent.post(`/api/whodas/assessments/${id}/complete`);

    const del = await agent.delete(`/api/whodas/assessments/${id}`);
    expect(del.status).toBe(409);
    expect(del.body.error).toBe('not_a_draft');
    expect(del.body.message).toMatch(/filed\s+clinical record/);

    // Still listed, still completed, still scored.
    const list = (await agent.get(`/api/whodas/clients/${CLIENT_A}/assessments`)).body.assessments;
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('completed');
    expect(list[0].overallScore).not.toBeNull();
  });

  test('a colleague cannot delete another author\'s draft, and is told nothing exists', async () => {
    const org = await seedOrganisation();
    const author = await agentFor('therapist', { organisation_id: org.id });
    const colleague = await agentFor('therapist', { organisation_id: org.id });

    const created = await author.agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });

    const del = await colleague.agent.delete(`/api/whodas/assessments/${created.body.assessment.id}`);
    expect(del.status).toBe(404);   // drafts are invisible to non-authors — 404, not 403

    // The author still has it.
    const list = (await author.agent.get(`/api/whodas/clients/${CLIENT_A}/assessments`)).body.assessments;
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('draft');
  });

  test('another organisation\'s draft is a 404', async () => {
    const orgA = await seedOrganisation('A');
    const orgB = await seedOrganisation('B');
    const a = await agentFor('therapist', { organisation_id: orgA.id });
    const b = await agentFor('therapist', { organisation_id: orgB.id });

    const created = await a.agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });
    expect((await b.agent.delete(`/api/whodas/assessments/${created.body.assessment.id}`)).status).toBe(404);
  });

  test('a voided COMPLETED assessment still appears in history', async () => {
    // The delete filter must only hide never-completed drafts. A completed
    // record that was voided (withdrawn in error) was once filed, and history
    // that quietly loses filed records is worse than cluttered history.
    const org = await seedOrganisation();
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const created = await agent.post('/api/whodas/assessments')
      .send({ clientId: CLIENT_A, administrationMethod: 'self' });
    const id = created.body.assessment.id;
    await agent.patch(`/api/whodas/assessments/${id}`).send({
      version: created.body.assessment.version,
      responses: fullResponses(),
      workSchoolApplicable: true,
    });
    await agent.post(`/api/whodas/assessments/${id}/complete`);
    await agent.post(`/api/whodas/assessments/${id}/void`).send({ reason: 'Filed against the wrong client' });

    const list = (await agent.get(`/api/whodas/clients/${CLIENT_A}/assessments`)).body.assessments;
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('voided');

    const records = (await agent.get(`/api/assessments/clients/${CLIENT_A}/records`)).body.records;
    expect(records).toHaveLength(1);
  });
});
