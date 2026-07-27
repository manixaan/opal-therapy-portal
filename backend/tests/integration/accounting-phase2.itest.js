'use strict';

/**
 * Accounting Automation Phase 2 — slice 1 integration tests.
 * Exception dashboard + contact mappings + invoice-candidate readiness.
 * Real Express routes, real sessions, real SQL. No external HTTP: the only
 * write-shaped route (create-xero-contact) must be blocked by flags before
 * it could ever need a network.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');
const adb = require('../../accounting-db');
const { generateExceptions } = require('../../accounting-exceptions');
const { createCandidateEngine } = require('../../candidate-engine');

const PASSWORD = 'AcctPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../accounting-routes'));
  return app;
}

async function agentFor(app, role) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

const FLAG_VARS = ['ENABLE_XERO_WRITE', 'ENABLE_XERO_CONTACT_CREATE',
  'ENABLE_XERO_DRAFT_INVOICE_CREATE', 'ENABLE_ACCOUNTING_EXCEPTION_DASHBOARD'];

beforeEach(async () => {
  await truncateAll();
  for (const v of FLAG_VARS) delete process.env[v];
  require('../../auth')._resetLoginRateLimit();
});
afterAll(closePool);

// ── RBAC ─────────────────────────────────────────────────────────────────────

describe('RBAC — slice-1 routes are owner-only', () => {
  const routes = [
    ['get', '/api/accounting/exceptions'],
    ['post', '/api/accounting/exceptions/refresh'],
    ['post', '/api/accounting/exceptions/00000000-0000-0000-0000-000000000001/resolve'],
    ['get', '/api/accounting/contacts'],
    ['post', '/api/accounting/contacts/refresh-suggestions'],
    ['post', '/api/accounting/contacts/00000000-0000-0000-0000-000000000001/map'],
    ['post', '/api/accounting/contacts/create-xero-contact'],
  ];

  test('admin, therapist and read_only are all denied', async () => {
    const app = buildApp();
    for (const role of ['admin', 'therapist', 'read_only']) {
      const { agent } = await agentFor(app, role);
      for (const [method, path] of routes) {
        const res = await agent[method](path);
        expect([401, 403]).toContain(res.status);
      }
    }
  });

  test('unauthenticated is 401 on every route', async () => {
    const app = buildApp();
    for (const [method, path] of routes) {
      expect((await request(app)[method](path)).status).toBe(401);
    }
  });
});

// ── Flag gates ───────────────────────────────────────────────────────────────

describe('write-shaped stub is fail-closed (hard rule proven at the route)', () => {
  test('403 with flags unset', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const res = await agent.post('/api/accounting/contacts/create-xero-contact');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('contact_create_disabled');
  });

  test('403 when the SPECIFIC flag is true but the global gate is off — the hard rule', async () => {
    process.env.ENABLE_XERO_CONTACT_CREATE = 'true'; // "accidentally true"
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const res = await agent.post('/api/accounting/contacts/create-xero-contact');
    expect(res.status).toBe(403);
  });

  test('even fully enabled, no write path exists in this slice (501)', async () => {
    process.env.ENABLE_XERO_WRITE = 'true';
    process.env.ENABLE_XERO_CONTACT_CREATE = 'true';
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const res = await agent.post('/api/accounting/contacts/create-xero-contact');
    expect(res.status).toBe(501);
  });

  test('exception dashboard read flag can be turned off', async () => {
    process.env.ENABLE_ACCOUNTING_EXCEPTION_DASHBOARD = 'false';
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    expect((await agent.get('/api/accounting/exceptions')).status).toBe(403);
    expect((await agent.post('/api/accounting/exceptions/refresh')).status).toBe(403);
  });
});

// ── Contact mappings ─────────────────────────────────────────────────────────

describe('contact mappings', () => {
  test('manual mapping persists as permanent (mapped/high/manual) and is audited', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const row = await adb.upsertSuggestedContactMapping({
      organisationId: null, sploseClientId: 'sc-1', xeroContactId: 'X-9',
      matchConfidence: 'low', matchReason: 'name_fuzzy', status: 'needs_review',
    });

    const res = await agent.post(`/api/accounting/contacts/${row.id}/map`).send({ xeroContactId: 'X-9' });
    expect(res.status).toBe(200);
    expect(res.body.mapping).toMatchObject({ status: 'mapped', match_reason: 'manual', match_confidence: 'high', xero_contact_id: 'X-9' });

    const audit = await db.pool.query("SELECT COUNT(*) FROM audit_logs WHERE action='finance.contact_mapped_manually'");
    expect(Number(audit.rows[0].count)).toBe(1);

    const list = await agent.get('/api/accounting/contacts');
    expect(list.status).toBe(200);
    expect(list.body.mappings.find(m => m.id === row.id).status).toBe('mapped');
  });

  test('suggestion upserts NEVER downgrade an owner-confirmed mapping', async () => {
    const row = await adb.upsertSuggestedContactMapping({
      organisationId: null, sploseClientId: 'sc-2', xeroContactId: null,
      matchConfidence: null, matchReason: 'none', status: 'unmapped',
    });
    await adb.setManualContactMapping(row.id, 'X-42', null);
    // A later suggestion run proposes something else entirely.
    const after = await adb.upsertSuggestedContactMapping({
      organisationId: null, sploseClientId: 'sc-2', xeroContactId: 'X-99',
      matchConfidence: 'high', matchReason: 'email', status: 'needs_review',
    });
    expect(after).toMatchObject({ xero_contact_id: 'X-42', status: 'mapped', match_reason: 'manual' });
  });

  test('suggestion upsert is idempotent under NULL organisation_id (no duplicate rows)', async () => {
    for (let i = 0; i < 3; i++) {
      await adb.upsertSuggestedContactMapping({
        organisationId: null, sploseClientId: 'sc-3', xeroContactId: null,
        matchConfidence: null, matchReason: 'none', status: 'unmapped',
      });
    }
    const { rows } = await db.pool.query(
      "SELECT COUNT(*) FROM finance_contact_mappings WHERE splose_client_id='sc-3'");
    expect(Number(rows[0].count)).toBe(1);
  });

  test('refresh-suggestions without a Xero connection is a clean 404', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const res = await agent.post('/api/accounting/contacts/refresh-suggestions');
    expect(res.status).toBe(404);
  });
});

// ── Candidate readiness ──────────────────────────────────────────────────────

describe('invoice-candidate readiness requires a confirmed contact mapping', () => {
  const pricedStub = {
    priceAppointment: () => ({
      status: 'priced', warnings: [], totalAmount: 100, totalTax: 0, pricingSource: 'test',
      lines: [{ description: 'Therapy', quantity: 1, unitAmount: 100, accountCode: '200', taxType: 'NONE' }],
    }),
  };
  const engine = createCandidateEngine({ adb, pricing: pricedStub, logger: { warn: () => {} } });
  const appt = { id: 'appt-p2', clientId: 'sc-10', serviceId: 'svc-1', serviceName: 'Therapy', status: 'completed', date: '2026-07-20' };
  const serviceMappings = [{ splose_service_id: 'svc-1', xero_account_code: '200' }];

  test('no confirmed mapping → needs_mapping with no_contact_mapping warning', async () => {
    await engine.generate([appt], { organisationId: null, pricingRules: [], serviceMappings, contactMappings: [] });
    const [cand] = await adb.listCandidates(null, {});
    expect(cand.status).toBe('needs_mapping');
    expect(cand.warnings).toContain('no_contact_mapping');
    expect(cand.xero_contact_id).toBeNull();
  });

  test('confirmed mapping → ready_for_review with ContactID stored; regeneration never duplicates', async () => {
    const mapping = [{ splose_client_id: 'sc-10', xero_contact_id: 'X-77' }];
    await engine.generate([appt], { organisationId: null, pricingRules: [], serviceMappings, contactMappings: mapping });
    await engine.generate([appt], { organisationId: null, pricingRules: [], serviceMappings, contactMappings: mapping });
    const cands = await adb.listCandidates(null, {});
    expect(cands).toHaveLength(1); // NULL-org idempotency (uq_invoice_candidate_dedupe)
    expect(cands[0].status).toBe('ready_for_review');
    expect(cands[0].xero_contact_id).toBe('X-77');
  });
});

// ── Exception engine + dashboard ─────────────────────────────────────────────

describe('exception generation, lifecycle and dedupe', () => {
  async function seedBlockedState() {
    // Candidate blocked on mapping + account code.
    await adb.upsertCandidate({
      organisationId: null, sploseAppointmentId: 'appt-x1',
      status: 'needs_mapping', warnings: ['no_contact_mapping', 'no_account_code'], totalAmount: 100,
    }, []);
    // Candidate with duplicate risk.
    await adb.upsertCandidate({
      organisationId: null, sploseAppointmentId: 'appt-x2',
      status: 'duplicate_risk', warnings: [], totalAmount: 100,
    }, []);
    // Unmapped contact.
    await adb.upsertSuggestedContactMapping({
      organisationId: null, sploseClientId: 'sc-x', xeroContactId: null,
      matchConfidence: null, matchReason: 'none', status: 'unmapped',
    });
    // Recent sync error.
    const conn = await adb.upsertConnection({
      organisationId: null, tenantId: 't-exc', tenantName: 'T', tenantType: 'ORGANISATION',
      connectedByUserId: null, accessToken: 'at', refreshToken: 'rt',
      tokenExpiresAt: new Date(Date.now() + 1e6), baseCurrency: 'AUD',
    });
    await adb.logFinanceSync(conn.id, { resource: 'invoices', status: 'error', records: 0, durationMs: 5, message: 'boom' });
    // Ready candidate sitting >3 days.
    const stale = await adb.upsertCandidate({
      organisationId: null, sploseAppointmentId: 'appt-x3',
      status: 'ready_for_review', warnings: [], totalAmount: 50,
    }, []);
    await db.pool.query("UPDATE finance_invoice_candidates SET created_at = NOW() - INTERVAL '4 days' WHERE id = $1", [stale.id]);
  }

  test('generates typed items with severity + explanation + suggested action', async () => {
    await seedBlockedState();
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const res = await agent.get('/api/accounting/exceptions?refresh=true');
    expect(res.status).toBe(200);
    const types = res.body.items.map(i => i.exception_type);
    for (const t of ['unmapped_contact', 'missing_account_code', 'duplicate_invoice_risk', 'sync_error', 'not_invoiced']) {
      expect(types).toContain(t);
    }
    for (const item of res.body.items) {
      expect(['high', 'medium', 'low']).toContain(item.severity);
      expect(item.explanation).toBeTruthy();
      expect(item.suggested_action).toBeTruthy();
      expect(item.status).toBe('open');
    }
    // High severity sorts first.
    expect(res.body.items[0].severity).toBe('high');
  });

  test('regeneration is idempotent — same conditions, same row count', async () => {
    await seedBlockedState();
    await generateExceptions(null);
    const first = await db.pool.query('SELECT COUNT(*) FROM accounting_exception_items');
    await generateExceptions(null);
    const second = await db.pool.query('SELECT COUNT(*) FROM accounting_exception_items');
    expect(second.rows[0].count).toBe(first.rows[0].count);
  });

  test('resolve → reopens on next scan if the condition persists; dismiss is permanent', async () => {
    await seedBlockedState();
    await generateExceptions(null);
    const items = await adb.listExceptions(null, {});
    const toResolve = items.find(i => i.exception_type === 'duplicate_invoice_risk');
    const toDismiss = items.find(i => i.exception_type === 'sync_error');

    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    expect((await agent.post(`/api/accounting/exceptions/${toResolve.id}/resolve`)).status).toBe(200);
    expect((await agent.post(`/api/accounting/exceptions/${toDismiss.id}/dismiss`)).status).toBe(200);

    // Conditions unchanged → rescan.
    await generateExceptions(null);
    const after = await adb.listExceptions(null, { status: 'all' });
    expect(after.find(i => i.id === toResolve.id).status).toBe('open');      // recurred
    expect(after.find(i => i.id === toDismiss.id).status).toBe('dismissed'); // silenced

    // Reopen a dismissed item explicitly.
    expect((await agent.post(`/api/accounting/exceptions/${toDismiss.id}/reopen`)).status).toBe(200);
    const reopened = await db.pool.query('SELECT status FROM accounting_exception_items WHERE id=$1', [toDismiss.id]);
    expect(reopened.rows[0].status).toBe('open');
  });

  test('fixing the condition auto-resolves the item on the next scan', async () => {
    await adb.upsertCandidate({
      organisationId: null, sploseAppointmentId: 'appt-fix',
      status: 'duplicate_risk', warnings: [], totalAmount: 10,
    }, []);
    await generateExceptions(null);
    let items = await adb.listExceptions(null, {});
    expect(items.some(i => i.exception_type === 'duplicate_invoice_risk')).toBe(true);

    // Owner reviews the candidate → condition gone.
    const [cand] = await adb.listCandidates(null, { status: 'duplicate_risk' });
    await adb.setCandidateStatus(cand.id, 'ignored', {});
    // Age the item past the auto-resolve horizon, then rescan.
    await db.pool.query("UPDATE accounting_exception_items SET last_seen_at = NOW() - INTERVAL '2 minutes'");
    await generateExceptions(null);
    items = await adb.listExceptions(null, {});
    expect(items.some(i => i.exception_type === 'duplicate_invoice_risk')).toBe(false);
    const all = await adb.listExceptions(null, { status: 'all' });
    expect(all.find(i => i.exception_type === 'duplicate_invoice_risk').status).toBe('resolved');
  });

  test('exception items never contain names or clinical text — identifiers only', async () => {
    await seedBlockedState();
    await generateExceptions(null);
    const { rows } = await db.pool.query('SELECT * FROM accounting_exception_items');
    for (const r of rows) {
      // affected_id must look like an id (uuid / splose id), never free text with spaces.
      expect(r.affected_id).not.toMatch(/\s/);
      expect(r.explanation).not.toMatch(/boom/); // sync message text is not copied through
    }
  });
});
