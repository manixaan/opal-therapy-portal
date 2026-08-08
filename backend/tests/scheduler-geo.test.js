'use strict';

/**
 * SCHEDULER GEOGRAPHY (Phase 5) — pure helper tests: suburb extraction,
 * key normalisation, and the allowlist map-point serializer.
 */

const geo = require('../geo');

describe('extractSuburb (server)', () => {
  test('full street addresses reduce to the suburb', () => {
    expect(geo.extractSuburb('19 Eucalyptus Blvd, Canning Vale WA 6155')).toBe('Canning Vale');
    expect(geo.extractSuburb('24 Grand Blvd, Joondalup WA 6027, Australia')).toBe('Joondalup');
  });
  test('bare suburb and postcode forms', () => {
    expect(geo.extractSuburb('Willetton')).toBe('Willetton');
    expect(geo.extractSuburb('Willetton 6155')).toBe('Willetton');
    expect(geo.extractSuburb('Willetton WA')).toBe('Willetton');
  });
  test('prefixed forms like "Home - Willetton"', () => {
    expect(geo.extractSuburb('Home - Willetton')).toBe('Willetton');
  });
  test('structured objects are preferred over parsing', () => {
    expect(geo.extractSuburb({ suburb: 'Baldivis', address: '22 Makybe Dr' })).toBe('Baldivis');
    expect(geo.extractSuburb({ address: '14 Adelaide St, Fremantle WA 6160' })).toBe('Fremantle');
  });
  test('virtual locations are never geography', () => {
    expect(geo.extractSuburb('Microsoft Teams Meeting')).toBe('');
    expect(geo.extractSuburb('Telehealth — video call')).toBe('');
    expect(geo.extractSuburb('Zoom')).toBe('');
  });
  test('street-only lines and empties yield nothing', () => {
    expect(geo.extractSuburb('219 Manning Rd')).toBe('');
    expect(geo.extractSuburb('')).toBe('');
    expect(geo.extractSuburb(null)).toBe('');
  });
});

describe('suburbKey', () => {
  test('normalises case/whitespace and carries state', () => {
    expect(geo.suburbKey('  Canning   Vale ', 'wa')).toBe('canning vale|WA');
    expect(geo.suburbKey('Broome')).toBe('broome|WA');
  });
});

describe('buildSchedulerMapPoint — allowlist serializer', () => {
  test('constructs ONLY safe fields, regardless of what the event carries', () => {
    const ev = {
      id: 'e1', title: 'SECRET — Jane Smith NDIS 12345 psych review',
      client_name: 'Jane Smith', description: 'diagnosis notes',
      location: '12 Hidden St, Willetton WA 6155',
    };
    const point = geo.buildSchedulerMapPoint(ev,
      { therapistProfileId: 't1', displayName: 'Sarah', colour: '#0f7c6c' },
      { suburb: 'Willetton', lat: -32.05, lng: 115.88 }, 600, 660);
    expect(point).toEqual({
      eventId: 'e1', therapistProfileId: 't1', therapistName: 'Sarah',
      therapistColour: '#0f7c6c', startMin: 600, endMin: 660,
      suburb: 'Willetton', lat: -32.05, lng: 115.88, precision: 'suburb',
    });
    const raw = JSON.stringify(point);
    for (const banned of ['SECRET', 'Jane', 'NDIS', 'diagnosis', 'Hidden St']) {
      expect(raw).not.toContain(banned);
    }
  });
});
