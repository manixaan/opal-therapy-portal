'use strict';

/**
 * Block review classifier (block-review.js) — pure guessing over synthetic
 * clients. No database, no Splose.
 */

const BR = require('../block-review');

const CLIENTS = [
  { id: '9001', fullName: 'Harper Testwell', formattedAddress: '12 Example Street, Applecross WA 6153' },
  { id: '9002', fullName: 'Jordan Sampleton', formattedAddress: '4 Sample Road, Como WA 6152' },
  { id: '9003', fullName: 'Jordan Fixture', formattedAddress: null },
];

const ev = (over) => ({
  id: 'e1', title: '', location: '', event_type: 'outlook', client_id: null, client_name: null,
  splose_id: null, is_teams_meeting: false, custom_metadata: {},
  start_time: '2026-11-02T01:00:00.000Z', end_time: '2026-11-02T02:00:00.000Z', ...over,
});

describe('kindFromText', () => {
  test.each([
    ['Assessment – Harper Testwell', null, 'assessment'],
    ['FCA write-up Harper', null, 'fca'],
    ['Functional Capacity report', null, 'fca'],
    ['Initial consult', null, 'initial'],
    ['Case notes', null, 'case-noting'],
    ['MDT with school', null, 'mdt'],
    ['OT session', 'Microsoft Teams Meeting', 'telehealth'],
    ['Therapy session (Early Intervention)', null, 'therapy-ei'],
    ['Lunch', null, 'lunch'],
    ['Supervision with Ann', null, 'supervision'],
    ['Progress report – Jordan', null, 'progress-report'],
    ['Dentist', null, null],
  ])('%s → %s', (title, loc, kind) => {
    expect(BR.kindFromText(title, loc)).toBe(kind);
  });
});

describe('clientFromText', () => {
  test('full name in the title is a confident match', () => {
    const m = BR.clientFromText('Assessment - Harper Testwell', '', CLIENTS);
    expect(m.client.id).toBe('9001');
    expect(m.confidence).toBe('high');
  });
  test('initial + surname is only medium', () => {
    const m = BR.clientFromText('Session H. Testwell', '', CLIENTS);
    expect(m.client.id).toBe('9001');
    expect(m.confidence).toBe('medium');
  });
  test('a shared first name is ambiguous and names no client', () => {
    const m = BR.clientFromText('Session with Jordan', '', CLIENTS);
    expect(m.client).toBeNull();
    expect(m.candidates.map(c => c.id).sort()).toEqual(['9002', '9003']);
  });
  test('the address breaks a tie', () => {
    const m = BR.clientFromText('Session with Jordan', '4 Sample Road, Como', CLIENTS);
    expect(m.client.id).toBe('9002');
    expect(m.confidence).toBe('high');
  });
  test('address alone is medium', () => {
    const m = BR.clientFromText('Home visit', '12 Example Street Applecross', CLIENTS);
    expect(m.client.id).toBe('9001');
    expect(m.confidence).toBe('medium');
  });
  test('nothing named, nothing guessed', () => {
    expect(BR.clientFromText('Home visit', '', CLIENTS)).toBeNull();
  });
});

describe('classifyBlock', () => {
  test('Outlook "Assessment – full name" with no place: guessed, client address used', () => {
    const g = BR.classifyBlock(ev({ title: 'Assessment – Harper Testwell' }), { clients: CLIENTS });
    expect(g.status).toBe('guessed');
    expect(g.kind).toBe('assessment');
    expect(g.eventType).toBe('therapy');
    expect(g.client.id).toBe('9001');
    expect(g.location).toBe('12 Example Street, Applecross WA 6153');
    expect(g.fields.location.source).toBe('client_address');
  });

  test('a face-to-face session for a client with no address on file needs a place', () => {
    const g = BR.classifyBlock(ev({ title: 'Therapy Jordan Fixture' }), { clients: CLIENTS });
    expect(g.status).toBe('needs_input');
    expect(g.missing).toEqual(['location']);
  });

  test('telehealth never takes the client address', () => {
    const g = BR.classifyBlock(ev({ title: 'Session Harper Testwell', location: 'Microsoft Teams Meeting' }), { clients: CLIENTS });
    expect(g.kind).toBe('telehealth');
    expect(g.location).toBeNull();
    expect(g.status).toBe('guessed');
  });

  test('an unnamed client session needs the client', () => {
    const g = BR.classifyBlock(ev({ title: 'Assessment' }), { clients: CLIENTS });
    expect(g.status).toBe('needs_input');
    expect(g.missing).toContain('client');
  });

  test('an unrecognisable title needs everything', () => {
    const g = BR.classifyBlock(ev({ title: 'Blocked' }), { clients: CLIENTS });
    expect(g.status).toBe('needs_input');
    expect(g.missing).toEqual(['kind']);
  });

  test('lunch needs no client and no place', () => {
    const g = BR.classifyBlock(ev({ title: 'Lunch' }), { clients: CLIENTS });
    expect(g.status).toBe('guessed');
    expect(g.client).toBeNull();
    expect(g.eventType).toBe('lunch');
  });

  test('a report needs its client but no place', () => {
    const g = BR.classifyBlock(ev({ title: 'FCA Harper Testwell' }), { clients: CLIENTS });
    expect(g.status).toBe('guessed');
    expect(g.group).toBe('report');
    expect(g.location).toBeNull();
  });

  test('a Splose appointment with its service and own place is settled outright', () => {
    const g = BR.classifyBlock(ev({ title: 'Client Appointment (booked in Splose)', splose_id: '77', client_id: '9002',
      event_type: 'therapy', location: '4 Sample Road, Como WA' }), { clients: CLIENTS, serviceId: '131003' });
    expect(g.kind).toBe('assessment');
    expect(g.status).toBe('confirmed');
  });

  test('a Splose appointment whose service is unknown is only a medium guess', () => {
    const g = BR.classifyBlock(ev({ title: 'Client Appointment (booked in Splose)', splose_id: '77', client_id: '9002', event_type: 'therapy' }), { clients: CLIENTS });
    expect(g.kind).toBe('therapy');
    expect(g.status).toBe('needs_input');
    expect(g.unsure).toContain('kind');
  });

  test('a Splose service name maps through the leaf rules, Early Intervention included', () => {
    expect(BR.leafForServiceName('Therapy Session (Early Intervention - Under 9) (Occupational Therapy)')).toBe('therapy-ei');
    expect(BR.leafForServiceName('MDT Meeting')).toBe('mdt');
  });

  test('a client the caller cannot see is never named', () => {
    const g = BR.classifyBlock(ev({ title: 'Assessment – Harper Testwell' }), { clients: [] });
    expect(g.client).toBeNull();
    expect(g.status).toBe('needs_input');
  });
});

describe('bookingFor', () => {
  test('nf2f carries its client in clients[]', () => {
    expect(BR.bookingFor('case-noting', { id: '9001', fullName: 'Harper Testwell' }))
      .toEqual({ kind: 'case-noting', group: 'nf2f', clientId: '9001', clientName: 'Harper Testwell', clients: [{ clientId: '9001', clientName: 'Harper Testwell' }] });
  });
  test('other kinds drop the client', () => {
    expect(BR.bookingFor('lunch', { id: '9001' }).clientId).toBeNull();
  });
});

describe('fingerprintOf', () => {
  test('changes with the title, not with case or punctuation', () => {
    const a = BR.fingerprintOf(ev({ title: 'Assessment – Harper' }));
    expect(BR.fingerprintOf(ev({ title: 'assessment harper' }))).toBe(a);
    expect(BR.fingerprintOf(ev({ title: 'Therapy Harper' }))).not.toBe(a);
  });
});
