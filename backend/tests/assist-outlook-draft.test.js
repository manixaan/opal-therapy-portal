'use strict';

/**
 * Opal Assist — "Outlook draft": a document reply saved to the caller's OWN
 * Outlook Drafts, never sent.
 *   - assist/email-draft.js: recipients, escaping, limits;
 *   - POST /api/assist/outlook-draft: switched off / not connected refuse
 *     before Graph, the body is built and escaped server-side, Graph
 *     failures reported, audited by counts only, never a model call;
 *   - graph-mail.createDraft: several recipients or none;
 *   - frontend/current/assist-outlook.js: prefill, blocks, the dialog.
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
jest.mock('../splose-api', () => ({ isConfigured: () => false, getPatients: jest.fn(), getContacts: jest.fn(), getPractitioners: jest.fn() }));
jest.mock('../graph-mail', () => {
  const actual = jest.requireActual('../graph-mail');
  return { ...actual, getAccessToken: jest.fn(), createDraft: jest.fn() };
});

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const graphMail = require('../graph-mail');
const provider = require('../assist/assist-provider');
const routes = require('../assist-routes');
const E = require('../assist/email-draft');
const ui = require('../../frontend/current/assist-outlook.js');

describe('email-draft', () => {
  test('recipients: optional, checked, de-duplicated, capped', () => {
    expect(E.readRecipients('')).toEqual({ ok: true, to: [] });
    expect(E.readRecipients('sc@coord.test, SC@coord.test; family@home.test')).toEqual({ ok: true, to: ['sc@coord.test', 'family@home.test'] });
    expect(E.readRecipients(['a@b.test']).to).toEqual(['a@b.test']);
    expect(E.readRecipients('not-an-address').ok).toBe(false);
    expect(E.readRecipients('"Evil" <x@y.test>').ok).toBe(false);
    expect(E.readRecipients(Array.from({ length: 11 }, (_, i) => `p${i}@x.test`)).ok).toBe(false);
  });

  test('body: every character escaped, structure kept, nothing becomes markup', () => {
    const r = E.renderBody([
      { t: 'p', text: 'Hi Sam,' },
      { t: 'h', text: 'Update' },
      { t: 'li', lead: 'Goal <1>', text: 'Cooked & cleaned\nwell' },
      { t: 'li', text: '<script>alert(1)</script> <a href="javascript:x">link</a>' },
      { t: 'p', text: 'Kind regards' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.html).toBe('<div style="font-family:Arial,Helvetica,sans-serif;font-size:11pt;"><p>Hi Sam,</p><p><strong>Update</strong></p><ul><li><strong>Goal &lt;1&gt;:</strong> Cooked &amp; cleaned<br>well</li><li>&lt;script&gt;alert(1)&lt;/script&gt; &lt;a href=&quot;javascript:x&quot;&gt;link&lt;/a&gt;</li></ul><p>Kind regards</p></div>');
    expect(E.renderBody([]).ok).toBe(false);
    expect(E.renderBody([{ t: 'img', text: 'x' }]).ok).toBe(false);
    expect(E.renderBody([{ t: 'p', text: 'x'.repeat(E.MAX_TEXT + 1) }]).ok).toBe(false);
    expect(E.readSubject('Line one\r\nBcc: x@y.test')).toBe('Line one Bcc: x@y.test');
  });
});

describe('graph-mail.createDraft recipients', () => {
  test('several, one, or none', async () => {
    jest.isolateModules(() => {
      jest.doMock('axios', () => ({ post: jest.fn().mockResolvedValue({ data: { id: 'm1', webLink: 'https://outlook.office.com/x' } }) }));
    });
    let gm; let axios;
    jest.isolateModules(() => { jest.unmock('../graph-mail'); axios = require('axios'); gm = jest.requireActual('../graph-mail'); });
    await gm.createDraft({ accessToken: 't', to: ['a@x.test', 'b@x.test'], subject: 's', html: '<p>x</p>' });
    await gm.createDraft({ accessToken: 't', to: 'c@x.test', subject: 's', html: '<p>x</p>' });
    await gm.createDraft({ accessToken: 't', to: [], subject: 's', html: '<p>x</p>' });
    const sent = axios.post.mock.calls.map((c) => c[1].toRecipients.map((r) => r.emailAddress.address));
    expect(sent).toEqual([['a@x.test', 'b@x.test'], ['c@x.test'], []]);
    expect(axios.post.mock.calls[0][0]).toBe('https://graph.microsoft.com/v1.0/me/messages');
  });
});

// ── the route ────────────────────────────────────────────────────────────────
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
  microsoft_id: 'ms-1', refresh_token: 'enc:refresh', ...over,
});
async function login(app, u) {
  db.getUserByEmail.mockResolvedValue(u); db.getUser.mockResolvedValue(u);
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: u.email, password: PASS })).status).toBe(200);
  return agent;
}
const DOC = { to: 'sc@coord.test', subject: 'Update for Test Client', blocks: [{ t: 'p', text: 'Hi, Test Client cooked a meal safely this week.' }] };

beforeAll(async () => { HASH = await bcrypt.hash(PASS, 4); });
beforeEach(() => {
  jest.clearAllMocks();
  require('../auth')._resetLoginRateLimit();
  routes._resetRateLimitForTests();
  process.env.GRAPH_MAIL_ENABLED = 'true';
  graphMail.getAccessToken.mockResolvedValue('access-token');
  graphMail.createDraft.mockResolvedValue({ ok: true, id: 'm1', webLink: 'https://outlook.office.com/mail/drafts/m1' });
});
afterEach(() => { delete process.env.GRAPH_MAIL_ENABLED; });

describe('POST /api/assist/outlook-draft', () => {
  test('401 without a session; read-only refused', async () => {
    expect((await request(buildApp()).post('/api/assist/outlook-draft').send(DOC)).status).toBe(401);
    const ro = await login(buildApp(), user({ role: 'read_only' }));
    expect((await ro.post('/api/assist/outlook-draft').send(DOC)).status).toBe(403);
    expect(graphMail.createDraft).not.toHaveBeenCalled();
  });

  test('switched off, or no Microsoft connection: refused before Graph, with the reason', async () => {
    delete process.env.GRAPH_MAIL_ENABLED;
    let agent = await login(buildApp(), user());
    let r = await agent.post('/api/assist/outlook-draft').send(DOC);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/not switched on/);
    process.env.GRAPH_MAIL_ENABLED = 'true';
    agent = await login(buildApp(), user({ microsoft_id: null, refresh_token: null }));
    r = await agent.post('/api/assist/outlook-draft').send(DOC);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/not connected/);
    expect(graphMail.createDraft).not.toHaveBeenCalled();
  });

  test('saves a draft — never a send — with the body built here; audited by counts; no model call', async () => {
    const spy = jest.fn(); provider._setProviderForTests(spy);
    const agent = await login(buildApp(), user());
    const r = await agent.post('/api/assist/outlook-draft').send({ ...DOC, html: '<img src=x onerror=alert(1)>' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, webLink: 'https://outlook.office.com/mail/drafts/m1' });
    const args = graphMail.createDraft.mock.calls[0][0];
    expect(args).toEqual({ accessToken: 'access-token', to: ['sc@coord.test'], subject: 'Update for Test Client', html: expect.stringContaining('<p>Hi, Test Client cooked a meal safely this week.</p>') });
    expect(args.html).not.toMatch(/img|onerror/);
    const audit = db.logAuditEvent.mock.calls.find((c) => c[0].action === 'assist.outlook_draft_created')[0];
    expect(audit.metadata).toEqual({ recipients: 1, chars: DOC.blocks[0].text.length, code: null });
    expect(JSON.stringify(audit)).not.toMatch(/Test Client|coord\.test/);
    expect(spy).not.toHaveBeenCalled();
    provider._setProviderForTests(null);
    // Only the draft endpoint exists: no send path.
    const src = fs.readFileSync(path.join(__dirname, '../assist-routes.js'), 'utf8');
    expect(src).not.toMatch(/sendMail|\/send['`]/);
  });

  test('bad input is 400; Graph refusals are reported', async () => {
    const agent = await login(buildApp(), user());
    expect((await agent.post('/api/assist/outlook-draft').send({ ...DOC, to: 'nope' })).status).toBe(400);
    expect((await agent.post('/api/assist/outlook-draft').send({ ...DOC, blocks: [] })).status).toBe(400);
    graphMail.createDraft.mockResolvedValueOnce({ ok: false, code: 'scope_missing', reason: 'Outlook refused the request.' });
    let r = await agent.post('/api/assist/outlook-draft').send(DOC);
    expect(r.status).toBe(409);
    graphMail.createDraft.mockResolvedValueOnce({ ok: false, code: 'graph_error', reason: 'Outlook could not be reached just now.' });
    r = await agent.post('/api/assist/outlook-draft').send(DOC);
    expect(r.status).toBe(502);
    expect(db.logAuditEvent.mock.calls.filter((c) => c[0].action === 'assist.outlook_draft_failed')).toHaveLength(2);
    graphMail.getAccessToken.mockResolvedValueOnce(null);
    r = await agent.post('/api/assist/outlook-draft').send(DOC);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Reconnect/);
  });

  test('config says whether drafts are available', async () => {
    const agent = await login(buildApp(), user());
    const r = await agent.get('/api/assist/config');
    expect(r.body.outlookDrafts).toEqual({ available: true, reason: null });
  });
});

// ── frontend ─────────────────────────────────────────────────────────────────
describe('assist-outlook.js', () => {
  const names = { CLIENT_1: 'Test Client', EMAIL_1: 'sc@coord.test', EMAIL_2: 'family@home.test' };
  const restore = (t) => String(t || '').replace(/\[([A-Z][A-Z0-9_]*)\]/g, (w, k) => names[k] || k);
  const strip = (t) => String(t || '').replace(/\s*\(N\d+(?:,\s*N\d+)*\)/g, '');
  const doc = { title: 'Update for [CLIENT_1]', report: null, blocks: [
    { t: 'p', text: 'Hi, sent to [EMAIL_1] and [EMAIL_2] and [EMAIL_1].' },
    { t: 'li', lead: 'Cooking', text: '[CLIENT_1] cooked (N2).' },
  ] };

  test('helpers', () => {
    expect(ui.recipientsFrom(doc, names)).toEqual(['sc@coord.test', 'family@home.test']);
    expect(ui.recipientsFrom(doc, {})).toEqual([]);
    expect(ui.subjectFor(doc, restore)).toBe('Update for Test Client');
    expect(ui.subjectFor({ blocks: [{ t: 'h', text: 'Plan' }] }, restore)).toBe('Plan');
    expect(ui.draftBlocks(doc, restore, strip)).toEqual([
      { t: 'p', text: 'Hi, sent to sc@coord.test and family@home.test and sc@coord.test.' },
      { t: 'li', lead: 'Cooking', text: 'Test Client cooked.' },
    ]);
  });

  function dom() {
    const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/assist' }).window;
    w.eval(fs.readFileSync(path.join(__dirname, '../../frontend/current/assist-outlook.js'), 'utf8'));
    return w;
  }

  test('not available: the reason shows and Save is off', () => {
    const w = dom();
    w.OpalAssistOutlook.open({ doc, names, restore, strip, api: jest.fn(), status: { available: false, reason: 'Outlook drafts are not switched on for this practice.' } });
    expect(w.document.querySelector('#oa-od').textContent).toMatch(/not switched on/);
    expect(w.document.querySelector('[data-od="save"]').disabled).toBe(true);
  });

  test('available: prefilled, sends plain blocks, shows the Outlook link', async () => {
    const w = dom(); const calls = [];
    const api = (p, o) => { calls.push({ p, o }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, webLink: 'https://outlook.office.com/mail/drafts/m1' }) }); };
    w.OpalAssistOutlook.open({ doc, names, restore, strip, api, status: { available: true } });
    expect(w.document.querySelector('#oa-od-to').value).toBe('sc@coord.test, family@home.test');
    w.document.querySelector('[data-od="save"]').click();
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
    expect(calls[0].p).toBe('/api/assist/outlook-draft');
    expect(calls[0].o.body).toEqual({ to: 'sc@coord.test, family@home.test', subject: 'Update for Test Client', blocks: ui.draftBlocks(doc, restore, strip) });
    expect(JSON.stringify(calls[0].o.body)).not.toMatch(/<|\[CLIENT_1\]|\(N2\)/);
    const link = w.document.querySelector('#oa-od-msg a');
    expect(link.getAttribute('href')).toBe('https://outlook.office.com/mail/drafts/m1');
    expect(link.getAttribute('rel')).toBe('noopener');
  });

  test('page wiring', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist.js'), 'utf8');
    expect(html).toMatch(/<script src="\/assist-outlook\.js\?v=\d+"><\/script>[\s\S]*<script src="\/assist\.js\?v=\d+">/);
    expect(js).toMatch(/S\.surface === 'web' && global\.OpalAssistOutlook/);
    expect(js).toMatch(/S\.outlook = c\.outlookDrafts/);
  });
});
