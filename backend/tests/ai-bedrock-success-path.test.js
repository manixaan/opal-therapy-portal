'use strict';

/**
 * SUCCESSFUL-RESPONSE PATH THROUGH invoke() — regression for the August 2026
 * staging incident.
 *
 * CloudTrail showed InvokeModel completing with no errorCode (real token
 * usage, guardrail applied), yet every Opa answer rendered as blocked. The
 * lesson this suite encodes: a guardrail intervention is NOT an API error.
 * It arrives inside an HTTP 200 whose CloudTrail event is indistinguishable
 * from a clean pass — the only signal is the `amazon-bedrock-guardrailAction`
 * marker in the body. So the conversion table between response shape and
 * behaviour is a contract worth pinning:
 *
 *   marker NONE / absent            → the text flows through untouched
 *   marker INTERVENED               → refused before content is read
 *   marker GUARDRAIL_INTERVENED     → refused (Converse vocabulary — this
 *                                     passed through as a CLEAN SUCCESS
 *                                     before the fix this suite guards)
 *   stop_reason mentions guardrail  → refused
 *
 * Every prior guardrail test exercised refusals that happen before
 * transmission; none pushed a successful response through invoke(), which is
 * exactly where the incident lived.
 *
 * The SDK is mocked — nothing here touches the network, AWS, or Azure.
 */

const mockBedrockState = { nextResponse: null };

jest.mock('@anthropic-ai/bedrock-sdk', () => ({
  AnthropicBedrock: class {
    constructor() {
      this.messages = { create: async () => mockBedrockState.nextResponse };
    }
  },
}));

const bedrock = require('../ai/providers/bedrock-provider');

/**
 * The staging case, shaped from the CloudTrail evidence: Sonnet 4.5 AU
 * profile, 1629 input / 308 output tokens, guardrail applied, no error.
 */
const successResponse = (extra = {}) => ({
  id: 'msg_bdrk_01RegressionOpa',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-5-20250929',
  content: [{
    type: 'text',
    text: '{"answer":"Calendar booking works from the Calendar tab.","actions":[],"confidence":0.9}',
  }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1629, output_tokens: 308 },
  ...extra,
});

const invoke = () => bedrock.invoke({
  model: 'au.anthropic.claude-sonnet-4-5-20250929-v1:0',
  region: 'ap-southeast-2',
  system: 'You are Opa.',
  messages: [{ role: 'user', content: 'how does calendar booking work?' }],
  maxTokens: 1024,
  timeoutMs: 25000,
});

let warn;

beforeEach(() => {
  process.env.BEDROCK_GUARDRAIL_ID = 'abcd1234efgh';
  process.env.BEDROCK_GUARDRAIL_VERSION = '1';
  bedrock._resetForTests();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.BEDROCK_GUARDRAIL_ID;
  delete process.env.BEDROCK_GUARDRAIL_VERSION;
  warn.mockRestore();
});

describe('clean passes are never converted into interventions', () => {
  test('guardrailAction NONE — the documented clean pass — returns the model text', async () => {
    mockBedrockState.nextResponse = successResponse({ 'amazon-bedrock-guardrailAction': 'NONE' });
    const out = await invoke();
    expect(out.text).toContain('Calendar booking works');
    expect(warn).not.toHaveBeenCalled();
  });

  test('a response with no guardrail field at all returns the model text', async () => {
    mockBedrockState.nextResponse = successResponse();
    const out = await invoke();
    expect(out.text).toContain('Calendar booking works');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('interventions are refused before content is read, in both vocabularies', () => {
  test('marker INTERVENED refuses', async () => {
    mockBedrockState.nextResponse = successResponse({ 'amazon-bedrock-guardrailAction': 'INTERVENED' });
    await expect(invoke()).rejects.toThrow('guardrail_intervened');
  });

  test('marker GUARDRAIL_INTERVENED (Converse vocabulary) also refuses — it must not fail open', async () => {
    // Before the fix this suite guards, this response flowed through as a
    // clean success: guardrail-masked text would have reached the caller.
    mockBedrockState.nextResponse = successResponse({ 'amazon-bedrock-guardrailAction': 'GUARDRAIL_INTERVENED' });
    await expect(invoke()).rejects.toThrow('guardrail_intervened');
  });

  test('a guardrail stop_reason refuses', async () => {
    mockBedrockState.nextResponse = successResponse({ stop_reason: 'guardrail_intervened' });
    await expect(invoke()).rejects.toThrow('guardrail_intervened');
  });
});

describe('an intervention is named in the log, without content', () => {
  test('the warn line records the action and stop_reason', async () => {
    mockBedrockState.nextResponse = successResponse({ 'amazon-bedrock-guardrailAction': 'INTERVENED' });
    await expect(invoke()).rejects.toThrow('guardrail_intervened');
    const logged = warn.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('guardrail intervened');
    expect(logged).toContain('action: INTERVENED');
  });

  test('the warn line never carries the response text or the user message', async () => {
    mockBedrockState.nextResponse = successResponse({ 'amazon-bedrock-guardrailAction': 'INTERVENED' });
    await expect(invoke()).rejects.toThrow('guardrail_intervened');
    const logged = warn.mock.calls.flat().map(String).join(' ');
    expect(logged).not.toContain('Calendar booking');
    expect(logged).not.toContain('calendar booking work');
  });
});
