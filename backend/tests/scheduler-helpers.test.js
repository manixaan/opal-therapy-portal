'use strict';

/**
 * MASTER SCHEDULER (Phase 1) — unit tests for the pure view logic in
 * frontend/current/scheduler.js (the same file the browser loads; it exports
 * its helpers when required under node).
 */

const S = require('../../frontend/current/scheduler.js');

// Perth = UTC+8. Helper to build an ISO instant from Perth wall-clock.
const perthIso = (ymd, hh, mm = 0) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) - 8 * 3600e3 + (hh * 60 + mm) * 60e3).toISOString();

const ev = (over = {}) => Object.assign({
  therapistProfileId: 't1',
  title: 'Client session — Felicia L',
  start: perthIso('2026-08-10', 9),
  end: perthIso('2026-08-10', 10),
  eventType: 'therapy',
  location: '19 Eucalyptus Blvd, Canning Vale WA 6155',
  isDeleted: false,
  isCancelled: false,
}, over);

describe('Perth time helpers', () => {
  test('perthParts converts a UTC instant to Perth wall-clock', () => {
    const p = S.perthParts(perthIso('2026-08-10', 9, 30));
    expect(p.ymd).toBe('2026-08-10');
    expect(p.hh).toBe(9);
    expect(p.mm).toBe(30);
    expect(p.minutes).toBe(9 * 60 + 30);
  });
  test('mondayOfYmd finds the week start', () => {
    expect(S.mondayOfYmd('2026-08-13')).toBe('2026-08-10'); // Thu → Mon
    expect(S.mondayOfYmd('2026-08-10')).toBe('2026-08-10'); // Mon → itself
    expect(S.mondayOfYmd('2026-08-16')).toBe('2026-08-10'); // Sun → prior Mon
  });
  test('addDaysYmd crosses month boundaries', () => {
    expect(S.addDaysYmd('2026-08-31', 1)).toBe('2026-09-01');
    expect(S.addDaysYmd('2026-08-01', -1)).toBe('2026-07-31');
  });
  test('fmtTime12 renders 12-hour labels', () => {
    expect(S.fmtTime12(0)).toBe('12:00am');
    expect(S.fmtTime12(9 * 60 + 5)).toBe('9:05am');
    expect(S.fmtTime12(13 * 60 + 30)).toBe('1:30pm');
  });
});

describe('privacy-safe labels', () => {
  test('cross-therapist mode never shows the raw title or client name', () => {
    expect(S.safeLabel(ev(), 'cross')).toBe('Client session');
    expect(S.safeLabel(ev({ eventType: 'meeting', title: 'MDT — Jane Smith NDIS review' }), 'cross')).toBe('Meeting');
  });
  test('unknown/outlook types render as Busy in cross mode', () => {
    expect(S.safeLabel(ev({ eventType: 'outlook', title: 'Private — GP appointment' }), 'cross')).toBe('Busy');
    expect(S.safeLabel(ev({ eventType: null, title: 'Anything' }), 'cross')).toBe('Busy');
  });
  test('focus mode shows the real title (server already gates access)', () => {
    expect(S.safeLabel(ev(), 'focus')).toBe('Client session — Felicia L');
  });
  test('placeholder titles never leak — no "(No subject)"/"(No title)"', () => {
    expect(S.safeLabel(ev({ title: '(No subject)' }), 'focus')).toBe('Client session');
    expect(S.safeLabel(ev({ title: '(No title)', eventType: 'outlook' }), 'focus')).toBe('Busy');
    expect(S.safeLabel(ev({ title: '' }), 'focus')).toBe('Client session');
    expect(S.isPlaceholderTitle('Untitled')).toBe(true);
  });
  test('every event-type maps to a calm, specific label (not the Busy fallback)', () => {
    ['therapy','travel','meeting','teams_meeting','admin','report','cpd','lunch','leave']
      .forEach(t => {
        const label = S.safeLabel(ev({ eventType: t }), 'cross');
        expect(label).toBeTruthy();
        expect(label).not.toBe('Busy');
      });
  });
});

describe('suburb extraction (privacy: suburb, not household address)', () => {
  test('full street address reduces to the suburb', () => {
    expect(S.extractSuburb('19 Eucalyptus Blvd, Canning Vale WA 6155')).toBe('Canning Vale');
    expect(S.extractSuburb('24 Grand Blvd, Joondalup WA 6027, Australia')).toBe('Joondalup');
  });
  test('bare suburb passes through', () => {
    expect(S.extractSuburb('Willetton')).toBe('Willetton');
  });
  test('a street-only line with digits yields nothing rather than an address', () => {
    expect(S.extractSuburb('219 Manning Rd')).toBe('');
  });
  test('empty/absent locations are safe', () => {
    expect(S.extractSuburb('')).toBe('');
    expect(S.extractSuburb(null)).toBe('');
  });
  test('virtual/telehealth locations are not treated as geography', () => {
    expect(S.extractSuburb('Microsoft Teams Meeting')).toBe('');
    expect(S.extractSuburb('Zoom')).toBe('');
    expect(S.extractSuburb('Telehealth — video call')).toBe('');
  });
});

describe('lane assignment', () => {
  const item = (s, e) => ({ startMin: s, endMin: e });
  test('non-overlapping events keep a single full-width lane', () => {
    const out = S.assignLanes([item(540, 600), item(600, 660)]); // back-to-back
    expect(out.every(t => t.laneCount === 1)).toBe(true);
  });
  test('two overlapping events split into two lanes', () => {
    const out = S.assignLanes([item(540, 630), item(600, 660)]);
    expect(out[0].laneCount).toBe(2);
    expect(new Set(out.map(t => t.lane)).size).toBe(2);
  });
  test('triple overlap yields three lanes; a later separate event resets', () => {
    const out = S.assignLanes([item(540, 660), item(560, 620), item(580, 640), item(900, 960)]);
    const cluster = out.filter(t => t.startMin < 700);
    expect(cluster[0].laneCount).toBe(3);
    expect(out.find(t => t.startMin === 900).laneCount).toBe(1);
  });
  test('lane reuse: an event after one lane frees slots back into it', () => {
    const out = S.assignLanes([item(540, 600), item(570, 630), item(605, 660)]);
    const third = out.find(t => t.startMin === 605);
    expect(third.lane).toBe(0); // first lane free again at 600
  });
});

describe('day scoping and filtering', () => {
  const events = [
    ev(),                                                            // t1 Mon 9-10
    ev({ start: perthIso('2026-08-10', 10), end: perthIso('2026-08-10', 11) }),
    ev({ therapistProfileId: 't2', eventType: 'meeting' }),
    ev({ isDeleted: true }),
    ev({ isCancelled: true }),
    ev({ start: perthIso('2026-08-11', 9), end: perthIso('2026-08-11', 10) }), // Tuesday
    ev({ eventType: 'travel', start: perthIso('2026-08-10', 8, 30), end: perthIso('2026-08-10', 9) }),
  ];
  test('eventsForTherapistDay scopes by therapist + Perth day, drops deleted/cancelled', () => {
    const out = S.eventsForTherapistDay(events, 't1', '2026-08-10');
    expect(out.length).toBe(3); // 9-10, 10-11, travel — not deleted/cancelled/Tuesday/t2
    expect(out.every(x => x.startMin < x.endMin)).toBe(true);
  });
  test('an event spanning midnight clamps to the visible day', () => {
    const spanning = [ev({ start: perthIso('2026-08-09', 22), end: perthIso('2026-08-10', 2) })];
    const out = S.eventsForTherapistDay(spanning, 't1', '2026-08-10');
    expect(out[0].startMin).toBe(0);
    expect(out[0].endMin).toBe(120);
  });
  test('apptCount excludes travel blocks', () => {
    const out = S.eventsForTherapistDay(events, 't1', '2026-08-10');
    expect(S.apptCount(out)).toBe(2);
  });

  const therapists = [
    { id: 't1', displayName: 'Maya Chen', roleTitle: 'Occupational Therapist' },
    { id: 't2', displayName: 'Tom Rivera', roleTitle: 'Speech Pathologist' },
    { id: 't3', displayName: 'Priya Nair', roleTitle: 'Physiotherapist' },
  ];
  test('filterTherapists: everyone by default; by id set; by discipline; focus wins', () => {
    expect(S.filterTherapists(therapists, {}).length).toBe(3);
    expect(S.filterTherapists(therapists, { ids: new Set(['t2']) }).map(t => t.id)).toEqual(['t2']);
    expect(S.filterTherapists(therapists, { discipline: 'Speech Pathologist' }).map(t => t.id)).toEqual(['t2']);
    expect(S.filterTherapists(therapists, { ids: new Set(['t1', 't2']), focusId: 't3' }).map(t => t.id)).toEqual(['t3']);
  });
  test('disciplinesOf produces the distinct sorted set', () => {
    expect(S.disciplinesOf(therapists)).toEqual(
      ['Occupational Therapist', 'Physiotherapist', 'Speech Pathologist']);
  });

  test('groupWeek buckets each therapist day, sorted by start', () => {
    const g = S.groupWeek(events, therapists, '2026-08-10');
    expect(g.days.length).toBe(7);
    expect(g.byTherapist.t1['2026-08-10'].length).toBe(3);
    expect(g.byTherapist.t1['2026-08-11'].length).toBe(1);
    expect(g.byTherapist.t3['2026-08-10'].length).toBe(0);
    const mins = g.byTherapist.t1['2026-08-10'].map(x => x.startMin);
    expect(mins).toEqual([...mins].sort((a, b) => a - b));
  });
});
