'use strict';

/** Warm-up and the single silent retry: glitches are absorbed, decisions never are. */

jest.mock('../database', () => ({ pool: { query: jest.fn().mockResolvedValue({ rows: [] }) } }));
jest.mock('../splose-api', () => ({ isConfigured: () => false }));
jest.mock('../ai/ai-gateway', () => {
  class AiPolicyError extends Error { constructor(r) { super('ai_denied'); this.reason = r; } }
  return { AiPolicyError, isAvailable: jest.fn(() => true), unavailableReason: () => null, generate: jest.fn() };
});

const gateway = require('../ai/ai-gateway');
const warmup = require('../assist/warmup');
const opa = require('../opa-provider');
const assistProvider = require('../assist/assist-provider');

beforeEach(() => { gateway.generate.mockReset(); process.env.OPA_AI_ENABLED = 'true'; process.env.OPAL_ASSIST_ENABLED = 'true'; });
afterEach(() => { delete process.env.OPA_AI_ENABLED; delete process.env.OPAL_ASSIST_ENABLED; });

test('the warm-up call is a fixed synthetic string with no user, through the normal gateway', async () => {
  gateway.generate.mockResolvedValue({ text: 'ready' });
  await warmup.warmModel();
  const call = gateway.generate.mock.calls[0][0];
  expect(call).toMatchObject({ feature: 'opa_assistant', messages: [{ role: 'user', content: 'ready?' }] });
  expect(call.userId).toBeUndefined();
  expect(warmup.status()).toMatchObject({ model_ready: true, last_reason: null });
});

test('a failed warm-up records a reason and throws nothing; with every AI switched off it does not call at all', async () => {
  gateway.generate.mockRejectedValue(new Error('provider_error'));
  await expect(warmup.warmModel()).resolves.toBeUndefined();
  expect(warmup.status()).toMatchObject({ model_ready: false, last_reason: 'model:provider_error' });
  gateway.generate.mockClear(); delete process.env.OPA_AI_ENABLED; delete process.env.OPAL_ASSIST_ENABLED;
  await warmup.warmModel();
  expect(gateway.generate).not.toHaveBeenCalled();
});

test('Opa: one dropped connection is retried and the person sees the answer', async () => {
  gateway.generate.mockRejectedValueOnce(new Error('provider_error')).mockResolvedValueOnce({ text: 'Yes.' });
  expect((await opa.generateOpaResponse({ system: 's', messages: [{ role: 'user', content: 'do you work?' }] })).text).toBe('Yes.');
  expect(gateway.generate).toHaveBeenCalledTimes(2);
});

test('a second failure is reported; a guardrail refusal and a policy denial are never retried', async () => {
  gateway.generate.mockRejectedValue(new Error('provider_error'));
  await expect(opa.generateOpaResponse({ system: 's', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow('provider_error');
  expect(gateway.generate).toHaveBeenCalledTimes(2);

  gateway.generate.mockReset(); gateway.generate.mockRejectedValue(new Error('guardrail_intervened'));
  await expect(opa.generateOpaResponse({ system: 's', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow('content_blocked');
  expect(gateway.generate).toHaveBeenCalledTimes(1);

  gateway.generate.mockReset(); gateway.generate.mockRejectedValue(new gateway.AiPolicyError('not_deidentified:known_name_present'));
  await expect(assistProvider.generate({ system: 's', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow('provider_error');
  expect(gateway.generate).toHaveBeenCalledTimes(1);
});

test('streaming is retried only while nothing has been shown', async () => {
  gateway.generate.mockImplementationOnce(async () => { throw new Error('provider_error'); })
    .mockImplementationOnce(async ({ onText }) => { onText('Hello there '); return { text: 'Hello there' }; });
  const seen = [];
  await assistProvider.generate({ system: 's', messages: [], onText: (t) => seen.push(t) });
  expect(seen.join('')).toBe('Hello there ');

  gateway.generate.mockReset();
  gateway.generate.mockImplementation(async ({ onText }) => { onText('Half an answer '); throw new Error('provider_error'); });
  await expect(assistProvider.generate({ system: 's', messages: [], onText: () => {} })).rejects.toThrow('provider_error');
  expect(gateway.generate).toHaveBeenCalledTimes(1);
});
