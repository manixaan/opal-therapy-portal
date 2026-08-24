'use strict';

/**
 * TEMPLATES ROUTES — permission-boundary unit tests (no real database).
 *
 * Templates resolves clinical client data, so the question these tests answer
 * is narrow and important: can any role reach client data through
 * /api/templates that it cannot already reach through /api/fca? The answer has
 * to be no, and it has to stay no.
 *
 * The three boundaries asserted here:
 *   1. anonymous          → 401 everywhere, no query runs
 *   2. admin              → 403 everywhere, no query runs (admin is excluded
 *                           from clinical data, exactly as /api/fca excludes it)
 *   3. read_only          → may read, may NOT write
 * plus: a user with no organisation is refused before any query, and a field
 * the master does not declare is refused rather than stored.
 *
 * Behaviour against real SQL — own-only scoping, cross-user denial and the
 * export boundary end to end — lives in tests/integration/templates.itest.js.
 */

jest.mock('../database', () => ({
  pool:               { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: jest.fn() },
  getUserByEmail:     jest.fn(),
  getUser:            jest.fn(),
  logAuditEvent:      jest.fn().mockResolvedValue(null),
  recordLogin:        jest.fn().mockResolvedValue(null),
  initializeDatabase: jest.fn().mockResolvedValue(null),
}));

jest.mock('../email', () => ({
  sendVerificationEmail:  jest.fn().mockResolvedValue(null),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(null),
}));

jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api', () => ({
  getPatients: jest.fn().mockResolvedValue([]),
  getPatient: jest.fn().mockResolvedValue(null),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(bodyParser.json());
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true },
  }));
  app.use('/', require('../auth'));
  app.use('/', require('../templates-routes'));
  return app;
}

const TEST_PASS = 'ValidPass1';
let TEST_HASH;

const ORG = 'cccccccc-2222-4222-8222-222222222222';
const DOC_ID = 'dddddddd-3333-4333-8333-333333333333';

const mkUser = (role, n, extra) => ({
  id: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-11111111111${n}`,
  email: `${role}.${n}@opaltherapy.com.au`,
  role, is_active: true, account_status: 'active', email_verified: true,
  organisation_id: ORG, permissions: null, name: `${role} ${n}`,
  ...(extra || {}),
});

const OWNER = mkUser('owner', 'a');
const ADMIN = mkUser('admin', 'b');
const THERAPIST = mkUser('therapist', 'c');
const READ_ONLY = mkUser('read_only', 'd');
const ORPHAN = mkUser('therapist', 'e', { organisation_id: null });
const USERS = Object.fromEntries(
  [OWNER, ADMIN, THERAPIST, READ_ONLY, ORPHAN].map((u) => [u.id, u])
);

let app;
let ipCounter = 0;

beforeAll(async () => {
  TEST_HASH = await bcrypt.hash(TEST_PASS, 1);
  app = buildApp();
  db.getUser.mockImplementation(async (id) => USERS[id] || null);
});

beforeEach(() => {
  db.pool.query.mockClear();
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

async function loginAs(user) {
  db.getUserByEmail.mockResolvedValueOnce({ ...user, password_hash: TEST_HASH });
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .set('X-Forwarded-For', `10.9.${Math.floor(ipCounter / 200)}.${(ipCounter++ % 200) + 10}`)
    .send({ email: user.email, password: TEST_PASS });
  expect(res.status).toBe(200);
  return agent;
}

const READ_ENDPOINTS = [
  ['get', '/api/templates'],
  ['get', '/api/templates/fca/fields'],
  ['get', '/api/templates/clients?q=smith'],
  ['get', '/api/templates/documents'],
  ['get', `/api/templates/documents/${DOC_ID}`],
  ['get', `/api/templates/documents/${DOC_ID}/preview.docx`],
  ['get', `/api/templates/documents/${DOC_ID}/export.docx`],
  ['get', `/api/templates/documents/${DOC_ID}/export.pdf`],
];

const WRITE_ENDPOINTS = [
  ['post', '/api/templates/documents'],
  ['patch', `/api/templates/documents/${DOC_ID}`],
  ['delete', `/api/templates/documents/${DOC_ID}`],
];

const ALL_ENDPOINTS = [...READ_ENDPOINTS, ...WRITE_ENDPOINTS];

// ═══════════════════════════════════════════════════════════════════════════

describe('anonymous', () => {
  test('every endpoint is 401 and no query runs', async () => {
    for (const [method, path] of ALL_ENDPOINTS) {
      db.pool.query.mockClear();
      const res = await request(app)[method](path).send({});
      expect([path, res.status]).toEqual([path, 401]);
      expect([path, db.pool.query.mock.calls.length]).toEqual([path, 0]);
    }
  });
});

describe('admin is excluded from client data, exactly as /api/fca excludes it', () => {
  test('every endpoint is 403 and no query runs', async () => {
    const agent = await loginAs(ADMIN);
    for (const [method, path] of ALL_ENDPOINTS) {
      db.pool.query.mockClear();
      const res = await agent[method](path).send({ templateId: 'fca' });
      expect([path, res.status]).toEqual([path, 403]);
      expect([path, db.pool.query.mock.calls.length]).toEqual([path, 0]);
    }
  });

  test('the refusal names no client and leaks no internals', async () => {
    const agent = await loginAs(ADMIN);
    const res = await agent.get('/api/templates/documents');
    expect(res.body.error).toBe('forbidden');
    expect(JSON.stringify(res.body)).not.toMatch(/OPAL_|SELECT|template_documents/i);
  });
});

describe('read_only may look but not write', () => {
  test('the catalogue is readable', async () => {
    const agent = await loginAs(READ_ONLY);
    const res = await agent.get('/api/templates');
    expect(res.status).toBe(200);
    expect(res.body.templates.map((t) => t.id))
      .toEqual(['service_agreement', 'progress_note', 'fca']);
  });

  test('every write endpoint is 403 and no query runs', async () => {
    const agent = await loginAs(READ_ONLY);
    for (const [method, path] of WRITE_ENDPOINTS) {
      db.pool.query.mockClear();
      const res = await agent[method](path).send({ templateId: 'fca' });
      expect([path, res.status]).toEqual([path, 403]);
      expect([path, db.pool.query.mock.calls.length]).toEqual([path, 0]);
    }
  });
});

describe('a user with no organisation is refused before any query', () => {
  test.each(ALL_ENDPOINTS)('%s %s', async (method, path) => {
    const agent = await loginAs(ORPHAN);
    db.pool.query.mockClear();
    const res = await agent[method](path).send({ templateId: 'fca' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_organisation');
    expect(db.pool.query).not.toHaveBeenCalled();
  });
});

describe('therapist and owner may reach the capability', () => {
  test.each([['therapist', THERAPIST], ['owner', OWNER]])('%s reads the catalogue', async (_l, user) => {
    const agent = await loginAs(user);
    const res = await agent.get('/api/templates');
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(3);
  });

  test('the field spec never exposes a binding identifier', async () => {
    const agent = await loginAs(THERAPIST);
    const res = await agent.get('/api/templates/service_agreement/fields');
    expect(res.status).toBe(200);
    const labels = res.body.groups.flatMap((g) => g.fields.map((f) => f.label));
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(`${l}:${/OPAL_|PORTAL —/.test(l)}`).toBe(`${l}:false`);
  });

  test('an unknown template id is 404, not a 500 and not a guess', async () => {
    const agent = await loginAs(THERAPIST);
    const res = await agent.get('/api/templates/not_a_template/fields');
    expect(res.status).toBe(404);
  });

  test('creating with an unknown template id is refused before any insert', async () => {
    const agent = await loginAs(THERAPIST);
    db.pool.query.mockClear();
    const res = await agent.post('/api/templates/documents').send({ templateId: 'evil' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_template');
    expect(db.pool.query).not.toHaveBeenCalled();
  });
});

describe('a document id the caller does not own is indistinguishable from one that does not exist', () => {
  test('404, never 403 — a 403 would confirm the row exists', async () => {
    const agent = await loginAs(THERAPIST);
    // The own-only predicate is in the WHERE clause, so a foreign row simply
    // returns nothing.
    db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    for (const [method, path] of [
      ['get', `/api/templates/documents/${DOC_ID}`],
      ['patch', `/api/templates/documents/${DOC_ID}`],
      ['delete', `/api/templates/documents/${DOC_ID}`],
      ['get', `/api/templates/documents/${DOC_ID}/preview.docx`],
      ['get', `/api/templates/documents/${DOC_ID}/export.docx`],
      ['get', `/api/templates/documents/${DOC_ID}/export.pdf`],
    ]) {
      const res = await agent[method](path).send({});
      expect([path, res.status]).toEqual([path, 404]);
    }
  });

  test('the lookup really is scoped by organisation AND creator', async () => {
    const agent = await loginAs(THERAPIST);
    db.pool.query.mockClear();
    db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await agent.get(`/api/templates/documents/${DOC_ID}`);
    const [sql, params] = db.pool.query.mock.calls[0];
    expect(sql).toMatch(/organisation_id = \$2/);
    expect(sql).toMatch(/created_by_user_id = \$3/);
    expect(params).toEqual([DOC_ID, ORG, THERAPIST.id]);
  });

  test('a non-uuid id never reaches the database', async () => {
    const agent = await loginAs(THERAPIST);
    db.pool.query.mockClear();
    const res = await agent.get('/api/templates/documents/not-a-uuid');
    expect(res.status).toBe(404);
    expect(db.pool.query).not.toHaveBeenCalled();
  });
});

describe('a document instance cannot be used to write arbitrary content', () => {
  const ROW = {
    id: DOC_ID, organisation_id: ORG, template_id: 'fca', template_version: 'v1',
    title: 'A report', splose_client_id: null, field_values: {},
    created_at: new Date('2026-08-24T00:00:00Z'), updated_at: new Date('2026-08-24T00:00:00Z'),
  };

  test('a field the master does not declare is refused, and nothing is written', async () => {
    const agent = await loginAs(THERAPIST);
    db.pool.query.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });   // loadOwnDocument
    const res = await agent.patch(`/api/templates/documents/${DOC_ID}`)
      .send({ fieldValues: { NOT_A_REAL_TAG: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_field');
    // Only the lookup ran; no UPDATE.
    const updates = db.pool.query.mock.calls.filter((c) => /UPDATE/i.test(c[0]));
    expect(updates).toHaveLength(0);
  });

  test('a tag from a DIFFERENT template is refused on this one', async () => {
    const agent = await loginAs(THERAPIST);
    db.pool.query.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });
    // A real Service Agreement tag, sent to an FCA document.
    const res = await agent.patch(`/api/templates/documents/${DOC_ID}`)
      .send({ fieldValues: { OPAL_AGREEMENT_START_DATE: '01/01/2027' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_field');
  });

  test('a non-object fieldValues payload is refused', async () => {
    const agent = await loginAs(THERAPIST);
    for (const bad of [[], 'x', 3]) {
      db.pool.query.mockClear();
      db.pool.query.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });
      const res = await agent.patch(`/api/templates/documents/${DOC_ID}`).send({ fieldValues: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_field_values');
    }
  });

  test('an unknown section tag is refused, and nothing is written', async () => {
    const agent = await loginAs(THERAPIST);
    db.pool.query.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });
    const res = await agent.patch(`/api/templates/documents/${DOC_ID}`)
      .send({ sections: { selected: ['NOT_A_SECTION'] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_section');
    expect(db.pool.query.mock.calls.filter((c) => /UPDATE/i.test(c[0]))).toHaveLength(0);
  });

  test('dropping a REQUIRED section is refused with its name, and nothing is written', async () => {
    const agent = await loginAs(THERAPIST);
    db.pool.query.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });
    const fcaSections = require('../fca/template-map').SECTIONS;
    const withoutReferral = fcaSections.map((s) => s.tag)
      .filter((t) => t !== 'OPAL_SECTION_REFERRAL_INFORMATION');
    const res = await agent.patch(`/api/templates/documents/${DOC_ID}`)
      .send({ sections: { selected: withoutReferral } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('required_section');
    expect(res.body.message).toContain('Referral Information');
    expect(db.pool.query.mock.calls.filter((c) => /UPDATE/i.test(c[0]))).toHaveLength(0);
  });

  test('sections on a template with a fixed structure are refused', async () => {
    const agent = await loginAs(THERAPIST);
    db.pool.query.mockResolvedValueOnce({
      rows: [{ ...ROW, template_id: 'service_agreement', template_version: 'v1.0.1' }],
      rowCount: 1,
    });
    const res = await agent.patch(`/api/templates/documents/${DOC_ID}`)
      .send({ sections: { selected: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sections_not_supported');
  });

  test('a legitimate section choice is stored parameterised and echoed back normalised', async () => {
    const agent = await loginAs(THERAPIST);
    const fcaSections = require('../fca/template-map').SECTIONS.map((s) => s.tag);
    const selected = fcaSections.filter((t) => t !== 'OPAL_SECTION_ASSESSMENT_TOOL_MOCA');
    const stored = { selected, order: fcaSections };
    db.pool.query
      .mockResolvedValueOnce({ rows: [ROW], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...ROW, sections: stored }], rowCount: 1 });
    const res = await agent.patch(`/api/templates/documents/${DOC_ID}`)
      .send({ sections: { selected, order: fcaSections } });
    expect(res.status).toBe(200);

    const update = db.pool.query.mock.calls.find((c) => /UPDATE template_documents/i.test(c[0]));
    expect(update).toBeDefined();
    // Column-scoped SET: only sections travelled, so only sections is written
    // (plus the timestamp) — a fieldValues save cannot clobber this column.
    expect(update[0]).toContain('sections = $2::jsonb');
    expect(update[0]).not.toContain('field_values =');
    expect(update[0]).not.toContain('title =');

    // The document echoes the EFFECTIVE structure: MoCA out, required in.
    const sections = res.body.document.sections;
    expect(Array.isArray(sections)).toBe(true);
    const moca = sections.find((s) => s.tag === 'OPAL_SECTION_ASSESSMENT_TOOL_MOCA');
    expect(moca.included).toBe(false);
    expect(sections.find((s) => s.tag === 'OPAL_SECTION_REFERRAL_INFORMATION').included).toBe(true);
  });

  test('a custom section needs a real title, a real id and a real level', async () => {
    const agent = await loginAs(THERAPIST);
    const bads = [
      [{ custom: [{ title: '' }] }, 'invalid_sections'],
      [{ custom: [{ title: 'Ok', id: 'not-a-uuid' }] }, 'invalid_sections'],
      [{ custom: [{ title: 'Ok', level: 9 }] }, 'invalid_sections'],
      [{ custom: 'nope' }, 'invalid_sections'],
      [{ levels: { NOT_A_SECTION: 2 } }, 'unknown_section'],
      [{ levels: { OPAL_SECTION_DOMAIN_MOBILITY: 7 } }, 'invalid_sections'],
    ];
    for (const [sections, code] of bads) {
      db.pool.query.mockClear();
      db.pool.query.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });
      const res = await agent.patch(`/api/templates/documents/${DOC_ID}`).send({ sections });
      expect([JSON.stringify(sections), res.status]).toEqual([JSON.stringify(sections), 400]);
      expect(res.body.error).toBe(code);
      expect(db.pool.query.mock.calls.filter((c) => /UPDATE/i.test(c[0]))).toHaveLength(0);
    }
  });

  test('saving heading levels alone does not reset a stored section selection', async () => {
    const agent = await loginAs(THERAPIST);
    const fcaTags = require('../fca/template-map').SECTIONS.map((s) => s.tag);
    const priorSelected = fcaTags.filter((t) => t !== 'OPAL_SECTION_ASSESSMENT_TOOL_MOCA');
    const rowWithSections = {
      ...ROW,
      sections: { selected: priorSelected, order: fcaTags, custom: [], levels: {} },
    };
    db.pool.query
      .mockResolvedValueOnce({ rows: [rowWithSections], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [rowWithSections], rowCount: 1 });
    const res = await agent.patch(`/api/templates/documents/${DOC_ID}`)
      .send({ sections: { levels: { OPAL_SECTION_DOMAIN_MOBILITY: 1 } } });
    expect(res.status).toBe(200);
    const update = db.pool.query.mock.calls.find((c) => /UPDATE template_documents/i.test(c[0]));
    const stored = JSON.parse(update[1][1]);
    expect(stored.selected).toEqual(priorSelected);           // untouched
    expect(stored.levels).toEqual({ OPAL_SECTION_DOMAIN_MOBILITY: 1 });
  });

  test('a legitimate tag is accepted and stored parameterised', async () => {
    const agent = await loginAs(THERAPIST);
    db.pool.query
      .mockResolvedValueOnce({ rows: [ROW], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...ROW, field_values: { OPAL_REPORT_DATE: '01/01/2027' } }], rowCount: 1 });
    const res = await agent.patch(`/api/templates/documents/${DOC_ID}`)
      .send({ fieldValues: { OPAL_REPORT_DATE: '01/01/2027' } });
    expect(res.status).toBe(200);
    const update = db.pool.query.mock.calls.find((c) => /UPDATE template_documents/i.test(c[0]));
    expect(update).toBeDefined();
    // Values travel as parameters, never interpolated.
    expect(update[0]).not.toContain('01/01/2027');
    expect(update[1][1]).toContain('01/01/2027');
  });
});
