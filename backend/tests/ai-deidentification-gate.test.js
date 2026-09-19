'use strict';

/**
 * THE DE-IDENTIFICATION GATE — one rule for every Opal AI.
 *
 * A feature a clinician can type into must declare `deidentification:
 * 'required'`, and the gateway then refuses any call whose messages still
 * carry a known person, a contact detail or a record number — whatever
 * surface it came from and whatever the caller did or forgot to do. A new
 * feature cannot be registered without declaring which it is, and a
 * clinical-capable one cannot be exempt. Synthetic data; nothing leaves.
 */

jest.mock('../database', () => ({ pool: { query: jest.fn().mockResolvedValue({ rows: [] }) } }));
jest.mock('../splose-api', () => ({ isConfigured: () => false }));
const gateway = require('../ai/ai-gateway');
const policy = require('../ai/ai-policy');
const mockProvider = require('../ai/providers/mock-provider');
const audit = require('../ai/ai-audit');
const killSwitch = require('../ai/ai-kill-switch');
const mockEvents = [];
const directory = require('../assist/identity-directory');

const full = (role, ref, name) => { const c = directory.capitalisedVariants(name); return { role, ref, name, variants: directory.strictVariants(name), capVariants: c.cap, midOnly: c.midOnly }; };
let calls;
beforeEach(() => {
  process.env.AWS_REGION = 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = 'au.anthropic.test-profile-synthetic';
  delete process.env.AI_GLOBAL_DISABLE;
  mockEvents.length = 0; calls = 0;
  audit._setSinkForTests(async (payload) => { mockEvents.push(payload); });
  killSwitch._setReaderForTests(async () => 'true');
  directory._setCacheForTests({ partial: false, entries: [full('client', 'p1', 'Johan Whitlock')] });
  mockProvider._setHandlerForTests(async () => { calls++; return { text: 'ok', toolUse: null, providerRequestId: 'x', sourceRegion: 'ap-southeast-2' }; });
});

const CLINICIAN_FEATURES = ['clinical_note_generation', 'opa_assistant', 'opal_assist'];

describe.each(CLINICIAN_FEATURES)('%s', (feature) => {
  const base = { feature, modelKey: 'mock', userId: 'u1', system: 's' };

  test.each([
    ['a known client name', 'Summarise what happened with Johan today.', 'known_name_present'],
    ['a phone number', 'Mum is on 0412 345 678.', 'contact_detail_present'],
    ['a birth date', 'DOB 03/04/2019.', 'contact_detail_present'],
    ['a name buried in an earlier turn', null, 'known_name_present'],
  ])('refuses %s in the clear, audits the denial, and never reaches the model', async (_label, text, code) => {
    const messages = text ? [{ role: 'user', content: text }]
      : [{ role: 'user', content: 'Johan was late.' }, { role: 'assistant', content: 'Noted.' }, { role: 'user', content: 'And then?' }];
    await expect(gateway.generate({ ...base, messages })).rejects.toMatchObject({ reason: `not_deidentified:${code}` });
    expect(calls).toBe(0);
    expect(mockEvents[0].event).toMatchObject({ feature, status: 'denied', denyReason: `not_deidentified:${code}` });
    expect(JSON.stringify(mockEvents)).not.toMatch(/Johan|0412|2019/);
  });

  test('passes tokenised text', async () => {
    await gateway.generate({ ...base, messages: [{ role: 'user', content: '[CLIENT_1] was late; ring [PHONE_1]. Aged 7, seen 12/09/2026.' }] });
    expect(calls).toBe(1);
  });

  test('refuses content it cannot read as text', async () => {
    await expect(gateway.generate({ ...base, messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }] })).rejects.toMatchObject({ reason: 'not_deidentified:uncheckable_content' });
    expect(calls).toBe(0);
  });
});

describe('the policy table', () => {
  test('every feature declares de-identification; every clinical-capable one requires it', () => {
    for (const feature of Object.keys(policy.AI_POLICIES)) {
      const p = policy.get(feature);
      const exempt = p.deidentification && typeof p.deidentification === 'object';
      expect(p.deidentification === 'required' || exempt).toBe(true);
      if (p.mayReceiveClinicalData) expect(p.deidentification).toBe('required');
    }
    CLINICIAN_FEATURES.forEach((f) => expect(policy.get(f).deidentification).toBe('required'));
  });
});
