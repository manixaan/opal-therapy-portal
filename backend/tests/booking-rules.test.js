'use strict';

/**
 * Booking rules (4 Oct 2026): the client rule per booking type is enforced by
 * the server as well as the panel, one click makes one booking, and a dragged
 * travel leg's time is stored without touching its where-from/where-to.
 */

let mockUser = null;
jest.mock('../database', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  logAuditEvent: jest.fn().mockResolvedValue(null),
  getUser: jest.fn(),
  upsertOutlookEvent: jest.fn(),
  createEvent: jest.fn(),
  updateEventOutlookId: jest.fn(),
  updateEventWriteError: jest.fn(),
}));
jest.mock('../outlook-oauth', () => ({ createOutlookEvent: jest.fn() }));
jest.mock('../splose-api', () => ({}));
jest.mock('../permissions', () => {
  const actual = jest.requireActual('../permissions');
  return {
    ...actual,
    requireAuth: (req, res, next) => {
      if (!mockUser) return res.status(401).json({ error: 'Not authenticated' });
      req.user = mockUser; req.session = { userId: mockUser.id }; next();
    },
  };
});

const request = require('supertest');
const express = require('express');
const db = require('../database');
const outlook = require('../outlook-oauth');
const rules = require('../booking-rules');

const ME = 'aaaaaaaa-1111-4111-8111-111111111111';
const as = (role) => { mockUser = { id: ME, role, organisation_id: null }; };
function app() {
  const a = express();
  a.use(express.json());
  a.use('/', require('../routes'));
  return a;
}
const SLOT = { startTime: '2026-10-05T10:00:00+08:00', endTime: '2026-10-05T11:00:00+08:00' };

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  db.getUser.mockResolvedValue({ id: ME, access_token: 'tok', token_expires_at: new Date(Date.now() + 3600e3) });
  let n = 0;
  outlook.createOutlookEvent.mockImplementation(async () => ({ outlookId: 'out-' + (++n) }));
  db.upsertOutlookEvent.mockImplementation(async (u, e) => ({ id: 'row-' + e.outlookId }));
  // Local-first: the portal row is written before any Outlook mirror.
  let m = 0;
  db.createEvent.mockImplementation(async () => ({ id: 'row-' + (++m) }));
});

describe('validateBooking — the client rule per group', () => {
  test('direct services and reports need a client', () => {
    for (const kind of ['therapy', 'therapy-ei', 'telehealth', 'mdt', 'mdu', 'fca', 'support-letter']) {
      const r = rules.validateBooking({ booking: { kind } });
      expect(r.ok).toBe(false);
    }
    expect(rules.validateBooking({ booking: { kind: 'fca', clientId: '501', clientName: 'Bo B' } }))
      .toEqual({ ok: true, booking: { kind: 'fca', group: 'report', clientId: '501', clientName: 'Bo B' } });
    // A direct service's client may ride in the Splose payload.
    expect(rules.validateBooking({ booking: { kind: 'therapy' }, splose: { patientId: 501 } }).booking.clientId).toBe('501');
  });

  test('non-face-to-face: with or without a client', () => {
    for (const kind of ['case-noting', 'resource-prep', 'emails', 'phone-calls']) {
      expect(rules.validateBooking({ booking: { kind } })).toEqual({ ok: true, booking: { kind, group: 'nf2f', clientId: null, clientName: null } });
      expect(rules.validateBooking({ booking: { kind, clientId: 7, clientName: 'Al' } }).booking).toMatchObject({ group: 'nf2f', clientId: '7', clientName: 'Al' });
    }
  });

  test('each kind maps to its own group — resource prep is not case noting', () => {
    expect(rules.bookingGroup('resource-prep')).toBe('nf2f');
    expect(rules.bookingGroup('case-noting')).toBe('nf2f');
    expect(rules.validateBooking({ booking: { kind: 'resource-prep' } }).booking.kind).toBe('resource-prep');
    expect(rules.bookingGroup('pd')).toBe('other');
    expect(rules.validateBooking({ booking: { kind: 'lunch', clientId: '9' } }).booking.clientId).toBeNull();
  });

  test('unknown kinds and bad client ids are refused; legacy callers pass', () => {
    expect(rules.validateBooking({ booking: { kind: 'provider-travel' } }).ok).toBe(false);
    expect(rules.validateBooking({ booking: { kind: 'emails', clientId: 'x; DROP' } }).ok).toBe(false);
    expect(rules.validateBooking({ title: 'Outlook-only' })).toEqual({ ok: true, booking: null });
  });
});

describe('idempotency store', () => {
  test('a repeat waits for and gets the first answer; a failure frees the key', async () => {
    const s = rules.createIdempotencyStore();
    const a = s.claim('u:1');
    expect(a.fresh).toBe(true);
    const b = s.claim('u:1');
    expect(b.fresh).toBe(false);
    a.settle(201, { dbId: 'row-1' });
    expect(await b.wait).toEqual({ status: 201, body: { dbId: 'row-1' } });
    const c = s.claim('u:2'); c.settle(500, { error: 'x' });
    expect(s.claim('u:2').fresh).toBe(true);
  });

  test('entries expire', () => {
    const s = rules.createIdempotencyStore({ ttlMs: 1000 });
    s.claim('k', 0).settle(201, {});
    expect(s.claim('k', 500).fresh).toBe(false);
    expect(s.claim('k', 2000).fresh).toBe(true);
  });
});

describe('POST /api/outlook/events', () => {
  test('a report without a client is refused before anything is written', async () => {
    as('therapist');
    const r = await request(app()).post('/api/outlook/events').send({ title: 'Support Letter', ...SLOT, booking: { kind: 'support-letter' } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/client/i);
    expect(outlook.createOutlookEvent).not.toHaveBeenCalled();
  });

  test('a direct service without a client is refused', async () => {
    as('therapist');
    const r = await request(app()).post('/api/outlook/events').send({ title: 'Therapy', ...SLOT, booking: { kind: 'therapy' } });
    expect(r.status).toBe(400);
    expect(outlook.createOutlookEvent).not.toHaveBeenCalled();
  });

  test('Resource Preparation without a client: one event, its type stored, no Splose link', async () => {
    as('therapist');
    const r = await request(app()).post('/api/outlook/events').send({ title: 'Resource Preparation', ...SLOT, categories: ['Report Writing'], booking: { kind: 'resource-prep' } });
    expect(r.status).toBe(201);
    expect(outlook.createOutlookEvent).toHaveBeenCalledTimes(1);
    const store = db.pool.query.mock.calls.find(([t]) => /jsonb_build_object\('booking'/.test(t));
    expect(JSON.parse(store[1][1])).toEqual({ kind: 'resource-prep', group: 'nf2f', clientId: null, clientName: null });
    expect(db.pool.query.mock.calls.some(([t]) => /SET client_id/.test(t))).toBe(false);
  });

  test('Case Noting linked to a client keeps the client on the booking, not in client_id', async () => {
    as('therapist');
    const r = await request(app()).post('/api/outlook/events').send({ title: 'Case Noting — Bo B', ...SLOT, booking: { kind: 'case-noting', clientId: '501', clientName: 'Bo B' } });
    expect(r.status).toBe(201);
    const store = db.pool.query.mock.calls.find(([t]) => /jsonb_build_object\('booking'/.test(t));
    expect(JSON.parse(store[1][1])).toMatchObject({ kind: 'case-noting', clientId: '501' });
    expect(db.pool.query.mock.calls.some(([t]) => /SET client_id/.test(t))).toBe(false);
  });

  test('an event without an address is created (location optional)', async () => {
    as('therapist');
    const r = await request(app()).post('/api/outlook/events').send({ title: 'Telehealth', ...SLOT, booking: { kind: 'telehealth', clientId: '501' } });
    expect(r.status).toBe(201);
    expect(outlook.createOutlookEvent.mock.calls[0][1].location).toBe('');
  });

  test('a double click (same requestId) makes one booking and answers both', async () => {
    as('therapist');
    const a = app();
    const body = { title: 'Emails', ...SLOT, booking: { kind: 'emails' }, requestId: 'req-aaaaaaaa-0001' };
    const [r1, r2] = await Promise.all([request(a).post('/api/outlook/events').send(body), request(a).post('/api/outlook/events').send(body)]);
    expect(outlook.createOutlookEvent).toHaveBeenCalledTimes(1);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r1.body.dbId).toBe(r2.body.dbId);
    expect([r1.body.duplicate, r2.body.duplicate].filter(Boolean)).toHaveLength(1);
    // A new click is a new booking.
    await request(a).post('/api/outlook/events').send({ ...body, requestId: 'req-aaaaaaaa-0002' });
    expect(outlook.createOutlookEvent).toHaveBeenCalledTimes(2);
  });

  test('a failed attempt can be retried with the same requestId', async () => {
    as('therapist');
    const a = app();
    // Local-first: an Outlook failure still saves the booking; only a failed
    // portal save is a failed attempt.
    db.createEvent.mockRejectedValueOnce(new Error('db down'));
    const body = { title: 'Phone Calls', ...SLOT, booking: { kind: 'phone-calls' }, requestId: 'req-bbbbbbbb-0001' };
    expect((await request(a).post('/api/outlook/events').send(body)).status).toBe(500);
    expect((await request(a).post('/api/outlook/events').send(body)).status).toBe(201);
  });

  test('unauthenticated callers are refused', async () => {
    expect((await request(app()).post('/api/outlook/events').send({ title: 'x', ...SLOT })).status).toBe(401);
  });
});

describe('PATCH /api/events/:dbId/travel — a moved leg', () => {
  test('an offset alone changes only the offset', async () => {
    as('therapist');
    db.pool.query.mockResolvedValue({ rows: [{ id: 'e1', custom_metadata: { travel: { after: { kind: 'base', id: 'home-1' }, afterOffsetMin: 30 } } }] });
    const r = await request(app()).patch('/api/events/e1/travel').send({ afterOffsetMin: 30 });
    expect(r.status).toBe(200);
    const [sql, params] = db.pool.query.mock.calls.find(([t]) => /UPDATE events/.test(t));
    expect(sql).toMatch(/- \$4::text\[\]/);
    expect(JSON.parse(params[2])).toEqual({ afterOffsetMin: 30 });
    expect(params[3]).toEqual(['afterOffsetMin']);          // before/after answers untouched
    expect(params[1]).toBe(ME);                              // the caller's own row
  });

  test('null clears it; nonsense is refused; read-only accounts cannot move travel', async () => {
    as('therapist');
    db.pool.query.mockResolvedValue({ rows: [{ id: 'e1', custom_metadata: {} }] });
    await request(app()).patch('/api/events/e1/travel').send({ beforeOffsetMin: null });
    const [, params] = db.pool.query.mock.calls.find(([t]) => /UPDATE events/.test(t));
    expect(JSON.parse(params[2])).toEqual({});
    expect(params[3]).toEqual(['beforeOffsetMin']);
    for (const v of [1.5, 'soon', 13 * 60]) {
      expect((await request(app()).patch('/api/events/e1/travel').send({ afterOffsetMin: v })).status).toBe(400);
    }
    as('read_only');
    expect((await request(app()).patch('/api/events/e1/travel').send({ afterOffsetMin: 30 })).status).toBe(403);
  });

  test('the gap choice (direct / home / automatic) is stored on its own; nonsense and read-only are refused', async () => {
    as('therapist');
    db.pool.query.mockResolvedValue({ rows: [{ id: 'e1', custom_metadata: {} }] });
    await request(app()).patch('/api/events/e1/travel').send({ next: 'home', afterOffsetMin: null });
    let [, params] = db.pool.query.mock.calls.find(([t]) => /UPDATE events/.test(t));
    expect(JSON.parse(params[2])).toEqual({ next: 'home' });
    expect(params[3]).toEqual(['afterOffsetMin', 'next']);
    db.pool.query.mockClear();
    await request(app()).patch('/api/events/e1/travel').send({ next: null });
    [, params] = db.pool.query.mock.calls.find(([t]) => /UPDATE events/.test(t));
    expect([JSON.parse(params[2]), params[3]]).toEqual([{}, ['next']]);
    expect((await request(app()).patch('/api/events/e1/travel').send({ next: 'teleport' })).status).toBe(400);
    as('read_only');
    expect((await request(app()).patch('/api/events/e1/travel').send({ next: 'home' })).status).toBe(403);
  });

  test('the existing before/after body still replaces both answers', async () => {
    as('therapist');
    db.pool.query.mockResolvedValue({ rows: [{ id: 'e1', custom_metadata: {} }] });
    await request(app()).patch('/api/events/e1/travel').send({ before: null, after: { kind: 'base', id: 'home-1' } });
    const [, params] = db.pool.query.mock.calls.find(([t]) => /UPDATE events/.test(t));
    expect(params[3]).toEqual(['before', 'after']);
    expect(JSON.parse(params[2])).toEqual({ after: { kind: 'base', id: 'home-1' } });
  });
});
