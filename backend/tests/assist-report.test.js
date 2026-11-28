'use strict';

/**
 * Opal Assist — the Report builder.
 *   - backend/assist/report-kinds.js: the request, the instruction, the
 *     heading check;
 *   - POST /api/assist/chat with report: client chats only, the template's
 *     headings asked for, one correction, the marker kept on the document
 *     (and through an edit), audited by kind only;
 *   - GET /api/assist/client-file?from&to: a period of notes, bound as
 *     parameters;
 *   - frontend/current/assist-report.js + assist-doc.js: note numbering,
 *     note references (chips, stripped for readers), the template fill;
 *   - the headings and field tags agree with report-kinds.js and the
 *     Templates masters.
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
  fetchAllCases: jest.fn().mockResolvedValue([]), peekPatient: jest.fn(), getPatient: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const directory = require('../assist/identity-directory');
const provider = require('../assist/assist-provider');
const routes = require('../assist-routes');
const reports = require('../assist/report-kinds');
const documents = require('../assist/assist-document');
const clientFile = require('../assist/client-file');
const ui = require('../../frontend/current/assist-report.js');
const docUi = require('../../frontend/current/assist-doc.js');
const progressMap = require('../templates/progress-report-map.js');
const letterMap = require('../templates/support-letter-map.js');

const FRONT = path.join(__dirname, '../../frontend/current');

// ── report-kinds ─────────────────────────────────────────────────────────────
describe('report-kinds', () => {
  test('readReport accepts only the two kinds; goals are clamped', () => {
    expect(reports.readReport(null)).toBeNull();
    expect(reports.readReport({ kind: 'fca' })).toBeNull();
    expect(reports.readReport({ kind: 'toString' })).toBeNull();
    expect(reports.readReport({ kind: 'progress_report', goals: 3 })).toEqual({ kind: 'progress_report', goals: 3 });
    expect(reports.readReport({ kind: 'progress_report', goals: 99 })).toEqual({ kind: 'progress_report', goals: 8 });
    expect(reports.readReport({ kind: 'progress_report', goals: 'x' })).toEqual({ kind: 'progress_report', goals: 1 });
    expect(reports.readReport({ kind: 'support_letter', goals: 4 })).toEqual({ kind: 'support_letter', goals: 0 });
  });

  test('the instruction names every heading in order and the citation rule', () => {
    const text = reports.reportInstruction({ kind: 'progress_report', goals: 2 });
    expect(text).toContain('"Background information", "Goal 1 progress", "Goal 2 progress", "Overall summary of progress", "Core supports", "Capacity building"');
    expect(text).toContain('(N3)');
    expect(text).toMatch(/never invent a note number/);
    expect(reports.reportInstruction({ kind: 'support_letter', goals: 0 })).toContain('"Impact if not funded"');
  });

  test('checkHeadings canonicalises matching headings and names the first wrong one', () => {
    const r = { kind: 'support_letter', goals: 0 };
    const heads = reports.headingsFor(r);
    const doc = { blocks: heads.flatMap((h) => [{ t: 'h', text: `${h.toUpperCase()}:` }, { t: 'p', text: 'x' }]) };
    expect(reports.checkHeadings(doc, r)).toBeNull();
    expect(doc.blocks[0].text).toBe('Purpose of this letter');
    expect(reports.checkHeadings({ blocks: [{ t: 'h', text: 'Intro' }] }, r)).toMatch(/expected 8 headings/);
    const swapped = { blocks: heads.slice().reverse().map((h) => ({ t: 'h', text: h })) };
    expect(reports.checkHeadings(swapped, r)).toMatch(/heading 1 should be "Purpose of this letter"/);
  });

  test('the report marker survives validation (an edit) only when valid', () => {
    const blocks = [{ t: 'h', text: 'A' }, { t: 'p', text: 'b' }];
    expect(documents.validateDocument({ blocks, report: { kind: 'progress_report', goals: 2 } }, 'document').doc.report).toEqual({ kind: 'progress_report', goals: 2 });
    expect(documents.validateDocument({ blocks, report: { kind: 'nope' } }, 'document').doc.report).toBeUndefined();
  });
});

// ── the headings and fields agree everywhere ─────────────────────────────────
describe('one set of headings', () => {
  test('frontend and server headings match for every goal count', () => {
    for (let g = 1; g <= 8; g++) {
      expect(ui.KINDS.progress_report.headings(g)).toEqual(reports.headingsFor({ kind: 'progress_report', goals: g }));
    }
    expect(ui.KINDS.support_letter.headings()).toEqual(reports.headingsFor({ kind: 'support_letter', goals: 0 }));
  });

  test('every heading maps onto a real narrative field of its Templates master', () => {
    const check = (kind, headings, map) => headings.forEach((h) => {
      const tag = ui.KINDS[kind].field(h);
      expect(tag).toBeTruthy();
      expect(map.SCALAR_BY_TAG.get(tag)).toEqual(expect.objectContaining({ narrative: true }));
    });
    check('progress_report', reports.headingsFor({ kind: 'progress_report', goals: 8 }), progressMap);
    check('support_letter', reports.headingsFor({ kind: 'support_letter' }), letterMap);
    // The extra fields the fill writes exist too.
    expect(progressMap.SCALAR_BY_TAG.has('OPAL_REPORT_PERIOD')).toBe(true);
    expect(progressMap.SCALAR_BY_TAG.has('OPAL_REPORT_GOALS_LIST')).toBe(true);
    // Support-letter section titles are the headings themselves.
    expect(letterMap.SECTIONS.map((s) => s.title)).toEqual(reports.headingsFor({ kind: 'support_letter' }));
    // The section tags the fill switches on exist.
    for (let g = 1; g <= 8; g++) expect(progressMap.SECTION_BY_TAG.has(`OPAL_SECTION_REPORT_GOAL_${g}`)).toBe(true);
    expect(letterMap.SECTION_BY_TAG.has('OPAL_SECTION_SUPPORT_LETTER_IMPACT_IF_NOT_FUNDED')).toBe(true);
  });
});

// ── the chat route ───────────────────────────────────────────────────────────
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
const USER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const user = (over) => ({
  id: USER_ID, email: 'sam@opal.test', name: 'Sam Okafor', display_name: null, role: 'owner', organisation_id: null,
  is_active: true, account_status: 'active', email_verified: true, password_hash: HASH, permissions: null, ...over,
});
async function login(app, u) {
  db.getUserByEmail.mockResolvedValue(u); db.getUser.mockResolvedValue(u);
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: u.email, password: PASS })).status).toBe(200);
  return agent;
}
const CONV = { id: '12345678-1234-4123-8123-123456789012', user_id: USER_ID, surface: 'web' };
const REPORT = { kind: 'progress_report', goals: 1 };
const goodReport = () => ({
  title: 'Progress report',
  blocks: reports.headingsFor(REPORT).flatMap((h) => [{ t: 'h', text: h }, { t: 'p', text: `[CLIENT_1] cooked a meal with prompts (N1, N2).` }]),
});

beforeAll(async () => { HASH = await bcrypt.hash(PASS, 4); });
beforeEach(() => {
  jest.clearAllMocks();
  require('../auth')._resetLoginRateLimit();
  routes._resetRateLimitForTests();
  process.env.OPAL_ASSIST_ENABLED = 'true';
  process.env.AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'au.anthropic.test-profile-synthetic';
  directory._setCacheForTests({ entries: [{ role: 'client', ref: 'splose:patient:1', name: 'Aiden Blackwood-Tan', variants: directory.strictVariants('Aiden Blackwood-Tan') }], partial: false });
  db.pool.query.mockImplementation(async (sql) => {
    if (/INSERT INTO assist_conversations/.test(sql)) return { rows: [{ ...CONV, client_ref: 'splose:patient:1' }], rowCount: 1 };
    if (/INSERT INTO assist_messages .*RETURNING id/s.test(sql)) return { rows: [{ id: 91 }], rowCount: 1 };
    if (/SELECT \* FROM assist_conversations WHERE id/.test(sql)) return { rows: [{ ...CONV, client_ref: 'splose:patient:1' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
});
afterEach(() => { provider._setProviderForTests(null); delete process.env.OPAL_ASSIST_ENABLED; });

describe('POST /api/assist/chat with a report', () => {
  const send = (agent, body) => agent.post('/api/assist/chat/stream').send({ message: 'Write a progress report for [CLIENT_1].', conversationId: CONV.id, ...body });

  test('asks for the template headings and citations, and keeps the report marker on the stored document', async () => {
    let seen = null;
    provider._setProviderForTests(async (args) => { seen = args; return { text: JSON.stringify(goodReport()) }; });
    const agent = await login(buildApp(), user());
    const r = await send(agent, { report: REPORT, selection: 'REPORT MATERIAL — 2 case notes\n--- N1 — 1 Nov 2026 ---\n[CLIENT_1] cooked.' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual(expect.objectContaining({ status: 'ok', kind: 'document' }));
    expect(r.body.document.report).toEqual(REPORT);
    expect(seen.system).toContain('THIS REPLY IS A PROGRESS REPORT');
    expect(seen.system).toContain('"Goal 1 progress"');
    expect(seen.system).toContain('CITE THE NOTES');
    const insert = db.pool.query.mock.calls.find((c) => /INSERT INTO assist_messages .*'assistant'/s.test(c[0]));
    expect(JSON.parse(insert[1][1]).report).toEqual(REPORT);
    const audit = db.logAuditEvent.mock.calls.find((c) => c[0].action === 'assist.chat')[0];
    expect(audit.metadata.report).toBe('progress_report');
    expect(JSON.stringify(audit.metadata)).not.toMatch(/cooked|CLIENT_1/);
  });

  test('wrong headings are corrected once', async () => {
    const replies = [JSON.stringify({ blocks: [{ t: 'h', text: 'Summary' }, { t: 'p', text: 'x (N1).' }] }), JSON.stringify(goodReport())];
    const calls = [];
    provider._setProviderForTests(async (args) => { calls.push(args); return { text: replies.shift() }; });
    const agent = await login(buildApp(), user());
    const r = await send(agent, { report: REPORT });
    expect(calls).toHaveLength(2);
    expect(calls[1].messages[calls[1].messages.length - 1].content).toMatch(/report_headings/);
    expect(r.body.document.blocks[0].text).toBe('Background information');
  });

  test('a report needs a client chat; an unknown kind is an ordinary chat', async () => {
    const spy = jest.fn(async () => ({ text: 'Plain answer.' }));
    provider._setProviderForTests(spy);
    db.pool.query.mockImplementation(async (sql) => {
      if (/INSERT INTO assist_conversations/.test(sql)) return { rows: [{ ...CONV, client_ref: null }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const agent = await login(buildApp(), user());
    const r = await agent.post('/api/assist/chat').send({ message: 'Write a report', report: REPORT });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('report_needs_client');
    expect(spy).not.toHaveBeenCalled();
    const plain = await agent.post('/api/assist/chat').send({ message: 'Hello', report: { kind: 'fca' } });
    expect(plain.status).toBe(200);
    expect(spy.mock.calls[0][0].system).not.toContain('THIS REPLY IS A');
  });

  test('the guard still applies to the report material', async () => {
    const spy = jest.fn(async () => ({ text: JSON.stringify(goodReport()) }));
    provider._setProviderForTests(spy);
    const agent = await login(buildApp(), user());
    const r = await send(agent, { report: REPORT, selection: '--- N1 ---\nAiden Blackwood-Tan cooked.' });
    expect(r.status).toBe(422);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── the period of notes ──────────────────────────────────────────────────────
describe('client-file period', () => {
  test('periodBounds: Perth days to UTC instants; bad or reversed is ignored', () => {
    const b = clientFile.periodBounds('2026-05-01', '2026-11-26');
    expect(b.from.toISOString()).toBe('2026-04-30T16:00:00.000Z');
    expect(b.to.toISOString()).toBe('2026-11-26T16:00:00.000Z');
    expect(clientFile.periodBounds('2026-12-01', '2026-01-01')).toEqual({ from: null, to: null });
    expect(clientFile.periodBounds("2026-01-01'; DROP", 'x')).toEqual({ from: null, to: null });
  });

  test('loadNotes binds the period and the search as parameters', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const b = clientFile.periodBounds('2026-05-01', '2026-11-26');
    await clientFile.loadNotes(pool, { userId: 'u', clientId: '9', query: 'stove', from: b.from, to: b.to });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/websearch_to_tsquery\('english', \$3\)/);
    expect(sql).toMatch(/>= \$4/);
    expect(sql).toMatch(/< \$5/);
    expect(params).toEqual(['9', 'u', 'stove', b.from.toISOString(), b.to.toISOString()]);
  });
});

// ── frontend helpers ─────────────────────────────────────────────────────────
describe('report helpers', () => {
  const NOTES = [
    { id: 'b', date: '2026-11-10T01:00:00Z', title: 'Home visit', review: 'approved', text: 'Cooked pasta.' },
    { id: 'a', date: '2026-10-02T01:00:00Z', title: '', review: 'review_required', text: 'Kitchen review.' },
  ];

  test('numberNotes: oldest first, N1…, sources for the chips', () => {
    const r = ui.numberNotes(NOTES);
    expect(r.count).toBe(2);
    expect(r.text).toMatch(/--- N1 — 2 Oct 2026 \(not yet reviewed\) ---\nKitchen review\.[\s\S]*--- N2 — 10 Nov 2026 — Home visit ---\nCooked pasta\./);
    expect(r.sources).toEqual({ N1: { date: '2 Oct 2026', title: '', text: 'Kitchen review.' }, N2: { date: '10 Nov 2026', title: 'Home visit', text: 'Cooked pasta.' } });
  });

  test('goals, request, message, period', () => {
    expect(ui.goalLines('1. Cook safely\n\n- Catch the bus\n* Shower\n4) Four\n5\n6\n7\n8\n9')).toEqual(['Cook safely', 'Catch the bus', 'Shower', 'Four', '5', '6', '7', '8']);
    expect(ui.requestText('progress_report', ['A', 'B'], '')).toBe('NDIS GOALS, in order:\n1. A\n2. B');
    expect(ui.requestText('support_letter', [], 'A shower chair')).toBe('WHAT IS RECOMMENDED:\nA shower chair');
    expect(ui.message('progress_report', 'Test Person', { from: '2026-05-01', to: '2026-11-26' })).toBe('Write a progress report for Test Person, covering 1 May 2026 to 26 Nov 2026, from the attached case notes and NDIS goals.');
    expect(ui.defaultPeriod(new Date('2026-11-26T03:00:00Z'))).toEqual({ from: '2026-05-26', to: '2026-11-26' });
  });

  test('templateValues: names back, references out, a narrative per heading, missing headings listed', () => {
    const doc = { report: { kind: 'progress_report', goals: 2 }, blocks: [
      { t: 'h', text: 'Background information' }, { t: 'p', text: '[CLIENT_1] lives at home (N1).' },
      { t: 'h', text: 'Goal 1 progress' }, { t: 'p', text: 'Improved (N2).' }, { t: 'li', lead: 'Next', text: 'Bus training (N2, N3).' },
      { t: 'h', text: 'Overall summary of progress' }, { t: 'p', text: 'Good.' },
    ] };
    const restore = (t) => docUi.restoreText(t, { CLIENT_1: 'Test Person' }, 'first');
    const r = ui.templateValues(doc, 'progress_report', restore, docUi.stripCites);
    expect(r.values).toEqual({
      OPAL_REPORT_BACKGROUND: 'Test lives at home.',
      OPAL_REPORT_GOAL_1_PROGRESS: 'Improved.\n• Next: Bus training.',
      OPAL_REPORT_SUMMARY: 'Good.',
    });
    expect(r.missing).toEqual(['Goal 2 progress', 'Core supports', 'Capacity building']);
  });

  test('sectionSelection: goal slots follow the goal count; impact only when written', () => {
    const sections = [1, 2, 3, 4, 5, 6, 7, 8].map((g) => ({ tag: `OPAL_SECTION_REPORT_GOAL_${g}`, included: g <= 4 }))
      .concat([{ tag: 'OPAL_SECTION_REPORT_SUMMARY', included: true }, { tag: 'X_CUSTOM', included: true, custom: true }]);
    expect(ui.sectionSelection(sections, 'progress_report', 6, {})).toEqual(['OPAL_SECTION_REPORT_GOAL_1', 'OPAL_SECTION_REPORT_GOAL_2', 'OPAL_SECTION_REPORT_GOAL_3', 'OPAL_SECTION_REPORT_GOAL_4', 'OPAL_SECTION_REPORT_SUMMARY', 'OPAL_SECTION_REPORT_GOAL_5', 'OPAL_SECTION_REPORT_GOAL_6']);
    expect(ui.sectionSelection(sections, 'progress_report', 2, {})).toEqual(['OPAL_SECTION_REPORT_GOAL_1', 'OPAL_SECTION_REPORT_GOAL_2', 'OPAL_SECTION_REPORT_SUMMARY']);
    const letter = [{ tag: 'OPAL_SECTION_SUPPORT_LETTER_PURPOSE', included: true }, { tag: 'OPAL_SECTION_SUPPORT_LETTER_IMPACT_IF_NOT_FUNDED', included: false }];
    expect(ui.sectionSelection(letter, 'support_letter', 0, { OPAL_LETTER_IMPACT_IF_NOT_FUNDED: 'Risk.' })).toEqual(['OPAL_SECTION_SUPPORT_LETTER_PURPOSE', 'OPAL_SECTION_SUPPORT_LETTER_IMPACT_IF_NOT_FUNDED']);
    expect(ui.sectionSelection(letter, 'support_letter', 0, {})).toEqual(['OPAL_SECTION_SUPPORT_LETTER_PURPOSE']);
  });

  test('note references: chips in the editor, stripped for readers, tokens untouched', () => {
    expect(docUi.stripCites('Cooked (N1). Rested (N2, N10) then left.')).toBe('Cooked. Rested then left.');
    expect(docUi.stripCites('[CLIENT_1] (aged 30) cooked.')).toBe('[CLIENT_1] (aged 30) cooked.');
    const html = docUi.docToHtml({ blocks: [{ t: 'p', text: '[CLIENT_1] cooked (N1, N2).' }] }, {}, 'first', { N1: { date: '2 Oct 2026', title: 'Home' } });
    expect(html).toContain('data-token="CLIENT_1"');
    expect(html).toContain('<span class="oa-cite" contenteditable="false" data-cite="N1, N2" title="N1 — 2 Oct 2026, Home');
    const plain = docUi.withoutCites({ kind: 'document', report: { kind: 'support_letter', goals: 0 }, blocks: [{ t: 'li', lead: 'Why (N1)', text: 'Safe (N2).' }] });
    expect(plain).toEqual({ kind: 'document', title: null, report: { kind: 'support_letter', goals: 0 }, blocks: [{ t: 'li', lead: 'Why', text: 'Safe.' }] });
  });
});

// ── in a DOM ─────────────────────────────────────────────────────────────────
function dom() {
  const d = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/assist' });
  d.window.eval(fs.readFileSync(path.join(FRONT, 'assist-doc.js'), 'utf8'));
  d.window.eval(fs.readFileSync(path.join(FRONT, 'assist-report.js'), 'utf8'));
  return d.window;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const res = (status, body, headers = {}) => ({ ok: status < 400, status, json: () => Promise.resolve(body), blob: () => Promise.resolve(new Blob(['x'])), headers: { get: (k) => headers[k] || null } });

describe('the builder panel', () => {
  test('loads the period, attaches numbered notes and goals, then starts the report', async () => {
    const w = dom();
    const calls = []; const added = []; let started = null;
    const api = (p) => { calls.push(p); return Promise.resolve(res(200, { notes: [
      { id: 'n2', date: '2026-11-10T01:00:00Z', title: 'Visit', review: 'approved', text: 'Cooked pasta.' },
      { id: 'n1', date: '2026-10-02T01:00:00Z', title: '', review: 'approved', text: 'Kitchen review.' },
      { id: 'n3', date: '2026-11-20T01:00:00Z', title: '', review: 'approved', text: 'Not this one.' },
    ] })); };
    w.OpalAssistReport.open({ client: { ref: 'splose:patient:7', name: 'Test Person' }, api, composer: { roomLeft: () => 30000, addText: (n, t) => { added.push([n, t]); return true; } }, start: (p, m) => { started = { p, m }; } });
    await flush(); await flush();
    expect(calls[0]).toMatch(/^\/api\/assist\/client-file\?client=splose%3Apatient%3A7&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    const $ = (s) => w.document.querySelector(s);
    expect($('[data-rb="draft"]').disabled).toBe(true); // no goals yet
    const goals = $('#oa-rb-goals'); goals.value = 'Cook safely\nCatch the bus'; goals.dispatchEvent(new w.Event('input', { bubbles: true }));
    const n3 = $('[data-note="n3"]'); n3.checked = false; n3.dispatchEvent(new w.Event('change', { bubbles: true }));
    expect($('[data-rb="draft"]').disabled).toBe(false);
    $('[data-rb="draft"]').click();
    expect(added[0][0]).toBe('Report material: 2 case notes');
    expect(added[0][1]).toMatch(/N1 — 2 Oct 2026 ---\nKitchen review\.[\s\S]*N2 — 10 Nov 2026 — Visit/);
    expect(added[0][1]).not.toMatch(/Not this one/);
    expect(added[1]).toEqual(['Report request: NDIS goals', 'NDIS GOALS, in order:\n1. Cook safely\n2. Catch the bus']);
    expect(started.p).toEqual(expect.objectContaining({ kind: 'progress_report', goals: 2, goalsText: 'Cook safely\nCatch the bus' }));
    expect(Object.keys(started.p.sources)).toEqual(['N1', 'N2']);
    expect(started.m).toMatch(/^Write a progress report for Test Person, covering /);
    expect($('#oa-rb')).toBeNull();
  });

  test('too much material for the room left blocks the draft', async () => {
    const w = dom();
    const api = () => Promise.resolve(res(200, { notes: [{ id: 'n1', date: '2026-10-02T01:00:00Z', text: 'x'.repeat(5000) }] }));
    w.OpalAssistReport.open({ client: { ref: 'splose:patient:7', name: 'T' }, api, composer: { roomLeft: () => 1000, addText: jest.fn() }, start: jest.fn() });
    await flush(); await flush();
    const goals = w.document.querySelector('#oa-rb-goals'); goals.value = 'A'; goals.dispatchEvent(new w.Event('input', { bubbles: true }));
    expect(w.document.querySelector('[data-rb="draft"]').disabled).toBe(true);
    expect(w.document.querySelector('#oa-rb-count').textContent).toMatch(/too much/);
  });
});

describe('fill the template', () => {
  test('creates the client-bound document, fills sections and fields, downloads the Word file', async () => {
    const w = dom();
    w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
    const calls = [];
    const api = (p, o = {}) => {
      calls.push({ p, o });
      if (p === '/api/templates/documents') return Promise.resolve(res(201, { document: { id: 'doc-1', sections: [1, 2, 3, 4, 5].map((g) => ({ tag: `OPAL_SECTION_REPORT_GOAL_${g}`, included: g <= 4 })) } }));
      if (o.method === 'PATCH') return Promise.resolve(res(200, { document: {} }));
      return Promise.resolve(res(200, {}, { 'Content-Disposition': 'attachment; filename="Progress%20Report.docx"' }));
    };
    const doc = { kind: 'document', report: { kind: 'progress_report', goals: 1 }, blocks: reports.headingsFor(REPORT).flatMap((h) => [{ t: 'h', text: h }, { t: 'p', text: '[CLIENT_1] did well (N1).' }]) };
    const r = await w.OpalAssistReport.fillTemplate({
      doc, api, client: { ref: 'splose:patient:7' }, meta: { period: '1 May 2026 to 26 Nov 2026', goalsText: 'Cook safely' },
      restore: (t) => w.OpalAssistDoc.restoreText(t, { CLIENT_1: 'Test Person' }, 'first'), strip: w.OpalAssistDoc.stripCites,
    });
    expect(r.missing).toEqual([]);
    expect(calls[0].o.body).toEqual({ templateId: 'progress_report', clientId: '7', title: 'Progress report — Opal Assist draft' });
    const patch = calls[1];
    expect(patch.p).toBe('/api/templates/documents/doc-1');
    expect(patch.o.body.fieldValues).toEqual(expect.objectContaining({ OPAL_REPORT_BACKGROUND: 'Test did well.', OPAL_REPORT_GOAL_1_PROGRESS: 'Test did well.', OPAL_REPORT_PERIOD: '1 May 2026 to 26 Nov 2026', OPAL_REPORT_GOALS_LIST: 'Cook safely' }));
    expect(JSON.stringify(patch.o.body)).not.toMatch(/\(N1\)|CLIENT_1/);
    expect(patch.o.body.sections.selected).toEqual(['OPAL_SECTION_REPORT_GOAL_1']);
    expect(calls[2].p).toBe('/api/templates/documents/doc-1/export.docx');
  });

  test('a role without Templates is told so', async () => {
    const w = dom();
    const api = () => Promise.resolve(res(403, { error: 'forbidden' }));
    const doc = { report: { kind: 'support_letter', goals: 0 }, blocks: [{ t: 'h', text: 'Recommendation' }, { t: 'p', text: 'x' }] };
    await expect(w.OpalAssistReport.fillTemplate({ doc, api, client: { ref: 'splose:patient:7' }, restore: (t) => t, strip: (t) => t })).rejects.toThrow(/therapists and the owner/);
  });
});

describe('page wiring', () => {
  const HTML = fs.readFileSync(path.join(FRONT, 'assist.html'), 'utf8');
  const JS = fs.readFileSync(path.join(FRONT, 'assist.js'), 'utf8');
  test('loaded before assist.js; the button is hidden until a client chat; the request carries report', () => {
    expect(HTML).toMatch(/<script src="\/assist-report\.js\?v=\d+"><\/script>[\s\S]*<script src="\/assist\.js\?v=\d+">/);
    expect(HTML).toMatch(/id="oa-report"[^>]*hidden/);
    expect(JS).toMatch(/body\.report = \{ kind: S\.pendingReport\.kind/);
    expect(JS).toMatch(/if \(doc && doc\.report\) doc = DOC\(\)\.withoutCites\(doc\)/);
  });
  test('the builder keeps note text in memory only and calls only its routes', () => {
    const src = fs.readFileSync(path.join(FRONT, 'assist-report.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|console\./);
    expect([...new Set(src.match(/'\/api\/[^']*'/g))].sort()).toEqual(["'/api/assist/client-file?client='", "'/api/templates/documents'", "'/api/templates/documents/'"]);
  });
});
