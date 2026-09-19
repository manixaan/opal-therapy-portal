'use strict';

/**
 * Opa (chat bubble + phone) sends tokens, never names: every turn is
 * de-identified inside the provider and the reply is restored in memory.
 * Synthetic names only; the gateway is mocked, nothing touches a network.
 */

jest.mock('../database', () => ({ pool: { query: jest.fn().mockResolvedValue({ rows: [] }) } }));
jest.mock('../splose-api', () => ({ isConfigured: () => false }));
jest.mock('../ai/ai-gateway', () => {
  class AiPolicyError extends Error {}
  return { AiPolicyError, isAvailable: () => true, unavailableReason: () => null, generate: jest.fn() };
});

const gateway = require('../ai/ai-gateway');
const directory = require('../assist/identity-directory');
const provider = require('../opa-provider');

const full = (role, ref, name) => { const c = directory.capitalisedVariants(name); return { role, ref, name, variants: directory.strictVariants(name), capVariants: c.cap, midOnly: c.midOnly }; };
beforeEach(() => {
  gateway.generate.mockReset();
  directory._setCacheForTests({ partial: false, entries: [full('client', 'p1', 'Johan Whitlock'), full('contact', 'c1', 'Priya Whitlock')] });
});

test('the model receives tokens for every turn, numbered consistently, and the reply comes back with names', async () => {
  gateway.generate.mockResolvedValue({ text: 'Ring [CONTACT_1] on [PHONE_1] about [CLIENT_1].' });
  const r = await provider.generateOpaResponse({
    system: 's',
    messages: [
      { role: 'user', content: 'Priya rang about Johan.' },
      { role: 'assistant', content: 'Noted for Johan.' },
      { role: 'user', content: 'Summarise what happened with Johan today. Mum is on 0412 345 678.' },
    ],
  });
  const sent = gateway.generate.mock.calls[0][0].messages.map((m) => m.content);
  expect(sent).toEqual(['[CONTACT_1] rang about [CLIENT_1].', 'Noted for [CLIENT_1].', 'Summarise what happened with [CLIENT_1] today. Mum is on [PHONE_1].']);
  expect(JSON.stringify(sent)).not.toMatch(/Johan|Priya|0412/);
  expect(r.text).toBe('Ring Priya Whitlock on 0412 345 678 about Johan Whitlock.');
});

test('a reply carrying a token this request never issued is refused', async () => {
  gateway.generate.mockResolvedValue({ text: 'Ask [CLIENT_7].' });
  await expect(provider.generateOpaResponse({ system: 's', messages: [{ role: 'user', content: 'Johan?' }] })).rejects.toThrow('content_blocked');
});

test('streaming restores a token split across chunks and never emits a raw token', async () => {
  gateway.generate.mockImplementation(async ({ onText }) => { ['See [CLI', 'ENT_1] at ', 'ten [1].'].forEach(onText); return { text: 'See [CLIENT_1] at ten [1].' }; });
  const seen = [];
  const r = await provider.generateOpaResponseStream({ system: 's', messages: [{ role: 'user', content: 'When is Johan in?' }], onText: (t) => seen.push(t) });
  expect(seen.join('')).toBe('See Johan Whitlock at ten [1].');
  expect(r.text).toBe('See Johan Whitlock at ten [1].');
});

test('if de-identification itself fails, nothing is sent', async () => {
  directory._setCacheForTests(null);
  directory.load = jest.fn().mockRejectedValue(new Error('boom'));
  await expect(provider.generateOpaResponse({ system: 's', messages: [{ role: 'user', content: 'Johan' }] })).rejects.toThrow('provider_error');
  expect(gateway.generate).not.toHaveBeenCalled();
});
