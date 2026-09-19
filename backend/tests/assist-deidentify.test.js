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
