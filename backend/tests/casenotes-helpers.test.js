'use strict';

/**
 * CASE NOTES — pure helpers (node).
 *
 * casenotes.js exports its side-effect-free helpers before it touches the
 * DOM (same shape as supportpop.js / opa.js), so the rules that matter
 * clinically can be tested without a browser:
 *   - the plan normaliser must match the PATCH contract exactly
 *     (strings, trimmed, empties dropped, max 20) — anything else is a 400;
 *   - the dirty comparator decides whether Save is offered at all, so it
 *     must not report a change the server would ignore (and must never miss
 *     a real one);
 *   - the metadata row builder omits missing appointment fields rather than
 *     inventing placeholders, mirroring buildHeader() on the server.
 */

const {
  cnEsc,
  cnRelativeTime,
  cnNormalisePlan,
  cnIsDirty,
  cnMetaRows,
  CN_MAX_PLAN_ITEMS,
} = require('../../frontend/current/casenotes.js');

describe('cnEsc', () => {
  test('escapes every HTML-significant character', () => {
    expect(cnEsc('<img src=x onerror="alert(1)">'))
      .toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(cnEsc("O'Brien & Co")).toBe('O&#39;Brien &amp; Co');
  });
  test('null and undefined render as empty, not "null"', () => {
    expect(cnEsc(null)).toBe('');
    expect(cnEsc(undefined)).toBe('');
  });
});

describe('cnRelativeTime', () => {
  const NOW = Date.parse('2026-08-10T10:00:00Z');
  const ago = (ms) => new Date(NOW - ms).toISOString();
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  test('very recent reads as "just now"', () => {
    expect(cnRelativeTime(ago(5 * 1000), NOW)).toBe('just now');
    expect(cnRelativeTime(ago(40 * 1000), NOW)).toBe('just now');
  });
  test('minutes and hours are singular/plural correct', () => {
    expect(cnRelativeTime(ago(1 * MIN), NOW)).toBe('1 minute ago');
    expect(cnRelativeTime(ago(20 * MIN), NOW)).toBe('20 minutes ago');
    expect(cnRelativeTime(ago(1 * HOUR), NOW)).toBe('1 hour ago');
    expect(cnRelativeTime(ago(5 * HOUR), NOW)).toBe('5 hours ago');
  });
  test('yesterday and recent days', () => {
    expect(cnRelativeTime(ago(1 * DAY), NOW)).toBe('yesterday');
    expect(cnRelativeTime(ago(3 * DAY), NOW)).toBe('3 days ago');
  });
  test('beyond a week falls back to an Australian date', () => {
    const out = cnRelativeTime('2026-07-01T02:30:00Z', NOW);
    expect(out).toMatch(/^\d{1,2} [A-Za-z]+ 2026$/); // "1 Jul 2026" / "1 July 2026" per ICU build
    expect(out).not.toMatch(/ago|just now/);
  });
  test('clock skew never produces a negative or future phrasing', () => {
    expect(cnRelativeTime(new Date(NOW + 5 * MIN).toISOString(), NOW)).toBe('just now');
  });
  test('missing or unparseable values render as empty', () => {
    expect(cnRelativeTime(null, NOW)).toBe('');
    expect(cnRelativeTime('', NOW)).toBe('');
    expect(cnRelativeTime('not a date', NOW)).toBe('');
  });
});

describe('cnNormalisePlan — matches the PATCH contract', () => {
  test('trims items and drops empty rows', () => {
    expect(cnNormalisePlan(['  Review grip strength  ', '', '   ', 'Email the school']))
      .toEqual(['Review grip strength', 'Email the school']);
  });
  test('caps at 20 items', () => {
    const many = Array.from({ length: 30 }, (_, i) => 'item ' + i);
    const out = cnNormalisePlan(many);
    expect(out.length).toBe(CN_MAX_PLAN_ITEMS);
    expect(CN_MAX_PLAN_ITEMS).toBe(20);
    expect(out[19]).toBe('item 19');
  });
  test('non-array input is an empty plan, never a throw', () => {
    expect(cnNormalisePlan(undefined)).toEqual([]);
    expect(cnNormalisePlan(null)).toEqual([]);
    expect(cnNormalisePlan('a plan')).toEqual([]);
  });
  test('every returned item is a string (the server rejects anything else)', () => {
    const out = cnNormalisePlan(['a', 3, null, undefined, ' b ']);
    expect(out).toEqual(['a', '3', 'b']);
    out.forEach((v) => expect(typeof v).toBe('string'));
  });
});

describe('cnIsDirty', () => {
  const draft = { noteBody: 'Therapist attended the school.', plan: ['Review grip strength'] };

  test('identical content is not dirty', () => {
    expect(cnIsDirty(draft, { noteBody: 'Therapist attended the school.', plan: ['Review grip strength'] }))
      .toBe(false);
  });
  test('changed note body is dirty', () => {
    expect(cnIsDirty(draft, { noteBody: 'Therapist attended the school. He was settled.', plan: ['Review grip strength'] }))
      .toBe(true);
  });
  test('added, removed and reordered plan items are dirty', () => {
    expect(cnIsDirty(draft, { noteBody: draft.noteBody, plan: ['Review grip strength', 'Email school'] })).toBe(true);
    expect(cnIsDirty(draft, { noteBody: draft.noteBody, plan: [] })).toBe(true);
    expect(cnIsDirty({ noteBody: 'x', plan: ['a', 'b'] }, { noteBody: 'x', plan: ['b', 'a'] })).toBe(true);
  });
  test('a blank plan row the server would drop is NOT dirty', () => {
    expect(cnIsDirty(draft, { noteBody: draft.noteBody, plan: ['Review grip strength', '   '] })).toBe(false);
  });
  test('whitespace-only trailing edits inside a plan item still count', () => {
    expect(cnIsDirty(draft, { noteBody: draft.noteBody, plan: ['Review  grip strength'] })).toBe(true);
  });
  test('missing draft or edits is never dirty', () => {
    expect(cnIsDirty(null, { noteBody: 'x', plan: [] })).toBe(false);
    expect(cnIsDirty(draft, null)).toBe(false);
  });
  test('null note bodies compare as empty strings', () => {
    expect(cnIsDirty({ noteBody: null, plan: [] }, { noteBody: '', plan: [] })).toBe(false);
  });
});

describe('cnMetaRows — server-composed metadata only', () => {
  test('renders the four appointment fields in a stable order', () => {
    const rows = cnMetaRows({
      clientName: 'Liam T',
      clientAddress: '12 Example St, Perth WA',
      serviceLine: '9:00 am, 12 Jul 2026 Therapy Session',
      sessionDateLabel: '12/07/2026',
    });
    expect(rows.map((r) => r.label)).toEqual(['Client', 'Address', 'Service', 'Session date']);
    expect(rows[1].value).toBe('12 Example St, Perth WA');
  });
  test('missing fields are omitted, never invented or placeholdered', () => {
    const rows = cnMetaRows({ clientName: 'Liam T', clientAddress: null, sessionDateLabel: '' });
    expect(rows.map((r) => r.label)).toEqual(['Client']);
    expect(JSON.stringify(rows)).not.toMatch(/unknown|n\/a|tbc/i);
  });
  test('an absent header is an empty row set', () => {
    expect(cnMetaRows(undefined)).toEqual([]);
    expect(cnMetaRows({})).toEqual([]);
  });
  test('narrative and note fields are never metadata rows', () => {
    const rows = cnMetaRows({
      clientName: 'Liam T',
      identify: 'should not appear',
      sessionDetails: 'should not appear',
      noteBody: 'should not appear',
    });
    expect(JSON.stringify(rows)).not.toContain('should not appear');
  });
});
