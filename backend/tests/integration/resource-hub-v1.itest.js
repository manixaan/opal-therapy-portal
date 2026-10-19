'use strict';

/**
 * Resource Hub V1 integration tests — purchase-request workflow (with the
 * admin operational view and clinical-field stripping), AI Resource Studio
 * drafts (local store, owner review queue, publish-to-hub), saved filter,
 * kit progress, feedback/report/link-status.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'HubV1Pass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../resources-routes'));
  app.use('/', require('../../purchases-routes'));
  app.use('/', require('../../resource-hub-r2-routes'));
  app.use('/', require('../../instrument-register-routes'));
  return app;
}

// Users share one organisation per test: governance events carry a NOT NULL
// organisation_id, so an org-less user cannot complete the rh2 review walk.
let sharedOrgId = null;

async function agentFor(app, role, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  if (!sharedOrgId) sharedOrgId = (await seedOrganisation('Hub V1 Org')).id;
  const user = await seedUser({ password_hash: hash, role, organisation_id: sharedOrgId, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

beforeEach(async () => { await truncateAll(); sharedOrgId = null; require('../../auth')._resetLoginRateLimit(); });
afterAll(closePool);

// ═══ Purchase requests ═══════════════════════════════════════════════════════

test('purchase lifecycle: create→edit→submit→approve→order→receive with role scoping + audit', async () => {
  const app = buildApp();
  const { agent: owner } = await agentFor(app, 'owner');
  const { agent: admin } = await agentFor(app, 'admin');
  const { agent: therapistA } = await agentFor(app, 'therapist');
  const { agent: therapistB } = await agentFor(app, 'therapist');
  const { agent: ro } = await agentFor(app, 'read_only');

  // Unauthenticated + read_only denied everywhere (reads included)
  expect((await request(app).get('/api/purchases')).status).toBe(401);
  expect((await ro.get('/api/purchases')).status).toBe(403);
  expect((await ro.post('/api/purchases').send({ productName: 'X' })).status).toBe(403);

  // Admin cannot create
  expect((await admin.post('/api/purchases').send({ productName: 'X' })).status).toBe(403);

  // Validation
  expect((await therapistA.post('/api/purchases').send({})).status).toBe(400);
  expect((await therapistA.post('/api/purchases').send({ productName: 'X', quantity: 0 })).status).toBe(400);

  // Therapist A creates a draft with clinical fields
  const created = await therapistA.post('/api/purchases').send({
    productName: 'Weighted lap blanket', productUrl: 'https://example.invalid/blanket',
    supplier: 'Sensory Supplies Co', quantity: 2, approxCostCents: 15000,
    costCheckedOn: '2026-08-01', intendedUse: 'In-clinic regulation kit',
    clinicalRationale: 'Proprioceptive input for session regulation',
    clientReference: 'C-123', note: 'Prefer the washable cover',
  });
  expect(created.status).toBe(201);
  const id = created.body.request.id;
  expect(created.body.request.status).toBe('draft');
  expect(created.body.request.quantity).toBe(2);
  expect(created.body.request.clinical_rationale).toBeTruthy();

  // Edit while draft
  const edited = await therapistA.patch(`/api/purchases/${id}`).send({ note: 'Washable cover, blue' });
  expect(edited.status).toBe(200);
  expect(edited.body.request.note).toBe('Washable cover, blue');

  // Therapist B cannot see or edit A's request
  expect((await therapistB.get(`/api/purchases/${id}`)).status).toBe(404);
  expect((await therapistB.patch(`/api/purchases/${id}`).send({ note: 'hijack' })).status).toBe(404);
  expect((await therapistB.get('/api/purchases')).body.requests).toHaveLength(0);

  // Admin sees nothing pre-approval
  expect((await admin.get('/api/purchases')).body.requests).toHaveLength(0);
  expect((await admin.get(`/api/purchases/${id}`)).status).toBe(404);

  // Invalid transition: approve a draft → 409
  const badApprove = await owner.post(`/api/purchases/${id}/approve`).send({ comment: 'too early' });
  expect(badApprove.status).toBe(409);
  expect(badApprove.body.code).toBe('invalid_status_transition');

  // Submit; therapist cannot approve; owner sees full clinical detail
  expect((await therapistA.post(`/api/purchases/${id}/submit`)).body.request.status).toBe('submitted');
  expect((await therapistA.post(`/api/purchases/${id}/approve`).send({})).status).toBe(403);
  const ownerView = await owner.get(`/api/purchases/${id}`);
  expect(ownerView.status).toBe(200);
  expect(ownerView.body.request.clinical_rationale).toBe('Proprioceptive input for session regulation');
  expect(ownerView.body.request.client_reference).toBe('C-123');

  // Owner approves with comment + spend limit
  const approved = await owner.post(`/api/purchases/${id}/approve`).send({ comment: 'Approved to the limit', spendLimitCents: 20000 });
  expect(approved.status).toBe(200);
  expect(approved.body.request.status).toBe('approved');
  expect(approved.body.request.owner_comment).toBe('Approved to the limit');
  expect(approved.body.request.spend_limit_cents).toBe(20000);
  expect(approved.body.request.decided_at).toBeTruthy();

  // Admin list now shows it, WITHOUT clinical fields
  const adminList = await admin.get('/api/purchases');
  expect(adminList.body.requests).toHaveLength(1);
  const adminRow = adminList.body.requests[0];
  expect(adminRow.product_name).toBe('Weighted lap blanket');
  expect(adminRow.clinical_rationale).toBeUndefined();
  expect(adminRow.client_reference).toBeUndefined();

  // Admin marks ordered then received (responses also stripped)
  const ordered = await admin.post(`/api/purchases/${id}/mark-ordered`).send({ poReference: 'PO-77', finalCostCents: 14500 });
  expect(ordered.status).toBe(200);
  expect(ordered.body.request.status).toBe('ordered');
  expect(ordered.body.request.po_reference).toBe('PO-77');
  expect(ordered.body.request.ordered_at).toBeTruthy();
  expect(ordered.body.request.clinical_rationale).toBeUndefined();
  const received = await admin.post(`/api/purchases/${id}/mark-received`).send({ invoiceReference: 'INV-9' });
  expect(received.status).toBe(200);
  expect(received.body.request.status).toBe('received');
  expect(received.body.request.invoice_reference).toBe('INV-9');
  expect(received.body.request.received_at).toBeTruthy();

  // Events: full trail for owner, visible to requester and (post-approval) admin
  const events = await owner.get(`/api/purchases/${id}/events`);
  expect(events.status).toBe(200);
  const actions = events.body.events.map((e) => e.action);
  for (const a of ['created', 'edited', 'submitted', 'approve', 'mark_ordered', 'mark_received']) {
    expect(actions).toContain(a);
  }
  expect(JSON.stringify(events.body.events)).not.toContain('C-123');
  expect(JSON.stringify(events.body.events)).not.toContain('Proprioceptive');
  expect((await therapistA.get(`/api/purchases/${id}/events`)).status).toBe(200);
  expect((await admin.get(`/api/purchases/${id}/events`)).status).toBe(200);
  expect((await therapistB.get(`/api/purchases/${id}/events`)).status).toBe(404);

  // Cancel a fresh draft; request-changes requires a comment
  const d2 = await therapistA.post('/api/purchases').send({ productName: 'Pencil grips', submit: true });
  expect(d2.body.request.status).toBe('submitted');
  expect((await owner.post(`/api/purchases/${d2.body.request.id}/request-changes`).send({})).status).toBe(400);
  const rc = await owner.post(`/api/purchases/${d2.body.request.id}/request-changes`).send({ comment: 'Add a cost check' });
  expect(rc.body.request.status).toBe('changes_requested');
  expect((await therapistA.patch(`/api/purchases/${d2.body.request.id}`).send({ approxCostCents: 900 })).status).toBe(200);
  expect((await therapistA.post(`/api/purchases/${d2.body.request.id}/submit`)).body.request.status).toBe('submitted');
  expect((await therapistA.post(`/api/purchases/${d2.body.request.id}/cancel`)).body.request.status).toBe('cancelled');

  // Audit rows for the key transitions
  const audit = await db.pool.query("SELECT action FROM audit_logs WHERE action LIKE 'purchase.%'");
  const auditActions = audit.rows.map((r) => r.action);
  expect(auditActions).toContain('purchase.approve');
  expect(auditActions).toContain('purchase.mark_ordered');
});

// ═══ AI Resource Studio drafts ═══════════════════════════════════════════════

test('?saved=1 returns only the caller\'s favourites', async () => {
  const app = buildApp();
  const { agent: owner } = await agentFor(app, 'owner');
  const { agent: therapistA } = await agentFor(app, 'therapist');
  const { agent: therapistB } = await agentFor(app, 'therapist');

  const r1 = await owner.post('/api/resources').send({ title: 'Zones handout', status: 'approved' });
  await owner.post('/api/resources').send({ title: 'Grip chart', status: 'approved' });
  expect((await therapistA.post(`/api/resources/${r1.body.resource.id}/favourite`)).status).toBe(200);

  const savedA = await therapistA.get('/api/resources?saved=1');
  expect(savedA.body.resources.map((r) => r.title)).toEqual(['Zones handout']);
  expect(savedA.body.resources[0].favourited).toBe(true);
  // link health columns ride along on the list rows
  expect(savedA.body.resources[0]).toHaveProperty('link_status');
  expect(savedA.body.resources[0]).toHaveProperty('link_checked_at');

  expect((await therapistB.get('/api/resources?saved=1')).body.resources).toHaveLength(0);
  expect((await therapistB.get('/api/resources')).body.resources).toHaveLength(2);
});

// ═══ Kit progress ════════════════════════════════════════════════════════════

test('kit progress: per-user PUT/GET round trip + validation', async () => {
  const app = buildApp();
  const { agent: therapistA } = await agentFor(app, 'therapist');
  const { agent: therapistB } = await agentFor(app, 'therapist');
  const { agent: ro } = await agentFor(app, 'read_only');

  const put = await therapistA.put('/api/resources/kits/foundations/progress')
    .send({ completedSteps: ['orientation', 'first-resource'] });
  expect(put.status).toBe(200);
  const got = await therapistA.get('/api/resources/kits/progress');
  expect(got.body.progress).toEqual({ foundations: ['orientation', 'first-resource'] });

  // Upsert replaces
  await therapistA.put('/api/resources/kits/foundations/progress').send({ completedSteps: ['orientation'] });
  expect((await therapistA.get('/api/resources/kits/progress')).body.progress.foundations).toEqual(['orientation']);

  // Per-user isolation
  expect((await therapistB.get('/api/resources/kits/progress')).body.progress).toEqual({});

  // Validation
  expect((await therapistA.put('/api/resources/kits/foundations/progress').send({ completedSteps: 'nope' })).status).toBe(400);
  expect((await therapistA.put('/api/resources/kits/foundations/progress').send({ completedSteps: Array(51).fill('s') })).status).toBe(400);
  expect((await therapistA.put('/api/resources/kits/foundations/progress').send({ completedSteps: [42] })).status).toBe(400);

  // read_only: GET fine, writes blocked by the global choke point
  expect((await ro.get('/api/resources/kits/progress')).status).toBe(200);
  expect((await ro.put('/api/resources/kits/foundations/progress').send({ completedSteps: [] })).status).toBe(403);
});

// ═══ Feedback, report, link health ═══════════════════════════════════════════

test('feedback + report + owner link-status with audit', async () => {
  const app = buildApp();
  const { agent: owner } = await agentFor(app, 'owner');
  const { agent: therapist } = await agentFor(app, 'therapist');

  const r = await owner.post('/api/resources').send({
    title: 'External strategy library', status: 'approved', externalUrl: 'https://example.invalid/library',
  });
  const rid = r.body.resource.id;

  expect((await therapist.post(`/api/resources/${rid}/feedback`).send({ helpful: true })).status).toBe(200);
  expect((await therapist.post(`/api/resources/${rid}/report`).send({ reason: 'Link 404s for me' })).status).toBe(200);

  let row = await db.pool.query('SELECT link_status, link_checked_at FROM resources WHERE id=$1', [rid]);
  expect(row.rows[0].link_status).toBe('reported');

  // Therapist cannot set link status; owner clears it to ok
  expect((await therapist.post(`/api/resources/${rid}/link-status`).send({ status: 'ok' })).status).toBe(403);
  expect((await owner.post(`/api/resources/${rid}/link-status`).send({ status: 'weird' })).status).toBe(400);
  expect((await owner.post(`/api/resources/${rid}/link-status`).send({ status: 'ok' })).status).toBe(200);
  row = await db.pool.query('SELECT link_status, link_checked_at FROM resources WHERE id=$1', [rid]);
  expect(row.rows[0].link_status).toBe('ok');
  expect(row.rows[0].link_checked_at).toBeTruthy();

  // 404 on unknown ids
  expect((await therapist.post('/api/resources/not-a-uuid/feedback').send({ helpful: false })).status).toBe(404);

  const audit = await db.pool.query("SELECT action, metadata FROM audit_logs WHERE action LIKE 'resource.%'");
  const actions = audit.rows.map((a) => a.action);
  expect(actions).toContain('resource.feedback');
  expect(actions).toContain('resource.reported');
  expect(actions).toContain('resource.link_status_changed');
  const fb = audit.rows.find((a) => a.action === 'resource.feedback');
  expect(fb.metadata.helpful).toBe(true);
});
