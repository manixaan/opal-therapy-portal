'use strict';

/**
 * De-identification through the REAL gateway to the mock provider: what the
 * model is shown, what comes back, and what is refused.
 */

const provider = require('../clinical-note-provider');
const audit = require('../ai/ai-audit');
const mockProvider = require('../ai/providers/mock-provider');

const ENV_KEYS = ['CLINICAL_NOTE_AI_ENABLED', 'AWS_REGION', 'BEDROCK_MODEL_ID'];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.CLINICAL_NOTE_AI_ENABLED = 'true';
  process.env.AWS_REGION = 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = 'au.anthropic.test-profile-synthetic';
  provider._setProviderForTests(null);
  audit._setSinkForTests(async () => {});
  mockProvider._setHandlerForTests(null);
});
afterEach(() => {
  ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  provider._setProviderForTests(null);
  audit._setSinkForTests(null);
  mockProvider._setHandlerForTests(null);
});

const identity = {
  people: [{ name: 'Aiden Blackwood-Tan', role: 'client' }, { name: 'Sam Okafor', role: 'therapist' }],
  confirmedNames: ['Tobias'],
  ignoredWords: [],
};
const TRANSCRIPT = "Aiden arrived on time. Aiden's mum said he slept well. He played with Tobias. Sam Okafor led the session.";

const base = () => ({
  transcript: TRANSCRIPT, styleVersion: 'OPAL_CASE_NOTE_STYLE_V1',
  session: { dateLabel: '10/08/2026', serviceLabel: 'Therapy Session' }, modelKey: 'mock', identity,
});

test('the model is shown tokens, told to keep them, and the draft comes back with names restored', async () => {
  let shown = null;
  mockProvider._setHandlerForTests(async ({ system, messages }) => {
    shown = { system, user: messages[0].content };
    return {
      text: null, providerRequestId: 'r', sourceRegion: 'ap-southeast-2', usage: { inputTokens: null, outputTokens: null },
      toolUse: { type: 'tool_use', name: 'case_note', input: {
        identify: '[CLIENT] attended with [CLIENT]\'s mother.',
        sessionDetails: '[CLIENT] played with [PERSON]; [THERAPIST] facilitated.',
        plan: ['Follow up with [PERSON]\'s teacher'], warnings: [],
      } },
    };
  });
  const out = await provider.generateCaseNote(base());

  // Nothing named crossed the gateway.
  expect(shown.user).not.toMatch(/Aiden|Blackwood|Okafor|Tobias/);
  expect(shown.user).toContain("[CLIENT]'s mum");
  expect(shown.user).toContain('with [PERSON]');
  expect(shown.user).toContain('[THERAPIST] led');
  expect(shown.system).toContain('PEOPLE ARE TOKENISED');

  // Names are back in every section.
  expect(out.identify).toBe("Aiden Blackwood-Tan attended with Aiden Blackwood-Tan's mother.");
  expect(out.sessionDetails).toBe('Aiden Blackwood-Tan played with Tobias; Sam Okafor facilitated.');
  expect(out.plan).toEqual(["Follow up with Tobias's teacher"]);
  expect(out.deidentification).toEqual({
    tokens: [{ token: 'CLIENT', role: 'client', count: 2 }, { token: 'THERAPIST', role: 'therapist', count: 1 }, { token: 'PERSON', role: 'person', count: 1 }],
    candidateCount: 0, version: 1,
  });
});

test('a token the model invented refuses the whole draft', async () => {
  mockProvider._setHandlerForTests(async () => ({
    text: null, providerRequestId: 'r', sourceRegion: 'ap-southeast-2', usage: { inputTokens: null, outputTokens: null },
    toolUse: { type: 'tool_use', name: 'case_note', input: {
      identify: '[CLIENT] attended.', sessionDetails: '[CLIENT_UNCLE] collected him.', plan: [], warnings: [],
    } },
  }));
  await expect(provider.generateCaseNote(base())).rejects.toThrow('names_not_hidden');
});

test('a known name reappearing in the clear refuses the draft', async () => {
  mockProvider._setHandlerForTests(async () => ({
    text: null, providerRequestId: 'r', sourceRegion: 'ap-southeast-2', usage: { inputTokens: null, outputTokens: null },
    toolUse: { type: 'tool_use', name: 'case_note', input: {
      identify: 'Aiden Blackwood-Tan attended.', sessionDetails: '[CLIENT] was calm.', plan: [], warnings: [],
    } },
  }));
  await expect(provider.generateCaseNote(base())).rejects.toThrow('names_not_hidden');
});

test('without an identity the transcript travels as before (legacy callers)', async () => {
  let shown = null;
  mockProvider._setHandlerForTests(async ({ system, messages }) => {
    shown = { system, user: messages[0].content };
    return {
      text: null, providerRequestId: 'r', sourceRegion: 'ap-southeast-2', usage: { inputTokens: null, outputTokens: null },
      toolUse: { type: 'tool_use', name: 'case_note', input: { identify: 'x', sessionDetails: 'y', plan: [], warnings: [] } },
    };
  });
  const { identity: _omit, ...noIdentity } = base();
  const out = await provider.generateCaseNote(noIdentity);
  expect(shown.user).toContain('Aiden');
  expect(shown.system).not.toContain('PEOPLE ARE TOKENISED');
  expect(out.deidentification).toBeNull();
});

test('previewNames answers without any model call', async () => {
  let reached = false;
  mockProvider._setHandlerForTests(async () => { reached = true; return { text: null, toolUse: null }; });
  const p = provider.previewNames({ transcript: 'Aiden played with Tobias and Kofi.', identity: { ...identity, confirmedNames: [] } });
  expect(reached).toBe(false);
  expect(p.text).toBe('[CLIENT] played with Tobias and Kofi.');
  expect(p.hidden).toEqual([{ token: 'CLIENT', label: 'Client', count: 1 }]);
  expect(p.candidates.map((c) => c.word)).toEqual(['Tobias', 'Kofi']);
});
