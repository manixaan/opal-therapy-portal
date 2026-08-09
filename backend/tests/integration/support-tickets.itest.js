'use strict';

/**
 * Support tickets — integration tests (real Express, real sessions, real SQL).
 * Covers spec §34: numbering, visibility boundaries, triage, the status
 * workflow, verification, comments, attachments, duplicates, rate limiting,
 * notifications and audit rows.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'SupportPass1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '8mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../support-routes'));
  return app;
}

async function agentFor(app, role, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

async function createTicket(agent, body = {}) {
  const res = await agent.post('/api/support/tickets').send({
    type: 'bug', title: 'Calendar tile misaligned', description: 'Steps: open week view.',
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body.ticket;
}

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
  require('../../support-routes')._resetSupportRateLimit();
});
afterAll(closePool);

// ── Creation + numbering ─────────────────────────────────────────────────────

describe('creation and ticket numbers', () => {
  test('unauthenticated is 401 on every route', async () => {
    const app = buildApp();
    for (const [method, path] of [
      ['post', '/api/support/tickets'], ['get', '/api/support/tickets'],
      ['get', '/api/support/tickets/00000000-0000-0000-0000-000000000001'],
      ['get', '/api/support/analytics'], ['get', '/api/support/staff'],
    ]) {
      expect((await request(app)[method](path)).status).toBe(401);
    }
  });

  test('tickets number sequentially from OPA-0001', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    const t1 = await createTicket(agent);
    const t2 = await createTicket(agent, { title: 'Second issue' });
    expect(t1.ticket_number).toBe('OPA-0001');
    expect(t2.ticket_number).toBe('OPA-0002');
    expect(t1.status).toBe('new');
    expect(t1.reported_priority).toBe('medium');
    expect(t1.triaged_priority).toBeNull();
  });

  test('server captures environment/app version and sanitises client context', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    const t = await createTicket(agent, {
      module: 'calendar', route: 'calendar', browser: 'TestBrowser/1.0', viewport: '1280x800',
      technicalContext: { resourceId: 'abc', sessionToken: 'LEAK', authorization: 'Bearer LEAK' },
    });
    expect(t.environment).toBe('test'); // NODE_ENV under jest
    expect(t.app_version).toBeTruthy();
    expect(t.browser_context).toContain('TestBrowser/1.0');
    expect(t.technical_context.resourceId).toBe('abc');
    expect(JSON.stringify(t.technical_context)).not.toContain('LEAK');
  });

  test('validation: bad type, missing title/description', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    expect((await agent.post('/api/support/tickets').send({ type: 'rant', title: 'x', description: 'y' })).status).toBe(400);
    expect((await agent.post('/api/support/tickets').send({ type: 'bug', description: 'y' })).status).toBe(400);
    expect((await agent.post('/api/support/tickets').send({ type: 'bug', title: 'x' })).status).toBe(400);
  });

  test('creation is rate-limited to 10 per user per window (429)', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    let last;
    for (let i = 0; i < 11; i++) {
      last = await agent.post('/api/support/tickets').send({ type: 'bug', title: 'T' + i, description: 'd' });
    }
    expect(last.status).toBe(429);
    expect(last.body.error).toBe('rate_limited');
    // Another user is unaffected.
    const { agent: other } = await agentFor(app, 'therapist');
    await createTicket(other);
  });
});

// ── Visibility ───────────────────────────────────────────────────────────────

describe('visibility boundaries', () => {
  test('therapists list OWN tickets only; admin/owner see all org tickets', async () => {
    const app = buildApp();
    const { agent: tA } = await agentFor(app, 'therapist');
    const { agent: tB } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    await createTicket(tA, { title: 'A ticket' });
    await createTicket(tB, { title: 'B ticket' });

    const a = await tA.get('/api/support/tickets');
    expect(a.body.tickets.map((t) => t.title)).toEqual(['A ticket']);

    const all = await admin.get('/api/support/tickets');
    expect(all.body.tickets).toHaveLength(2);
  });

  test('cross-user detail access is 404 (no enumeration)', async () => {
    const app = buildApp();
    const { agent: tA } = await agentFor(app, 'therapist');
    const { agent: tB } = await agentFor(app, 'therapist');
    const t = await createTicket(tA);
    expect((await tB.get('/api/support/tickets/' + t.id)).status).toBe(404);
    expect((await tA.get('/api/support/tickets/' + t.id)).status).toBe(200);
  });

  test('admin filters: status, type, priority, q search', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const bug = await createTicket(rep, { title: 'Broken sync arrows', type: 'bug' });
    await createTicket(rep, { title: 'Please add dark mode', type: 'feature_request' });
    await admin.post(`/api/support/tickets/${bug.id}/status`).send({ status: 'triaged' });
    await admin.patch(`/api/support/tickets/${bug.id}`).send({ triagedPriority: 'p1' });

    expect((await admin.get('/api/support/tickets?type=bug')).body.tickets).toHaveLength(1);
    expect((await admin.get('/api/support/tickets?status=triaged')).body.tickets).toHaveLength(1);
    expect((await admin.get('/api/support/tickets?priority=p1')).body.tickets).toHaveLength(1);
    expect((await admin.get('/api/support/tickets?q=dark')).body.tickets).toHaveLength(1);
    expect((await admin.get('/api/support/tickets?q=OPA-0001')).body.tickets).toHaveLength(1);
    expect((await admin.get('/api/support/tickets?q=zzz-nothing')).body.tickets).toHaveLength(0);
  });

  test('detail includes comments, attachments meta, events and names', async () => {
    const app = buildApp();
    const { agent: rep, user } = await agentFor(app, 'therapist');
    const t = await createTicket(rep);
    await rep.post(`/api/support/tickets/${t.id}/comments`).send({ body: 'Extra detail.' });
    const d = await rep.get('/api/support/tickets/' + t.id);
    expect(d.status).toBe(200);
    expect(d.body.ticket.reporter_name).toBe(user.name);
    expect(d.body.comments).toHaveLength(1);
    expect(d.body.events.map((e) => e.event)).toEqual(['created', 'commented']);
    expect(d.body.attachments).toEqual([]);
  });
});

// ── Triage ───────────────────────────────────────────────────────────────────

describe('triage (priority, assignment)', () => {
  test('therapist cannot triage; admin can; triaged priority is separate from reported', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const t = await createTicket(rep, { reportedPriority: 'high' });

    expect((await rep.patch(`/api/support/tickets/${t.id}`).send({ triagedPriority: 'p1' })).status).toBe(403);

    const r = await admin.patch(`/api/support/tickets/${t.id}`).send({ triagedPriority: 'p3' });
    expect(r.status).toBe(200);
    expect(r.body.ticket.triaged_priority).toBe('p3');
    expect(r.body.ticket.reported_priority).toBe('high'); // untouched
    expect((await admin.patch(`/api/support/tickets/${t.id}`).send({ triagedPriority: 'urgent' })).status).toBe(400);
  });

  test('assignment: must be an active admin/owner in org; therapist assignee rejected', async () => {
    const app = buildApp();
    const { agent: rep, user: repUser } = await agentFor(app, 'therapist');
    const { agent: admin, user: adminUser } = await agentFor(app, 'admin');
    const t = await createTicket(rep);

    const bad = await admin.patch(`/api/support/tickets/${t.id}`).send({ assigneeUserId: repUser.id });
    expect(bad.status).toBe(400);

    const ok = await admin.patch(`/api/support/tickets/${t.id}`).send({ assigneeUserId: adminUser.id });
    expect(ok.status).toBe(200);
    expect(ok.body.ticket.assignee_user_id).toBe(adminUser.id);

    const events = await db.pool.query(
      "SELECT event FROM support_ticket_events WHERE ticket_id = $1 AND event = 'assigned'", [t.id]);
    expect(events.rows).toHaveLength(1);
  });

  test('staff endpoint lists admin/owner only and is role-gated', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    await agentFor(app, 'owner');
    expect((await rep.get('/api/support/staff')).status).toBe(403);
    const r = await admin.get('/api/support/staff');
    expect(r.status).toBe(200);
    expect(r.body.staff.length).toBe(2);
    expect(r.body.staff.every((s) => ['admin', 'owner'].includes(s.role))).toBe(true);
  });
});

// ── Status workflow ──────────────────────────────────────────────────────────

describe('status workflow', () => {
  test('the valid chain walks end to end; each hop is an event', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const t = await createTicket(rep);
    for (const to of ['triaged', 'in_progress', 'ready_to_test', 'resolved', 'closed']) {
      const r = await admin.post(`/api/support/tickets/${t.id}/status`).send({ status: to, resolution: to === 'resolved' ? 'Fixed in build 42' : undefined });
      expect([200]).toContain(r.status);
      expect(r.body.ticket.status).toBe(to);
    }
    const events = await db.pool.query(
      "SELECT detail FROM support_ticket_events WHERE ticket_id = $1 AND event = 'status_changed' ORDER BY id", [t.id]);
    expect(events.rows.map((e) => e.detail.to)).toEqual(['triaged', 'in_progress', 'ready_to_test', 'resolved', 'closed']);
    const row = await db.pool.query('SELECT resolved_at, closed_at, resolution FROM support_tickets WHERE id=$1', [t.id]);
    expect(row.rows[0].resolved_at).toBeTruthy();
    expect(row.rows[0].closed_at).toBeTruthy();
    expect(row.rows[0].resolution).toBe('Fixed in build 42');
  });

  test('invalid transitions are 409; unknown status is 400', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const t = await createTicket(rep);
    expect((await admin.post(`/api/support/tickets/${t.id}/status`).send({ status: 'resolved' })).status).toBe(409);
    expect((await admin.post(`/api/support/tickets/${t.id}/status`).send({ status: 'ready_to_test' })).status).toBe(409);
    expect((await admin.post(`/api/support/tickets/${t.id}/status`).send({ status: 'made_up' })).status).toBe(400);
  });

  test('therapist cannot run staff transitions', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const t = await createTicket(rep);
    expect((await rep.post(`/api/support/tickets/${t.id}/status`).send({ status: 'triaged' })).status).toBe(403);
  });

  test("wont_fix requires a reason and stores it", async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const t = await createTicket(rep);
    expect((await admin.post(`/api/support/tickets/${t.id}/status`).send({ status: 'wont_fix' })).status).toBe(400);
    const r = await admin.post(`/api/support/tickets/${t.id}/status`).send({ status: 'wont_fix', reason: 'Working as designed.' });
    expect(r.status).toBe(200);
    expect(r.body.ticket.wont_fix_reason).toBe('Working as designed.');
    // Terminal: nothing moves out of wont_fix.
    expect((await admin.post(`/api/support/tickets/${t.id}/status`).send({ status: 'in_progress' })).status).toBe(409);
  });

  test('duplicate linking: requires a valid target, rejects self and dup-of-dup', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const a = await createTicket(rep, { title: 'Original' });
    const b = await createTicket(rep, { title: 'Same thing again' });
    const c = await createTicket(rep, { title: 'And again' });

    expect((await admin.post(`/api/support/tickets/${b.id}/status`).send({ status: 'duplicate' })).status).toBe(400);
    expect((await admin.post(`/api/support/tickets/${b.id}/status`).send({ status: 'duplicate', duplicateOfId: b.id })).status).toBe(400);

    const ok = await admin.post(`/api/support/tickets/${b.id}/status`).send({ status: 'duplicate', duplicateOfId: a.id });
    expect(ok.status).toBe(200);
    expect(ok.body.ticket.duplicate_of_id).toBe(a.id);

    // c → b is refused because b is itself a duplicate.
    const dupOfDup = await admin.post(`/api/support/tickets/${c.id}/status`).send({ status: 'duplicate', duplicateOfId: b.id });
    expect(dupOfDup.status).toBe(400);

    // Detail exposes the link.
    const d = await admin.get('/api/support/tickets/' + b.id);
    expect(d.body.duplicateOf.ticket_number).toBe(a.ticket_number);
  });
});

// ── Verification + reopen ────────────────────────────────────────────────────

describe('reporter verification and reopening', () => {
  async function toReadyToTest(admin, rep) {
    const t = await createTicket(rep);
    for (const to of ['triaged', 'in_progress', 'ready_to_test']) {
      await admin.post(`/api/support/tickets/${t.id}/status`).send({ status: to });
    }
    return t;
  }

  test("verify 'fixed' resolves; only the reporter may verify", async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const t = await toReadyToTest(admin, rep);

    expect((await admin.post(`/api/support/tickets/${t.id}/verify`).send({ outcome: 'fixed' })).status).toBe(403);

    const r = await rep.post(`/api/support/tickets/${t.id}/verify`).send({ outcome: 'fixed', comment: 'All good now.' });
    expect(r.status).toBe(200);
    expect(r.body.ticket.status).toBe('resolved');
    expect(r.body.ticket.resolution).toBe('All good now.');
  });

  test("verify 'still_happening' returns the ticket to in_progress", async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const t = await toReadyToTest(admin, rep);
    const r = await rep.post(`/api/support/tickets/${t.id}/verify`).send({ outcome: 'still_happening' });
    expect(r.status).toBe(200);
    expect(r.body.ticket.status).toBe('in_progress');
    // Verify only works while awaiting verification.
    expect((await rep.post(`/api/support/tickets/${t.id}/verify`).send({ outcome: 'fixed' })).status).toBe(409);
  });

  test('reporter can reopen resolved/closed; resolution history survives in events', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const t = await toReadyToTest(admin, rep);
    await admin.post(`/api/support/tickets/${t.id}/status`).send({ status: 'resolved', resolution: 'Deployed fix.' });

    const r = await rep.post(`/api/support/tickets/${t.id}/status`).send({ status: 'in_progress' });
    expect(r.status).toBe(200);
    expect(r.body.ticket.status).toBe('in_progress');

    const events = await db.pool.query(
      "SELECT detail FROM support_ticket_events WHERE ticket_id=$1 AND event='status_changed' ORDER BY id", [t.id]);
    const details = events.rows.map((e) => e.detail);
    expect(details.some((d) => d.to === 'resolved' && d.resolution === 'Deployed fix.')).toBe(true);
    expect(details[details.length - 1]).toMatchObject({ from: 'resolved', to: 'in_progress' });
  });

  test('a different therapist can neither verify nor reopen (404 — no enumeration)', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const { agent: stranger } = await agentFor(app, 'therapist');
    const t = await toReadyToTest(admin, rep);
    expect((await stranger.post(`/api/support/tickets/${t.id}/verify`).send({ outcome: 'fixed' })).status).toBe(404);
    expect((await stranger.post(`/api/support/tickets/${t.id}/status`).send({ status: 'in_progress' })).status).toBe(404);
  });
});

// ── Comments ─────────────────────────────────────────────────────────────────

describe('comments', () => {
  test('reporter and staff can comment; outsiders 404; length capped', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const { agent: stranger } = await agentFor(app, 'therapist');
    const t = await createTicket(rep);

    expect((await rep.post(`/api/support/tickets/${t.id}/comments`).send({ body: 'More info.' })).status).toBe(201);
    expect((await admin.post(`/api/support/tickets/${t.id}/comments`).send({ body: 'Looking into it.' })).status).toBe(201);
    expect((await stranger.post(`/api/support/tickets/${t.id}/comments`).send({ body: 'hi' })).status).toBe(404);
    expect((await rep.post(`/api/support/tickets/${t.id}/comments`).send({ body: '' })).status).toBe(400);

    const long = await rep.post(`/api/support/tickets/${t.id}/comments`).send({ body: 'x'.repeat(4000) });
    expect(long.status).toBe(201);
    expect(long.body.comment.body.length).toBe(3000);
  });
});

// ── Attachments ──────────────────────────────────────────────────────────────

describe('attachments', () => {
  test('upload, list meta, authenticated download; cross-user download denied', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const { agent: stranger } = await agentFor(app, 'therapist');
    const t = await createTicket(rep);

    const up = await rep.post(`/api/support/tickets/${t.id}/attachments`)
      .send({ fileName: 'shot.png', fileMime: 'image/png', fileData: PNG, fileSizeBytes: 16 });
    expect(up.status).toBe(201);
    const attId = up.body.attachmentId;

    const d = await rep.get('/api/support/tickets/' + t.id);
    expect(d.body.attachments).toHaveLength(1);
    expect(d.body.attachments[0].file_name).toBe('shot.png');
    expect(d.body.attachments[0].file_data).toBeUndefined(); // meta only

    const dl = await rep.get(`/api/support/attachments/${attId}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('image/png');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-disposition']).toContain('attachment');

    expect((await admin.get(`/api/support/attachments/${attId}/download`)).status).toBe(200);
    expect((await stranger.get(`/api/support/attachments/${attId}/download`)).status).toBe(404);
  });

  test('type allowlist (incl. WEBP), extension match, and the 3-attachment cap', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const t = await createTicket(rep);

    expect((await rep.post(`/api/support/tickets/${t.id}/attachments`)
      .send({ fileName: 'x.pdf', fileMime: 'application/pdf', fileData: PNG })).status).toBe(415);
    expect((await rep.post(`/api/support/tickets/${t.id}/attachments`)
      .send({ fileName: 'x.png', fileMime: 'image/webp', fileData: PNG })).status).toBe(415);
    expect((await rep.post(`/api/support/tickets/${t.id}/attachments`)
      .send({ fileName: 'x.webp', fileMime: 'image/webp', fileData: PNG })).status).toBe(201);

    for (let i = 0; i < 2; i++) {
      await rep.post(`/api/support/tickets/${t.id}/attachments`)
        .send({ fileName: `s${i}.png`, fileMime: 'image/png', fileData: PNG });
    }
    const fourth = await rep.post(`/api/support/tickets/${t.id}/attachments`)
      .send({ fileName: 'four.png', fileMime: 'image/png', fileData: PNG });
    expect(fourth.status).toBe(400);
    expect(fourth.body.error).toContain('at most 3');
  });
});

// ── Notifications + audit ────────────────────────────────────────────────────

describe('notifications and audit', () => {
  test('high/critical creation notifies every admin/owner', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { user: adminUser } = await agentFor(app, 'admin');
    const { user: ownerUser } = await agentFor(app, 'owner');
    await createTicket(rep, { reportedPriority: 'critical', title: 'Cannot log in at all' });

    const rows = await db.pool.query(
      `SELECT user_id, type, severity FROM user_notifications WHERE type LIKE 'support_ticket_new:%'`);
    const userIds = rows.rows.map((r) => r.user_id).sort();
    expect(userIds).toEqual([adminUser.id, ownerUser.id].sort());
    expect(rows.rows.every((r) => r.severity === 'error')).toBe(true);
  });

  test('medium priority creates no staff notifications', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    await agentFor(app, 'admin');
    await createTicket(rep, { reportedPriority: 'medium' });
    const rows = await db.pool.query(`SELECT 1 FROM user_notifications WHERE type LIKE 'support_ticket_%'`);
    expect(rows.rows).toHaveLength(0);
  });

  test('assignment, staff comment and ready_to_test all notify the right person', async () => {
    const app = buildApp();
    const { agent: rep, user: repUser } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const { user: assignee } = await agentFor(app, 'owner');
    const t = await createTicket(rep);

    await admin.patch(`/api/support/tickets/${t.id}`).send({ assigneeUserId: assignee.id });
    await admin.post(`/api/support/tickets/${t.id}/comments`).send({ body: 'Can you send a screenshot?' });
    for (const to of ['triaged', 'in_progress', 'ready_to_test']) {
      await admin.post(`/api/support/tickets/${t.id}/status`).send({ status: to });
    }

    const rows = await db.pool.query('SELECT user_id, type FROM user_notifications ORDER BY id');
    const byType = (prefix) => rows.rows.filter((r) => r.type.startsWith(prefix));
    expect(byType('support_ticket_assigned:').map((r) => r.user_id)).toEqual([assignee.id]);
    expect(byType('support_ticket_comment:').map((r) => r.user_id)).toEqual([repUser.id]);
    expect(byType('support_ticket_ready:').map((r) => r.user_id)).toEqual([repUser.id]);
  });

  test('every mutation writes an audit row with targetType support_ticket', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    const t = await createTicket(rep);
    await admin.patch(`/api/support/tickets/${t.id}`).send({ triagedPriority: 'p2' });
    await admin.post(`/api/support/tickets/${t.id}/status`).send({ status: 'triaged' });
    await rep.post(`/api/support/tickets/${t.id}/comments`).send({ body: 'note' });
    await rep.post(`/api/support/tickets/${t.id}/attachments`)
      .send({ fileName: 's.png', fileMime: 'image/png', fileData: PNG });

    const rows = await db.pool.query(
      "SELECT action FROM audit_logs WHERE target_type = 'support_ticket' AND target_id = $1 ORDER BY created_at", [t.id]);
    const actions = rows.rows.map((r) => r.action);
    for (const a of ['support.ticket_created', 'support.ticket_triaged', 'support.ticket_status_changed',
      'support.ticket_commented', 'support.ticket_attachment_added']) {
      expect(actions).toContain(a);
    }
  });
});

// ── Analytics ────────────────────────────────────────────────────────────────

describe('analytics', () => {
  test('role-gated; counts open/new/p1p2/types/modules/reopened', async () => {
    const app = buildApp();
    const { agent: rep } = await agentFor(app, 'therapist');
    const { agent: admin } = await agentFor(app, 'admin');
    expect((await rep.get('/api/support/analytics')).status).toBe(403);

    const a = await createTicket(rep, { type: 'bug', module: 'calendar' });
    await createTicket(rep, { type: 'usability', module: 'calendar' });
    await createTicket(rep, { type: 'bug', module: 'resources' });
    await admin.post(`/api/support/tickets/${a.id}/status`).send({ status: 'triaged' });
    await admin.patch(`/api/support/tickets/${a.id}`).send({ triagedPriority: 'p1' });
    for (const to of ['in_progress', 'ready_to_test', 'resolved']) {
      await admin.post(`/api/support/tickets/${a.id}/status`).send({ status: to });
    }
    await rep.post(`/api/support/tickets/${a.id}/status`).send({ status: 'in_progress' }); // reopen

    const r = await admin.get('/api/support/analytics');
    expect(r.status).toBe(200);
    expect(r.body.openCount).toBe(3); // two new + one reopened in_progress
    expect(r.body.newThisWeek).toBe(3);
    expect(r.body.byType.find((x) => x.type === 'bug').count).toBe(2);
    expect(r.body.topModules[0]).toMatchObject({ source_module: 'calendar', count: 2 });
    expect(r.body.avgHoursToTriage).not.toBeNull();
    expect(r.body.avgHoursToResolve).not.toBeNull();
    expect(r.body.reopenedCount).toBe(1);
  });
});
