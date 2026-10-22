'use strict';

/**
 * Splose match (080) — the pure "is this booking already in Splose?" rule and
 * the bulk-link plan. No database, no network.
 */

const { findMatches, planBulkLink, computeMatches, MATCH_WINDOW_MINUTES, localDay } = require('../splose-match');

// 9:00 Perth on Mon 14 Sep 2026 = 01:00Z
const ROW = { start: '2026-09-14T01:00:00.000Z', end: '2026-09-14T02:00:00.000Z', patientId: 41, practitionerId: '88167' };
const appt = (id, start, extra = {}) => ({
  id, start, end: new Date(new Date(start).getTime() + 3600000).toISOString(),
  practitionerId: '88167', serviceId: 125320, locationId: 9456,
  patients: [{ patientId: 41, status: 'Booked' }], ...extra,
});
const names = {
  patients: new Map([['41', 'Jane D']]),
  services: new Map([['125320', 'Therapy Session']]),
  locations: new Map([['9456', 'Opal Therapy']]),
};

describe('findMatches', () => {
  test('the window is ±30 minutes by default', () => {
    expect(MATCH_WINDOW_MINUTES).toBe(30);
  });

  test('same client, same start → exact, with names', () => {
    const m = findMatches({ row: ROW, appointments: [appt(7001, '2026-09-14T01:00:00.000Z')], names });
    expect(m).toEqual([expect.objectContaining({
      sploseAppointmentId: '7001', confidence: 'exact', patientName: 'Jane D', serviceName: 'Therapy Session', locationName: 'Opal Therapy', minutesApart: 0,
    })]);
  });

  test('same client within the window → likely; outside it → nothing', () => {
    const m = findMatches({ row: ROW, appointments: [
      appt(1, '2026-09-14T01:30:00.000Z'),   // +30 → likely (edge inclusive)
      appt(2, '2026-09-14T00:45:00.000Z'),   // −15 → likely
      appt(3, '2026-09-14T01:31:00.000Z'),   // +31 → out
    ] });
    expect(m.map(x => [x.sploseAppointmentId, x.confidence])).toEqual([['2', 'likely'], ['1', 'likely']]);
  });

  test('exact sorts before likely', () => {
    const m = findMatches({ row: ROW, appointments: [appt(1, '2026-09-14T01:10:00.000Z'), appt(2, '2026-09-14T01:00:00.000Z')] });
    expect(m.map(x => x.sploseAppointmentId)).toEqual(['2', '1']);
  });

  test('a different client is never offered, even at the same time', () => {
    const m = findMatches({ row: ROW, appointments: [appt(1, ROW.start, { patients: [{ patientId: 99, status: 'Booked' }] })] });
    expect(m).toEqual([]);
  });

  test('a group appointment holding the client matches', () => {
    const m = findMatches({ row: ROW, appointments: [appt(1, ROW.start, { patients: [{ patientId: 99 }, { patientId: 41 }] })] });
    expect(m).toHaveLength(1);
  });

  test('cancelled appointments are excluded', () => {
    const m = findMatches({ row: ROW, appointments: [appt(1, ROW.start, { patients: [{ patientId: 41, status: 'Cancelled' }] })] });
    expect(m).toEqual([]);
  });

  test('appointments already linked to a portal event are excluded', () => {
    const m = findMatches({ row: ROW, appointments: [appt(1, ROW.start), appt(2, ROW.start)], linkedIds: new Set(['1']) });
    expect(m.map(x => x.sploseAppointmentId)).toEqual(['2']);
  });

  test('another practitioner is excluded when both sides name one', () => {
    expect(findMatches({ row: ROW, appointments: [appt(1, ROW.start, { practitionerId: '5' })] })).toEqual([]);
    expect(findMatches({ row: { ...ROW, practitionerId: null }, appointments: [appt(1, ROW.start, { practitionerId: '5' })] })).toHaveLength(1);
  });

  test('same practice-local day is required (Perth midnight)', () => {
    // 23:50 Perth on the 14th vs 00:10 Perth on the 15th: 20 minutes apart, different days.
    const row = { ...ROW, start: '2026-09-14T15:50:00.000Z' };
    expect(localDay(row.start)).toBe('2026-09-14');
    expect(findMatches({ row, appointments: [appt(1, '2026-09-14T16:10:00.000Z')] })).toEqual([]);
  });

  test('a row with no client or start matches nothing', () => {
    expect(findMatches({ row: { ...ROW, patientId: null }, appointments: [appt(1, ROW.start)] })).toEqual([]);
    expect(findMatches({ row: { ...ROW, start: null }, appointments: [appt(1, ROW.start)] })).toEqual([]);
  });
});

describe('planBulkLink', () => {
  const m = (id, confidence) => ({ sploseAppointmentId: id, confidence });
  test('links only rows with exactly one exact match', () => {
    const plan = planBulkLink({
      q1: [m('1', 'exact')],
      q2: [m('2', 'likely')],
      q3: [m('3', 'exact'), m('4', 'likely')],
      q4: [],
    });
    expect(plan).toEqual([{ queueId: 'q1', sploseAppointmentId: '1' }]);
  });
  test('two rows claiming the same appointment are both left for review', () => {
    expect(planBulkLink({ q1: [m('1', 'exact')], q2: [m('1', 'exact')], q3: [m('9', 'exact')] }))
      .toEqual([{ queueId: 'q3', sploseAppointmentId: '9' }]);
  });
});

describe('computeMatches', () => {
  test('one Splose read for the span, held ids excluded, only live creates considered', async () => {
    const calls = [];
    const sploseApi = {
      getAppointments: async (from, to, prac, opts) => { calls.push([from, to, prac, opts]); return [appt(7001, ROW.start), appt(7002, ROW.start)]; },
      getPatients: async () => [{ id: 41, fullName: 'Jane D' }],
      getServices: async () => [{ id: 125320, title: 'Therapy Session' }],
      getLocations: async () => { throw new Error('down'); },   // names are optional
    };
    const db = { pool: { query: async (sql) => {
      if (/FROM events WHERE splose_id = ANY/.test(sql)) return { rows: [{ splose_id: '7002' }] };
      if (/therapist_profiles/.test(sql)) return { rows: [{ splose_practitioner_id: '88167' }] };
      return { rows: [] };
    } } };
    const rows = [
      { id: 'q1', action: 'create', status: 'pending', payload: { start: ROW.start, patientId: 41 } },
      { id: 'q2', action: 'update', status: 'pending', payload: { start: ROW.start }, splose_id: '7002' },
      { id: 'q3', action: 'create', status: 'publishing', payload: { start: ROW.start, patientId: 41 } },
    ];
    const r = await computeMatches({ db, sploseApi, userId: 'u1', rows });
    expect(calls).toEqual([['2026-09-13', '2026-09-15', null, {}]]);
    expect(Object.keys(r.matches)).toEqual(['q1']);
    expect(r.matches.q1).toEqual([expect.objectContaining({ sploseAppointmentId: '7001', confidence: 'exact', patientName: 'Jane D', locationName: null })]);
  });

  test('no creates → no Splose call', async () => {
    const sploseApi = { getAppointments: jest.fn() };
    const r = await computeMatches({ db: { pool: { query: async () => ({ rows: [] }) } }, sploseApi, userId: 'u1', rows: [] });
    expect(r.matches).toEqual({});
    expect(sploseApi.getAppointments).not.toHaveBeenCalled();
  });
});
