'use strict';

/**
 * Mobile API tests — /api/mobile/* (Opa Mobile Companion backend, Phase 2).
 *
 * All external services are mocked; no real database, Splose, Outlook, or AI
 * connections are made. Tests run fully in-process using supertest.
 *
 * Focus: auth boundaries, strict caller scoping (own diary / own rows only),
 * Perth day-window maths, voice-note lifecycle + cross-user link denial,
 * audit events, and no raw sync payloads in responses.
 */

// ── Mock all external dependencies before any require ───────────────────────

jest.mock('../database', () => ({
  pool:                     { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  getUserByEmail:           jest.fn(),
  getUser:                  jest.fn(),
  logAuditEvent:            jest.fn().mockResolvedValue(null),
  recordLogin:              jest.fn().mockResolvedValue(null),
  getEventsForTherapists:   jest.fn().mockResolvedValue([]),
  initializeDatabase:       jest.fn().mockResolvedValue(null),
}));

jest.mock('../email', () => ({
  sendVerificationEmail:  jest.fn().mockResolvedValue(null),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(null),
}));

jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api',    () => ({
  getPatient:    jest.fn(),
  getPatients:   jest.fn(),
  fetchAllCases: jest.fn(),
}));

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const sploseApi = require('../splose-api');

function buildMobileApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(bodyParser.json());
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true },
  }));
  app.use('/', require('../auth'));
  app.use('/', require('../mobile-routes'));
  return app;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_PASS = 'ValidPass1';
let TEST_HASH;

const TP_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const TP_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

const USER_A = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  email: 'therapist.a@opaltherapy.com.au',
  role: 'therapist', is_active: true, account_status: 'active', email_verified: true,
  organisation_id: 'cccccccc-2222-4222-8222-222222222222',
  therapist_profile_id: TP_A, permissions: null, name: 'Therapist A',
};
const USER_B = {
  id: 'bbbbbbbb-1111-4111-8111-111111111111',
  email: 'therapist.b@opaltherapy.com.au',
  role: 'therapist', is_active: true, account_status: 'active', email_verified: true,
  organisation_id: USER_A.organisation_id,
  therapist_profile_id: TP_B, permissions: null, name: 'Therapist B',
};
const USERS = { [USER_A.id]: USER_A, [USER_B.id]: USER_B };

const EVENT_A = {
  id: 'dddddddd-3333-4333-8333-333333333333',
  user_id: USER_A.id, therapist_profile_id: TP_A,
  title: 'OT session', description: 'Fine motor goals',
  start_time: '2026-08-10T01:00:00.000Z', end_time: '2026-08-10T02:00:00.000Z',
  location: '12 Smith Street, Willetton', manual_location: null,
  event_type: 'therapy', status: 'confirmed', source: 'splose',
  splose_id: 'sp-123', outlook_id: 'ol-456', custom_metadata: { secret: 'x' },
  client_name: 'Client One', travel_time_minutes: 25, travel_distance: 14.25,
  is_deleted: false,
};
const EVENT_A2 = {
  ...EVENT_A,
  id: 'dddddddd-3333-4333-8333-333333333334',
  title: 'Home visit', location: 'Home visit', // unroutable address
  start_time: '2026-08-10T03:00:00.000Z', end_time: '2026-08-10T04:00:00.000Z',
  travel_time_minutes: null, travel_distance: null,
};
const EVENT_VIRTUAL = {
  ...EVENT_A,
  id: 'dddddddd-3333-4333-8333-333333333335',
  title: 'Telehealth check-in', location: 'Telehealth',
  start_time: '2026-08-10T05:00:00.000Z', end_time: '2026-08-10T05:30:00.000Z',
};
const EVENT_B = {
  ...EVENT_A,
  id: 'eeeeeeee-3333-4333-8333-333333333333',
  user_id: USER_B.id, therapist_profile_id: TP_B, title: 'B session',
};

// In-memory stores emulating the user_id-scoped SQL the routes issue.
let eventStore, voiceStore;

// Globally unique per login — auth.js's in-memory IP rate limiter survives
// across tests, so an IP must never repeat.
let ipCounter = 0;

function makeVoiceRow(id, params) {
  return {
    id,
    user_id: params[0], organisation_id: params[1], title: params[2],
    transcript: params[3], note_type: params[4], source: params[5],
    linked_event_id: params[6], linked_task_id: params[7], linked_reminder_id: params[8],
    captured_at: params[9], status: 'draft',
    reviewed_at: null, archived_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

let voiceIdSeq = 0;
const nextVoiceId = () => `faceface-4444-4444-8444-${String(++voiceIdSeq).padStart(12, '0')}`;

function installPoolMock() {
  db.pool.query.mockImplementation(async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, ' ');
    // Mutations first — their SQL contains the SELECT-by-id substring.
    if (q.includes('INSERT INTO voice_notes')) {
      const row = makeVoiceRow(nextVoiceId(), params);
      voiceStore.set(row.id, row);
      return { rows: [row] };
    }
    if (q.includes('UPDATE voice_notes SET')) {
      const row = voiceStore.get(params[0]);
      if (!row || row.user_id !== params[1]) return { rows: [] };
      const colRe = /(\w+) = \$(\d+)/g;
      let m;
      while ((m = colRe.exec(q)) !== null) {
        const [, col, n] = m;
        if (col === 'id' || col === 'user_id') continue;
        row[col] = params[Number(n) - 1];
      }
      row.updated_at = new Date().toISOString();
      return { rows: [row] };
    }
    if (q.includes('DELETE FROM voice_notes')) {
      const row = voiceStore.get(params[0]);
      if (row && row.user_id === params[1]) voiceStore.delete(params[0]);
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    // Voice notes: load own by id
    if (q.includes('FROM voice_notes WHERE id = $1 AND user_id = $2')) {
      const row = voiceStore.get(params[0]);
      return { rows: row && row.user_id === params[1] ? [row] : [] };
    }
    // Voice notes: linked-to-event list (appointment detail)
    if (q.includes('FROM voice_notes WHERE user_id = $1 AND linked_event_id = $2')) {
      const rows = [...voiceStore.values()]
        .filter((r) => r.user_id === params[0] && r.linked_event_id === params[1]);
      return { rows };
    }
    // Voice notes: list own (today aggregate uses status='draft' literal; list route uses params)
    if (q.includes('FROM voice_notes WHERE user_id = $1')) {
      let rows = [...voiceStore.values()].filter((r) => r.user_id === params[0]);
      if (q.includes('status = $2')) rows = rows.filter((r) => r.status === params[1]);
      if (q.includes("status = 'draft'")) rows = rows.filter((r) => r.status === 'draft');
      return { rows };
    }
    // Events: link-ownership check (SELECT id) and detail (SELECT *)
    if (q.includes('FROM events WHERE id = $1')) {
      const ev = eventStore.get(params[0]);
      const owned = ev && !ev.is_deleted
        && (ev.user_id === params[1] || (params[2] && ev.therapist_profile_id === params[2]));
      return { rows: owned ? [ev] : [] };
    }
    // Snapshot link-ownership checks + today aggregate reads
    if (q.includes('FROM snapshot_tasks') || q.includes('FROM snapshot_reminders')) {
      return { rows: [] };
    }
    return { rows: [], rowCount: 0 };
  });
}

let app;

beforeAll(async () => {
  // bcrypt cost 1 is intentionally low — only for test speed, never for production
  TEST_HASH = await bcrypt.hash(TEST_PASS, 1);
  app = buildMobileApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  eventStore = new Map([[EVENT_A.id, EVENT_A], [EVENT_A2.id, EVENT_A2],
    [EVENT_VIRTUAL.id, EVENT_VIRTUAL], [EVENT_B.id, EVENT_B]]);
  voiceStore = new Map();
  installPoolMock();
  db.logAuditEvent.mockResolvedValue(null);
  db.recordLogin.mockResolvedValue(null);
  db.getEventsForTherapists.mockResolvedValue([]);
  db.getUser.mockImplementation(async (id) => (USERS[id] ? { ...USERS[id] } : null));
});

/** Login and return a cookie-carrying agent (distinct IP per login: rate limit). */
async function loginAs(user) {
  db.getUserByEmail.mockResolvedValueOnce({ ...user, password_hash: TEST_HASH });
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .set('X-Forwarded-For', `10.9.${Math.floor(ipCounter / 200)}.${(ipCounter++ % 200) + 10}`)
    .send({ email: user.email, password: TEST_PASS });
  expect(res.status).toBe(200);
  return agent;
}

// ═══ Auth boundaries ═════════════════════════════════════════════════════════

describe('authentication boundaries', () => {
  test.each([
    ['GET', '/api/mobile/today'],
    ['GET', '/api/mobile/calendar'],
    ['GET', '/api/mobile/travel'],
    ['GET', `/api/mobile/appointments/${EVENT_A.id}`],
    ['GET', '/api/mobile/clients'],
    ['GET', '/api/mobile/voice-notes'],
    ['POST', '/api/mobile/voice-notes'],
    ['PATCH', `/api/mobile/voice-notes/${EVENT_A.id}`],
    ['DELETE', `/api/mobile/voice-notes/${EVENT_A.id}`],
  ])('unauthenticated %s %s returns 401', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path).send({});
    expect(res.status).toBe(401);
  });
});

// ═══ /api/mobile/today ═══════════════════════════════════════════════════════

describe('GET /api/mobile/today', () => {
  test('therapist gets own day only — query is pinned to own profile id', async () => {
    db.getEventsForTherapists.mockResolvedValue([EVENT_A, EVENT_A2]);
    const agent = await loginAs(USER_A);
    const res = await agent.get('/api/mobile/today?date=2026-08-10');

    expect(res.status).toBe(200);
    // Scoping: the events query was pinned to A's own profile, nothing else.
    expect(db.getEventsForTherapists).toHaveBeenCalledTimes(1);
    expect(db.getEventsForTherapists.mock.calls[0][0]).toEqual([TP_A]);
    // No other therapist's events in the payload.
    const ids = res.body.appointments.map((a) => a.id);
    expect(ids).toContain(EVENT_A.id);
    expect(ids).not.toContain(EVENT_B.id);
    expect(res.body.summary.appointmentCount).toBe(2);
  });

  test('client-supplied therapist/practitioner params are ignored', async () => {
    db.getEventsForTherapists.mockResolvedValue([]);
    const agent = await loginAs(USER_A);
    const res = await agent.get(
      `/api/mobile/today?date=2026-08-10&therapistId=${TP_B}&practitionerId=${TP_B}&therapistIds=${TP_B}`);
    expect(res.status).toBe(200);
    expect(db.getEventsForTherapists.mock.calls[0][0]).toEqual([TP_A]);
  });

  test('Perth day boundary: date maps to [16:00Z prev day, 16:00Z] window', async () => {
    const agent = await loginAs(USER_A);
    await agent.get('/api/mobile/today?date=2026-08-10');
    const opts = db.getEventsForTherapists.mock.calls[0][1];
    expect(opts.startDate).toBe('2026-08-09T16:00:00.000Z');
    expect(opts.endDate).toBe('2026-08-10T16:00:00.000Z');
  });

  test('empty day returns useful empty arrays and zeroed summary', async () => {
    const agent = await loginAs(USER_A);
    const res = await agent.get('/api/mobile/today?date=2026-08-10');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: '2026-08-10', timezone: 'Australia/Perth',
      nextAppointment: null, appointments: [], tasks: [], reminders: [], voiceNotes: [],
      travel: { nextTrip: null, trips: [], tripCount: 0, needsReviewCount: 0 },
      summary: { appointmentCount: 0, remainingTaskCount: 0, dueReminderCount: 0 },
    });
  });

  test('snapshot reads are scoped to the caller user id', async () => {
    const agent = await loginAs(USER_A);
    await agent.get('/api/mobile/today?date=2026-08-10');
    const snapshotCalls = db.pool.query.mock.calls
      .filter(([sql]) => /snapshot_reminders|snapshot_tasks|voice_notes/.test(String(sql)));
    expect(snapshotCalls.length).toBeGreaterThanOrEqual(3);
    for (const [, params] of snapshotCalls) expect(params[0]).toBe(USER_A.id);
  });

  test('invalid date and invalid timezone are 400; device timezone never shifts the day', async () => {
    const agent = await loginAs(USER_A);
    expect((await agent.get('/api/mobile/today?date=10-08-2026')).status).toBe(400);
    expect((await agent.get('/api/mobile/today?date=2026-08-10&timezone=Not/AZone')).status).toBe(400);
    const ok = await agent.get('/api/mobile/today?date=2026-08-10&timezone=Europe/London');
    expect(ok.status).toBe(200);
    expect(ok.body.timezone).toBe('Australia/Perth'); // London ignored for boundaries
    expect(db.getEventsForTherapists.mock.calls[0][1].startDate).toBe('2026-08-09T16:00:00.000Z');
  });

  test('account without a therapist profile gets empty diary + warning, not an error', async () => {
    const noProfile = { ...USER_A, therapist_profile_id: null };
    db.getUser.mockImplementation(async () => ({ ...noProfile }));
    const agent = await loginAs(noProfile);
    const res = await agent.get('/api/mobile/today?date=2026-08-10');
    expect(res.status).toBe(200);
    expect(res.body.appointments).toEqual([]);
    expect(res.body.warnings).toEqual(['no_therapist_profile']);
    expect(db.getEventsForTherapists).not.toHaveBeenCalled();
  });
});

// ═══ /api/mobile/calendar + appointment detail ═══════════════════════════════

describe('GET /api/mobile/calendar', () => {
  test('returns compact fields only — no raw Outlook/Splose payloads', async () => {
    db.getEventsForTherapists.mockResolvedValue([EVENT_A]);
    const agent = await loginAs(USER_A);
    const res = await agent.get('/api/mobile/calendar?date=2026-08-10');
    expect(res.status).toBe(200);
    const appt = res.body.days[0].appointments[0];
    expect(appt).toMatchObject({
      id: EVENT_A.id, title: 'OT session', eventType: 'therapy',
      timezone: 'Australia/Perth', hasTravel: true,
      needsAddressReview: false, canOpenInMaps: true, source: 'splose',
    });
    for (const raw of ['outlook_id', 'outlookId', 'splose_id', 'sploseId',
      'custom_metadata', 'customMetadata', 'client_name', 'description']) {
      expect(appt).not.toHaveProperty(raw);
    }
  });

  test('week range groups appointments by Perth day', async () => {
    db.getEventsForTherapists.mockResolvedValue([EVENT_A]);
    const agent = await loginAs(USER_A);
    const res = await agent.get('/api/mobile/calendar?date=2026-08-09&range=week');
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);
    // EVENT_A starts 01:00Z on the 10th = 09:00 Perth on the 10th.
    const day10 = res.body.days.find((d) => d.date === '2026-08-10');
    expect(day10.appointments.map((a) => a.id)).toEqual([EVENT_A.id]);
  });

  test('unroutable in-person address is flagged for review', async () => {
    db.getEventsForTherapists.mockResolvedValue([EVENT_A2]);
    const agent = await loginAs(USER_A);
    const res = await agent.get('/api/mobile/calendar?date=2026-08-10');
    const appt = res.body.days[0].appointments[0];
    expect(appt.needsAddressReview).toBe(true);
    expect(appt.canOpenInMaps).toBe(false);
  });

  test('bad range is 400', async () => {
    const agent = await loginAs(USER_A);
    expect((await agent.get('/api/mobile/calendar?date=2026-08-10&range=month')).status).toBe(400);
  });
});

describe('GET /api/mobile/appointments/:id', () => {
  test('own appointment returns detail with travel + maps fields', async () => {
    const agent = await loginAs(USER_A);
    const res = await agent.get(`/api/mobile/appointments/${EVENT_A.id}`);
    expect(res.status).toBe(200);
    expect(res.body.appointment).toMatchObject({
      id: EVENT_A.id, clientName: 'Client One', description: 'Fine motor goals',
      travel: { minutes: 25, km: 14.3 },
      mapsAddress: '12 Smith Street, Willetton',
    });
    expect(res.body.appointment).not.toHaveProperty('custom_metadata');
    expect(res.body.voiceNoteCount).toBe(0);
  });

  test("another therapist's appointment answers 404, indistinguishable from missing", async () => {
    const agent = await loginAs(USER_A);
    const foreign = await agent.get(`/api/mobile/appointments/${EVENT_B.id}`);
    const missing = await agent.get('/api/mobile/appointments/99999999-9999-4999-8999-999999999999');
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  test('non-UUID id is 404 (no existence probing)', async () => {
    const agent = await loginAs(USER_A);
    expect((await agent.get('/api/mobile/appointments/not-a-uuid')).status).toBe(404);
  });
});

// ═══ /api/mobile/travel ══════════════════════════════════════════════════════

describe('GET /api/mobile/travel', () => {
  test('derives own trips; flags unroutable stops; skips telehealth', async () => {
    db.getEventsForTherapists.mockResolvedValue([EVENT_A, EVENT_A2, EVENT_VIRTUAL]);
    const agent = await loginAs(USER_A);
    const res = await agent.get('/api/mobile/travel?date=2026-08-10');
    expect(res.status).toBe(200);

    // Virtual appointment produces no trip.
    expect(res.body.trips).toHaveLength(2);
    const [t1, t2] = res.body.trips;
    expect(t1).toMatchObject({
      appointmentId: EVENT_A.id, toAddress: '12 Smith Street, Willetton',
      minutes: 25, km: 14.3, status: 'ok', fromAddress: null,
    });
    expect(t2).toMatchObject({
      appointmentId: EVENT_A2.id, status: 'needs_review',
      needsReviewReason: 'address_missing', toAddress: null,
      fromAddress: '12 Smith Street, Willetton',
    });
    expect(res.body.summary).toMatchObject({
      tripCount: 2, totalMinutes: 25, needsReviewCount: 1,
    });
    // Scoped to own profile.
    expect(db.getEventsForTherapists.mock.calls[0][0]).toEqual([TP_A]);
  });

  test('cancelled appointments produce no trips', async () => {
    db.getEventsForTherapists.mockResolvedValue([{ ...EVENT_A, status: 'cancelled' }]);
    const agent = await loginAs(USER_A);
    const res = await agent.get('/api/mobile/travel?date=2026-08-10');
    expect(res.body.trips).toEqual([]);
  });
});

// ═══ Voice notes ═════════════════════════════════════════════════════════════

describe('voice notes', () => {
  const CREATE_BODY = { transcript: 'Client practised buttoning — good progress.', title: 'Session note' };

  test('create draft: 201, status draft, audit written without content', async () => {
    const agent = await loginAs(USER_A);
    const res = await agent.post('/api/mobile/voice-notes').send(CREATE_BODY);
    expect(res.status).toBe(201);
    expect(res.body.voiceNote).toMatchObject({
      status: 'draft', source: 'mobile_voice', noteType: 'general_note',
      transcript: CREATE_BODY.transcript,
    });
    expect(db.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mobile.voice_note_created', actorUserId: USER_A.id,
    }));
    const call = db.logAuditEvent.mock.calls
      .find(([a]) => a.action === 'mobile.voice_note_created');
    expect(JSON.stringify(call[0].metadata)).not.toContain('buttoning'); // ids only, never content
  });

  test('transcript is required and empty is rejected', async () => {
    const agent = await loginAs(USER_A);
    expect((await agent.post('/api/mobile/voice-notes').send({})).status).toBe(400);
    expect((await agent.post('/api/mobile/voice-notes').send({ transcript: '   ' })).status).toBe(400);
  });

  test('transcript max length (8000) is enforced', async () => {
    const agent = await loginAs(USER_A);
    const res = await agent.post('/api/mobile/voice-notes')
      .send({ transcript: 'x'.repeat(8001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8000/);
  });

  test('invalid noteType/status/source values are rejected', async () => {
    const agent = await loginAs(USER_A);
    expect((await agent.post('/api/mobile/voice-notes')
      .send({ transcript: 'ok text here', noteType: 'clinical_final' })).status).toBe(400);
    expect((await agent.post('/api/mobile/voice-notes')
      .send({ transcript: 'ok text here', source: 'server_ai' })).status).toBe(400);
  });

  test('linking to own appointment works; linking to another user’s fails identically to missing', async () => {
    const agent = await loginAs(USER_A);
    const own = await agent.post('/api/mobile/voice-notes')
      .send({ ...CREATE_BODY, linkedEventId: EVENT_A.id, noteType: 'appointment_note' });
    expect(own.status).toBe(201);
    expect(own.body.voiceNote.linkedEventId).toBe(EVENT_A.id);

    const foreign = await agent.post('/api/mobile/voice-notes')
      .send({ ...CREATE_BODY, linkedEventId: EVENT_B.id });
    const missing = await agent.post('/api/mobile/voice-notes')
      .send({ ...CREATE_BODY, linkedEventId: '99999999-9999-4999-8999-999999999999' });
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe('invalid_link');
    expect(missing.status).toBe(400);
    expect(foreign.body).toEqual(missing.body);
  });

  test('user can list own notes; another user’s list stays empty', async () => {
    const agentA = await loginAs(USER_A);
    await agentA.post('/api/mobile/voice-notes').send(CREATE_BODY);

    const listA = await agentA.get('/api/mobile/voice-notes');
    expect(listA.body.voiceNotes).toHaveLength(1);

    const agentB = await loginAs(USER_B);
    const listB = await agentB.get('/api/mobile/voice-notes');
    expect(listB.status).toBe(200);
    expect(listB.body.voiceNotes).toEqual([]);
  });

  test('user cannot read, update, or delete another user’s note (404)', async () => {
    const agentA = await loginAs(USER_A);
    const created = await agentA.post('/api/mobile/voice-notes').send(CREATE_BODY);
    const noteId = created.body.voiceNote.id;

    const agentB = await loginAs(USER_B);
    expect((await agentB.get(`/api/mobile/voice-notes/${noteId}`)).status).toBe(404);
    expect((await agentB.patch(`/api/mobile/voice-notes/${noteId}`)
      .send({ title: 'hijack' })).status).toBe(404);
    expect((await agentB.delete(`/api/mobile/voice-notes/${noteId}`)).status).toBe(404);
    // A still owns the unmodified note.
    const still = await agentA.get(`/api/mobile/voice-notes/${noteId}`);
    expect(still.status).toBe(200);
    expect(still.body.voiceNote.title).toBe('Session note');
  });

  test('owner can update own draft; audit voice_note_updated', async () => {
    const agent = await loginAs(USER_A);
    const created = await agent.post('/api/mobile/voice-notes').send(CREATE_BODY);
    const noteId = created.body.voiceNote.id;
    db.logAuditEvent.mockClear();

    const res = await agent.patch(`/api/mobile/voice-notes/${noteId}`)
      .send({ transcript: 'Edited transcript.', title: 'Edited' });
    expect(res.status).toBe(200);
    expect(res.body.voiceNote).toMatchObject({ transcript: 'Edited transcript.', title: 'Edited' });
    expect(db.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mobile.voice_note_updated',
    }));
  });

  test('review then archive: transitions audited; content frozen after review', async () => {
    const agent = await loginAs(USER_A);
    const created = await agent.post('/api/mobile/voice-notes').send(CREATE_BODY);
    const noteId = created.body.voiceNote.id;

    const reviewed = await agent.patch(`/api/mobile/voice-notes/${noteId}`).send({ status: 'reviewed' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.voiceNote.status).toBe('reviewed');
    expect(reviewed.body.voiceNote.reviewedAt).toBeTruthy();
    expect(db.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mobile.voice_note_reviewed',
    }));

    // Content edits are frozen after review.
    const frozen = await agent.patch(`/api/mobile/voice-notes/${noteId}`).send({ transcript: 'sneaky edit' });
    expect(frozen.status).toBe(409);
    expect(frozen.body.code).toBe('invalid_state');

    const archived = await agent.patch(`/api/mobile/voice-notes/${noteId}`).send({ status: 'archived' });
    expect(archived.status).toBe(200);
    expect(archived.body.voiceNote.status).toBe('archived');
    expect(db.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mobile.voice_note_archived',
    }));

    // Archived is terminal.
    expect((await agent.patch(`/api/mobile/voice-notes/${noteId}`)
      .send({ status: 'reviewed' })).status).toBe(409);
  });

  test('delete: drafts hard-delete with audit; reviewed notes must archive instead', async () => {
    const agent = await loginAs(USER_A);
    const draft = await agent.post('/api/mobile/voice-notes').send(CREATE_BODY);
    const del = await agent.delete(`/api/mobile/voice-notes/${draft.body.voiceNote.id}`);
    expect(del.status).toBe(200);
    expect(db.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mobile.voice_note_deleted',
    }));
    expect((await agent.get(`/api/mobile/voice-notes/${draft.body.voiceNote.id}`)).status).toBe(404);

    const kept = await agent.post('/api/mobile/voice-notes').send(CREATE_BODY);
    await agent.patch(`/api/mobile/voice-notes/${kept.body.voiceNote.id}`).send({ status: 'reviewed' });
    const res = await agent.delete(`/api/mobile/voice-notes/${kept.body.voiceNote.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_state');
  });

  test('appointment detail lists the caller’s linked voice notes', async () => {
    const agent = await loginAs(USER_A);
    await agent.post('/api/mobile/voice-notes')
      .send({ ...CREATE_BODY, linkedEventId: EVENT_A.id, noteType: 'appointment_note' });
    const res = await agent.get(`/api/mobile/appointments/${EVENT_A.id}`);
    expect(res.status).toBe(200);
    expect(res.body.voiceNoteCount).toBe(1);
    expect(res.body.voiceNotes[0].linkedEventId).toBe(EVENT_A.id);
  });
});

// ═══ POST /api/mobile/ai/case-note ═══════════════════════════════════════════
//
// Moved. The iOS Companion's AI call is no longer stateless and no longer
// lives in mobile-routes.js: it is a deprecated alias of
// POST /api/mobile/case-note-drafts/generate, sharing that route's single
// governed implementation (persisted draft, ai_interactions linkage, review
// workflow). Its coverage lives in tests/case-note-routes.test.js, and
// tests/ai-single-gateway-guards.test.js pins that no AI generation can
// return to this file.

// ═══ /api/mobile/clients — the "Link a client" picker ═══════════════════════

describe('GET /api/mobile/clients', () => {
  const PATIENTS = [
    { id: 'pt-1', firstname: 'Liam', lastname: 'Carter', fullName: 'Liam Carter', suburb: 'Willetton',
      ndisNumber: '430000001', mobilePhone: '0400000000', email: 'liam@example.test',
      formattedAddress: '12 Smith Street, Willetton WA 6155' },
    { id: 'pt-2', firstname: 'Ava', lastname: 'Nguyen', fullName: 'Ava Nguyen', suburb: 'Perth',
      ndisNumber: '430000002', mobilePhone: '0400000001', email: 'ava@example.test',
      formattedAddress: '1 Test Terrace, Perth WA 6000' },
  ];
  const CASES = [
    { id: 'c1', patientId: 'pt-1', practitionerId: 'prac-A', isOpen: true },
    { id: 'c2', patientId: 'pt-2', practitionerId: 'prac-B', isOpen: true },
  ];
  const MAPPED_A = { ...USER_A, id: 'aaaaaaaa-1111-4111-8111-11111111ma01', email: 'mapped.a@opaltherapy.com.au', tp_splose_practitioner_id: 'prac-A' };
  const READ_ONLY = { ...USER_A, id: 'aaaaaaaa-1111-4111-8111-11111111ro01', email: 'ro@opaltherapy.com.au', role: 'read_only', tp_splose_practitioner_id: 'prac-A' };
  const OWNER = { ...USER_A, id: 'aaaaaaaa-1111-4111-8111-11111111ow01', email: 'owner@opaltherapy.com.au', role: 'owner' };

  beforeEach(() => {
    Object.assign(USERS, { [MAPPED_A.id]: MAPPED_A, [READ_ONLY.id]: READ_ONLY, [OWNER.id]: OWNER });
    sploseApi.getPatients.mockResolvedValue(PATIENTS);
    sploseApi.fetchAllCases.mockResolvedValue(CASES);
  });

  test('therapist gets ONLY their open-case clients, in a compact identity-minimal shape', async () => {
    const res = await (await loginAs(MAPPED_A)).get('/api/mobile/clients');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('caseload');
    expect(res.body.clients).toEqual([{ id: 'pt-1', fullName: 'Liam Carter', suburb: 'Willetton' }]);
    const raw = JSON.stringify(res.body);
    for (const leak of ['ndisNumber', '430000001', 'mobilePhone', 'email', 'Smith Street', 'pt-2', 'Ava']) {
      expect(raw).not.toContain(leak);
    }
  });

  test('owner gets the practice directory, sorted by name', async () => {
    const res = await (await loginAs(OWNER)).get('/api/mobile/clients');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('practice');
    expect(res.body.clients.map((c) => c.fullName)).toEqual(['Ava Nguyen', 'Liam Carter']);
    expect(sploseApi.fetchAllCases).not.toHaveBeenCalled();
  });

  test('read_only is refused; an unmapped therapist fails closed — Splose is never called', async () => {
    const ro = await (await loginAs(READ_ONLY)).get('/api/mobile/clients');
    expect(ro.status).toBe(403);
    expect(ro.body.code).toBe('splose_read_only_denied');
    const un = await (await loginAs(USER_A)).get('/api/mobile/clients'); // USER_A has no mapping
    expect(un.status).toBe(403);
    expect(un.body.code).toBe('practitioner_mapping_required');
    expect(sploseApi.getPatients).not.toHaveBeenCalled();
  });

  test('Splose unreachable is a 502 with no detail leaked', async () => {
    sploseApi.getPatients.mockRejectedValue(new Error('ECONNREFUSED splose.internal:443'));
    const res = await (await loginAs(MAPPED_A)).get('/api/mobile/clients');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('client_lookup_failed');
    expect(JSON.stringify(res.body)).not.toContain('splose.internal');
  });
});
