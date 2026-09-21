'use strict';

/**
 * CASE NOTES COMPOSER — pure helpers (node).
 *
 * casenotes-compose.js exports its side-effect-free helpers before it touches
 * the DOM (same shape as casenotes.js), so the rules that matter clinically
 * can be tested without a browser:
 *   - a dictated phrase is APPENDED — it never rewrites what the therapist
 *     typed, and never pushes the transcript past the server's limit;
 *   - the name decisions sent to /generate are exactly the therapist's
 *     answers, and an unanswered word is reported so generation is blocked;
 *   - a speech engine that cannot be required to stay on-device is refused.
 */

const {
  cncEsc,
  cncAppendFinal,
  cncFilterClients,
  cncNameDecisions,
  cncCanRequireOnDevice,
  CNC_MAX_TRANSCRIPT_CHARS,
  CNC_LANGS,
} = require('../../frontend/current/casenotes-compose.js');

describe('cncEsc', () => {
  test('escapes every HTML-significant character; null renders empty', () => {
    expect(cncEsc('<b onclick="x">O\'Neil & co</b>')).toBe('&lt;b onclick=&quot;x&quot;&gt;O&#39;Neil &amp; co&lt;/b&gt;');
    expect(cncEsc(null)).toBe('');
  });
});

describe('cncAppendFinal', () => {
  test('first phrase is capitalised and added as-is', () => {
    expect(cncAppendFinal('', 'met the client at home')).toBe('Met the client at home');
  });
  test('one space between phrases; existing text is never altered', () => {
    expect(cncAppendFinal('Met the client at home', 'we practised transfers')).toBe('Met the client at home we practised transfers');
    expect(cncAppendFinal('Typed by hand,   ', 'then dictated')).toBe('Typed by hand, then dictated');
  });
  test('capital after a sentence end or a new line, no space before punctuation', () => {
    expect(cncAppendFinal('Session went well.', 'mum attended')).toBe('Session went well. Mum attended');
    expect(cncAppendFinal('Plan:\n', 'review in two weeks')).toBe('Plan:\nReview in two weeks');
    expect(cncAppendFinal('Session went well', '. next visit friday')).toBe('Session went well. next visit friday');
  });
  test('empty or whitespace phrases change nothing', () => {
    expect(cncAppendFinal('Kept', '   ')).toBe('Kept');
    expect(cncAppendFinal('Kept', null)).toBe('Kept');
  });
  test('never exceeds the server limit — the overflow is dropped, not the existing text', () => {
    const base = 'a'.repeat(CNC_MAX_TRANSCRIPT_CHARS - 3);
    const out = cncAppendFinal(base, 'overflowing phrase');
    expect(out.length).toBe(CNC_MAX_TRANSCRIPT_CHARS);
    expect(out.startsWith(base)).toBe(true);
    expect(CNC_MAX_TRANSCRIPT_CHARS).toBe(8000); // mirrors MAX_TRANSCRIPT_CHARS in case-note-routes.js
  });
});

describe('cncFilterClients', () => {
  const clients = [
    { id: 1, fullName: 'Harper Testwell', suburb: 'Fremantle' },
    { id: 2, fullName: 'Jordan Sample', suburb: 'Subiaco' },
    { id: 3, fullName: 'Harper Sample', suburb: null },
  ];
  test('empty query returns everyone (a copy, not the same array)', () => {
    const out = cncFilterClients(clients, '  ');
    expect(out).toEqual(clients);
    expect(out).not.toBe(clients);
  });
  test('case-insensitive, matches name or suburb, every term must hit', () => {
    expect(cncFilterClients(clients, 'harper').map((c) => c.id)).toEqual([1, 3]);
    expect(cncFilterClients(clients, 'SUBI').map((c) => c.id)).toEqual([2]);
    expect(cncFilterClients(clients, 'harper sample').map((c) => c.id)).toEqual([3]);
    expect(cncFilterClients(clients, 'nobody')).toEqual([]);
  });
  test('tolerates junk input', () => {
    expect(cncFilterClients(null, 'x')).toEqual([]);
    expect(cncFilterClients([null, {}], 'x')).toEqual([]);
  });
});

describe('cncNameDecisions', () => {
  const candidates = [{ word: 'Rosie', reason: 'capitalised' }, { word: 'Bunnings', reason: 'capitalised' }, { word: 'Tash', reason: 'unknown' }];
  test('answers map onto the generate payload; the unanswered are reported', () => {
    expect(cncNameDecisions(candidates, { Rosie: 'person', Bunnings: 'word' })).toEqual({
      confirmedNames: ['Rosie'], ignoredWords: ['Bunnings'], undecided: ['Tash'],
    });
  });
  test('an unknown answer value counts as undecided — never as "keep it"', () => {
    expect(cncNameDecisions(candidates, { Rosie: 'maybe' }).undecided).toEqual(['Rosie', 'Bunnings', 'Tash']);
  });
  test('no candidates → nothing to decide', () => {
    expect(cncNameDecisions([], {})).toEqual({ confirmedNames: [], ignoredWords: [], undecided: [] });
    expect(cncNameDecisions(null, null)).toEqual({ confirmedNames: [], ignoredWords: [], undecided: [] });
  });
});

describe('cncCanRequireOnDevice', () => {
  test('refuses a missing engine and a cloud-only engine', () => {
    expect(cncCanRequireOnDevice(null)).toBe(false);
    function CloudOnly() {}
    expect(cncCanRequireOnDevice(CloudOnly)).toBe(false);
    function ProbeOnly() {}
    ProbeOnly.available = () => Promise.resolve('available');
    expect(cncCanRequireOnDevice(ProbeOnly)).toBe(false);   // no instance switch → cannot be required
  });
  test('accepts an engine with both the probe and the instance switch', () => {
    function Local() {}
    Local.available = () => Promise.resolve('available');
    Local.prototype.processLocally = false;
    expect(cncCanRequireOnDevice(Local)).toBe(true);
  });
  test('Australian English is tried first', () => {
    expect(CNC_LANGS[0]).toBe('en-AU');
  });
});
