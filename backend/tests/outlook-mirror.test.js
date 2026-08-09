'use strict';

/**
 * OUTLOOK-ONLY MIRROR — propagation + flag-gating unit tests (2026-08-09)
 *
 * The calendar integration is Outlook-only: the app and Outlook mirror each
 * other two ways, and Splose serves patient/client data only. These tests pin:
 *
 *   1. App → Outlook update propagation (PATCH /api/outlook/events/:dbId):
 *      - local change is saved FIRST and persists when the Graph PATCH fails
 *        (graceful degradation: sync_log 'failed' + sync_status 'pending')
 *      - Graph success marks sync_status 'synced' and logs success
 *      - staged-rollout flag off ⇒ 403 feature_disabled and NO local write
 *   2. App → Outlook delete propagation (DELETE /api/outlook/events/:dbId):
 *      - Graph failure is non-fatal; the local soft-delete always happens
 *   3. Splose calendar decoupling flag surface:
 *      - GET /api/splose/sync-status reports calendarSyncEnabled=false unless
 *        ENABLE_SPLOSE_CALENDAR_SYNC is exactly 'true' (fail-closed)
 *
 * Graph is mocked at the module boundary (established pattern — no network).
 */

jest.mock('../database', () => ({
  pool: { query: jest.fn() },
  getUser: jest.fn(),
  updateUserTokens: jest.fn().mockResolvedValue({}),
  updateEvent: jest.fn().mockResolvedValue({}),
  updateEventManualLocation: jest.fn().mockResolvedValue({}),
  updateEventOutlookId: jest.fn().mockResolvedValue({}),
  updateEventWriteError: jest.fn().mockResolvedValue({}),
  upsertOutlookEvent: jest.fn().mockResolvedValue({}),
  softDeleteEventByOutlookId: jest.fn().mockResolvedValue(null),
  getDeltaState: jest.fn().mockResolvedValue(null),
  saveDeltaState: jest.fn().mockResolvedValue(null),
  getEvents: jest.fn().mockResolvedValue([]),
  createEvent: jest.fn(),
  logAuditEvent: jest.fn().mockResolvedValue(null),
  getTherapistProfile: jest.fn().mockResolvedValue(null),
}));

jest.mock('../outlook-oauth', () => ({
  getAuthorizationUrl: jest.fn(),
  getAccessToken: jest.fn(),
  getMicrosoftUser: jest.fn(),
  refreshAccessToken: jest.fn(),
  getOutlookCalendarEvents: jest.fn().mockResolvedValue([]),
  getOutlookCalendarDelta: jest.fn().mockResolvedValue({ changed: [], deleted: [], deltaToken: 't' }),
  createOutlookEvent: jest.fn(),
  updateOutlookEvent: jest.fn(),
  deleteOutlookEvent: jest.fn(),
}));

jest.mock('../splose-api', () => ({}));

const express    = require('express');
const bodyParser = require('body-parser');
const request    = require('supertest');

const db         = require('../database');
const outlookApi = require('../outlook-oauth');

const USER_ID = 'user-mirror-001';
const DB_ID   = 'evt-db-0001';
const OL_ID   = 'AAMkMirror123==';

const ACTIVE_USER = {
  id: USER_ID, email: 'mirror@test.invalid', role: 'owner', is_active: true,
  access_token: 'valid-token', refresh_token: 'refresh-token',
  token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
};

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  // Authenticated session shim (requireAuth reads session.userId then db.getUser)
  app.use((req, res, next) => { req.session = { userId: USER_ID }; next(); });
  app.use('/', require('../routes'));
  return app;
}

/** pool.query router: SELECT of the event row returns outlookId (or null). */
function primePoolQuery({ outlookId } = {}) {
  db.pool.query.mockImplementation((sql) => {
    if (/SELECT outlook_id/.test(sql)) {
      return Promise.resolve({ rows: [{ outlook_id: outlookId, title: 'Client Appointment — Test Patient' }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  db.getUser.mockResolvedValue({ ...ACTIVE_USER });
  db.updateEvent.mockResolvedValue({});
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  delete process.env.ENABLE_OUTLOOK_WRITE;
  delete process.env.ENABLE_SPLOSE_CALENDAR_SYNC;
});

afterAll(() => {
  delete process.env.ENABLE_OUTLOOK_WRITE;
  delete process.env.ENABLE_SPLOSE_CALENDAR_SYNC;
});

// ─────────────────────────────────────────────────────────────────────────────
//  1. App → Outlook UPDATE propagation
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/outlook/events/:dbId — app → Outlook update propagation', () => {
  const patchBody = { title: 'Client Appointment — Test Patient', startTime: '2026-08-10T09:00:00+08:00', endTime: '2026-08-10T10:00:00+08:00', location: '12 Example St, Willetton' };

  test('success: local row saved first, Graph PATCH sent, sync marked synced', async () => {
    primePoolQuery({ outlookId: OL_ID });
    outlookApi.updateOutlookEvent.mockResolvedValueOnce({ outlookId: OL_ID, updated: true });

    const res = await request(buildApp()).patch(`/api/outlook/events/${DB_ID}`).send(patchBody);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, outlookId: OL_ID, savedToDb: true, savedToOutlook: true });

    // Local persistence happens BEFORE the Graph call
    const localOrder = db.updateEvent.mock.invocationCallOrder[0];
    const graphOrder = outlookApi.updateOutlookEvent.mock.invocationCallOrder[0];
    expect(localOrder).toBeLessThan(graphOrder);

    // Propagation payload carries exactly the edited fields
    expect(outlookApi.updateOutlookEvent).toHaveBeenCalledWith('valid-token', OL_ID, {
      title: patchBody.title, startTime: patchBody.startTime, endTime: patchBody.endTime, location: patchBody.location,
    });

    // First local write persists the field changes; a follow-up marks synced
    expect(db.updateEvent).toHaveBeenCalledWith(DB_ID, expect.objectContaining({ title: patchBody.title, lastModifiedBy: 'app' }));
    expect(db.updateEvent).toHaveBeenCalledWith(DB_ID, { syncStatus: 'synced' });

    const syncLogCalls = db.pool.query.mock.calls.filter(([sql]) => /INSERT INTO sync_log/.test(sql));
    expect(syncLogCalls).toHaveLength(1);
    expect(syncLogCalls[0][0]).toContain("'success'");
  });

  test('Graph failure degrades gracefully: local change PERSISTS, 200 with savedToOutlook=false, failure logged', async () => {
    primePoolQuery({ outlookId: OL_ID });
    outlookApi.updateOutlookEvent.mockRejectedValueOnce(new Error('Graph 503'));

    const res = await request(buildApp()).patch(`/api/outlook/events/${DB_ID}`).send(patchBody);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, savedToDb: true, savedToOutlook: false });
    expect(res.body.syncError).toContain('Graph 503');

    // The local edit was saved and NOT rolled back
    expect(db.updateEvent).toHaveBeenCalledWith(DB_ID, expect.objectContaining({ title: patchBody.title, lastModifiedBy: 'app' }));
    // The row is flagged for reconciliation
    expect(db.updateEvent).toHaveBeenCalledWith(DB_ID, { syncStatus: 'pending' });

    const syncLogCalls = db.pool.query.mock.calls.filter(([sql]) => /INSERT INTO sync_log/.test(sql));
    expect(syncLogCalls).toHaveLength(1);
    expect(syncLogCalls[0][0]).toContain("'failed'");
    expect(syncLogCalls[0][1]).toEqual([DB_ID, 'Graph 503']);
  });

  test('staged-rollout flag off: 403 feature_disabled and NO local write (mirror never diverges silently)', async () => {
    process.env.ENABLE_OUTLOOK_WRITE = 'false';
    primePoolQuery({ outlookId: OL_ID });

    const res = await request(buildApp()).patch(`/api/outlook/events/${DB_ID}`).send(patchBody);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('feature_disabled');
    expect(db.updateEvent).not.toHaveBeenCalled();
    expect(outlookApi.updateOutlookEvent).not.toHaveBeenCalled();
  });

  test('row without an outlook_id is rejected with 400 (unchanged semantics)', async () => {
    primePoolQuery({ outlookId: null });

    const res = await request(buildApp()).patch(`/api/outlook/events/${DB_ID}`).send(patchBody);

    expect(res.status).toBe(400);
    expect(db.updateEvent).not.toHaveBeenCalled();
    expect(outlookApi.updateOutlookEvent).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. App → Outlook DELETE propagation
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/outlook/events/:dbId — app → Outlook delete propagation', () => {
  test('Graph delete success: Outlook deleted AND local row soft-deleted', async () => {
    primePoolQuery({ outlookId: OL_ID });
    outlookApi.deleteOutlookEvent.mockResolvedValueOnce({ deleted: true });

    const res = await request(buildApp()).delete(`/api/outlook/events/${DB_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deletedFromOutlook: true });
    expect(outlookApi.deleteOutlookEvent).toHaveBeenCalledWith('valid-token', OL_ID);

    const softDelete = db.pool.query.mock.calls.find(([sql]) => /SET is_deleted = TRUE/.test(sql));
    expect(softDelete).toBeDefined();
    expect(softDelete[1]).toEqual([DB_ID, USER_ID]);
  });

  test('Graph delete failure is non-fatal: local soft-delete still happens', async () => {
    primePoolQuery({ outlookId: OL_ID });
    outlookApi.deleteOutlookEvent.mockRejectedValueOnce(new Error('ErrorItemNotFound'));

    const res = await request(buildApp()).delete(`/api/outlook/events/${DB_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deletedFromOutlook: false });

    const softDelete = db.pool.query.mock.calls.find(([sql]) => /SET is_deleted = TRUE/.test(sql));
    expect(softDelete).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. Splose calendar decoupling — flag surface
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/splose/sync-status — Splose calendar coupling flag (fail-closed)', () => {
  test('reports calendarSyncEnabled=false by default (Outlook-only mirror)', async () => {
    const res = await request(buildApp()).get('/api/splose/sync-status');
    expect(res.status).toBe(200);
    expect(res.body.calendarSyncEnabled).toBe(false);
  });

  test('only the exact string "true" re-enables the legacy coupling', async () => {
    process.env.ENABLE_SPLOSE_CALENDAR_SYNC = 'yes';
    let res = await request(buildApp()).get('/api/splose/sync-status');
    expect(res.body.calendarSyncEnabled).toBe(false);

    process.env.ENABLE_SPLOSE_CALENDAR_SYNC = 'true';
    res = await request(buildApp()).get('/api/splose/sync-status');
    expect(res.body.calendarSyncEnabled).toBe(true);
  });
});
