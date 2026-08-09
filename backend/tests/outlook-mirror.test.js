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
//  2b. DELETE cascade — travel blocks go with their event (2026-08-09)
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/outlook/events/:dbId — travel-block cascade + dryRun', () => {
  const EV_START = '2026-08-10T02:00:00Z';
  const EV_END   = '2026-08-10T03:00:00Z';
  const TB_LINKED   = 'tb-linked-0001';
  const TB_ADJACENT = 'tb-adjacent-0002';
  const TB_OL_ID    = 'AAMkTravel456==';

  const CANDIDATES = [
    { id: TB_LINKED, title: '🚗 Travel: Base → Client', event_type: 'travel',
      outlook_id: TB_OL_ID, related_event_id: DB_ID,
      start_time: '2026-08-10T01:30:00Z', end_time: '2026-08-10T01:45:00Z' },
    { id: TB_ADJACENT, title: '🚗 Travel: Client → Next suburb', event_type: 'travel',
      outlook_id: null, related_event_id: null,
      start_time: EV_END, end_time: '2026-08-10T03:15:00Z' }, // starts at event end, other end free
    { id: 'tb-unrelated', title: '🚗 Travel: elsewhere', event_type: 'travel',
      outlook_id: null, related_event_id: null,
      start_time: '2026-08-10T07:00:00Z', end_time: '2026-08-10T07:20:00Z' },
  ];

  function primeCascade({ candidates = CANDIDATES, candidatesFail = false } = {}) {
    db.pool.query.mockImplementation((sql) => {
      if (/SELECT outlook_id/.test(sql)) {
        return Promise.resolve({ rows: [{
          outlook_id: OL_ID, title: 'Client Appointment — Test Patient',
          start_time: EV_START, end_time: EV_END,
        }], rowCount: 1 });
      }
      if (/cascade-candidates/.test(sql)) {
        if (candidatesFail) return Promise.reject(new Error('candidates query down'));
        return Promise.resolve({ rows: candidates, rowCount: candidates.length });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  }

  test('dryRun=1 previews the cascade without deleting anything anywhere', async () => {
    primeCascade();

    const res = await request(buildApp()).delete(`/api/outlook/events/${DB_ID}?dryRun=1`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true, dryRun: true, deleted: 0, travelBlocksDeleted: 2,
    });
    expect(res.body.travelBlockIds.sort()).toEqual([TB_ADJACENT, TB_LINKED].sort());
    expect(res.body.travelBlockIds).not.toContain('tb-unrelated');

    // NOTHING was deleted — no tombstones, no Graph calls
    expect(db.pool.query.mock.calls.find(([sql]) => /SET is_deleted = TRUE/.test(sql))).toBeUndefined();
    expect(outlookApi.deleteOutlookEvent).not.toHaveBeenCalled();
  });

  test('real delete cascades: blocks soft-deleted locally + best-effort Graph delete each', async () => {
    primeCascade();
    outlookApi.deleteOutlookEvent.mockResolvedValue({ deleted: true });

    const res = await request(buildApp()).delete(`/api/outlook/events/${DB_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deleted: 1, travelBlocksDeleted: 2, deletedFromOutlook: true });
    expect(res.body.travelBlockTitles).toContain('🚗 Travel: Base → Client');

    // Graph: main event + the linked block (the adjacent block has no outlook_id)
    const graphIds = outlookApi.deleteOutlookEvent.mock.calls.map(([, id]) => id);
    expect(graphIds).toEqual(expect.arrayContaining([OL_ID, TB_OL_ID]));
    expect(graphIds).toHaveLength(2);

    // Local: main tombstone (user-scoped) + cascade tombstone via id = ANY
    const softDeletes = db.pool.query.mock.calls.filter(([sql]) => /SET is_deleted = TRUE/.test(sql));
    expect(softDeletes).toHaveLength(2);
    expect(softDeletes[0][1]).toEqual([DB_ID, USER_ID]);
    expect(softDeletes[1][0]).toMatch(/id = ANY/);
    expect(softDeletes[1][1][0].sort()).toEqual([TB_ADJACENT, TB_LINKED].sort());
    expect(softDeletes[1][1][1]).toBe(USER_ID);

    // Audited with the cascade size (identifiers only)
    expect(db.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'calendar.event_deleted',
      metadata: expect.objectContaining({ travelBlocksDeleted: 2 }),
    }));
  });

  test('cascade lookup failure is non-fatal: the event itself still deletes', async () => {
    primeCascade({ candidatesFail: true });
    outlookApi.deleteOutlookEvent.mockResolvedValueOnce({ deleted: true });

    const res = await request(buildApp()).delete(`/api/outlook/events/${DB_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deleted: 1, travelBlocksDeleted: 0 });

    const softDeletes = db.pool.query.mock.calls.filter(([sql]) => /SET is_deleted = TRUE/.test(sql));
    expect(softDeletes).toHaveLength(1); // main event only
    expect(softDeletes[0][1]).toEqual([DB_ID, USER_ID]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2c. POST /api/outlook/travel-blocks — appointment linkage (migration 016)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/outlook/travel-blocks — relatedEventId linkage', () => {
  const body = {
    start: '2026-08-10T00:45:00Z', end: '2026-08-10T01:00:00Z',
    fromLabel: 'Base', toLabel: 'Client', travelMin: 15,
  };

  beforeEach(() => {
    outlookApi.createOutlookEvent.mockResolvedValue({ outlookId: 'AAMkNewTravel==' });
    db.createEvent.mockResolvedValue({ id: 'tb-new-0001' });
  });

  test('a valid relatedEventId (own event) is stamped onto the created block', async () => {
    db.pool.query.mockImplementation((sql) => {
      if (/SELECT id FROM events WHERE id = \$1 AND user_id = \$2/.test(sql)) {
        return Promise.resolve({ rows: [{ id: DB_ID }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(buildApp()).post('/api/outlook/travel-blocks')
      .send({ ...body, relatedEventId: DB_ID });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, dbId: 'tb-new-0001', relatedEventId: DB_ID });

    const stamp = db.pool.query.mock.calls.find(([sql]) => /related_event_id = \$2/.test(sql));
    expect(stamp).toBeDefined();
    expect(stamp[1]).toEqual(['tb-new-0001', DB_ID]);
  });

  test("a relatedEventId that isn't the caller's own event is dropped (NULL link)", async () => {
    // Validation SELECT finds nothing → linkage silently dropped
    const res = await request(buildApp()).post('/api/outlook/travel-blocks')
      .send({ ...body, relatedEventId: 'someone-elses-event' });

    expect(res.status).toBe(201);
    expect(res.body.relatedEventId).toBeNull();

    const stamp = db.pool.query.mock.calls.find(([sql]) => /related_event_id = \$2/.test(sql));
    expect(stamp).toBeDefined();
    expect(stamp[1]).toEqual(['tb-new-0001', null]);
  });

  test('omitting relatedEventId keeps the legacy shape (NULL link, no validation query)', async () => {
    const res = await request(buildApp()).post('/api/outlook/travel-blocks').send(body);

    expect(res.status).toBe(201);
    const validation = db.pool.query.mock.calls.find(([sql]) => /SELECT id FROM events WHERE id = \$1 AND user_id = \$2/.test(sql));
    expect(validation).toBeUndefined();
    const stamp = db.pool.query.mock.calls.find(([sql]) => /related_event_id = \$2/.test(sql));
    expect(stamp[1]).toEqual(['tb-new-0001', null]);
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
