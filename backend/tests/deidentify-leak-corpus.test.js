'use strict';

/**
 * THE LEAK CORPUS — proof the de-identifier keeps working.
 *
 * Every category in the Opal De-identification Rule Book, written the many
 * ways a busy clinician actually types it, dropped into several sentence
 * frames. The standard is not "most": every AUTO case must leave NO trace of
 * the secret in what would be sent, and every KEPT case must come through
 * untouched (a de-identifier that hides clinical meaning gets switched off).
 * A new way something slipped through is added HERE first, then fixed.
 *
 * Entirely synthetic. No database, no Splose, no model.
 */

jest.mock('../database', () => ({ pool: { query: jest.fn().mockResolvedValue({ rows: [] }) } }));
jest.mock('../splose-api', () => ({ isConfigured: () => true, getPatientIdentifiers: jest.fn() }));

const splose = require('../splose-api');
const directory = require('../assist/identity-directory');
const knownValues = require('../assist/known-values');
const assist = require('../assist/assist-deidentify');

const person = (role, ref, name) => { const c = directory.capitalisedVariants(name); return { role, ref, name, variants: directory.strictVariants(name), capVariants: c.cap, midOnly: c.midOnly }; };

beforeAll(() => {
  directory._setCacheForTests({ partial: false, entries: [
    person('client', 'p1', 'Noah Whitlock'), person('client', 'p2', 'Rose Hill'), person('client', 'p3', 'Li Wu'),
    person('client', 'p4', 'Antony Marchetti-Lowe'), person('contact', 'c1', 'Priya Whitlock'),
    person('therapist', 't1', 'Sam Okafor'), person('staff', 'u1', 'Will Young'),
  ] });
  splose.getPatientIdentifiers.mockResolvedValue([
    { id: 1, dateOfBirth: '2019-04-03', phones: ['+61 412 345 678', '(08) 9388 1234'], ndisNumber: '431234567', medicareNumber: '2123456701', addressL1: 'Unit 4/12 Smith St', suburb: 'Mount Lawley' },
  ]);
  knownValues.clear();
});

const FRAMES = [
  (x) => `${x}`,
  (x) => `Spoke today. ${x}. Then follow up.`,
  (x) => `notes: ${x}, then home visit`,
  (x) => `Session summary\n- ${x}\n- goals reviewed`,
];

/** [category, what is typed, the fragments that must NOT survive] */
const AUTO = [
  // A · people
  ['A1 client full name', 'Noah Whitlock attended', ['Noah', 'Whitlock']],
  ['A1 lowercase', 'noah whitlock attended', ['noah', 'whitlock']],
  ['A1 capitals + possessive', "NOAH'S bag was left", ['NOAH']],
  ['A1 first name only', 'saw noah at ten', ['noah']],
  ['A1 surname only', 'the Whitlock family', ['Whitlock']],
  ['A1 initial + surname', 'N. Whitlock signed', ['Whitlock']],
  ['A2 contact', 'Priya rang back', ['Priya']],
  ['A3 practitioner', 'handover to Sam Okafor', ['Sam', 'Okafor']],
  ['A3 staff, mid-sentence', 'we asked Will to call', ['Will']],
  ['A4 two-letter name', 'then Li arrived', ['Li']],
  ['A4 three-letter lowercase', 'ot is sam this term', ['sam']],
  ['A5 everyday-word name', 'Rose was upset', ['Rose']],
  ['A6 no apostrophe', 'Noahs splint', ['Noah']],
  ['A6 dotted', 'email n.whitlock', ['whitlock']],
  ['A6 hyphenated half', 'the Whitlock-Tan household', ['Whitlock']],
  ['A6 double-barrelled client', 'Mr Marchetti called', ['Marchetti']],
  ['A10 nickname of someone present', 'Antony Marchetti-Lowe is known as Tony at school', ['Antony', 'Tony']],
  ['A11 initials of someone present', 'Noah Whitlock arrived; NW then left', ['Noah', 'NW']],
  // B · contact
  ['B1 email', 'send to priya.w+ot@example.com.au', ['priya.w', 'example.com']],
  ['B2 mobile spaced', 'call 0412 345 678', ['0412', '345 678']],
  ['B2 mobile +61', 'call +61 412 345 678', ['412 345']],
  ['B2 mobile dotted (record match)', 'call 0412.345.678', ['0412.345']],
  ['B2 landline with area code', 'ring (08) 9388 1234', ['9388']],
  ['B3 bare landline', 'ring 9388 1234', ['9388']],
  ['B3 bare landline run together (record match)', 'number is 93881234', ['93881234']],
  ['B2 1300', 'call 1300 123 456', ['1300 123']],
  ['B4 street address', 'lives at 12 Smith Street Subiaco WA 6008', ['12 Smith', '6008']],
  ['B4 unit address', 'Unit 4/12 Smith St', ['12 Smith']],
  ['B4 address without street type (record match)', 'visit at 12 smith tomorrow', ['12 smith']],
  ['B5 PO box', 'mail to PO Box 77 Subiaco WA 6008', ['PO Box 77', '6008']],
  ['B5 named postcode', 'postcode 6008', ['6008']],
  ['B6 client suburb (record match)', 'they live in Mount Lawley', ['Mount Lawley']],
  ['B6 listed suburb', 'family moved to Hamilton Hill last year', ['Hamilton Hill']],
  ['B6 listed suburb, one word', 'lives in Nedlands with dad', ['Nedlands']],
  ['B6 regional centre', 'relocating to Margaret River', ['Margaret River']],
  ['B7 link', 'see https://facebook.com/noah.whitlock.77', ['facebook.com']],
  ['B7 handle', 'instagram is @noah_w2019', ['noah_w2019']],
  // C · government and health
  ['C1 NDIS number', 'NDIS 431234567', ['431234567']],
  ['C1 NDIS spaced (record match)', 'participant 431 234 567', ['431 234']],
  ['C2 DOB numeric', 'DOB 03/04/2019', ['03/04/2019']],
  ['C2 DOB words', 'born 3 April 2019', ['April 2019']],
  ['C2 DOB with no cue (record match)', 'turned seven on 3.4.19', ['3.4.19']],
  ['C2 DOB ISO', 'date of birth: 2019-04-03', ['2019-04-03']],
  ['C3 Medicare grouped', 'Medicare 2123 45670 1', ['2123 45670']],
  ['C3 Medicare run together, no cue (check digit)', 'card 2123456701 sighted', ['2123456701']],
  ['C4 CRN', 'CRN 123 456 789A', ['456 789A']],
  ['C5 TFN cue', 'tax file number 876 543 210', ['876 543']],
  ['C5 TFN checksum', 'number 123 456 782 on file', ['123 456 782']],
  ['C6 IHI', 'IHI 8003 6081 6669 0503', ['8003 6081']],
  ['C7 licence', "driver's licence number 7654321", ['7654321']],
  ['C7 passport', 'passport PA1234567', ['PA1234567']],
  ['C7 health fund', 'health fund member no: 99887766', ['99887766']],
  // D · money
  ['D1 bank', 'BSB 066-000 account 12345678', ['066-000', '12345678']],
  ['D2 card', 'card 4111 1111 1111 1111', ['4111 1111']],
  ['D3 ABN', 'ABN 51 824 753 556', ['824 753']],
  // E · places and ages
  ['E1 school', 'attends Subiaco Primary School', ['Subiaco']],
  ['E1 hospital', "seen at Perth Children's Hospital", ["Perth Children"]],
  ['E1 college', "enrolled at St Mary's College", ["Mary"]],
  ['E1 employer', 'works at Brightwater Timber Pty Ltd', ['Brightwater']],
  ['E1 day program', 'goes to Rocky Bay Day Program', ['Rocky Bay']],
  ['E2 age yo', 'he is 7yo', ['7yo']],
  ['E2 age words', 'a 7 year old boy', ['7 year']],
  ['E2 age hyphen', 'a 7-year-old', ['7-year']],
  ['E2 aged', 'mum aged 41', ['41']],
  ['E2 months', 'sister is 18 months old', ['18 months']],
  ['E7 rego', 'rego 1ABC234', ['1ABC234']],
];

/** Clinical content that must come through EXACTLY as typed. */
const KEPT = [
  'Score 12/20 on the BOT-2, up from 9/20.',
  'Seen 12/09/2026 for 50 minutes at 10:30.',
  'Plan period 2025-2026, funding $19,399.50 remaining.',
  'Weight 24.5 kg, height 118 cm.',
  'Diagnosis: ASD level 2 with ADHD; trial of weighted vest 3 times per week.',
  'The rose garden on the hill was a calm space. We will review in May.',
  'Goal 3 of 4 achieved; 90 days to plan review.',
  'Occupational Therapy and Speech Pathology both recommended.',
  'OT and PT to co-treat; GP letter requested.',
  'He walked 400 m with 2 rests, pain 3/10.',
  'Martin and Wilson scales were both completed; success criteria met on the hill.',
  'Referred to the Perth clinic; travels from the South West.',
];

describe('nothing identifying survives (AUTO)', () => {
  const cases = [];
  AUTO.forEach(([label, typed, secrets]) => FRAMES.forEach((frame, i) => cases.push([`${label} · frame ${i + 1}`, frame(typed), secrets])));
  test(`the corpus is large enough to mean something (${cases.length} cases)`, () => { expect(cases.length).toBeGreaterThanOrEqual(200); });

  test.each(cases)('%s', async (_label, text, secrets) => {
    const r = await assist.check({ text });
    for (const secret of secrets) expect(r.text).not.toContain(secret);
    expect(r.hidden.length).toBeGreaterThan(0);
    // And it all comes back: every token written into the text is one the check can restore.
    const issued = new Set(r.hidden.map((h) => h.token));
    for (const m of r.text.matchAll(/\[([A-Z][A-Z_]*_\d+)\]/g)) expect(issued.has(m[1])).toBe(true);
    // The send guard agrees with the check: what it produced is clean, what was typed is not.
    expect(await assist.assertClean({ text: r.text })).toBeNull();
  });
});

describe('clinical meaning is never hidden (KEPT)', () => {
  test.each(KEPT)('%s', async (text) => {
    const r = await assist.check({ text });
    expect(r.text).toBe(text);
    expect(await assist.assertClean({ text })).toBeNull();
  });
});

describe('offered, never silently replaced', () => {
  test.each([
    ['unknown person after a title', 'Met Dr Kowalski today.', 'Kowalski'],
    ['unknown person, capitalised', 'His friend Tobias came too.', 'Tobias'],
    ['unknown person, lowercase after a cue', 'I spoke with tobias about it.', 'tobias'],
    ['misspelling of someone present', 'Noah was tired and nowah slept.', 'nowah'],
  ])('%s', async (_label, text, word) => {
    const r = await assist.check({ text });
    expect(r.candidates.map((c) => c.word)).toContain(word);
    const confirmed = await assist.check({ text, confirmedNames: [word] });
    expect(confirmed.text).not.toContain(word);
  });
});

describe('cautions are raised, not enforced', () => {
  test('a sensitive topic is named on the card', async () => {
    const r = await assist.check({ text: 'Family court orders are in place and DCP is involved.' });
    expect(r.cautions.map((c) => c.kind)).toContain('sensitive_topic');
    expect(r.text).toContain('Family court');
  });
  test('several leftover specifics together raise the combination caution', async () => {
    const r = await assist.check({ text: 'The only twin in a wheelchair at Subiaco Primary School, 7yo, seen 12/09/2026 with Zephyrine.' });
    expect(r.cautions.map((c) => c.kind)).toContain('combination');
  });
});
