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

describe('structured identifiers — email, phone, address, NDIS number', () => {
  const { containsStructuredIdentifier, deidentifyStructured } = require('../ai/deidentify');
  const map = buildIdentityMap([{ name: 'Aiden Blackwood-Tan', role: 'client' }, { name: 'Emily Rose', role: 'mother' }]);

  test('each shape becomes a numbered token and comes back verbatim', () => {
    const text = 'Aiden lives at Unit 4/12 Smith Street, Fremantle WA 6160. Mum emily.rose@example.com or 0412 345 678, also (08) 9321 1234. NDIS 431234567. Call 1300 123 456.';
    const r = deidentify(text, map);
    expect(r.text).toBe('[CLIENT] lives at [ADDRESS_1]. Mum [EMAIL_1] or [PHONE_1], also [PHONE_2]. NDIS [NDIS_NUMBER_1]. Call [PHONE_3].');
    expect(r.candidates).toEqual([]);
    expect(r.entries.map((e) => e.role)).toEqual(['client', 'email', 'address', 'ndis_number', 'phone', 'phone', 'phone']);
    const back = reidentify(r.text, r.map);
    expect(back.ok).toBe(true);
    expect(back.text).toBe(text.replace('Aiden', 'Aiden Blackwood-Tan'));
  });

  test('clinical numbers are never mistaken for identifiers', () => {
    const text = 'Aged 7, born 2019. Score 12/20, weight 24.5 kg, session cost $193.99 on 12/08/2026 at 10:30. Goal 3 of 4. Plan review in 90 days.';
    const r = deidentify(text, map);
    expect(r.text).toBe(text);
    expect(containsStructuredIdentifier(text)).toBe(false);
  });

  test('the same value spoken twice shares one token', () => {
    const r = deidentifyStructured('ring 0412 345 678 today and 0412345678 tomorrow');
    expect(r.text).toBe('ring [PHONE_1] today and [PHONE_1] tomorrow');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].count).toBe(2);
  });

  test('an email built from a known name is one opaque token, not a half-replaced name', () => {
    const r = deidentify('contact emily.rose@example.com or Emily directly', map);
    expect(r.text).toBe('contact [EMAIL_1] or [CLIENT_MOTHER] directly');
  });

  test('a token already in the text is never phonetically matched to a name', () => {
    // "EMAIL" and "Emily" share a phonetic key; the token must stay opaque.
    const r = deidentify('sent to [EMAIL_1] earlier', map);
    expect(r.text).toBe('sent to [EMAIL_1] earlier');
    expect(r.candidates).toEqual([]);
  });

  test('a lowercase dictated address with a state and postcode is caught', () => {
    const r = deidentify('dropped him at 7b ocean drive scarborough wa 6019 after school', map);
    expect(r.text).toBe('dropped him at [ADDRESS_1] after school');
  });

  test('the output-side check finds a raw identifier the model should never have', () => {
    expect(containsStructuredIdentifier('Mother can be reached on 0412 345 678.')).toBe(true);
    expect(containsStructuredIdentifier('Send to someone@example.org')).toBe(true);
    expect(containsStructuredIdentifier('Lives at 12 Smith St')).toBe(true);
    expect(containsStructuredIdentifier('Participant 431234567')).toBe(true);
    expect(containsStructuredIdentifier('[PHONE_1] and [ADDRESS_1] were noted.')).toBe(false);
  });

  test('token labels read plainly on the phone', () => {
    expect(describeToken('EMAIL_1')).toBe('Email address');
    expect(describeToken('PHONE_2')).toBe('Phone number');
    expect(describeToken('ADDRESS_1')).toBe('Address');
    expect(describeToken('NDIS_NUMBER_1')).toBe('NDIS number');
  });
});
