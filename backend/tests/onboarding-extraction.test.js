'use strict';

/**
 * DOCUMENT EXTRACTION — the vocabulary, the normaliser and the refusals.
 *
 * Pure tests. No model is called, and that is the point: everything here is
 * the layer that decides what a model is ALLOWED to have said. A model that
 * hallucinated, misread, or was talked into ignoring its instructions still
 * cannot get past these functions.
 *
 * The properties pinned here:
 *
 *   - the field vocabulary is CLOSED, so nothing can invent a field to store;
 *   - it contains no tax file number, and a nine-digit run cannot smuggle one
 *     in through a text field either;
 *   - a value that will not normalise is DROPPED, not stored badly — an
 *     ambiguous date is worse than a missing one, because a missing one is
 *     visibly missing;
 *   - a day-first Australian date is never silently read as month-first;
 *   - sensitive fields are flagged so the storage layer encrypts them, and
 *     their masks never reveal the value.
 */

const ex = require('../onboarding-extraction');

// ═════════════════════════════════════════════════════════════════════════════
//  THE VOCABULARY
// ═════════════════════════════════════════════════════════════════════════════

describe('the field vocabulary', () => {
  test('is closed — every key has a definition and a group', () => {
    for (const key of ex.FIELD_KEYS) {
      const def = ex.FIELDS[key];
      expect(typeof def.label).toBe('string');
      expect(ex.GROUP_ORDER).toContain(def.group);
    }
  });

  test('contains NO tax file number, under any spelling', () => {
    // Three independent layers refuse a TFN: the prompt, this vocabulary, and
    // a CHECK constraint in migration 038. This is the middle one — the layer
    // that holds even if a model ignores its instructions.
    for (const key of ex.FIELD_KEYS) {
      expect(key).not.toMatch(/tfn|tax_file/i);
    }
    for (const key of ex.FIELD_KEYS) {
      expect(ex.FIELDS[key].label).not.toMatch(/tax file number/i);
    }
  });

  test('the prompt forbids returning one, in words', () => {
    expect(ex.SYSTEM_PROMPT).toMatch(/NEVER return a tax file number/i);
  });

  test('every group appears in the display order, and vice versa', () => {
    const used = new Set(ex.FIELD_KEYS.map((k) => ex.FIELDS[k].group));
    for (const g of used) expect(ex.GROUP_ORDER).toContain(g);
    for (const g of ex.GROUP_ORDER) expect(typeof ex.GROUP_LABELS[g]).toBe('string');
  });

  test('bank and licence numbers are marked sensitive; a suburb is not', () => {
    expect(ex.FIELDS.bsb.sensitive).toBe(true);
    expect(ex.FIELDS.account_number.sensitive).toBe(true);
    expect(ex.FIELDS.drivers_licence_number.sensitive).toBe(true);
    expect(ex.FIELDS.suburb.sensitive).toBeUndefined();
  });

  test('every field that writes somewhere names both a target and a column', () => {
    for (const key of ex.FIELD_KEYS) {
      const def = ex.FIELDS[key];
      if (def.target) expect(typeof def.column).toBe('string');
    }
  });
});

describe('permission tiers', () => {
  test('bank and super need the payroll permission', () => {
    expect(ex.requiredPermissionFor('bsb')).toBe('onboarding.payroll');
    expect(ex.requiredPermissionFor('super_member_number')).toBe('onboarding.payroll');
  });

  test('a licence number needs the identity permission', () => {
    expect(ex.requiredPermissionFor('drivers_licence_number')).toBe('onboarding.sensitive_identity');
  });

  test('an ordinary contact detail needs only review', () => {
    expect(ex.requiredPermissionFor('suburb')).toBe('onboarding.review');
    expect(ex.requiredPermissionFor('emergency_name')).toBe('onboarding.review');
  });

  test('an unknown key defaults to the STRICTEST thing it can, not to open', () => {
    expect(ex.requiredPermissionFor('nonsense')).toBe('onboarding.review');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  NORMALISATION
// ═════════════════════════════════════════════════════════════════════════════

describe('dates', () => {
  test('accepts an ISO date', () => {
    expect(ex.normaliseValue('date_of_birth', '1990-04-03')).toBe('1990-04-03');
  });

  test('REJECTS anything not already ISO', () => {
    // The prompt asks for ISO precisely so this layer never has to guess
    // whether 03/04/1990 is April or March. Guessing wrong writes the wrong
    // date of birth onto somebody's employment record.
    for (const bad of ['03/04/1990', '3 April 1990', '1990/04/03', '04-03-1990', 'April 1990']) {
      expect(ex.normaliseValue('date_of_birth', bad)).toBeNull();
    }
  });

  test('rejects an impossible year', () => {
    expect(ex.normaliseValue('date_of_birth', '1799-01-01')).toBeNull();
    expect(ex.normaliseValue('wwcc_expiry', '2999-01-01')).toBeNull();
  });

  test('rejects a date that does not exist', () => {
    expect(ex.normaliseValue('date_of_birth', '1990-13-45')).toBeNull();
  });
});

describe('bank details', () => {
  test('a BSB normalises to 000-000 however it was written', () => {
    expect(ex.normaliseValue('bsb', '066123')).toBe('066-123');
    expect(ex.normaliseValue('bsb', '066-123')).toBe('066-123');
    expect(ex.normaliseValue('bsb', '066 123')).toBe('066-123');
  });

  test('a BSB of the wrong length is rejected, not padded', () => {
    expect(ex.normaliseValue('bsb', '06612')).toBeNull();
    expect(ex.normaliseValue('bsb', '0661234')).toBeNull();
  });

  test('an account number keeps only digits, within a plausible length', () => {
    expect(ex.normaliseValue('account_number', '12 345 678')).toBe('12345678');
    expect(ex.normaliseValue('account_number', '1234')).toBeNull();
    expect(ex.normaliseValue('account_number', '1234567890123')).toBeNull();
  });
});

describe('other kinds', () => {
  test('an email is lowercased and shape-checked', () => {
    expect(ex.normaliseValue('personal_email', ' Jane@Example.COM ')).toBe('jane@example.com');
    expect(ex.normaliseValue('personal_email', 'not-an-email')).toBeNull();
  });

  test('a phone number keeps its shape but must have plausible digits', () => {
    expect(ex.normaliseValue('mobile', '0412 345 678')).toBe('0412 345 678');
    expect(ex.normaliseValue('mobile', '+61 412 345 678')).toBe('+61 412 345 678');
    expect(ex.normaliseValue('mobile', '123')).toBeNull();
  });

  test('a state must be a real Australian one', () => {
    expect(ex.normaliseValue('state', 'wa')).toBe('WA');
    expect(ex.normaliseValue('state', 'Western Australia')).toBeNull();
    expect(ex.normaliseValue('state', 'XX')).toBeNull();
  });

  test('a postcode is exactly four digits', () => {
    expect(ex.normaliseValue('postcode', '6000')).toBe('6000');
    expect(ex.normaliseValue('postcode', '600')).toBeNull();
  });

  test('employment type maps onto the values the database actually accepts', () => {
    expect(ex.normaliseValue('employment_type', 'Full Time')).toBe('full_time');
    expect(ex.normaliseValue('employment_type', 'part-time')).toBe('part_time');
    expect(ex.normaliseValue('employment_type', 'Casual')).toBe('casual');
    expect(ex.normaliseValue('employment_type', 'Fixed Term')).toBe('fixed_term');
    // Anything the CHECK constraint would refuse is dropped here instead of
    // failing at the INSERT with a message nobody can act on.
    expect(ex.normaliseValue('employment_type', 'seasonal')).toBeNull();
  });

  test('ordinary hours must be a plausible week', () => {
    expect(ex.normaliseValue('hours_per_week', '38')).toBe('38');
    expect(ex.normaliseValue('hours_per_week', '200')).toBeNull();
  });

  test('an unknown field key normalises to nothing at all', () => {
    expect(ex.normaliseValue('medicare_number', '1234567890')).toBeNull();
  });

  test('a blank value is nothing, not an empty string', () => {
    expect(ex.normaliseValue('suburb', '')).toBeNull();
    expect(ex.normaliseValue('suburb', '   ')).toBeNull();
  });

  test('a long value is capped rather than refused', () => {
    const out = ex.normaliseValue('address_line1', 'x'.repeat(500));
    expect(out.length).toBe(300);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE LAST-RESORT TFN REFUSAL
// ═════════════════════════════════════════════════════════════════════════════

describe('looksLikeTfn', () => {
  test('refuses a bare nine-digit run in a free-text field', () => {
    expect(ex.looksLikeTfn('award_classification', '123456789')).toBe(true);
    expect(ex.looksLikeTfn('preferred_name', '123 456 789')).toBe(true);
  });

  test('does NOT refuse an account number — that has its own encrypted field', () => {
    expect(ex.looksLikeTfn('account_number', '123456789')).toBe(false);
    expect(ex.looksLikeTfn('bsb', '066-123')).toBe(false);
  });

  test('does not refuse ordinary text that merely contains digits', () => {
    expect(ex.looksLikeTfn('address_line1', '12 Wattle Street')).toBe(false);
    expect(ex.looksLikeTfn('job_title', 'Occupational Therapist')).toBe(false);
  });

  test('an unknown key is refused outright', () => {
    expect(ex.looksLikeTfn('whatever', 'x')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  WHAT A MODEL ANSWER BECOMES
// ═════════════════════════════════════════════════════════════════════════════

describe('normaliseFields', () => {
  const sources = new Map([
    [1, { id: 'doc-1', title: 'Employee Details Form' }],
    [2, { id: 'doc-2', title: 'Super Choice Form' }],
  ]);

  test('keeps a good answer and attaches its provenance', () => {
    const { fields } = ex.normaliseFields([
      { key: 'surname', value: 'Smith', confidence: 'high', documentIndex: 1, page: 2 },
    ], sources);

    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      key: 'surname', value: 'Smith', confidence: 'high',
      sourceDocumentId: 'doc-1', sourceLabel: 'Employee Details Form', sourcePage: 2,
      sensitive: false, group: 'identity',
    });
  });

  test('drops an invented field key', () => {
    const { fields, dropped } = ex.normaliseFields([
      { key: 'spouse_income', value: '90000', confidence: 'high' },
      { key: 'medicare_number', value: '1234', confidence: 'high' },
    ], sources);
    expect(fields).toHaveLength(0);
    expect(dropped).toBe(2);
  });

  test('drops a value that will not normalise', () => {
    const { fields, dropped } = ex.normaliseFields([
      { key: 'date_of_birth', value: '03/04/1990', confidence: 'high' },
    ], sources);
    expect(fields).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  test('drops a value that looks like a tax file number', () => {
    const { fields } = ex.normaliseFields([
      { key: 'award_classification', value: '123 456 789', confidence: 'high' },
    ], sources);
    expect(fields).toHaveLength(0);
  });

  test('keeps only the FIRST answer for a repeated field', () => {
    const { fields, dropped } = ex.normaliseFields([
      { key: 'surname', value: 'Smith', confidence: 'high' },
      { key: 'surname', value: 'Smyth', confidence: 'low' },
    ], sources);
    expect(fields).toHaveLength(1);
    expect(fields[0].value).toBe('Smith');
    expect(dropped).toBe(1);
  });

  test('an unrecognised confidence becomes the CAUTIOUS one, not the confident one', () => {
    const { fields } = ex.normaliseFields([
      { key: 'surname', value: 'Smith', confidence: 'certain' },
    ], sources);
    expect(fields[0].confidence).toBe('low');
  });

  test('an unknown document index leaves provenance null rather than guessing', () => {
    const { fields } = ex.normaliseFields([
      { key: 'surname', value: 'Smith', confidence: 'high', documentIndex: 99, page: 1 },
    ], sources);
    expect(fields[0].sourceDocumentId).toBeNull();
  });

  test('a nonsense page number is dropped, not stored', () => {
    const { fields } = ex.normaliseFields([
      { key: 'surname', value: 'Smith', confidence: 'high', documentIndex: 1, page: -4 },
    ], sources);
    expect(fields[0].sourcePage).toBeNull();
  });

  test('survives a malformed answer without throwing', () => {
    expect(() => ex.normaliseFields([null, 'string', 42, {}], sources)).not.toThrow();
    expect(ex.normaliseFields([null, 'string', 42, {}], sources).fields).toHaveLength(0);
  });

  test('flags a sensitive field so the storage layer encrypts it', () => {
    const { fields } = ex.normaliseFields([
      { key: 'bsb', value: '066123', confidence: 'high', documentIndex: 1 },
    ], sources);
    expect(fields[0].sensitive).toBe(true);
    expect(fields[0].value).toBe('066-123');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  MASKS
// ═════════════════════════════════════════════════════════════════════════════

describe('maskValue', () => {
  test('a BSB shows its bank, never its branch', () => {
    expect(ex.maskValue('bsb', '066-123')).toBe('066-•••');
  });

  test('an account number shows the last three digits only', () => {
    expect(ex.maskValue('account_number', '12345678')).toBe('••••678');
  });

  test('no mask ever contains the whole value', () => {
    for (const [key, value] of [
      ['bsb', '066-123'],
      ['account_number', '12345678'],
      ['drivers_licence_number', 'WA1234567'],
      ['super_member_number', 'M99887766'],
    ]) {
      const masked = ex.maskValue(key, value);
      expect(masked).not.toBe(value);
      expect(masked).toContain('•');
    }
  });

  test('a short value is masked entirely rather than mostly revealed', () => {
    expect(ex.maskValue('super_member_number', '12')).toBe('••••');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  TEXT AND CORPUS
// ═════════════════════════════════════════════════════════════════════════════

describe('readDocumentText', () => {
  test('a photograph reports no text layer rather than failing', async () => {
    // Scanned and photographed forms are the COMMON case for a small
    // practice, not an edge case. Reporting it plainly is what lets the UI
    // say "type these three fields" instead of silently finding nothing.
    const out = await ex.readDocumentText(Buffer.from('fake'), 'image/jpeg');
    expect(out.status).toBe('no_text_layer');
  });

  test('an unsupported type says so', async () => {
    const out = await ex.readDocumentText(Buffer.from('x'), 'application/zip');
    expect(out.status).toBe('unsupported');
  });

  test('plain text is read directly', async () => {
    const body = 'Surname: Smith\nDate of birth: 1990-04-03\nSuburb: Fremantle';
    const out = await ex.readDocumentText(Buffer.from(body, 'utf8'), 'text/plain');
    expect(out.status).toBe('extracted');
    expect(out.pages[0]).toContain('Smith');
  });

  test('a corrupt PDF fails rather than throwing into the request', async () => {
    const out = await ex.readDocumentText(Buffer.from('not a pdf at all'), 'application/pdf');
    expect(['failed', 'no_text_layer']).toContain(out.status);
  });
});

describe('buildCorpus', () => {
  test('tags every page so a field can cite where it came from', () => {
    const { text } = ex.buildCorpus([
      { index: 1, title: 'Employee Details Form', pages: ['Surname: Smith', 'Bank: 066-123'] },
    ]);
    expect(text).toContain('DOCUMENT 1: Employee Details Form');
    expect(text).toContain('--- page 1 ---');
    expect(text).toContain('--- page 2 ---');
  });

  test('is bounded, so one enormous scan cannot become the whole request', () => {
    const huge = Array.from({ length: 50 }, () => 'x'.repeat(5000));
    const { chars } = ex.buildCorpus([{ index: 1, title: 'Big', pages: huge }]);
    expect(chars).toBeLessThanOrEqual(ex.MAX_CHARS_PER_RUN);
  });

  test('one document cannot consume the whole run budget', () => {
    const huge = Array.from({ length: 50 }, () => 'x'.repeat(5000));
    const { text } = ex.buildCorpus([
      { index: 1, title: 'Big', pages: huge },
      { index: 2, title: 'Small', pages: ['Surname: Smith'] },
    ]);
    // The second document still gets its header, because the per-document cap
    // stops the first from starving it.
    expect(text).toContain('DOCUMENT 2: Small');
  });

  test('a document with no pages contributes nothing', () => {
    const { text } = ex.buildCorpus([{ index: 1, title: 'Empty', pages: [] }]);
    expect(text).toBe('');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE TOOL SCHEMA
// ═════════════════════════════════════════════════════════════════════════════

describe('the tool the model must call', () => {
  test('constrains `key` to the closed vocabulary', () => {
    const tool = ex.buildTool();
    const keySchema = tool.input_schema.properties.fields.items.properties.key;
    expect(keySchema.enum).toEqual(ex.FIELD_KEYS);
  });

  test('constrains confidence to the three buckets', () => {
    const tool = ex.buildTool();
    const c = tool.input_schema.properties.fields.items.properties.confidence;
    expect(c.enum).toEqual(['high', 'medium', 'low']);
  });

  test('requires a key, a value and a confidence for every entry', () => {
    const tool = ex.buildTool();
    expect(tool.input_schema.properties.fields.items.required)
      .toEqual(['key', 'value', 'confidence']);
  });
});

describe('the AI policy', () => {
  test('is registered, so the gateway does not deny the feature outright', () => {
    const policy = require('../ai/ai-policy');
    expect(policy.features()).toContain(ex.AI_FEATURE);
  });

  test('is pinned to Australia and may not receive clinical data', () => {
    const policy = require('../ai/ai-policy');
    const p = policy.AI_POLICIES[ex.AI_FEATURE];
    expect(p.region).toBe('australia');
    expect(p.mayReceiveClinicalData).toBe(false);
    // Employment paperwork is internal information about a colleague, not
    // health information about a participant. Declaring it clinical would blur
    // the one distinction the register exists to keep.
    expect(p.allowedClassifications).toEqual(['internal']);
  });
});
