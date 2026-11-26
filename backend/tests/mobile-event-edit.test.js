'use strict';

/**
 * mobile-event-edit.js — the pure rules behind editing client / type /
 * address from the phone. The booking composed here must match what the
 * portal's Smart Booking posts (mockup_v3.html confirmBooking), and must pass
 * the server's own client rules (booking-rules.js).
 */

const edit = require('../mobile-event-edit');
const bookingRules = require('../booking-rules');

const FUTURE = new Date('2030-01-01T00:00:00Z');
const NOW = new Date('2029-12-01T00:00:00Z');
const ev = (over = {}) => ({
  id: 'e1', user_id: 'u1', event_type: 'therapy', status: 'confirmed', is_deleted: false,
  start_time: FUTURE.toISOString(), end_time: new Date(FUTURE.getTime() + 3600e3).toISOString(),
  custom_metadata: {}, ...over,
});

describe('composeBooking — the portal’s booking, server-side', () => {
  const t = { startTime: '2030-01-01T01:00:00.000Z', endTime: '2030-01-01T02:00:00.000Z' };
  const client = { id: '777', name: 'Jo Bloggs' };

  test('a client session is a Client Appointment with its Splose draft', () => {
    const b = edit.composeBooking({ kind: 'telehealth', client, address: null, ...t });
    expect(b).toMatchObject({
      title: 'Client Appointment — Jo Bloggs', categories: ['Client Appointments'],
      booking: { kind: 'telehealth', clientId: '777', clientName: 'Jo Bloggs' },
      splose: { patientId: '777', serviceId: 487597, sessionType: 'therapy' },
    });
    expect(b.location).toBeUndefined();
    expect(bookingRules.validateBooking(b).ok).toBe(true);
  });

  test('a report names its client; non-face-to-face lists clients; non-billable drops the client', () => {
    const fca = edit.composeBooking({ kind: 'fca', client, address: '1 A St, Perth', ...t });
    expect(fca).toMatchObject({ title: 'Functional Capacity Assessment (FCA) — Jo Bloggs', categories: ['Report Writing'], location: '1 A St, Perth' });
    expect(fca.splose).toBeUndefined();
    const nf = edit.composeBooking({ kind: 'case-noting', client: null, address: null, ...t });
    expect(nf).toMatchObject({ title: 'Case Noting', categories: ['Admin'], booking: { kind: 'case-noting', clients: [] } });
    const lunch = edit.composeBooking({ kind: 'lunch', client, address: null, ...t });
    expect(lunch).toMatchObject({ title: 'Lunch', categories: ['Lunch'], booking: { kind: 'lunch', clientId: null } });
    for (const b of [fca, nf, lunch]) expect(bookingRules.validateBooking(b).ok).toBe(true);
  });

  test('every kind the phone offers is one the server knows, in the right group', () => {
    for (const k of edit.kindList()) {
      expect(bookingRules.bookingGroup ? bookingRules.bookingGroup(k.kind) : k.group).toBe(k.group);
    }
  });
});

describe('what the event is now', () => {
  test('type and client come from the booking, else the Splose link', () => {
    const booked = ev({ custom_metadata: { booking: { kind: 'assessment', clientId: 5, clientName: 'A B' } } });
    expect(edit.currentKind(booked)).toBe('assessment');
    expect(edit.currentClient(booked)).toEqual({ id: '5', name: 'A B' });
    const imported = ev({ client_id: '9', client_name: 'C D' });
    expect(edit.currentKind(imported)).toBeNull();
    expect(edit.currentClient(imported)).toEqual({ id: '9', name: 'C D' });
    const nf = ev({ custom_metadata: { booking: { kind: 'emails', clients: [{ clientId: '3', clientName: 'E F' }] } } });
    expect(edit.currentClient(nf)).toEqual({ id: '3', name: 'E F' });
    expect(edit.currentClient(ev())).toBeNull();
  });

  test('only the caller’s own, live, timed, future, non-travel rows are editable', () => {
    expect(edit.canEditEvent(ev(), 'u1', NOW)).toEqual({ ok: true });
    expect(edit.canEditEvent(ev(), 'u2', NOW).reason).toBe('not_owner');
    expect(edit.canEditEvent(ev({ event_type: 'travel' }), 'u1', NOW).reason).toBe('type');
    expect(edit.canEditEvent(ev({ status: 'cancelled' }), 'u1', NOW).reason).toBe('cancelled');
    expect(edit.canEditEvent(ev(), 'u1', new Date('2031-01-01')).reason).toBe('started');
  });
});

describe('cleanAddressInput', () => {
  test('absent, cleared, plain and pinned', () => {
    expect(edit.cleanAddressInput(undefined)).toBeUndefined();
    expect(edit.cleanAddressInput(null)).toEqual({ clear: true });
    expect(edit.cleanAddressInput({ address: '   ' })).toEqual({ clear: true });
    expect(edit.cleanAddressInput('1 A St, Perth')).toEqual({ address: '1 A St, Perth', lat: null, lng: null });
    expect(edit.cleanAddressInput({ address: '1 A St', lat: -31.9, lng: 115.8 })).toEqual({ address: '1 A St', lat: -31.9, lng: 115.8 });
    expect(edit.cleanAddressInput({ address: '1 A St', lat: 999, lng: 1 })).toMatchObject({ lat: null, lng: null });
    expect(edit.cleanAddressInput(42)).toEqual({ error: 'Invalid address' });
  });
});
