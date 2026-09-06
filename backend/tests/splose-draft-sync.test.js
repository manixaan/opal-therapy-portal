'use strict';

/**
 * Splose draft-and-publish sync (migration 058) — the decision rules and the
 * publisher's behaviour under the rate limit, without a database or network.
 */

const {
  coalesceChange, planPublish, summariseError, detectExternalChanges, createPublisher,
} = require('../splose-draft-sync');

describe('coalesceChange — one live change per event', () => {
  test('first change is kept as-is', () => {
    expect(coalesceChange(null, { action: 'create', payload: { a: 1 } })).toEqual({ action: 'create', payload: { a: 1 } });
    expect(coalesceChange(null, { action: 'cancel', payload: {} })).toEqual({ action: 'cancel', payload: {} });
  });
  test('create then move stays a create with the new times', () => {
    const r = coalesceChange({ action: 'create', payload: { start: 'A', patientId: 5 } }, { action: 'update', payload: { start: 'B' } });
    expect(r).toEqual({ action: 'create', payload: { start: 'B', patientId: 5 } });
  });
  test('create then cancel discards — Splose never saw it', () => {
    expect(coalesceChange({ action: 'create', payload: {} }, { action: 'cancel', payload: {} })).toBe('discard');
  });
  test('update then cancel becomes a cancel; cancel is sticky', () => {
    expect(coalesceChange({ action: 'update', payload: {} }, { action: 'cancel', payload: { reasonId: 1 } }).action).toBe('cancel');
    expect(coalesceChange({ action: 'cancel', payload: { reasonId: 1 } }, { action: 'update', payload: { start: 'X' } }).action).toBe('cancel');
  });
});

describe('planPublish — cancels free slots before moves and creates fill them', () => {
  test('orders cancel → update → create, each by start', () => {
    const rows = [
      { id: 'c2', action: 'create', payload: { start: '2026-09-08T02:00:00Z' } },
      { id: 'u1', action: 'update', payload: { start: '2026-09-08T01:00:00Z' } },
      { id: 'x1', action: 'cancel', payload: { start: '2026-09-08T05:00:00Z' } },
      { id: 'c1', action: 'create', payload: { start: '2026-09-08T00:00:00Z' } },
    ];
    expect(planPublish(rows).map(r => r.id)).toEqual(['x1', 'u1', 'c1', 'c2']);
  });
});

describe('summariseError — nothing internal leaks into the stored error', () => {
  test('maps the common failures to plain words', () => {
    expect(summariseError({ code: 'FEATURE_DISABLED' })).toMatch(/switched off/);
    expect(summariseError({ response: { status: 429 } })).toMatch(/slow down/);
    expect(summariseError({ response: { status: 401 } })).toMatch(/API key/);
    expect(summariseError({ response: { status: 404 } })).toMatch(/no longer/);
    expect(summariseError({ response: { status: 422, data: { message: 'start must be before end' } } })).toMatch(/start must be before end/);
  });
  test('never returns a stack or a raw provider body', () => {
    const e = new Error('boom'); e.stack = 'secret stack';
    expect(summariseError(e)).toBe('boom');
  });
});

describe('detectExternalChanges — what changed inside Splose', () => {
  const now = new Date('2026-09-08T00:00:00Z');
  const local = (id, splose, start, end) => ({ id, user_id: 'u1', splose_id: splose, start_time: start, end_time: end, title: 'T' + id });
  const appt = (id, start, end, extra = {}) => ({ id, start, end, practitionerId: 7, patients: [{ patientId: 1, status: 'Booked' }], createdAt: '2026-09-07T23:00:00Z', ...extra });

  test('no differences → no alerts', () => {
    const r = detectExternalChanges({
      localEvents: [local('e1', '10', '2026-09-08T01:00:00.000Z', '2026-09-08T02:00:00.000Z')],
      sploseAppointments: [appt(10, '2026-09-08T01:00:00.000Z', '2026-09-08T02:00:00.000Z', { createdAt: '2026-08-01T00:00:00Z' })],
      pendingEventIds: new Set(), now,
    });
    expect(r).toEqual([]);
  });
  test('cancelled, moved, deleted and recently created are each reported once with a stable fingerprint', () => {
    const r = detectExternalChanges({
      localEvents: [
        local('e1', '10', '2026-09-08T01:00:00.000Z', '2026-09-08T02:00:00.000Z'),
        local('e2', '11', '2026-09-08T03:00:00.000Z', '2026-09-08T04:00:00.000Z'),
        local('e3', '12', '2026-09-08T05:00:00.000Z', '2026-09-08T06:00:00.000Z'),
      ],
      sploseAppointments: [
        appt(10, '2026-09-08T01:00:00.000Z', '2026-09-08T02:00:00.000Z', { patients: [{ patientId: 1, status: 'Cancelled', cancellationReason: 'Sick' }] }),
        appt(11, '2026-09-08T03:30:00.000Z', '2026-09-08T04:30:00.000Z'),
        appt(99, '2026-09-09T01:00:00.000Z', '2026-09-09T02:00:00.000Z'),
      ],
      pendingEventIds: new Set(), now,
    });
    const kinds = Object.fromEntries(r.map(a => [a.sploseAppointmentId, a.kind]));
    expect(kinds).toEqual({ '10': 'cancelled', '11': 'moved', '12': 'deleted', '99': 'created' });
    expect(r.find(a => a.kind === 'moved').details.to.start).toBe('2026-09-08T03:30:00.000Z');
    expect(r.find(a => a.kind === 'cancelled').details.reason).toBe('Sick');
    expect(r.find(a => a.kind === 'created').practitionerId).toBe(7);
  });
  test('a portal move that is still pending is not a Splose-side move', () => {
    const r = detectExternalChanges({
      localEvents: [local('e2', '11', '2026-09-08T03:30:00.000Z', '2026-09-08T04:30:00.000Z')],
      sploseAppointments: [appt(11, '2026-09-08T03:00:00.000Z', '2026-09-08T04:00:00.000Z', { createdAt: '2026-08-01T00:00:00Z' })],
      pendingEventIds: new Set(['e2']), now,
    });
    expect(r).toEqual([]);
  });
  test('historical Splose bookings are not "created" alerts', () => {
    const r = detectExternalChanges({
      localEvents: [], sploseAppointments: [appt(50, '2026-09-08T01:00:00.000Z', '2026-09-08T02:00:00.000Z', { createdAt: '2026-01-01T00:00:00Z' })],
      pendingEventIds: new Set(), now,
    });
    expect(r).toEqual([]);
  });
});

describe('createPublisher — paced, ordered, one failure never stops the run', () => {
  function fakeDb(queueRows) {
    const updates = [];
    return {
      updates,
      pool: {
        query: async (sql, params) => {
          if (/FROM splose_sync_queue q JOIN events e/.test(sql)) return { rows: queueRows };
          if (/UPDATE splose_sync_queue/.test(sql)) { updates.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rowCount: 1 }; }
          if (/therapist_profiles/.test(sql)) return { rows: [{ splose_practitioner_id: '88167' }] };
          if (/UPDATE events/.test(sql)) { updates.push({ sql: 'UPDATE events', params }); return { rowCount: 1 }; }
          return { rows: [] };
        },
      },
    };
  }
  const row = (id, action, payload, extra = {}) => ({
    id, action, payload, user_id: 'u1', event_id: 'ev-' + id,
    start_time: '2026-09-08T01:00:00.000Z', end_time: '2026-09-08T02:00:00.000Z', splose_id: null, title: 'T', ...extra,
  });

  test('publishes in plan order, waits gapMs between calls, records success per row', async () => {
    const calls = [];
    const sleeps = [];
    const sploseApi = {
      createAppointment: async (d) => { calls.push(['create', d.patientId]); return { id: 500 + d.patientId }; },
      updateAppointment: async (id) => { calls.push(['update', id]); return {}; },
      cancelAppointment: async (id, reasonId) => { calls.push(['cancel', id, reasonId]); return 1; },
      getCancellationReasons: async () => [{ id: 1, reason: 'Sick' }, { id: 66, reason: 'Other' }],
      getLocations: async () => [{ id: 9456, archived: false }],
      fetchAllCases: async () => [{ id: 300, patientId: 1, status: 'Active' }, { id: 301, patientId: 2, status: 'Active' }],
    };
    const db = fakeDb([
      row('c1', 'create', { patientId: 1, serviceId: 125320, start: '2026-09-08T01:00:00.000Z', end: '2026-09-08T02:00:00.000Z' }),
      row('x1', 'cancel', {}, { splose_id: '77' }),
      row('u1', 'update', { start: '2026-09-08T03:00:00.000Z', end: '2026-09-08T04:00:00.000Z' }, { splose_id: '78' }),
    ]);
    const pub = createPublisher({ db, sploseApi, gapMs: 1500, sleep: async (ms) => sleeps.push(ms) });
    const result = await pub.publish('u1', { batchId: 'b1' });

    expect(calls).toEqual([['cancel', '77', 66], ['update', '78'], ['create', 1]]);
    expect(sleeps).toEqual([1500, 1500]);                // between calls, not after the last
    expect(result.total).toBe(3); expect(result.failed).toBe(0);
    const done = db.updates.filter(u => /status = 'done'/.test(u.sql));
    expect(done).toHaveLength(3);
    // the create stamps the new Splose id onto the event
    const evUpdate = db.updates.find(u => u.sql === 'UPDATE events' && u.params[1] === '501');
    expect(evUpdate).toBeTruthy();
    expect(pub.status('u1')).toBeNull();
    expect(pub.lastResult('u1').results.map(r => r.ok)).toEqual([true, true, true]);
  });

  test('a 429 is retried with back-off; a hard failure marks that row and the run continues', async () => {
    let createCalls = 0;
    const sleeps = [];
    const sploseApi = {
      createAppointment: async () => {
        createCalls++;
        if (createCalls === 1) { const e = new Error('rate'); e.response = { status: 429 }; throw e; }
        return { id: 900 };
      },
      cancelAppointment: async () => { const e = new Error('bad'); e.response = { status: 404 }; throw e; },
      getCancellationReasons: async () => [{ id: 66, reason: 'Other' }],
      getLocations: async () => [{ id: 9456, archived: false }],
      fetchAllCases: async () => [{ id: 300, patientId: 1, status: 'Active' }],
    };
    const db = fakeDb([
      row('x1', 'cancel', {}, { splose_id: '77' }),
      row('c1', 'create', { patientId: 1, serviceId: 125320 }),
    ]);
    const pub = createPublisher({ db, sploseApi, gapMs: 0, sleep: async (ms) => sleeps.push(ms) });
    const result = await pub.publish('u1');
    expect(result.failed).toBe(1);
    expect(result.results).toEqual([
      { id: 'x1', ok: false, action: 'cancel', error: 'Splose no longer has this appointment' },
      { id: 'c1', ok: true, action: 'create', sploseId: '900' },
    ]);
    expect(sleeps).toContain(5000);                       // the 429 back-off
    const failed = db.updates.find(u => /status = 'failed'/.test(u.sql));
    expect(failed.params[1]).toBe('Splose no longer has this appointment');
  });

  test('a create with no service or no case fails that row with a plain reason', async () => {
    const sploseApi = {
      createAppointment: async () => { throw new Error('should not be called'); },
      getCancellationReasons: async () => [], getLocations: async () => [{ id: 1 }],
      fetchAllCases: async () => [],
    };
    const db = fakeDb([
      row('c1', 'create', { patientId: 1 }),
      row('c2', 'create', { patientId: 2, serviceId: 5 }),
    ]);
    const pub = createPublisher({ db, sploseApi, gapMs: 0, sleep: async () => {} });
    const r = await pub.publish('u1');
    expect(r.results.map(x => x.error)).toEqual([
      'Choose a Splose service for this appointment',
      'This client has no active case in Splose',
    ]);
  });

  test('a second publish for the same user while one runs is refused', async () => {
    let release;
    const gate = new Promise(res => { release = res; });
    const sploseApi = {
      cancelAppointment: async () => { await gate; return 1; },
      getCancellationReasons: async () => [{ id: 66, reason: 'Other' }],
    };
    const db = fakeDb([row('x1', 'cancel', {}, { splose_id: '77' })]);
    const pub = createPublisher({ db, sploseApi, gapMs: 0, sleep: async () => {} });
    const first = pub.publish('u1');
    await new Promise(r => setImmediate(r));
    expect(pub.status('u1')).toMatchObject({ total: 1, done: 0 });
    const second = await pub.publish('u1');
    expect(second.alreadyRunning).toBe(true);
    release();
    await first;
    expect(pub.status('u1')).toBeNull();
  });
});
