'use strict';

/**
 * Security regression tests (Phase 6):
 *  - Graph webhook notifications parse from a RAW body mounted before json()
 *  - clientState mismatches are ignored
 *  - OAuth state mismatch is a hard 403 outside development (no token exchange)
 *  - email HTML escaping
 *  - document upload validation
 */

jest.mock('../database', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  getUser: jest.fn(),
  getUserByEmail: jest.fn(),
  updateUserTokens: jest.fn().mockResolvedValue({}),
  getDeltaState: jest.fn().mockResolvedValue({ delta_token: 'stored-token' }),
  saveDeltaState: jest.fn().mockResolvedValue(null),
  upsertOutlookEvent: jest.fn().mockResolvedValue({}),
  softDeleteEventByOutlookId: jest.fn().mockResolvedValue(null),
  reconcileOutlookWindowSafe: jest.fn().mockResolvedValue({ blocked: false, pruned: [] }),
  logAuditEvent: jest.fn().mockResolvedValue(null),
  recordLogin: jest.fn().mockResolvedValue(null),
  getEvents: jest.fn().mockResolvedValue([]),
  createUser: jest.fn(),
  createEvent: jest.fn(),
  updateEventOutlookId: jest.fn(),
  updateEventWriteError: jest.fn(),
  updateEvent: jest.fn(),
  updateEventManualLocation: jest.fn(),
  deduplicateOutlookEvents: jest.fn().mockResolvedValue([]),
  cleanupStaleOutlookEvents: jest.fn().mockResolvedValue([]),
  getTherapistProfile: jest.fn().mockResolvedValue(null),
}));

jest.mock('../outlook-oauth', () => ({
  getAuthorizationUrl: jest.fn().mockReturnValue({ url: 'https://login.microsoftonline.com/x', state: 'expected-state' }),
  getAccessToken: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 3600 }),
  getMicrosoftUser: jest.fn().mockResolvedValue({ id: 'ms-1', email: 'u@test.invalid' }),
  getOutlookCalendarDelta: jest.fn().mockResolvedValue({ changed: [], deleted: [], deltaToken: 'new-token' }),
  getOutlookCalendarEvents: jest.fn().mockResolvedValue([]),
  refreshAccessToken: jest.fn().mockResolvedValue({ accessToken: 'a2', refreshToken: 'r2', expiresIn: 3600 }),
  createOutlookEvent: jest.fn(),
  updateOutlookEvent: jest.fn(),
  deleteOutlookEvent: jest.fn(),
}));

jest.mock('../splose-api', () => ({}));

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const request = require('supertest');

const db = require('../database');
const outlookApi = require('../outlook-oauth');
const { webhookSubscriptions } = require('../webhook-state');

function buildApp() {
  const app = express();
  // EXACTLY mirrors server.js ordering: raw webhook capture BEFORE json()
  app.use('/api/webhooks/outlook', express.raw({ type: '*/*' }));
  app.use(bodyParser.json());
  app.use(session({ secret: 'x'.repeat(32), resave: false, saveUninitialized: false }));
  app.use('/', require('../routes'));
  return app;
}

const flushAsync = () => new Promise(r => setImmediate(() => setImmediate(r)));

beforeEach(() => {
  jest.clearAllMocks();
  webhookSubscriptions.clear();
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('Graph webhook receiver (raw-body regression)', () => {
  test('validation handshake echoes the token as text/plain', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/webhooks/outlook?validationToken=abc123')
      .set('Content-Type', 'text/plain')
      .send('');
    expect(res.status).toBe(200);
    expect(res.text).toBe('abc123');
    expect(res.headers['content-type']).toContain('text/plain');
  });

  test('a JSON change notification is parsed and triggers a delta sync', async () => {
    process.env.WEBHOOK_CLIENT_STATE = 'test-client-state';
    webhookSubscriptions.set('sub-1', 'user-1');
    db.pool.query.mockImplementation(async (sql) => {
      if (/FROM users WHERE id/.test(sql)) {
        return { rows: [{ id: 'user-1', email: 'u@test.invalid', access_token: 'tok', refresh_token: 'r', token_expires_at: new Date(Date.now() + 3600e3) }] };
      }
      return { rows: [{ n: 0 }], rowCount: 0 };
    });

    const app = buildApp();
    const payload = JSON.stringify({
      value: [{ subscriptionId: 'sub-1', clientState: 'test-client-state', changeType: 'updated' }],
    });
    const res = await request(app)
      .post('/api/webhooks/outlook')
      .set('Content-Type', 'application/json') // exactly what Graph sends
      .send(payload);

    expect(res.status).toBe(202);
    await flushAsync();
    // Before the raw-before-json fix this was never reached:
    // req.body arrived pre-parsed and Buffer.toString() → "[object Object]"
    expect(outlookApi.getOutlookCalendarDelta).toHaveBeenCalledWith('tok', 'stored-token');
    expect(db.saveDeltaState).toHaveBeenCalledWith('user-1', 'new-token');
    delete process.env.WEBHOOK_CLIENT_STATE;
  });

  test('clientState mismatch is ignored (no sync, still 202)', async () => {
    process.env.WEBHOOK_CLIENT_STATE = 'correct-state';
    webhookSubscriptions.set('sub-1', 'user-1');
    const app = buildApp();
    const res = await request(app)
      .post('/api/webhooks/outlook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ value: [{ subscriptionId: 'sub-1', clientState: 'WRONG' }] }));
    expect(res.status).toBe(202);
    await flushAsync();
    expect(outlookApi.getOutlookCalendarDelta).not.toHaveBeenCalled();
    delete process.env.WEBHOOK_CLIENT_STATE;
  });

  test('malformed payload does not crash the receiver', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/webhooks/outlook')
      .set('Content-Type', 'application/json')
      .send('this is not json');
    expect(res.status).toBe(202); // acked; error contained in async processor
    await flushAsync();
    expect(outlookApi.getOutlookCalendarDelta).not.toHaveBeenCalled();
  });
});

describe('OAuth state enforcement', () => {
  afterEach(() => { process.env.NODE_ENV = 'test'; });

  test('state mismatch outside development → 403 and NO token exchange', async () => {
    process.env.NODE_ENV = 'production';
    const app = buildApp();
    const res = await request(app)
      .get('/auth/oauth/callback')
      .query({ code: 'auth-code', state: 'forged-state' });
    expect(res.status).toBe(403);
    expect(outlookApi.getAccessToken).not.toHaveBeenCalled();
  });

  test('matching state WITHOUT a portal session is rejected in production (no auto-provisioning, code not burned)', async () => {
    // Post-fix contract: a valid state alone is not enough outside
    // development/test — the callback must belong to a signed-in portal
    // user. The rejection happens BEFORE the token exchange so the one-time
    // authorization code is not consumed. (The signed-in success path is
    // covered end-to-end in tests/integration/oauth-callback.itest.js.)
    process.env.NODE_ENV = 'production';
    db.getUserByEmail.mockResolvedValue({ id: 'u1', email: 'u@test.invalid', microsoft_id: 'ms-1', role: 'owner' });
    const app = buildApp();
    const agent = request.agent(app);

    // Step 1 stores the expected state in the session (public route)
    const init = await agent.get('/auth/outlook-login');
    expect(init.status).toBe(200);

    // Step 2 returns with the SAME state but no signed-in portal user → 401
    const res = await agent.get('/auth/oauth/callback')
      .query({ code: 'auth-code', state: 'expected-state' });
    expect(res.status).toBe(401);
    expect(outlookApi.getAccessToken).not.toHaveBeenCalled();
  });
});

describe('email HTML escaping', () => {
  const { escapeHtml } = require('../email');
  test('neutralises markup in user-supplied names', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>'))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml(`"quoted" & 'single'`)).toBe('&quot;quoted&quot; &amp; &#39;single&#39;');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('document upload validation', () => {
  const { validateUpload } = (() => {
    // validateUpload is module-internal; exercise it through the route surface
    // in integration. Here we replicate the contract via the exported router by
    // requiring the module and reaching the function through a tiny harness.
    const mod = require('../profile-routes');
    return { validateUpload: mod.validateUpload };
  })();

  // The function is attached for tests below (exported from profile-routes).
  test('accepts a well-formed PDF and rejects executables/mismatches', () => {
    expect(validateUpload({ fileName: 'cert.pdf', fileMime: 'application/pdf', fileData: 'JVBERi0xLjQ=' })).toBeNull();
    expect(validateUpload({ fileName: 'run.exe', fileMime: 'application/x-msdownload', fileData: 'TVqQ' })).toMatch(/not allowed/);
    expect(validateUpload({ fileName: 'evil.exe', fileMime: 'application/pdf', fileData: 'JVBERi0=' })).toMatch(/does not match/);
    expect(validateUpload({ fileName: '../../etc/passwd.pdf', fileMime: 'application/pdf', fileData: 'JVBERi0=' })).toMatch(/Invalid file name/);
    expect(validateUpload({ fileName: 'x.pdf', fileMime: 'application/pdf', fileData: '<script>alert(1)</script>' })).toMatch(/base64/);
    expect(validateUpload({ fileName: undefined, fileMime: undefined, fileData: undefined })).toBeNull(); // metadata-only
  });
});
