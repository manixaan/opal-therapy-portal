'use strict';

/**
 * De-identification — names out before the model, names back after.
 * Pure module, synthetic names only.
 */

const {
  buildIdentityMap, deidentify, reidentify, containsKnownName, phoneticKey, variantsOf, describeToken,
} = require('../ai/deidentify');

const people = [
  { name: 'Aiden Blackwood-Tan', role: 'client' },
  { name: 'Priya Blackwood', role: 'mother' },
  { name: 'Marcus Tan', role: 'father' },
  { name: 'Dr Helena Voss', role: 'gp' },
  { name: 'Sam Okafor', role: 'therapist' },
  { name: 'Josephine Reilly', role: 'support_coordinator' },
];

describe('variants and phonetics', () => {
  test('a recorded name expands to the ways it is spoken', () => {
    const v = variantsOf('Alexander Blackwood-Tan');
    expect(v.has('alexander blackwood-tan')).toBe(true);
    expect(v.has('alexander')).toBe(true);
    expect(v.has('alex')).toBe(true);
    expect(v.has('blackwood')).toBe(true);
    expect(v.has('a blackwood-tan')).toBe(true);
  });
  test('phonetic keys collide for dictation near-misses and not for ordinary words', () => {
    expect(phoneticKey('Aiden')).toBe(phoneticKey('Aidan'));
    expect(phoneticKey('Zara')).toBe(phoneticKey('Sara'));
    expect(phoneticKey('Mikayla')).toBe(phoneticKey('Makayla'));
    expect(phoneticKey('table')).not.toBe(phoneticKey('Aiden'));
  });
});

describe('deidentify — known identities', () => {
  const map = buildIdentityMap(people);

  test('every spelling of a known person becomes their role token', () => {
    const text = "Aiden arrived with Priya. Aiden's mum said Marcus will collect him. Dr Voss reviewed A. Blackwood-Tan. Sam Okafor led the session.";
    const r = deidentify(text, map);
    expect(r.text).toBe("[CLIENT] arrived with [CLIENT_MOTHER]. [CLIENT]'s mum said [CLIENT_FATHER] will collect him. [CLIENT_GP] reviewed [CLIENT]. [THERAPIST] led the session.");
    expect(r.entries.map((e) => e.token).sort()).toEqual(['CLIENT', 'CLIENT_FATHER', 'CLIENT_GP', 'CLIENT_MOTHER', 'THERAPIST']);
    expect(r.candidates).toEqual([]);
  });

  test('a diminutive and a phonetic near-miss are still the client', () => {
    const r = deidentify('aidan was calm today and aiden smiled', map);
    expect(r.text).toBe('[CLIENT] was calm today and [CLIENT] smiled');
  });

  test('dictation that splits a name in two is caught', () => {
    const r = deidentify('today aid in worked on cutting', map);
    expect(r.text).toBe('today [CLIENT] worked on cutting');
  });

  test('a lowercase transcript with no punctuation is handled', () => {
    const r = deidentify('saw aiden and priya mum reports josephine reilly has approved more hours', map);
    expect(r.text).toBe('saw [CLIENT] and [CLIENT_MOTHER] mum reports [SUPPORT_COORDINATOR] has approved more hours');
  });

  test('ordinary words that share letters with a name are left alone', () => {
    const r = deidentify('the sample was taken and the table was tidy', map);
    expect(r.text).toBe('the sample was taken and the table was tidy');
    expect(r.entries).toEqual([]);
  });

  test('a name that is also a word is still hidden when it is the known client', () => {
    const m = buildIdentityMap([{ name: 'Grace Hill', role: 'client' }]);
    const r = deidentify('Grace showed grace under pressure on the hill', m);
    // Both "Grace" instances are the client's first name; "hill" is too short a
    // surname to match alone (4 letters, but exact single-part variants need ≥3 — it is 'hill', it matches).
    expect(r.text).toBe('[CLIENT] showed [CLIENT] under pressure on the [CLIENT]');
  });
});

describe('deidentify — candidates for the therapist to confirm', () => {
  const map = buildIdentityMap(people);

  test('titles, "named", relations and capitalised mid-sentence words are offered, not replaced', () => {
    const r = deidentify('His teacher Mrs Delacroix and a boy named Kofi joined. Aiden played with Tobias at recess.', map);
    expect(r.text).toContain('Mrs Delacroix');
    expect(r.text).toContain('named Kofi');
    expect(r.text).toContain('with Tobias');
    expect(r.candidates.map((c) => c.word).sort()).toEqual(['Delacroix', 'Kofi', 'Tobias']);
    expect(r.candidates.find((c) => c.word === 'Delacroix').reason).toBe('after a title');
    expect(r.candidates.find((c) => c.word === 'Kofi').reason).toBe('after "named"');
    expect(r.candidates.find((c) => c.word === 'Tobias').reason).toBe('capitalised mid-sentence');
  });

  test('sentence starts, days, months and known acronyms are not candidates', () => {
    const r = deidentify('Monday session. Today Aiden used the iPad. NDIS goals reviewed in Perth.', map);
    expect(r.candidates).toEqual([]);
  });

  test('confirmed names become PERSON tokens; ignored words stop being asked', () => {
    const r = deidentify('Aiden played with Tobias and Kofi at Recess', map, { confirmedNames: ['Tobias', 'Kofi'], ignoredWords: ['Recess'] });
    expect(r.text).toBe('[CLIENT] played with [PERSON] and [PERSON_2] at Recess');
    expect(r.candidates).toEqual([]);
    expect(r.entries.map((e) => e.token)).toEqual(expect.arrayContaining(['PERSON', 'PERSON_2']));
  });
});

describe('reidentify — fail closed', () => {
  const map = buildIdentityMap(people);

  test('round trip restores every name', () => {
    const src = "Aiden's mum Priya said Dr Voss agreed.";
    const d = deidentify(src, map);
    const back = reidentify(d.text, d.map);
    expect(back.ok).toBe(true);
    expect(back.text).toBe("Aiden Blackwood-Tan's mum Priya Blackwood said Dr Helena Voss agreed.");
  });

  test('a token the model invented is refused', () => {
    const d = deidentify('Aiden was calm.', map);
    const back = reidentify('[CLIENT] was calm with [CLIENT_UNCLE].', d.map);
    expect(back.ok).toBe(false);
    expect(back.unknownTokens).toEqual(['CLIENT_UNCLE']);
  });

  test('a known full name in the clear is detected', () => {
    expect(containsKnownName('Session with aiden blackwood-tan went well', map)).toBe(true);
    expect(containsKnownName('Session with [CLIENT] went well', map)).toBe(false);
  });

  test('token labels read as roles', () => {
    expect(describeToken('CLIENT_MOTHER')).toBe("Client's Mother");
    expect(describeToken('SUPPORT_COORDINATOR')).toBe('Support Coordinator');
    expect(describeToken('PERSON_2')).toBe('Person');
  });
});
