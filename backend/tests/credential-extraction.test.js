'use strict';

/**
 * CREDENTIAL SCAN EXTRACTION — what the reader may return, and what it may not.
 *
 * The defect this file exists to prevent is not "the model misread a date". It
 * is a misread date that arrives looking like a fact. So the assertions
 * cluster around three things:
 *
 *   1. the CLOSED vocabulary — a licence's date of birth and address must not
 *      survive parsing, whatever the model returns;
 *   2. date handling — an ambiguous date is dropped, never guessed, because a
 *      transposed day and month is a wrong expiry that looks right;
 *   3. honest failure — a guardrail refusal, a policy denial and an unreadable
 *      photograph are three different answers and must not collapse into one.
 */

const path = require('path');
const fs = require('fs');

const extraction = require('../credential-extraction');
const mockProvider = require('../ai/providers/bedrock-provider') && require('../ai/providers/mock-provider');
const audit = require('../ai/ai-audit');
const killSwitch = require('../ai/ai-kill-switch');

const SYNTHETIC_PROFILE = 'au.anthropic.claude-sonnet-4-5-20250929-v1:0';

let savedRegion;
let savedProfile;

beforeEach(() => {
  savedRegion = process.env.AWS_REGION;
  savedProfile = process.env.BEDROCK_MODEL_ID;
  process.env.AWS_REGION = 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = SYNTHETIC_PROFILE;
  delete process.env.AI_GLOBAL_DISABLE;
  audit._setSinkForTests(async () => {});
  killSwitch._setReaderForTests(async () => 'true');
  mockProvider._setHandlerForTests(null);
});

afterEach(() => {
  if (savedRegion === undefined) delete process.env.AWS_REGION; else process.env.AWS_REGION = savedRegion;
  if (savedProfile === undefined) delete process.env.BEDROCK_MODEL_ID; else process.env.BEDROCK_MODEL_ID = savedProfile;
  audit._setSinkForTests(null);
  killSwitch._setReaderForTests(null);
  mockProvider._setHandlerForTests(null);
});

/** A minimal but genuine JPEG/PNG header, so the sniffer sees real bytes. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3),
]);

const asImage = (buf) => ({ data: buf.toString('base64'), mime: 'image/jpeg' });

/** Answer as the model would, through the forced tool. */
function respondWith(input) {
  mockProvider._setHandlerForTests(async () => ({
    text: null,
    toolUse: { type: 'tool_use', name: 'record_credential', input },
    providerRequestId: 'mock-request-id',
    sourceRegion: 'ap-southeast-2',
    usage: { inputTokens: 10, outputTokens: 5 },
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
//  THE CLOSED VOCABULARY
// ═══════════════════════════════════════════════════════════════════════════

describe('the field vocabulary', () => {
  test('carries no key for the personal data a licence happens to show', () => {
    const forbidden = ['date_of_birth', 'dob', 'address', 'residential_address',
      'signature', 'photo', 'photograph', 'medicare_number', 'tax_file_number', 'tfn'];
    for (const key of forbidden) {
      expect(extraction.FIELD_KEYS).not.toContain(key);
    }
  });

  test('only the credential columns are writable; the rest is review-only', () => {
    expect(extraction.TARGET_FIELDS).toEqual([
      'credential_type', 'credential_name', 'issuing_body',
      'registration_number', 'issue_date', 'expiry_date',
    ]);
    expect(extraction.TARGET_FIELDS).not.toContain('holder_name');
    expect(extraction.TARGET_FIELDS).not.toContain('document_kind');
  });

  test('the prompt forbids the personal data outright, not merely by omission', () => {
    // Whitespace-collapsed: the prompt is a wrapped array of lines, and a
    // phrase split across two of them is still the phrase.
    const prompt = extraction.SYSTEM_PROMPT.toLowerCase().replace(/\s+/g, ' ');
    expect(prompt).toContain('date of birth');
    expect(prompt).toContain('address');
    expect(prompt).toContain('tax file number');
    expect(prompt).toContain('never');
  });

  test('a value under an unknown key does not survive parsing', () => {
    const { fields } = extraction.normaliseProposal({
      date_of_birth: { value: '1988-03-04', confidence: 'high' },
      residential_address: { value: '14 Example St', confidence: 'high' },
      expiry_date: { value: '2029-05-01', confidence: 'high' },
    });
    expect(Object.keys(fields)).toEqual(['expiry_date']);
  });

  test('the tool schema offers the model no field outside the vocabulary', () => {
    const tool = extraction.buildTool();
    const offered = Object.keys(tool.input_schema.properties)
      .filter((k) => k !== 'unreadable' && k !== 'notes');
    expect(offered.sort()).toEqual([...extraction.FIELD_KEYS].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  DATES — the field where a plausible wrong answer does real damage
// ═══════════════════════════════════════════════════════════════════════════

describe('date normalisation', () => {
  test('accepts ISO', () => {
    expect(extraction.normaliseDate('2029-05-01')).toBe('2029-05-01');
  });

  test('accepts an unambiguous written date', () => {
    expect(extraction.normaliseDate('1 May 2029')).toBe('2029-05-01');
    expect(extraction.normaliseDate('01 September 2027')).toBe('2027-09-01');
  });

  test('REFUSES a slash date, because day-first cannot be verified', () => {
    // 03/04/2029 is 3 April in Australia and 4 March in the United States.
    // A model that ignored the ISO instruction is exactly the model whose
    // day/month order cannot be trusted, and a transposed expiry is the worst
    // defect this feature could ship.
    expect(extraction.normaliseDate('03/04/2029')).toBeNull();
    expect(extraction.normaliseDate('3/4/29')).toBeNull();
  });

  test('refuses a date that does not exist', () => {
    expect(extraction.normaliseDate('2029-02-31')).toBeNull();
    expect(extraction.normaliseDate('2029-13-01')).toBeNull();
  });

  test('refuses a year outside a credential\'s plausible life', () => {
    expect(extraction.normaliseDate('1899-01-01')).toBeNull();
    expect(extraction.normaliseDate('2200-01-01')).toBeNull();
  });

  test('an expiry that precedes its issue date is flagged, not silently kept', () => {
    const { fields, warnings } = extraction.normaliseProposal({
      issue_date: { value: '2029-05-01', confidence: 'high' },
      expiry_date: { value: '2024-05-01', confidence: 'high' },
    });
    expect(warnings.join(' ')).toMatch(/not after its issue date/i);
    expect(fields.expiry_date.confidence).toBe('low');
    expect(fields.issue_date.confidence).toBe('low');
  });

  test('an implausibly distant expiry is flagged', () => {
    const year = new Date().getUTCFullYear() + 40;
    const { fields, warnings } = extraction.normaliseProposal({
      expiry_date: { value: `${year}-01-01`, confidence: 'high' },
    });
    expect(warnings.join(' ')).toMatch(/25 years/i);
    expect(fields.expiry_date.confidence).toBe('low');
  });
});

describe('other value normalisation', () => {
  test('a credential type outside the practice vocabulary is dropped', () => {
    expect(extraction.normaliseValue('credential_type', 'wwcc')).toBe('wwcc');
    expect(extraction.normaliseValue('credential_type', 'WWCC')).toBe('wwcc');
    expect(extraction.normaliseValue('credential_type', 'wizard_licence')).toBeNull();
  });

  test('the older spelling of a type is folded, not rejected', () => {
    // Onboarding writes `ahpra_registration`; the profile dialog used to write
    // `ahpra`. Both are in the table, and a screen that knows one spelling
    // renders the other as a raw database string.
    expect(extraction.canonicalType('ahpra')).toBe('ahpra_registration');
    expect(extraction.canonicalType('ndis_screening')).toBe('ndis_worker_screening');
    expect(extraction.canonicalType('police_clearance')).toBe('police_check');
    expect(extraction.canonicalType('indemnity_insurance')).toBe('professional_indemnity');
    expect(extraction.canonicalType('wizard_licence')).toBeNull();
  });

  test('every type onboarding can write is a type this vocabulary knows', () => {
    // The list a compliance requirement template may carry (onboarding-catalogue).
    for (const key of ['ahpra_registration', 'qualification', 'professional_indemnity',
      'ndis_worker_screening', 'wwcc', 'police_check', 'drivers_licence']) {
      expect(extraction.CREDENTIAL_TYPE_KEYS).toContain(key);
    }
  });

  test('a registration number is a number, not a sentence', () => {
    expect(extraction.normaliseValue('registration_number', ' occ0012345 ')).toBe('OCC0012345');
    expect(extraction.normaliseValue('registration_number', 'WWC-1234/56')).toBe('WWC-1234/56');
    expect(extraction.normaliseValue('registration_number', 'WWC 1234567')).toBe('WWC1234567');
    // The failure that actually happens: the sentence beside the label,
    // returned instead of the number.
    expect(extraction.normaliseValue('registration_number', 'see attached letter')).toBeNull();
    expect(extraction.normaliseValue('registration_number', 'not printed on this certificate')).toBeNull();
    expect(extraction.normaliseValue('registration_number', 'A')).toBeNull();
  });

  test('an unrecognised confidence degrades to low rather than to trusted', () => {
    const { fields } = extraction.normaliseProposal({
      issuing_body: { value: 'AHPRA', confidence: 'certain' },
    });
    expect(fields.issuing_body.confidence).toBe('low');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  IMAGES — client-supplied bytes, treated as such
// ═══════════════════════════════════════════════════════════════════════════

describe('page images', () => {
  test('bytes are sniffed, not believed', () => {
    expect(extraction.sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(extraction.sniffImageMime(PNG)).toBe('image/png');
    expect(extraction.sniffImageMime(Buffer.from('%PDF-1.4 not an image at all'))).toBeNull();
  });

  test('a file claiming to be an image but is not is rejected', () => {
    const { images, rejected } = extraction.prepareImages([
      { data: Buffer.from('%PDF-1.4 nope nope nope').toString('base64'), mime: 'image/jpeg' },
    ]);
    expect(images).toHaveLength(0);
    expect(rejected).toContain('not_an_image');
  });

  test('an oversized image is dropped rather than sent', () => {
    const huge = Buffer.concat([JPEG, Buffer.alloc(extraction.MAX_IMAGE_BYTES + 1024, 9)]);
    const { images, rejected } = extraction.prepareImages([asImage(huge)]);
    expect(images).toHaveLength(0);
    expect(rejected).toContain('too_large');
  });

  test('the page count is capped — a credential is not a twenty-page report', () => {
    const many = Array.from({ length: 9 }, () => asImage(JPEG));
    const { images, rejected } = extraction.prepareImages(many);
    expect(images).toHaveLength(extraction.MAX_PAGE_IMAGES);
    expect(rejected).toContain('too_many_pages');
  });

  test('one bad page does not lose the good ones', () => {
    const { images } = extraction.prepareImages([
      { data: 'not base64 at all !!!', mime: 'image/jpeg' },
      asImage(JPEG),
    ]);
    expect(images).toHaveLength(1);
  });
});

describe('the message sent to the model', () => {
  test('carries the image as an image block with its sniffed media type', () => {
    const messages = extraction.buildMessages({
      images: [{ mediaType: 'image/png', data: PNG.toString('base64') }],
      text: '',
    });
    const blocks = messages[0].content;
    const image = blocks.find((b) => b.type === 'image');
    expect(image.source.type).toBe('base64');
    expect(image.source.media_type).toBe('image/png');
  });

  test('the type a person chose is offered as a hint, never as an instruction', () => {
    const messages = extraction.buildMessages({
      images: [{ mediaType: 'image/jpeg', data: JPEG.toString('base64') }],
      text: '', credentialTypeHint: 'wwcc',
    });
    const text = messages[0].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    expect(text).toMatch(/hint only/i);
    expect(text).toMatch(/if the document says otherwise/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE READ ITSELF
// ═══════════════════════════════════════════════════════════════════════════

describe('extract()', () => {
  test('proposes the fields the model returned, normalised', async () => {
    respondWith({
      credential_type: { value: 'wwcc', confidence: 'high' },
      credential_name: { value: 'Working with Children Check', confidence: 'high' },
      registration_number: { value: 'wwc1234567', confidence: 'medium' },
      expiry_date: { value: '2029-05-01', confidence: 'high' },
      date_of_birth: { value: '1988-03-04', confidence: 'high' },
      notes: 'Card front only.',
    });

    const result = await extraction.extract({
      pageImages: [asImage(JPEG)], modelKey: 'mock',
      userId: '11111111-1111-1111-1111-111111111111',
    });

    expect(result.status).toBe('proposed');
    expect(result.sourceKind).toBe('image');
    expect(result.fields.registration_number.value).toBe('WWC1234567');
    expect(result.fields.expiry_date.value).toBe('2029-05-01');
    expect(result.fields).not.toHaveProperty('date_of_birth');
  });

  test('an unreadable document is reported as unreadable, not as empty success', async () => {
    respondWith({ unreadable: true, notes: 'The photograph is too dark to read.' });
    const result = await extraction.extract({
      pageImages: [asImage(JPEG)], modelKey: 'mock', userId: null,
    });
    expect(result.status).toBe('unreadable');
    expect(result.fields).toEqual({});
    expect(result.notes).toMatch(/too dark/);
  });

  test('a guardrail refusal is its own answer — expected on identity documents', async () => {
    mockProvider._setHandlerForTests(async () => { throw new Error('guardrail_intervened'); });
    const result = await extraction.extract({
      pageImages: [asImage(JPEG)], modelKey: 'mock', userId: null,
    });
    expect(result.status).toBe('refused');
    expect(result.fields).toEqual({});
  });

  test('AI switched off returns unavailable, and never throws at the caller', async () => {
    process.env.AI_GLOBAL_DISABLE = 'true';
    const result = await extraction.extract({
      pageImages: [asImage(JPEG)], modelKey: 'mock', userId: null,
    });
    expect(result.status).toBe('unavailable');
    delete process.env.AI_GLOBAL_DISABLE;
  });

  test('nothing to read means no model call at all', async () => {
    let called = false;
    mockProvider._setHandlerForTests(async () => { called = true; return { text: null, toolUse: null }; });
    const result = await extraction.extract({ pageImages: [], modelKey: 'mock', userId: null });
    expect(called).toBe(false);
    expect(result.status).toBe('unreadable');
    expect(result.sourceKind).toBe('unknown');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  MISMATCHED HOLDER — the case that catches the wrong certificate
// ═══════════════════════════════════════════════════════════════════════════

describe('holder name checking', () => {
  test('tolerates the ways a real name legitimately differs', () => {
    expect(extraction.holderNameMismatch('Jane Elizabeth Smith', 'Jane Smith')).toBe(false);
    expect(extraction.holderNameMismatch('SMITH, Jane', 'Jane Smith')).toBe(false);
    expect(extraction.holderNameMismatch('Jane Smith', 'Jane Smith-Okafor')).toBe(false);
  });

  test('flags a certificate that shares nothing with the account name', () => {
    expect(extraction.holderNameMismatch('Priya Raman', 'Jane Smith')).toBe(true);
  });

  test('says nothing when there is nothing to compare', () => {
    expect(extraction.holderNameMismatch('', 'Jane Smith')).toBe(false);
    expect(extraction.holderNameMismatch('Jane Smith', '')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE BOUNDARY
// ═══════════════════════════════════════════════════════════════════════════

test('the module reaches a model only through the gateway', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'credential-extraction.js'), 'utf8');
  expect(source).toMatch(/require\('\.\/ai\/ai-gateway'\)/);
  expect(source).not.toMatch(/@anthropic-ai|bedrock-runtime|BedrockRuntimeClient|openai/);
});

test('the feature has a policy, so the gateway does not deny it outright', () => {
  const policy = require('../ai/ai-policy');
  const entry = policy.get(extraction.AI_FEATURE);
  expect(entry).toBeTruthy();
  expect(entry.region).toBe('australia');
  expect(entry.mayReceiveClinicalData).toBe(false);
  // Its own audit category: "has an image of a staff identity document ever
  // reached a model?" must be answerable without reading code.
  expect(entry.auditCategory).toBe('credential_extraction');
});
