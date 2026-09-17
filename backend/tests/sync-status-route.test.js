'use strict';

/**
 * GET /api/sync-status must answer from a COUNT, never by loading the whole
 * event history. It runs on every page load and every freshness poll, and a
 * full-history read here was several MB per call on a real caseload.
 */

jest.mock('../database', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  getUser: jest.fn(),
  getEvents: jest.fn().mockResolvedValue([]),
  countEvents: jest.fn().mockResolvedValue({ total: 0, outlook: 0 }),
  logAuditEvent: jest.fn().mockResolvedValue(null),
}));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api', () => ({}));

const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const db = require('../database');

function buildApp(userId) {
  const app = express();
  app.use(bodyParser.json());
  app.use((req, _res, next) => { req.session = userId ? { userId } : {}; next(); });
  app.use('/', require('../routes'));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

test('no session → 401 and no queries', async () => {
  const res = await request(buildApp(null)).get('/api/sync-status');
  expect(res.status).toBe(401);
  expect(db.countEvents).not.toHaveBeenCalled();
});

test('reports counts without loading the event history', async () => {
  db.getUser.mockResolvedValue({ id: 'u1', role: 'therapist', access_token: 'tok', email: 't@x.invalid' });
  db.countEvents.mockResolvedValue({ total: 4800, outlook: 4700 });
  db.pool.query.mockResolvedValue({ rows: [{ last_synced_at: '2026-09-17T01:00:00Z' }], rowCount: 1 });

  const res = await request(buildApp('u1')).get('/api/sync-status');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    outlookConnected: true,
    totalEvents: 4800,
    outlookSyncedEvents: 4700,
    status: 'synced',
    lastSyncedAt: '2026-09-17T01:00:00Z',
  });
  expect(db.countEvents).toHaveBeenCalledWith('u1');
  expect(db.getEvents).not.toHaveBeenCalled();
});

test('connected with nothing mirrored yet → synced_empty once a sync has run', async () => {
  db.getUser.mockResolvedValue({ id: 'u1', role: 'therapist', access_token: 'tok', email: 't@x.invalid' });
  db.countEvents.mockResolvedValue({ total: 3, outlook: 0 });
  db.pool.query.mockResolvedValue({ rows: [{ last_synced_at: '2026-09-17T01:00:00Z' }], rowCount: 1 });
  const res = await request(buildApp('u1')).get('/api/sync-status');
  expect(res.body.status).toBe('synced_empty');
});
