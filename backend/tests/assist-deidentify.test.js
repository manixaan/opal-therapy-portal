'use strict';

/**
 * Opal Assist de-identification over the practice-wide directory:
 * appearance-ordered tokens, conversation-stable tokens without a server-side
 * map, strict matching that leaves everyday words alone, and the send guard.
 * Synthetic names only; no database, no Splose.
 */

jest.mock('../database', () => ({ pool: { query: jest.fn().mockResolvedValue({ rows: [] }) } }));
jest.mock('../splose-api', () => ({ isConfigured: () => false, getPatients: jest.fn(), getContacts: jest.fn(), getPractitioners: jest.fn() }));

const directory = require('../assist/identity-directory');
const assist = require('../assist/assist-deidentify');

const entry = (role, ref, name) => ({ role, ref, name, variants: directory.strictVariants(name) });
const DIR = {
  entries: [
    entry('client', 'splose:patient:1', 'Aiden Blackwood-Tan'),
    entry('client', 'splose:patient:2', 'Zara Okonkwo'),
    entry('contact', 'splose:contact:9', 'Priya Blackwood'),
    entry('therapist', 'splose:practitioner:88167', 'Sam Okafor'),
    entry('staff', 'user:u1', 'Ann Mathew'),
    entry('client', 'splose:patient:3', 'Rose Hill'), // two everyday words — full name only
  ],
  partial: false,
};
beforeEach(() => directory._setCacheForTests(DIR));

describe('check — practice-wide, appearance-ordered', () => {
  test('people the practice knows become role tokens numbered by first appearance', async () => {
    const r = await assist.check({ text: 'Zara saw Sam Okafor, then Aiden arrived with Priya. Ann Mathew signed off. Email priya@example.com.' });
    expect(r.text).toBe('[CLIENT_1] saw [THERAPIST_1], then [CLIENT_2] arrived with [CONTACT_1]. [STAFF_1] signed off. Email [EMAIL_1].');
    expect(r.hidden.map((h) => [h.token, h.name])).toEqual([
      ['CLIENT_1', 'Zara Okonkwo'], ['THERAPIST_1', 'Sam Okafor'], ['CLIENT_2', 'Aiden Blackwood-Tan'],
      ['CONTACT_1', 'Priya Blackwood'], ['STAFF_1', 'Ann Mathew'], ['EMAIL_1', 'priya@example.com'],
    ]);
    // The browser's map carries refs for directory people, never a stored name on the server side.
    expect(r.known).toEqual([
      { token: 'CLIENT_1', ref: 'splose:patient:2', role: 'client' },
      { token: 'THERAPIST_1', ref: 'splose:practitioner:88167', role: 'therapist' },
      { token: 'CLIENT_2', ref: 'splose:patient:1', role: 'client' },
      { token: 'CONTACT_1', ref: 'splose:contact:9', role: 'contact' },
      { token: 'STAFF_1', ref: 'user:u1', role: 'staff' },
      // A contact detail keeps its token for the rest of the conversation.
      { token: 'EMAIL_1', name: 'priya@example.com', role: 'email' },
    ]);
  });

  test('everyday words that are also names are left alone unless the full name appears', async () => {
    const r = await assist.check({ text: 'The rose garden on the hill was calm. Rose Hill attended; a wild rose grew.' });
    expect(r.text).toBe('The rose garden on the hill was calm. [CLIENT_1] attended; a wild rose grew.');
  });

  test('a follow-up message keeps the same tokens for the same people and numbers new ones after', async () => {
    const first = await assist.check({ text: 'Aiden was late.' });
    expect(first.text).toBe('[CLIENT_1] was late.');
    const second = await assist.check({ text: 'Zara and Aiden both attended. Aiden left early.', known: first.known });
    expect(second.text).toBe('[CLIENT_2] and [CLIENT_1] both attended. [CLIENT_1] left early.');
    expect(second.known.map((k) => k.token)).toEqual(['CLIENT_1', 'CLIENT_2']);
  });

  test('a confirmed unknown person becomes PERSON_n, numbered past prior people, and stays stable', async () => {
    const r1 = await assist.check({ text: 'Spoke with Tobias about Aiden.', confirmedNames: ['Tobias'] });
    expect(r1.text).toBe('Spoke with [PERSON_1] about [CLIENT_1].');
    expect(r1.known).toContainEqual({ token: 'PERSON_1', name: 'Tobias', role: 'person' });
    const r2 = await assist.check({ text: 'Tobias rang again, and so did Marguerite.', known: r1.known, confirmedNames: ['Marguerite'] });
    expect(r2.text).toBe('[PERSON_1] rang again, and so did [PERSON_2].');
  });

  test('unknown capitalised words are offered as candidates, never replaced silently', async () => {
    const r = await assist.check({ text: 'Met Dr Kowalski at the school with Aiden.' });
    expect(r.text).toBe('Met Dr Kowalski at the school with [CLIENT_1].');
    expect(r.candidates).toEqual([{ word: 'Kowalski', reason: 'after a title' }]);
  });

  test('a browser-supplied ref the directory does not know is ignored, not trusted', async () => {
    const r = await assist.check({ text: 'Hello Aiden', known: [{ token: 'CLIENT_1', ref: 'splose:patient:999', role: 'client' }] });
    expect(r.text).toBe('Hello [CLIENT_1]');
    expect(r.known).toEqual([{ token: 'CLIENT_1', ref: 'splose:patient:1', role: 'client' }]);
  });
});

describe('assertClean — the send guard', () => {
  test('clean tokenised text passes', async () => {
    expect(await assist.assertClean({ text: '[CLIENT_1] saw [THERAPIST_1] at [ADDRESS_1].' })).toBeNull();
  });
  test('a directory name in the clear is refused', async () => {
    expect(await assist.assertClean({ text: 'Aiden saw the OT.' })).toBe('known_name_present');
  });
  test('a contact detail in the clear is refused', async () => {
    expect(await assist.assertClean({ text: 'Ring 0412 345 678.' })).toBe('contact_detail_present');
  });
  test('a name the person confirmed earlier is refused if it reappears in the clear', async () => {
    expect(await assist.assertClean({ text: 'Tobias called.', known: [{ token: 'PERSON_1', name: 'Tobias', role: 'person' }] })).toBe('known_name_present');
  });
});

describe('directory strict variants', () => {
  test('no diminutives, no phonetics, no short or everyday single words', () => {
    const v = directory.strictVariants('Alexander Rose-Smith');
    expect(v.has('alexander rose-smith')).toBe(true);
    expect(v.has('alexander')).toBe(true);
    expect(v.has('a rose-smith')).toBe(true);
    expect(v.has('alex')).toBe(false);
    expect(v.has('rose')).toBe(false);
    expect(v.has('smith')).toBe(false);
  });
});

describe('directory resilience — one source failing never forgets people already known', () => {
  const splose = require('../splose-api');
  const db = require('../database');
  beforeEach(() => {
    directory._resetForTests();
    splose.isConfigured = () => true;
    splose.getPatients.mockResolvedValue([{ id: 1, firstname: 'Noah', lastname: 'Whitlock' }]);
    splose.getContacts.mockResolvedValue([]);
    splose.getPractitioners.mockResolvedValue([]);
    db.pool.query.mockResolvedValue({ rows: [] });
  });
  afterEach(() => { splose.isConfigured = () => false; directory._resetForTests(); });

  test('a lone lowercase first name of a known client is hidden', async () => {
    const r = await assist.check({ text: 'noah as ADD - what are things I can do?' });
    expect(r.text).toBe('[CLIENT_1] as ADD - what are things I can do?');
    expect(r.directoryPartial).toBe(false);
  });

  test('a source that fails with no earlier copy is named, and the directory is rebuilt on the next check rather than held', async () => {
    splose.getPatients.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
    const first = await assist.check({ text: 'noah was late' });
    expect(first.directoryPartial).toBe(true);
    expect(first.directoryMissing).toEqual(['Splose clients']);
    expect(first.text).toBe('noah was late');
    // Thirty-second partial window: force it past, as the clock would.
    directory._setCacheForTests(null);
    const second = await assist.check({ text: 'noah was late' });
    expect(second.directoryPartial).toBe(false);
    expect(second.text).toBe('[CLIENT_1] was late');
  });

  test('a source that fails AFTER a good load falls back to its last good copy — nobody is forgotten', async () => {
    await assist.check({ text: 'warm up' });
    directory.invalidate();
    splose.getPatients.mockRejectedValueOnce(Object.assign(new Error('429'), { response: { status: 429 } }));
    const r = await assist.check({ text: 'noah was late' });
    expect(r.directoryPartial).toBe(false);
    expect(r.text).toBe('[CLIENT_1] was late');
  });
});

describe('gap closure — what a real paste contains (synthetic)', () => {
  const full = (role, ref, name) => { const c = directory.capitalisedVariants(name); return { role, ref, name, variants: directory.strictVariants(name), capVariants: c.cap, midOnly: c.midOnly }; };
  beforeEach(() => directory._setCacheForTests({ partial: false, entries: [
    full('client', 'p1', 'Noah Whitlock'), full('client', 'p2', 'Rose Hill'), full('client', 'p3', 'Li Wu'),
    full('therapist', 't1', 'Sam Okafor'), full('staff', 'u1', 'Will Young'), full('client', 'p4', 'May Tran'),
  ] }));

  test('date of birth, Medicare, bare landline, PO Box and a named postcode are hidden; a session date and a year range are not', async () => {
    const r = await assist.check({ text: 'DOB 03/04/2019, born 3 April 2019. Seen 12/09/2026 under the 2025-2026 plan. Medicare 2123 45670 1. Ph 9388 1234. PO Box 12 Subiaco WA 6008, postcode 6008.' });
    expect(r.text.replace(/ \(age group: [^)]+\)/g, '')).toBe('DOB [DOB_1], born [DOB_2]. Seen 12/09/2026 under the 2025-2026 plan. Medicare [MEDICARE_NUMBER_1]. Ph [PHONE_1]. [ADDRESS_1], postcode [ADDRESS_2].');
  });

  test('short and everyday-word names are hidden with a capital and left alone as ordinary words', async () => {
    const r = await assist.check({ text: 'Rose was upset in the rose garden. Li came late with the Wu family. OT is sam.' });
    expect(r.text).toBe('[CLIENT_1] was upset in the rose garden. [CLIENT_2] came late with the [CLIENT_2] family. OT is [THERAPIST_1].');
  });

  test('a sentence-opener name needs a capital mid-sentence; a month name needs the full name', async () => {
    const r = await assist.check({ text: 'Will attend next week. We will see Will then. In May we review May Tran.' });
    expect(r.text).toBe('Will attend next week. We will see [STAFF_1] then. In May we review [CLIENT_1].');
  });

  test('missing apostrophe, dotted initial and hyphenated surname all resolve to the person', async () => {
    const r = await assist.check({ text: 'Noahs bag; n.whitlock; the Whitlock-Tan family.' });
    expect(r.text).toBe("[CLIENT_1]'s bag; [CLIENT_1]; the [CLIENT_1] family.");
  });

  test('a one-letter near-miss of a name in the message and a lowercase name after a person cue are OFFERED, never silently replaced', async () => {
    const r = await assist.check({ text: 'Noah was tired and nowah slept. I spoke with tobias and with school.' });
    expect(r.text).toContain('nowah');
    expect(r.candidates).toEqual([{ word: 'nowah', reason: 'close to a name above' }, { word: 'tobias', reason: 'after a person cue' }]);
  });

  test('the send guard refuses each of the new shapes in the clear', async () => {
    expect(await assist.assertClean({ text: 'born 3 April 2019' })).toBe('contact_detail_present');
    expect(await assist.assertClean({ text: 'Medicare 2123 45670 1' })).toBe('contact_detail_present');
    expect(await assist.assertClean({ text: 'Li came late' })).toBe('known_name_present');
    expect(await assist.assertClean({ text: 'Seen 12/09/2026, aged 7, scored 42.' })).toBeNull();
  });
});

describe('age group, named places, and the client\'s own record values', () => {
  const splose = require('../splose-api');
  const knownValues = require('../assist/known-values');
  const { ageGroupOf } = require('../assist/age-groups');
  afterEach(() => { splose.isConfigured = () => false; knownValues.clear(); });

  test('a birth date is replaced by its token AND the age group, never the date', async () => {
    expect(ageGroupOf('03/04/2019', new Date('2026-09-19'))).toBe('child, 5–10 years');
    expect(ageGroupOf('3 April 1950', new Date('2026-09-19'))).toBe('older adult, 65 years and over');
    const r = await assist.check({ text: 'DOB 03/04/2019.' });
    expect(r.text).toMatch(/^DOB \[DOB_1\] \(age group: [a-z ]+, \d+–\d+ years\)\.$/);
    expect(r.text).not.toContain('2019');
  });

  test('a named school or hospital loses its name and keeps its kind', async () => {
    const r = await assist.check({ text: "He attends Subiaco Primary School and was seen at Perth Children's Hospital. The school was closed." });
    expect(r.text).toBe("He attends [SCHOOL_1] (primary school) and was seen at [HOSPITAL_1] (children's hospital). The school was closed.");
    expect(r.hidden.map((h) => h.name)).toEqual(['Subiaco Primary School', "Perth Children's Hospital"]);
  });

  test('a recorded phone, birth date, NDIS number and address are caught in formats no shape rule knows', async () => {
    splose.isConfigured = () => true;
    splose.getPatientIdentifiers = jest.fn().mockResolvedValue([
      { id: 1, dateOfBirth: '2019-04-03', phones: ['+61 412 345 678', '(08) 9388 1234'], ndisNumber: '431234567', addressL1: 'Unit 4/12 Smith St' },
    ]);
    const r = await assist.check({ text: 'Rang 0412.345.678 then 93881234. Turned seven on 3.4.19. Visit at 12 smith, number 431 234 567. Other: 0499.111.222, 5.5.20, 14 smith.' });
    expect(r.text.replace(/ \(age group: [^)]+\)/g, '')).toBe('Rang [PHONE_1] then [PHONE_2]. Turned seven on [DOB_1]. Visit at [ADDRESS_1], number [NDIS_NUMBER_1]. Other: 0499.111.222, 5.5.20, 14 smith.');
    expect(await assist.assertClean({ text: 'call 0412.345.678' })).toBe('client_record_detail_present');
  });

  test('the matcher holds fingerprints, not values', async () => {
    splose.isConfigured = () => true;
    splose.getPatientIdentifiers = jest.fn().mockResolvedValue([{ id: 1, phones: ['0412 345 678'], dateOfBirth: '2019-04-03' }]);
    await knownValues.matcher();
    const src = require('fs').readFileSync(require.resolve('../assist/known-values'), 'utf8');
    expect(src).not.toMatch(/console\.(log|info|debug)/);
    // Nothing reachable from the module's exports carries a recorded value.
    expect(JSON.stringify(Object.keys(knownValues))).not.toMatch(/0412|2019/);
  });
});

describe('contact-detail tokens are stable across a conversation', () => {
  test('the same number keeps its token; a new number never takes a used one', async () => {
    const first = await assist.check({ text: 'Mum is on 0412 345 678.' });
    expect(first.text).toBe('Mum is on [PHONE_1].');
    const second = await assist.check({ text: 'Dad is on 0499 111 222, mum again 0412345678.', known: first.known });
    expect(second.text).toBe('Dad is on [PHONE_2], mum again [PHONE_1].');
  });
  test('a token another pass already wrote into the text is never handed out again', async () => {
    const r = await assist.check({ text: '[CLIENT_1] and [PHONE_1] noted; Zara rang 0412 345 678.' });
    expect(r.text).toBe('[CLIENT_1] and [PHONE_1] noted; [CLIENT_2] rang [PHONE_2].');
  });
});
