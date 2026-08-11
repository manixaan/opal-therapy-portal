'use strict';

/**
 * Case-note draft API tests — /api/mobile/case-note-drafts.
 *
 * All external services mocked; the clinical-note provider is overridden via
 * its test seam (no network ever). Focus: fail-closed gating, ownership,
 * metadata-vs-AI separation, no-fabrication composition (billing/address
 * omission), transcript preservation, regenerate-in-place, privacy of audit
 * payloads, malformed-provider-response safety.
 */

jest.mock('../database', () => ({
  pool:                     { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  getUserByEmail:           jest.fn(),
  getUser:                  jest.fn(),
  logAuditEvent:            jest.fn().mockResolvedValue(null),
  recordLogin:              jest.fn().mockResolvedValue(null),
  getEventsForTherapists:   jest.fn().mockResolvedValue([]),
  initializeDatabase:       jest.fn().mockResolvedValue(null),
}));
jest.mock('../email', () => ({
  sendVerificationEmail:  jest.fn().mockResolvedValue(null),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(null),
}));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api',    () => ({}));

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const provider = require('../clinical-note-provider');
const caseNoteRoutes = require('../case-note-routes');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(bodyParser.json());
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false, saveUninitialized: false,
    cookie: { secure: false, httpOnly: true },
  }));
  app.use('/', require('../auth'));
  app.use('/', require('../case-note-routes'));
  return app;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_PASS = 'ValidPass1';
let TEST_HASH;
const TP_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const TP_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const USER_A = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'cn.a@opal.test',
  role: 'therapist', is_active: true, account_status: 'active', email_verified: true,
  organisation_id: 'cccccccc-2222-4222-8222-222222222222',
  therapist_profile_id: TP_A, permissions: null, name: 'Therapist A',
};
const USER_B = { ...USER_A, id: 'bbbbbbbb-1111-4111-8111-111111111111', email: 'cn.b@opal.test', therapist_profile_id: TP_B, name: 'Therapist B' };
const USERS = { [USER_A.id]: USER_A, [USER_B.id]: USER_B };

const EVENT_A = {
  id: 'dddddddd-3333-4333-8333-333333333333',
  user_id: USER_A.id, therapist_profile_id: TP_A,
  title: 'Therapy Session (Early Intervention - Under 9) (Occupational Therapy)',
  start_time: '2026-08-10T03:50:00.000Z', // 11:50 am Perth
  end_time: '2026-08-10T04:40:00.000Z',   // 50 minutes
  location: '7 Example Street, Testville', manual_location: null,
  client_name: 'Liam Carter', travel_time_minutes: 30, travel_distance: 18,
  event_type: 'therapy', status: 'confirmed', is_deleted: false,
};
// Sparse event: no client name, no routable address, no travel, zero-length.
const EVENT_SPARSE = {
  ...EVENT_A,
  id: 'dddddddd-3333-4333-8333-333333333334',
  client_name: null, location: 'tbc', travel_time_minutes: null,
  end_time: EVENT_A.start_time, // duration 0 → no billing line
};
const EVENT_B = { ...EVENT_A, id: 'eeeeeeee-3333-4333-8333-333333333333', user_id: USER_B.id, therapist_profile_id: TP_B };

const SECTIONS = {
  identify: 'Therapist attended the school on 10/08/2026 to complete a therapy session. Those present included Liam (participant) and the OT.',
  sessionDetails: 'Liam was seated on the mat when the OT arrived. He required hands-on assistance to free his left arm during the dressing activity. Classroom staff reported increased sensory-seeking this week.',
  plan: ['Continue practising jumper removal using the over-head method.'],
  warnings: ['Check attendee name — transcript was unclear.'],
};

const TRANSCRIPT = 'Liam was on the mat when I arrived, um, we did the jumper thing and he needed help with his left arm. Staff said he has been seeking the sensory corner more.';

let eventStore, draftStore, draftSeq;
const nextDraftId = () => `cafecafe-5555-4555-8555-${String(++draftSeq).padStart(12, '0')}`;

function installPoolMock() {
  db.pool.query.mockImplementation(async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, ' ');
    if (q.includes('INSERT INTO case_note_drafts')) {
      const row = {
        id: nextDraftId(),
        user_id: params[0], organisation_id: params[1], voice_note_id: params[2],
        linked_event_id: params[3], transcript: params[4], header: JSON.parse(params[5]),
        identify: params[6], session_details: params[7], plan: JSON.parse(params[8]),
        warnings: JSON.parse(params[9]), note_body: params[10],
        style_version: params[11], provider_id: params[12], model_id: params[13],
        status: 'draft', generated_at: new Date().toISOString(),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      draftStore.set(row.id, row);
      return { rows: [row] };
    }
    if (q.includes('UPDATE case_note_drafts SET header')) { // regenerate
      const row = draftStore.get(params[0]);
      if (!row || row.user_id !== params[1]) return { rows: [] };
      Object.assign(row, {
        header: JSON.parse(params[2]), identify: params[3], session_details: params[4],
        plan: JSON.parse(params[5]), warnings: JSON.parse(params[6]), note_body: params[7],
        style_version: params[8], provider_id: params[9], model_id: params[10],
        generated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      return { rows: [row] };
    }
    if (q.includes("UPDATE case_note_drafts SET status = 'archived'")) {
      const row = draftStore.get(params[0]);
      if (row && row.user_id === params[1]) row.status = 'archived';
      return { rows: [] };
    }
    if (q.includes('UPDATE case_note_drafts SET')) { // PATCH
      const row = draftStore.get(params[0]);
      if (!row || row.user_id !== params[1]) return { rows: [] };
      const colRe = /(\w+) = \$(\d+)/g; let m;
      while ((m = colRe.exec(q)) !== null) {
        const [, col, n] = m;
        if (col === 'id' || col === 'user_id') continue;
        let v = params[Number(n) - 1];
        if (col === 'plan') v = JSON.parse(v);
        row[col] = v;
      }
      row.updated_at = new Date().toISOString();
      return { rows: [row] };
    }
    if (q.includes('FROM case_note_drafts WHERE id = $1 AND user_id = $2')) {
      const row = draftStore.get(params[0]);
      return { rows: row && row.user_id === params[1] ? [row] : [] };
    }
    if (q.includes('FROM case_note_drafts WHERE user_id = $1')) {
      const rows = [...draftStore.values()].filter((r) => r.user_id === params[0] && r.status === 'draft');
      return { rows };
    }
    if (q.includes('FROM events WHERE id = $1')) {
      const ev = eventStore.get(params[0]);
      const owned = ev && !ev.is_deleted
        && (ev.user_id === params[1] || (params[2] && ev.therapist_profile_id === params[2]));
      return { rows: owned ? [ev] : [] };
    }
    if (q.includes('FROM voice_notes WHERE id = $1')) return { rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

let app;
let ipCounter = 0;

beforeAll(async () => {
  TEST_HASH = await bcrypt.hash(TEST_PASS, 1);
  app = buildApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  // The AI generation limiter is per-user and these tests reuse one therapist,
  // so without this the later tests in the file spend a window opened by the
  // earlier ones and start answering 429.
  caseNoteRoutes._resetCaseNoteAiRateLimit();
  eventStore = new Map([[EVENT_A.id, EVENT_A], [EVENT_SPARSE.id, EVENT_SPARSE], [EVENT_B.id, EVENT_B]]);
  draftStore = new Map();
  draftSeq = 0;
  installPoolMock();
  db.logAuditEvent.mockResolvedValue(null);
  db.recordLogin.mockResolvedValue(null);
  db.getUser.mockImplementation(async (id) => (USERS[id] ? { ...USERS[id] } : null));
  // Provider enabled + deterministic by default; individual tests override.
  // The default region/model are onshore and allowlisted, so the master
  // switch is all that's needed here. Onshore guards are covered in
  // tests/clinical-note-provider.test.js.
  process.env.CLINICAL_NOTE_AI_ENABLED = 'true';
  provider._setProviderForTests(async () => ({ ...SECTIONS, plan: [...SECTIONS.plan], warnings: [...SECTIONS.warnings] }));
});

afterEach(() => {
  provider._setProviderForTests(null);
  delete process.env.CLINICAL_NOTE_AI_ENABLED;
});

async function loginAs(user) {
  db.getUserByEmail.mockResolvedValueOnce({ ...user, password_hash: TEST_HASH });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login')
    .set('X-Forwarded-For', `10.8.${Math.floor(ipCounter / 200)}.${(ipCounter++ % 200) + 10}`)
    .send({ email: user.email, password: TEST_PASS });
  expect(res.status).toBe(200);
  return agent;
}

const generate = (agent, body = {}) => agent
  .post('/api/mobile/case-note-drafts/generate')
  .send({ transcript: TRANSCRIPT, linkedEventId: EVENT_A.id, ...body });

// ═══ Auth + fail-closed gating ═══════════════════════════════════════════════

test('unauthenticated requests are 401', async () => {
  const res = await request(app).post('/api/mobile/case-note-drafts/generate').send({});
  expect(res.status).toBe(401);
});

test('fail-closed: provider unconfigured → 503 generation_unavailable, provider never called, no row', async () => {
  delete process.env.CLINICAL_NOTE_AI_ENABLED;
  const spy = jest.fn();
  provider._setProviderForTests(spy);
  // isEnabled is checked before the override is consulted, so the spy must stay uncalled.
  const agent = await loginAs(USER_A);
  const res = await generate(agent);
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('generation_unavailable');
  expect(res.body.error).toContain('transcript is safe');
  expect(spy).not.toHaveBeenCalled();
  expect(draftStore.size).toBe(0);
});

// ═══ Ownership ═══════════════════════════════════════════════════════════════

test("another therapist's appointment cannot be linked (identical to missing)", async () => {
  const agent = await loginAs(USER_A);
  const foreign = await generate(agent, { linkedEventId: EVENT_B.id });
  const missing = await generate(agent, { linkedEventId: '99999999-9999-4999-8999-999999999999' });
  expect(foreign.status).toBe(400);
  expect(foreign.body.code).toBe('invalid_link');
  expect(foreign.body).toEqual(missing.body);
});

test("a therapist cannot read, edit, regenerate, or archive another's draft (404)", async () => {
  const agentA = await loginAs(USER_A);
  const created = (await generate(agentA)).body.caseNoteDraft;

  const agentB = await loginAs(USER_B);
  expect((await agentB.get(`/api/mobile/case-note-drafts/${created.id}`)).status).toBe(404);
  expect((await agentB.patch(`/api/mobile/case-note-drafts/${created.id}`).send({ noteBody: 'x' })).status).toBe(404);
  expect((await agentB.post(`/api/mobile/case-note-drafts/${created.id}/regenerate`).send({})).status).toBe(404);
  expect((await agentB.delete(`/api/mobile/case-note-drafts/${created.id}`)).status).toBe(404);
  const listB = await agentB.get('/api/mobile/case-note-drafts');
  expect(listB.body.caseNoteDrafts).toEqual([]);
});

// ═══ Metadata separation + composition ═══════════════════════════════════════

test('header and billing come from the event, never the model — model junk is ignored', async () => {
  provider._setProviderForTests(async () => ({
    ...SECTIONS,
    // A hostile/hallucinating model tries to smuggle metadata:
    clientName: 'Wrong Person', clientAddress: '1 Fabricated Way', billing: 'Time billed for 900 minutes',
  }));
  const agent = await loginAs(USER_A);
  const res = await generate(agent);
  expect(res.status).toBe(201);
  const d = res.body.caseNoteDraft;
  expect(d.header.clientName).toBe('Liam Carter');            // from event
  expect(d.header.clientAddress).toBe('7 Example Street, Testville');
  expect(d.header.serviceLine).toContain('11:50 am, 10 Aug 2026');
  expect(d.noteBody).not.toContain('Wrong Person');
  expect(d.noteBody).not.toContain('Fabricated Way');
  expect(d.noteBody).toContain('Time billed for 50-minute session + 30 minutes travel.');
});

// ── Adversarial-review regressions (P2 findings, Phase 6) ───────────────────

test('billing-shaped text INSIDE the model narrative is stripped and flagged', async () => {
  provider._setProviderForTests(async () => ({
    ...SECTIONS,
    sessionDetails: 'Liam practised transfers with hand-over-hand support. Time billed for 90-minute session + 45 minutes travel.',
    plan: ['Continue transfers practice.', 'Time billed for 20 minutes case noting.'],
  }));
  const agent = await loginAs(USER_A);
  // Sparse event has NO derivable billing, so a model billing claim would be
  // the note's only billing line — indistinguishable from the server's own.
  const d = (await generate(agent, { linkedEventId: EVENT_SPARSE.id })).body.caseNoteDraft;
  expect(d.noteBody).not.toMatch(/time billed/i);
  expect(d.noteBody).not.toMatch(/minutes travel/i);
  expect(d.noteBody).toContain('Liam practised transfers with hand-over-hand support.');
  expect(d.plan).toEqual(['Continue transfers practice.']);
  expect(d.warnings.join(' ')).toMatch(/billing or time statement was removed/i);
});

test('an address echoed in the narrative is flagged for the therapist', async () => {
  provider._setProviderForTests(async () => ({
    ...SECTIONS,
    sessionDetails: 'The OT attended 7 Example Street and completed the session.',
  }));
  const agent = await loginAs(USER_A);
  const d = (await generate(agent)).body.caseNoteDraft;
  expect(d.warnings.join(' ')).toMatch(/Check the address mentioned/i);
});

test('client name is stripped from the service label sent to the provider', async () => {
  let seen = null;
  provider._setProviderForTests(async (args) => { seen = args; return { ...SECTIONS }; });
  const agent = await loginAs(USER_A);
  const named = { ...EVENT_A, id: 'dddddddd-3333-4333-8333-333333333339', title: 'Therapy Session — Liam Carter (OT)' };
  eventStore.set(named.id, named);
  await generate(agent, { linkedEventId: named.id });

  expect(seen.session.serviceLabel).not.toMatch(/Liam/i);
  expect(seen.session.serviceLabel).not.toMatch(/Carter/i);
  expect(seen.session.serviceLabel).toContain('Therapy Session');
  expect(JSON.stringify(seen)).not.toContain('Liam Carter');
  // The header (never sent to the model) keeps the full title.
  const d = (await generate(agent, { linkedEventId: named.id })).body.caseNoteDraft;
  expect(d.header.serviceLine).toContain('Liam Carter');
});

test('missing metadata is omitted, never invented (no name/address/billing on sparse event)', async () => {
  const agent = await loginAs(USER_A);
  const res = await generate(agent, { linkedEventId: EVENT_SPARSE.id });
  expect(res.status).toBe(201);
  const d = res.body.caseNoteDraft;
  expect(d.header.clientName).toBeNull();
  expect(d.header.clientAddress).toBeNull();      // 'tbc' is not an address
  expect(d.noteBody).not.toContain('Time billed'); // zero duration → omitted
  expect(d.noteBody).not.toContain('null');
  expect(d.noteBody.startsWith('Therapy Session')).toBe(true);
});

test('composed note follows the Opal structure and preserves sections verbatim', async () => {
  const agent = await loginAs(USER_A);
  const d = (await generate(agent)).body.caseNoteDraft;
  const idxService = d.noteBody.indexOf('Service:');
  const idxIdentify = d.noteBody.indexOf('Identify:');
  const idxSession = d.noteBody.indexOf('Session details:');
  const idxPlan = d.noteBody.indexOf('Plan:');
  expect(idxService).toBeGreaterThan(-1);
  expect(idxIdentify).toBeGreaterThan(idxService);
  expect(idxSession).toBeGreaterThan(idxIdentify);
  expect(idxPlan).toBeGreaterThan(idxSession);
  expect(d.noteBody).toContain(SECTIONS.sessionDetails); // detail preserved, not summarised
  expect(d.noteBody).toContain('- Continue practising jumper removal');
  expect(d.warnings).toEqual(['Check attendee name — transcript was unclear.']);
  expect(d.transcript).toBe(TRANSCRIPT); // original dictation intact
});

test('empty plan from the model omits the Plan section rather than inventing one', async () => {
  provider._setProviderForTests(async () => ({ ...SECTIONS, plan: [] }));
  const agent = await loginAs(USER_A);
  const d = (await generate(agent)).body.caseNoteDraft;
  expect(d.noteBody).not.toContain('Plan:');
});

// ═══ Provider failure safety ═════════════════════════════════════════════════

test('provider failure → 502, no row written, transcript never stored server-side', async () => {
  provider._setProviderForTests(async () => { throw new Error('provider_error'); });
  const agent = await loginAs(USER_A);
  const res = await generate(agent);
  expect(res.status).toBe(502);
  expect(res.body.code).toBe('generation_failed');
  expect(res.body.error).toBe("We couldn't format your case note right now. Your transcript is safe.");
  expect(draftStore.size).toBe(0);
});

test('malformed provider payloads are rejected by validateResult', () => {
  const good = { identify: 'a', sessionDetails: 'b', plan: [], warnings: [] };
  expect(() => provider.validateResult(good)).not.toThrow();
  expect(() => provider.validateResult(null)).toThrow();
  expect(() => provider.validateResult({ ...good, identify: '' })).toThrow();
  expect(() => provider.validateResult({ ...good, sessionDetails: 42 })).toThrow();
  expect(() => provider.validateResult({ ...good, plan: 'not-array' })).toThrow();
  expect(() => provider.validateResult({ ...good, identify: 'x'.repeat(13000) })).toThrow();
  // Junk inside arrays is filtered, not fatal:
  const cleaned = provider.validateResult({ ...good, plan: ['ok', 7, '  '], warnings: [null, 'w'] });
  expect(cleaned.plan).toEqual(['ok']);
  expect(cleaned.warnings).toEqual(['w']);
});

// ═══ Edit / regenerate / archive ═════════════════════════════════════════════

test('therapist edits save via PATCH; archived drafts are frozen', async () => {
  const agent = await loginAs(USER_A);
  const d = (await generate(agent)).body.caseNoteDraft;

  const edited = await agent.patch(`/api/mobile/case-note-drafts/${d.id}`)
    .send({ noteBody: `${d.noteBody}\n\nEdited by therapist.` });
  expect(edited.status).toBe(200);
  expect(edited.body.caseNoteDraft.noteBody).toContain('Edited by therapist.');

  await agent.delete(`/api/mobile/case-note-drafts/${d.id}`);
  expect((await agent.patch(`/api/mobile/case-note-drafts/${d.id}`).send({ noteBody: 'x' })).status).toBe(409);
});

test('regenerate reuses the ORIGINAL transcript, updates the same row, never duplicates', async () => {
  const agent = await loginAs(USER_A);
  const d = (await generate(agent)).body.caseNoteDraft;

  let seenTranscript = null;
  provider._setProviderForTests(async ({ transcript, instruction }) => {
    seenTranscript = transcript;
    expect(instruction).toBe('more_detail');
    return { ...SECTIONS, sessionDetails: 'Regenerated narrative with more detail.' };
  });
  const regen = await agent.post(`/api/mobile/case-note-drafts/${d.id}/regenerate`)
    .send({ instruction: 'more_detail' });
  expect(regen.status).toBe(200);
  expect(regen.body.caseNoteDraft.id).toBe(d.id);
  expect(regen.body.caseNoteDraft.noteBody).toContain('Regenerated narrative with more detail.');
  expect(regen.body.caseNoteDraft.transcript).toBe(TRANSCRIPT);
  expect(seenTranscript).toBe(TRANSCRIPT);
  expect(draftStore.size).toBe(1);

  // Failed regeneration leaves the draft untouched.
  provider._setProviderForTests(async () => { throw new Error('provider_error'); });
  const failed = await agent.post(`/api/mobile/case-note-drafts/${d.id}/regenerate`).send({});
  expect(failed.status).toBe(502);
  expect(draftStore.get(d.id).note_body).toContain('Regenerated narrative with more detail.');
});

test('unknown regenerate instruction is rejected', async () => {
  const agent = await loginAs(USER_A);
  const d = (await generate(agent)).body.caseNoteDraft;
  const res = await agent.post(`/api/mobile/case-note-drafts/${d.id}/regenerate`)
    .send({ instruction: 'write anything you want' });
  expect(res.status).toBe(400);
});

// ═══ Privacy ═════════════════════════════════════════════════════════════════

test('audit events carry ids/versions/counts — never transcript or note content', async () => {
  const agent = await loginAs(USER_A);
  await generate(agent);
  const calls = db.logAuditEvent.mock.calls.filter(([a]) => String(a.action).startsWith('mobile.case_note'));
  expect(calls.length).toBeGreaterThan(0);
  const flat = JSON.stringify(calls);
  expect(flat).not.toContain('Liam was on the mat');       // transcript
  expect(flat).not.toContain('sensory');                   // narrative
  expect(flat).not.toContain('jumper');                    // plan content
  expect(flat).toContain('OPAL_CASE_NOTE_STYLE_V1');
});

test('provider receives only transcript + date/service context — no names, ids, or address', async () => {
  let seen = null;
  provider._setProviderForTests(async (args) => { seen = args; return { ...SECTIONS }; });
  const agent = await loginAs(USER_A);
  await generate(agent);
  expect(seen.transcript).toBe(TRANSCRIPT);
  expect(seen.session).toEqual({
    dateLabel: '10/08/2026',
    serviceLabel: EVENT_A.title,
  });
  const flat = JSON.stringify(seen);
  expect(flat).not.toContain('Liam Carter');               // full client name not sent
  expect(flat).not.toContain('Example Street');            // address not sent
  expect(flat).not.toContain(EVENT_A.id);                  // ids not sent
  expect(flat).not.toContain(USER_A.id);
});

test('transcript length is validated (8000 cap) and required', async () => {
  const agent = await loginAs(USER_A);
  expect((await generate(agent, { transcript: '' })).status).toBe(400);
  expect((await generate(agent, { transcript: 'x'.repeat(8001) })).status).toBe(400);
});

// ═══ Failure classification (mobile API contract) ════════════════════════════
//
// The phone offers a Retry button on a failure and not on a refusal or an
// unavailable service. These tests pin which server state produces which code,
// because getting it wrong is not a cosmetic bug: a therapist told to retry
// something that cannot succeed will retry it, and every attempt writes
// another denied row to ai_interactions.

test('policy denial mid-flight → 503 generation_unavailable, NOT 502', async () => {
  // The regression this locks down. The kill switch being thrown between the
  // isEnabled() pre-check and the model call is exactly the incident the
  // switch exists for, and it used to be reported as a retryable failure.
  provider._setProviderForTests(async () => { throw new Error('generation_disabled'); });
  const agent = await loginAs(USER_A);
  const res = await generate(agent);

  expect(res.status).toBe(503);
  expect(res.body.code).toBe('generation_unavailable');
  expect(res.body.code).not.toBe('generation_failed');
  expect(res.body.error).toContain('save it as a draft note');
  expect(draftStore.size).toBe(0);
});

test('policy denial on regenerate → 503, and the existing draft is untouched', async () => {
  const agent = await loginAs(USER_A);
  const created = await generate(agent);
  const id = created.body.caseNoteDraft.id;
  const bodyBefore = draftStore.get(id).note_body;

  provider._setProviderForTests(async () => { throw new Error('generation_disabled'); });
  const res = await agent.post(`/api/mobile/case-note-drafts/${id}/regenerate`).send({});

  expect(res.status).toBe(503);
  expect(res.body.code).toBe('generation_unavailable');
  expect(res.body.error).toContain('current draft is unchanged');
  expect(draftStore.get(id).note_body).toBe(bodyBefore);
});

test('guardrail refusal → 422 content_blocked, no row, and no reason leaked', async () => {
  provider._setProviderForTests(async () => { throw new Error('content_blocked'); });
  const agent = await loginAs(USER_A);
  const res = await generate(agent);

  expect(res.status).toBe(422);
  expect(res.body.code).toBe('content_blocked');
  expect(draftStore.size).toBe(0);
  // A refusal reason describing how clinical content tripped a filter is not
  // something to hand to a client-facing screen.
  expect(JSON.stringify(res.body)).not.toMatch(/guardrail|policy|filter|topic|blocked_reason/i);
});

test('the three failure states are mutually distinguishable by code', async () => {
  const agent = await loginAs(USER_A);
  const codeFor = async (thrown) => {
    caseNoteRoutes._resetCaseNoteAiRateLimit();
    provider._setProviderForTests(async () => { throw new Error(thrown); });
    return (await generate(agent)).body.code;
  };
  expect(await codeFor('generation_disabled')).toBe('generation_unavailable');
  expect(await codeFor('content_blocked')).toBe('content_blocked');
  expect(await codeFor('provider_error')).toBe('generation_failed');
});

test('an unrecognised provider error falls back to the retryable failure code', async () => {
  // Conservative default: an error we do not recognise is a transport-shaped
  // problem, not a refusal. Misclassifying the other way would suppress a
  // Retry that could have worked.
  provider._setProviderForTests(async () => { throw new Error('something-unexpected'); });
  const agent = await loginAs(USER_A);
  const res = await generate(agent);
  expect(res.status).toBe(502);
  expect(res.body.code).toBe('generation_failed');
});

// ═══ Rate limiting ═══════════════════════════════════════════════════════════

test('generation is rate limited per user with a Retry-After header', async () => {
  const agent = await loginAs(USER_A);
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await generate(agent)).status);

  // First 10 succeed, the rest are refused.
  expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
  expect(statuses.slice(10)).toEqual([429, 429]);

  const limited = await generate(agent);
  expect(limited.status).toBe(429);
  expect(limited.body.code).toBe('rate_limited');
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect(limited.body.error).toContain('transcript is safe');
});

test('the limit is per user — one therapist cannot exhaust another', async () => {
  const a = await loginAs(USER_A);
  for (let i = 0; i < 11; i++) await generate(a);
  expect((await generate(a)).status).toBe(429);

  // USER_B owns EVENT_B, so link that one.
  const b = await loginAs(USER_B);
  const res = await b.post('/api/mobile/case-note-drafts/generate')
    .send({ transcript: TRANSCRIPT, linkedEventId: EVENT_B.id });
  expect(res.status).toBe(201);
});

test('rate limiting applies to regenerate as well as generate', async () => {
  const agent = await loginAs(USER_A);
  const created = await generate(agent);
  const id = created.body.caseNoteDraft.id;
  for (let i = 0; i < 10; i++) {
    await agent.post(`/api/mobile/case-note-drafts/${id}/regenerate`).send({});
  }
  const res = await agent.post(`/api/mobile/case-note-drafts/${id}/regenerate`).send({});
  expect(res.status).toBe(429);
  expect(res.body.code).toBe('rate_limited');
});

test('reads and edits are NOT rate limited — only the model calls are', async () => {
  const agent = await loginAs(USER_A);
  const created = await generate(agent);
  const id = created.body.caseNoteDraft.id;
  for (let i = 0; i < 20; i++) {
    expect((await agent.get('/api/mobile/case-note-drafts')).status).toBe(200);
  }
  const patched = await agent.patch(`/api/mobile/case-note-drafts/${id}`)
    .send({ noteBody: 'Reviewed wording.' });
  expect(patched.status).toBe(200);
});

// ═══ Request correlation ═════════════════════════════════════════════════════

test('a client requestId is echoed on success and on every failure', async () => {
  const requestId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const agent = await loginAs(USER_A);

  const ok = await generate(agent, { requestId });
  expect(ok.body.requestId).toBe(requestId);

  provider._setProviderForTests(async () => { throw new Error('generation_disabled'); });
  const failed = await generate(agent, { requestId });
  expect(failed.body.requestId).toBe(requestId);
});

test('a malformed requestId is dropped rather than echoed', async () => {
  // Client-supplied and unauthenticated. It is a log field, so it is validated
  // as a UUID and otherwise ignored — never reflected back verbatim.
  const agent = await loginAs(USER_A);
  const res = await generate(agent, { requestId: '<script>alert(1)</script>' });
  expect(res.status).toBe(201);
  expect(res.body.requestId).toBeUndefined();
});
