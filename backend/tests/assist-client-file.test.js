'use strict';

/**
 * Opal Assist client file — GET /api/assist/client-file and the panel's
 * formatters. Read-only lookups for a client chat: caseload-scoped, the
 * caller's OWN notes, audited by counts, never a model call. The REAL
 * caseload scoping runs here (splose-api is mocked underneath it).
 * Synthetic data only.
 */

jest.mock('../database', () => ({
  pool:               { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  getUserByEmail:     jest.fn(),
  getUser:            jest.fn(),
  logAuditEvent:      jest.fn().mockResolvedValue(null),
  recordLogin:        jest.fn().mockResolvedValue(null),
  initializeDatabase: jest.fn().mockResolvedValue(null),
}));
jest.mock('../email', () => ({ sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn() }));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api', () => ({
  isConfigured: () => true, getPatients: jest.fn(), getContacts: jest.fn(), getPractitioners: jest.fn(),
  fetchAllCases: jest.fn(), peekPatient: jest.fn(), getPatient: jest.fn(),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const sploseApi = require('../splose-api');
const provider = require('../assist/assist-provider');
const routes = require('../assist-routes');
const cf = require('../assist/client-file');
const ui = require('../../frontend/current/assist-client-file.js');

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../auth'));
  app.use('/', routes);
  return app;
}
const PASS = 'ValidPass1';
let HASH;
const user = (over) => ({
  id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'sam@opal.test', name: 'Sam Okafor', display_name: null,
  role: 'therapist', organisation_id: null, is_active: true, account_status: 'active', email_verified: true, password_hash: HASH, permissions: null,
  tp_splose_practitioner_id: 'P1', therapist_profile_id: 'bbbbbbbb-2222-4222-8222-222222222222', ...over,
});
async function login(app, u) {
  db.getUserByEmail.mockResolvedValue(u); db.getUser.mockResolvedValue(u);
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: u.email, password: PASS })).status).toBe(200);
  return agent;
}
const CASES = [
  { id: 1, patientId: '2', practitionerId: 'P1', isOpen: true, caseNumber: 'C-100', issueDate: '2026-07-01 00:00:00', expiryDate: '2027-06-30 00:00:00', trackType: 'Budget', budget: 12000, appointmentCount: 14, notes: 'Plan reassessment due.' },
  { id: 2, patientId: '2', practitionerId: 'P1', isOpen: false, caseNumber: 'C-050', expiryDate: '2026-06-30 00:00:00', trackType: 'Hours', hours: 20 },
  { id: 3, patientId: '9', practitionerId: 'P2', isOpen: true, caseNumber: 'C-900' },
];
const NOTE_ROW = { id: 'n1', created_at: '2026-11-20T03:00:00Z', note_body: 'Stove left on again; discussed kitchen safety plan.', review_status: 'approved', event_title: 'OT home visit', event_start: '2026-11-20T02:00:00Z' };
const get = (agent, client, q) => agent.get('/api/assist/client-file').query(q ? { client, q } : { client });

let modelCalls;
beforeAll(async () => { HASH = await bcrypt.hash(PASS, 4); });
beforeEach(() => {
  jest.clearAllMocks();
  require('../auth')._resetLoginRateLimit();
  routes._resetRateLimitForTests();
  process.env.OPAL_ASSIST_ENABLED = 'true';
  process.env.AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'au.anthropic.test-profile-synthetic';
  modelCalls = jest.fn(); provider._setProviderForTests(modelCalls);
  sploseApi.fetchAllCases.mockResolvedValue(CASES);
  sploseApi.peekPatient.mockImplementation((id) => ({ id, firstname: 'Test', lastname: 'Client' + id, fullName: 'Test Client' + id, _raw: {} }));
  db.pool.query.mockImplementation(async (sql) => {
    if (/FROM case_note_drafts/.test(sql)) return { rows: [NOTE_ROW], rowCount: 1 };
    if (/FROM events/.test(sql)) return { rows: [
      { title: 'OT session', start_time: '2099-01-05T01:00:00Z', status: 'confirmed' },
      { title: 'OT home visit', start_time: '2026-11-20T02:00:00Z', status: 'confirmed' },
      { title: 'OT session', start_time: '2026-11-13T02:00:00Z', status: 'cancelled' },
    ], rowCount: 3 };
    return { rows: [], rowCount: 0 };
  });
});
afterEach(() => { provider._setProviderForTests(null); delete process.env.OPAL_ASSIST_ENABLED; });

const noteQueries = () => db.pool.query.mock.calls.filter(([sql]) => /FROM case_note_drafts/.test(sql));

describe('guards', () => {
  test('no session is 401, read-only is 403, and nothing is read', async () => {
    expect((await get(request(buildApp()), 'splose:patient:2')).status).toBe(401);
    const agent = await login(buildApp(), user({ role: 'read_only' }));
    expect((await get(agent, 'splose:patient:2')).status).toBe(403);
    expect(noteQueries()).toHaveLength(0);
  });
  test('a therapist cannot open a client who is not on their caseload — 404, no notes read', async () => {
    const agent = await login(buildApp(), user());
    const r = await get(agent, 'splose:patient:9');
    expect(r.status).toBe(404);
    expect(noteQueries()).toHaveLength(0);
  });
  test('an unlinked therapist is refused (fail closed)', async () => {
    const agent = await login(buildApp(), user({ tp_splose_practitioner_id: null }));
    expect((await get(agent, 'splose:patient:2')).status).toBe(403);
    expect(noteQueries()).toHaveLength(0);
  });
  test('a bad client ref is 400; Assist switched off is 503', async () => {
    const agent = await login(buildApp(), user());
    expect((await get(agent, 'patient 2')).status).toBe(400);
    process.env.OPAL_ASSIST_ENABLED = 'false';
    expect((await get(agent, 'splose:patient:2')).status).toBe(503);
    expect(noteQueries()).toHaveLength(0);
  });
  test('an owner may open any client in the practice', async () => {
    const agent = await login(buildApp(), user({ role: 'owner' }));
    expect((await get(agent, 'splose:patient:9')).status).toBe(200);
  });
});

describe('what comes back', () => {
  test('the caller\'s own notes, sessions and this client\'s cases — no model call', async () => {
    const agent = await login(buildApp(), user());
    const r = await get(agent, 'splose:patient:2');
    expect(r.status).toBe(200);
    expect(modelCalls).not.toHaveBeenCalled();
    expect(r.body.notes).toEqual([{ id: 'n1', date: NOTE_ROW.event_start, title: 'OT home visit', review: 'approved', text: NOTE_ROW.note_body, cut: false }]);
    expect(r.body.cases.map((c) => c.number)).toEqual(['C-100', 'C-050']); // open first; the other client's case is not here
    expect(r.body.sessions.next).toHaveLength(1);
    expect(r.body.sessions.past.map((s) => s.cancelled)).toEqual([false, true]);
    const [sql, params] = noteQueries()[0];
    expect(params).toEqual(['2', 'aaaaaaaa-1111-4111-8111-111111111111']);
    expect(sql).toMatch(/c\.user_id = \$2/);
    expect(sql).toMatch(/c\.status <> 'archived'/);
    expect(sql).toMatch(/review_status <> 'rejected'/);
  });
  test('search is a bound parameter to full-text search, never interpolated; sessions and cases are skipped', async () => {
    const agent = await login(buildApp(), user());
    const q = "stove'; DROP TABLE users; --";
    const r = await get(agent, 'splose:patient:2', q);
    expect(r.status).toBe(200);
    const [sql, params] = noteQueries()[0];
    expect(sql).toMatch(/websearch_to_tsquery\('english', \$3\)/);
    expect(sql).not.toContain('DROP');
    expect(params[2]).toBe(q);
    expect(r.body.sessions).toBeNull(); expect(r.body.cases).toBeNull();
  });
  test('Splose down costs the case summary, not the notes', async () => {
    sploseApi.fetchAllCases.mockResolvedValueOnce(CASES).mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 503 } }));
    const agent = await login(buildApp(), user());
    const r = await get(agent, 'splose:patient:2');
    expect(r.status).toBe(200);
    expect(r.body.casesAvailable).toBe(false);
    expect(r.body.notes).toHaveLength(1);
  });
  test('every look is audited by counts — never the search words or note text', async () => {
    const agent = await login(buildApp(), user());
    await get(agent, 'splose:patient:2', 'kitchen safety');
    const audit = db.logAuditEvent.mock.calls.map((c) => c[0]).find((a) => a.action === 'assist.client_file_viewed');
    expect(audit).toMatchObject({ targetType: 'client', targetId: '2', metadata: { notes: 1, searched: true } });
    expect(JSON.stringify(audit)).not.toMatch(/kitchen|Stove/);
  });
});

describe('helpers', () => {
  test('cleanQuery trims, strips control characters and caps length', () => {
    expect(cf.cleanQuery('  stove\n\tfire  ')).toBe('stove fire');
    expect(cf.cleanQuery('x'.repeat(500))).toHaveLength(cf.MAX_QUERY_CHARS);
    expect(cf.cleanQuery(undefined)).toBe('');
  });
  test('the panel text: case summary, sessions, notes as a timeline', () => {
    const cases = cf.shapeCases(CASES, '2');
    expect(ui.casesText(cases)).toBe('Splose case C-100 (open)\n- Issued 1 Jul 2026 · expires 30 Jun 2027\n- Tracked by budget: $12,000\n- Appointments on the case: 14\n- Case note: Plan reassessment due.'
      + '\n\nSplose case C-050 (closed)\n- Expires 30 Jun 2026\n- Tracked by hours: 20 hours');
    expect(ui.sessionsText({ past: [{ start: '2026-11-20T02:00:00Z', title: 'OT', cancelled: false }], next: [] })).toBe('Recent sessions (newest first):\n- 20 Nov 2026 — OT');
    const notes = [
      { id: 'b', date: '2026-11-20T02:00:00Z', title: 'Visit', review: 'approved', text: 'Second.' },
      { id: 'a', date: '2026-11-01T02:00:00Z', title: null, review: 'unreviewed', text: 'First.', cut: true },
    ];
    expect(ui.notesText(notes)).toBe('Case note — 1 Nov 2026 (not yet reviewed)\nFirst.\n[note shortened]\n\nCase note — 20 Nov 2026 — Visit\nSecond.');
  });
  test('a preview centres on the search word', () => {
    const text = 'a'.repeat(300) + ' the stove was left on ' + 'b'.repeat(300);
    expect(ui.snippet(text, 'stove')).toContain('stove was left on');
    expect(ui.snippet('short note', '')).toBe('short note');
  });
  test('the panel cannot reach the AI or the network by itself — it uses the page\'s api() and attaches through the composer', () => {
    const fs = require('fs'); const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist-client-file.js'), 'utf8');
    expect(src).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\/api\/assist\/(chat|revise|actions)/);
    expect(src).toContain("opts.composer.addText(p[0], p[1])");
    expect(src).toContain("'/api/assist/client-file?client='");
  });
});
