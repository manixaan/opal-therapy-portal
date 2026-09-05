'use strict';

/**
 * IN-APP BACK/FORWARD — pure route helpers (node).
 *
 * navigation.js exports its side-effect-free helpers before it touches the
 * DOM (same shape as casenotes.js / supportpop.js / opa.js), so the routing
 * rules can be tested without a browser.
 *
 * What actually matters here:
 *   - a route must survive encode → decode → encode unchanged, or Back and
 *     Forward land somewhere the user did not ask for;
 *   - decodeRoute is fed straight from location.hash, which is attacker- and
 *     typo-controlled. It must NEVER throw and must NEVER produce a state
 *     outside the known tabs/views — a garbage hash degrades to Calendar;
 *   - pushOrReplace is the single rule that keeps the history stack honest:
 *     re-rendering the same screen must not add a duplicate entry, and the
 *     very first write at boot must never add an entry at all (that is what
 *     stops the user being trapped on the page).
 */

const {
  encodeRoute,
  decodeRoute,
  normaliseRoute,
  routesEqual,
  pushOrReplace,
  baseOf,
  DEFAULT_TAB,
  KNOWN_TABS,
  PAGE_TABS,
  MAX_ID,
} = require('../../frontend/current/navigation.js');

// ── Every route form in the grammar ────────────────────────────────────────

const ROUND_TRIP = [
  '#calendar',
  '#calendar/day',
  '#calendar/week',
  '#calendar/month',
  '#calendar/scheduler',
  '#resources',
  '#resources/library',
  '#resources/saved',
  '#resources/learning',
  '#resources/admin',
  '#resources/detail/res-123',
  '#casenotes',
  '#interviews',
  '#interviews/record/iv-abc-123',
  '#casenotes/draft-77',
  '#book',
  '#profile',
  '#logbook',
  '#accounting',
  '#settings',
  '#support',
  '#contacts',
  '#activity',
  '#billing',
  '#ndis',
  '#dormant',
  '#travel',
  '#purchases',
  '#fca',
  '#fca/step-2',
  '#letter',
  '#letter/step-3',
  // overlays hang off the base route after "!"
  '#calendar/week!booking',
  '#calendar/week!event/S-42',
  '#calendar/scheduler!booking',
  '#profile!support',
  '#settings!modal/modal-purchase',
  '#resources/detail/res-123!support',
];

describe('route grammar round-trips', () => {
  for (const hash of ROUND_TRIP) {
    test(`${hash} survives encode(decode(x))`, () => {
      expect(encodeRoute(decodeRoute(hash))).toBe(hash);
    });
  }

  test('decode → encode is idempotent for every form', () => {
    for (const hash of ROUND_TRIP) {
      const once = encodeRoute(decodeRoute(hash));
      expect(encodeRoute(decodeRoute(once))).toBe(once);
    }
  });

  test('state → string → state is lossless', () => {
    const states = [
      { tab: 'calendar', view: 'month' },
      { tab: 'resources', view: 'detail', id: 'abc' },
      { tab: 'casenotes', id: 'zz-1' },
      { tab: 'fca', step: 6 },
      { tab: 'calendar', view: 'week', overlay: 'event', overlayId: 'S-9' },
      { tab: 'profile', overlay: 'support' },
    ];
    for (const s of states) {
      expect(decodeRoute(encodeRoute(s))).toEqual(normaliseRoute(s));
    }
  });

  test('every known tab encodes to its own hash', () => {
    // Page tabs are excluded: they are surfaces ABOUT a record, so a bare
    // "#assessment" names nothing openable and is asserted separately below.
    for (const tab of KNOWN_TABS.filter((t) => !PAGE_TABS.includes(t))) {
      expect(encodeRoute({ tab })).toBe('#' + tab);
      expect(decodeRoute('#' + tab).tab).toBe(tab);
    }
  });
});

// ── The assessment surface ─────────────────────────────────────────────────
//
// A full-page surface addressed by an id rather than a step. The rules that
// matter clinically: an assessment must have a real address (so Back returns
// to it and a colleague can be linked to it), and an address that names no
// record must degrade to the catalogue rather than to a blank page.

describe('assessment routes', () => {
  test('both views round-trip', () => {
    expect(encodeRoute({ tab: 'assessment', view: 'record', id: 'abc-123' }))
      .toBe('#assessment/record/abc-123');
    expect(encodeRoute({ tab: 'assessment', view: 'client', id: '4821' }))
      .toBe('#assessment/client/4821');
    for (const hash of ['#assessment/record/abc-123', '#assessment/client/4821']) {
      expect(encodeRoute(decodeRoute(hash))).toBe(hash);
    }
  });

  test('the short form is a record', () => {
    expect(decodeRoute('#assessment/abc-123'))
      .toMatchObject({ tab: 'assessment', view: 'record', id: 'abc-123' });
  });

  test('an idless assessment address is the Assessments tab, never a blank page', () => {
    for (const hash of ['#assessment', '#assessment/record', '#assessment/record/', '#assessment/client/']) {
      expect(decodeRoute(hash)).toMatchObject({ tab: 'resources', view: 'instruments' });
    }
  });

  test('an unknown view degrades to the record view rather than being dropped', () => {
    expect(normaliseRoute({ tab: 'assessment', view: 'nonsense', id: 'x' }))
      .toMatchObject({ tab: 'assessment', view: 'record', id: 'x' });
  });

  test('a hostile id cannot smuggle extra route segments', () => {
    const r = decodeRoute('#assessment/record/' + encodeURIComponent('a/b?c#d'));
    expect(r.id).toBe('abcd');          // every separator stripped
    expect(r.view).toBe('record');      // and none of them became a segment
    expect(r.overlay).toBeNull();
  });
});

// ── Assessment information pages ───────────────────────────────────────────

describe('assessment information pages', () => {
  test('an assessment key is addressable under the Assessments tab', () => {
    const hash = '#resources/instruments/whodas-2.0-36';
    expect(decodeRoute(hash)).toMatchObject({
      tab: 'resources', view: 'instruments', id: 'whodas-2.0-36',
    });
    expect(encodeRoute(decodeRoute(hash))).toBe(hash);
  });

  test('the idless form is still the catalogue', () => {
    expect(encodeRoute(decodeRoute('#resources/instruments'))).toBe('#resources/instruments');
  });
});

// ── Learning-workflow editor ───────────────────────────────────────────────
// The editor renders over the Learning console. Without an address of its own
// Back re-landed on the console it was already covering, so it looked inert.

describe('learning-workflow editor', () => {
  test('an open editor is addressable by workflow id', () => {
    const hash = '#resources/lwedit/037be510-7e10-4ba2-9842-7ad206ebfc85';
    expect(decodeRoute(hash)).toMatchObject({
      tab: 'resources', view: 'lwedit', id: '037be510-7e10-4ba2-9842-7ad206ebfc85',
    });
    expect(encodeRoute(decodeRoute(hash))).toBe(hash);
  });

  test('an idless editor address is the Learning console, not an empty editor', () => {
    expect(encodeRoute(decodeRoute('#resources/lwedit'))).toBe('#resources/learning');
    expect(encodeRoute(decodeRoute('#resources/lwedit/'))).toBe('#resources/learning');
  });
});

// ── Normalisation ──────────────────────────────────────────────────────────

describe('normaliseRoute', () => {
  test('a missing/garbage state is the default tab, never a throw', () => {
    for (const bad of [undefined, null, 0, '', 'calendar', [], NaN, true]) {
      expect(normaliseRoute(bad).tab).toBe(DEFAULT_TAB);
    }
  });

  test('unknown tab falls back to Calendar', () => {
    expect(normaliseRoute({ tab: 'wibble' }).tab).toBe('calendar');
    expect(normaliseRoute({ tab: '__proto__' }).tab).toBe('calendar');
    expect(normaliseRoute({ tab: 'constructor' }).tab).toBe('calendar');
  });

  test('tab names are case-insensitive', () => {
    expect(normaliseRoute({ tab: 'CALENDAR', view: 'WEEK' }).view).toBe('week');
    expect(decodeRoute('#CALENDAR/WEEK')).toEqual(normaliseRoute({ tab: 'calendar', view: 'week' }));
  });

  test('the app-internal "master" mode maps to the readable "scheduler" route', () => {
    expect(normaliseRoute({ tab: 'calendar', view: 'master' }).view).toBe('scheduler');
    expect(encodeRoute({ tab: 'calendar', view: 'master' })).toBe('#calendar/scheduler');
  });

  test('an unknown calendar mode is dropped, not invented', () => {
    expect(normaliseRoute({ tab: 'calendar', view: 'fortnight' }).view).toBeNull();
    expect(encodeRoute({ tab: 'calendar', view: 'fortnight' })).toBe('#calendar');
  });

  test('bare #calendar carries NO mode so the default-view logic is left alone', () => {
    expect(decodeRoute('#calendar').view).toBeNull();
  });

  test('resources defaults to home and home is omitted from the hash', () => {
    expect(normaliseRoute({ tab: 'resources' }).view).toBe('home');
    expect(encodeRoute({ tab: 'resources', view: 'home' })).toBe('#resources');
    expect(encodeRoute(decodeRoute('#resources/home'))).toBe('#resources');
  });

  test('an unknown resources view falls back to home', () => {
    expect(normaliseRoute({ tab: 'resources', view: 'secret' }).view).toBe('home');
  });

  test('detail without an id degrades to the library, never a broken detail', () => {
    expect(normaliseRoute({ tab: 'resources', view: 'detail' }).view).toBe('library');
    expect(encodeRoute(decodeRoute('#resources/detail'))).toBe('#resources/library');
    expect(encodeRoute(decodeRoute('#resources/detail/'))).toBe('#resources/library');
    expect(encodeRoute(decodeRoute('#resources/detail///'))).toBe('#resources/library');
  });

  test('wizard steps are clamped to a sane range', () => {
    expect(normaliseRoute({ tab: 'fca', step: 3 }).step).toBe(3);
    expect(normaliseRoute({ tab: 'fca', step: 0 }).step).toBeNull();
    expect(normaliseRoute({ tab: 'fca', step: -4 }).step).toBeNull();
    expect(normaliseRoute({ tab: 'fca', step: 999 }).step).toBeNull();
    expect(normaliseRoute({ tab: 'letter', step: 'banana' }).step).toBeNull();
    expect(encodeRoute(decodeRoute('#fca/step-0'))).toBe('#fca');
    expect(encodeRoute(decodeRoute('#fca/step-999'))).toBe('#fca');
  });

  test('steps only exist on wizard routes', () => {
    expect(normaliseRoute({ tab: 'calendar', step: 3 }).step).toBeNull();
    expect(normaliseRoute({ tab: 'settings', step: 3 }).step).toBeNull();
  });

  test('unknown overlays are dropped', () => {
    expect(normaliseRoute({ tab: 'profile', overlay: 'popup' }).overlay).toBeNull();
    expect(encodeRoute(decodeRoute('#profile!popup'))).toBe('#profile');
  });

  test('id-bearing overlays without an id are dropped', () => {
    expect(normaliseRoute({ tab: 'calendar', overlay: 'event' }).overlay).toBeNull();
    expect(encodeRoute(decodeRoute('#calendar!event'))).toBe('#calendar');
    expect(encodeRoute(decodeRoute('#calendar!modal/'))).toBe('#calendar');
  });

  test('overlays that take no id never carry one', () => {
    expect(normaliseRoute({ tab: 'profile', overlay: 'support', overlayId: 'x' }).overlayId).toBeNull();
    expect(encodeRoute(decodeRoute('#profile!support/junk'))).toBe('#profile!support');
  });

  test('ids are length-capped and stripped of route separators', () => {
    const long = 'a'.repeat(MAX_ID + 500);
    expect(normaliseRoute({ tab: 'casenotes', id: long }).id.length).toBe(MAX_ID);
    expect(normaliseRoute({ tab: 'casenotes', id: 'a/b!c#d' }).id).toBe('abcd');
  });

  test('baseOf strips the overlay and leaves the view untouched', () => {
    const r = decodeRoute('#calendar/week!event/S-1');
    expect(baseOf(r)).toEqual(normaliseRoute({ tab: 'calendar', view: 'week' }));
    expect(r.overlay).toBe('event'); // baseOf does not mutate its argument
  });
});

// ── Hostile / malformed input ──────────────────────────────────────────────

describe('decodeRoute never throws and never leaves the known set', () => {
  const HOSTILE = [
    '',
    '#',
    '#/',
    '#//////',
    '#!',
    '#!booking',
    '#/////calendar/////',
    '#resources/detail/',
    '#unknown-tab',
    '#calendar/week/extra/segments/ignored',
    '#' + 'x'.repeat(10000),
    '#calendar/' + 'y'.repeat(10000),
    '#casenotes/%E0%A4%A',            // malformed percent escape
    '#casenotes/%%%%',
    '#resources/detail/<script>alert(1)</script>',
    '#calendar!event/../../etc/passwd',
    '#__proto__',
    '#constructor/prototype',
    '#calendar/week!booking!booking',
    'not-even-a-hash',
    null,
    undefined,
    12345,
    {},
    [],
  ];

  for (const bad of HOSTILE) {
    test(`safe for ${JSON.stringify(bad) === undefined ? String(bad) : JSON.stringify(bad).slice(0, 46)}`, () => {
      let r;
      expect(() => { r = decodeRoute(bad); }).not.toThrow();
      expect(KNOWN_TABS).toContain(r.tab);
      expect(() => encodeRoute(r)).not.toThrow();
      expect(encodeRoute(r).startsWith('#')).toBe(true);
    });
  }

  test('a 10kB hash cannot produce a 10kB id', () => {
    const r = decodeRoute('#casenotes/' + 'z'.repeat(10000));
    expect(r.id.length).toBeLessThanOrEqual(MAX_ID);
    expect(encodeRoute(r).length).toBeLessThan(200);
  });

  test('a garbage hash resolves to the safe default', () => {
    expect(encodeRoute(decodeRoute('#unknown-tab'))).toBe('#calendar');
    expect(encodeRoute(decodeRoute('#!!!!'))).toBe('#calendar');
    expect(encodeRoute(decodeRoute('#/'))).toBe('#calendar');
  });

  test('trailing slashes are normalised away', () => {
    expect(encodeRoute(decodeRoute('#calendar/week/'))).toBe('#calendar/week');
    expect(encodeRoute(decodeRoute('#calendar/week///'))).toBe('#calendar/week');
    expect(encodeRoute(decodeRoute('#profile/'))).toBe('#profile');
  });

  test('leading hashes and slashes are tolerated', () => {
    expect(encodeRoute(decodeRoute('##profile'))).toBe('#profile');
    expect(encodeRoute(decodeRoute('#/profile'))).toBe('#profile');
    expect(encodeRoute(decodeRoute('profile'))).toBe('#profile');
  });
});

// ── routesEqual ────────────────────────────────────────────────────────────

describe('routesEqual', () => {
  test('identical routes compare equal across encodings', () => {
    expect(routesEqual(decodeRoute('#calendar/week'), { tab: 'calendar', view: 'week' })).toBe(true);
    expect(routesEqual(decodeRoute('#calendar/scheduler'), { tab: 'calendar', view: 'master' })).toBe(true);
    expect(routesEqual(decodeRoute('#resources'), { tab: 'resources', view: 'home' })).toBe(true);
    expect(routesEqual(decodeRoute('#RESOURCES/LIBRARY'), { tab: 'resources', view: 'library' })).toBe(true);
  });

  test('a differing tab, view, id, step or overlay is not equal', () => {
    expect(routesEqual({ tab: 'calendar' }, { tab: 'profile' })).toBe(false);
    expect(routesEqual({ tab: 'calendar', view: 'week' }, { tab: 'calendar', view: 'month' })).toBe(false);
    expect(routesEqual({ tab: 'casenotes', id: 'a' }, { tab: 'casenotes', id: 'b' })).toBe(false);
    expect(routesEqual({ tab: 'fca', step: 1 }, { tab: 'fca', step: 2 })).toBe(false);
    expect(routesEqual({ tab: 'calendar' }, { tab: 'calendar', overlay: 'booking' })).toBe(false);
    expect(routesEqual(
      { tab: 'calendar', overlay: 'event', overlayId: 'a' },
      { tab: 'calendar', overlay: 'event', overlayId: 'b' })).toBe(false);
  });

  test('a null route is never equal to anything (boot has no predecessor)', () => {
    expect(routesEqual(null, { tab: 'calendar' })).toBe(false);
    expect(routesEqual({ tab: 'calendar' }, null)).toBe(false);
    expect(routesEqual(null, null)).toBe(false);
  });

  test('bare #calendar is NOT the same route as #calendar/week', () => {
    expect(routesEqual(decodeRoute('#calendar'), decodeRoute('#calendar/week'))).toBe(false);
  });
});

// ── push vs replace ────────────────────────────────────────────────────────

describe('pushOrReplace — the anti-trap / anti-duplicate rule', () => {
  test('the first write at boot REPLACES, so no entry is ever added', () => {
    expect(pushOrReplace(null, decodeRoute('#calendar'))).toBe('replace');
    expect(pushOrReplace(undefined, decodeRoute('#profile'))).toBe('replace');
  });

  test('re-rendering the same screen REPLACES — no duplicate entries', () => {
    const a = decodeRoute('#calendar/week');
    expect(pushOrReplace(a, decodeRoute('#calendar/week'))).toBe('replace');
    expect(pushOrReplace(a, { tab: 'calendar', view: 'week' })).toBe('replace');
    expect(pushOrReplace(decodeRoute('#resources'), decodeRoute('#resources/home'))).toBe('replace');
  });

  test('a real navigation PUSHES exactly one entry', () => {
    expect(pushOrReplace(decodeRoute('#calendar'), decodeRoute('#profile'))).toBe('push');
    expect(pushOrReplace(decodeRoute('#calendar/week'), decodeRoute('#calendar/month'))).toBe('push');
    expect(pushOrReplace(decodeRoute('#resources/library'), decodeRoute('#resources/detail/r1'))).toBe('push');
    expect(pushOrReplace(decodeRoute('#casenotes/a'), decodeRoute('#casenotes/b'))).toBe('push');
  });

  test('opening an overlay PUSHES so Back closes it', () => {
    expect(pushOrReplace(decodeRoute('#calendar/week'), decodeRoute('#calendar/week!booking'))).toBe('push');
    expect(pushOrReplace(decodeRoute('#calendar/week'), decodeRoute('#calendar/week!event/S-1'))).toBe('push');
    expect(pushOrReplace(decodeRoute('#profile'), decodeRoute('#profile!support'))).toBe('push');
  });

  test('re-opening the overlay that is already current REPLACES (no loop)', () => {
    const o = decodeRoute('#calendar/week!booking');
    expect(pushOrReplace(o, decodeRoute('#calendar/week!booking'))).toBe('replace');
  });

  test('a garbage next-route still resolves to a decision, never a throw', () => {
    expect(() => pushOrReplace(decodeRoute('#calendar'), decodeRoute('#!!!'))).not.toThrow();
    expect(pushOrReplace(decodeRoute('#calendar'), decodeRoute('#!!!'))).toBe('replace');
  });
});


// ── Interview Preparation ──────────────────────────────────────────────────
//
// A normal tab that may carry a record id, the same shape as casenotes. What
// separates it from the assessment surface: '#interviews' names a REAL screen
// (the template library and the record list), so an idless address must
// degrade to itself rather than being redirected somewhere else.

describe('interview routes', () => {
  test('the library is an address of its own', () => {
    expect(encodeRoute({ tab: 'interviews' })).toBe('#interviews');
    expect(decodeRoute('#interviews')).toMatchObject({ tab: 'interviews', id: null });
  });

  test('one interview round-trips through the canonical form', () => {
    expect(encodeRoute({ tab: 'interviews', id: 'iv-abc-123' })).toBe('#interviews/record/iv-abc-123');
    expect(encodeRoute(decodeRoute('#interviews/record/iv-abc-123'))).toBe('#interviews/record/iv-abc-123');
  });

  test('the short form a human would type is accepted and canonicalised', () => {
    expect(decodeRoute('#interviews/iv-abc-123')).toMatchObject({ tab: 'interviews', id: 'iv-abc-123' });
    expect(encodeRoute(decodeRoute('#interviews/iv-abc-123'))).toBe('#interviews/record/iv-abc-123');
  });

  test('an idless or malformed record address degrades to the library, not a blank page', () => {
    for (const hash of ['#interviews/record/', '#interviews/record', '#interviews/', '#interviews//']) {
      expect(`${hash} -> ${encodeRoute(decodeRoute(hash))}`).toBe(`${hash} -> #interviews`);
    }
  });

  test('a hostile id is stripped of route separators and length-capped', () => {
    const nasty = decodeRoute('#interviews/record/' + encodeURIComponent('../../settings!modal/x'));
    expect(nasty.tab).toBe('interviews');
    expect(nasty.id).not.toMatch(/[#!/?\s]/);
    expect(decodeRoute('#interviews/record/' + 'z'.repeat(500)).id.length).toBeLessThanOrEqual(MAX_ID);
  });
});
