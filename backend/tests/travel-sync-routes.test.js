'use strict';

/** PUT /api/travel/outlook-sync — the guard and the error mapping. */

let mockUser = null;
jest.mock('../database', () => ({ pool: { query: jest.fn() }, getUser: jest.fn() }));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../travel-outlook-sync', () => ({ syncDay: jest.fn() }));
jest.mock('../permissions', () => {
  const actual = jest.requireActual('../permissions');
  return { ...actual, requireAuth: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Not authenticated' });
    req.user = mockUser; req.session = { userId: mockUser.id }; next();
  } };
});

const request = require('supertest');
const express = require('express');
const sync = require('../travel-outlook-sync');
const app = () => { const a = express(); a.use(express.json()); a.use('/', require('../travel-sync-routes')); return a; };
const as = (role) => { mockUser = { id: 'aaaaaaaa-1111-4111-8111-111111111111', role, organisation_id: null }; };
beforeEach(() => { jest.clearAllMocks(); mockUser = null; });

test('signed-out and read-only accounts cannot sync travel', async () => {
  expect((await request(app()).put('/api/travel/outlook-sync').send({})).status).toBe(401);
  as('read_only');
  expect((await request(app()).put('/api/travel/outlook-sync').send({})).status).toBe(403);
  expect(sync.syncDay).not.toHaveBeenCalled();
});

test('a therapist syncs their own day; the service answer is passed through', async () => {
  as('therapist');
  sync.syncDay.mockResolvedValue({ status: 200, body: { ok: true, created: 1, updated: 0, removed: 0 } });
  const r = await request(app()).put('/api/travel/outlook-sync').send({ date: '2030-03-04', legs: [], seenEventIds: [] });
  expect([r.status, r.body.created]).toEqual([200, 1]);
  expect(sync.syncDay.mock.calls[0][1]).toBe(mockUser.id);           // always the caller, never a body field
});

test('Outlook writes off → 403 feature_disabled; not connected → 409; anything else → a plain 500', async () => {
  as('therapist');
  sync.syncDay.mockRejectedValueOnce(Object.assign(new Error('off'), { code: 'FEATURE_DISABLED' }));
  expect((await request(app()).put('/api/travel/outlook-sync').send({})).body.code).toBe('feature_disabled');
  sync.syncDay.mockRejectedValueOnce(new Error('Outlook not connected'));
  expect((await request(app()).put('/api/travel/outlook-sync').send({})).status).toBe(409);
  sync.syncDay.mockRejectedValueOnce(new Error('relation "x" does not exist'));
  const r = await request(app()).put('/api/travel/outlook-sync').send({});
  expect([r.status, r.body.error]).toEqual([500, 'Could not sync travel to Outlook']);   // no SQL leaked
});
