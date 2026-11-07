'use strict';
/** The AI queue: a burst waits its turn instead of failing. No model, no network. */
const q = require('../ai/ai-request-queue');

const deferred = () => { let resolve; let reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const tick = () => new Promise((r) => setImmediate(r));
const throttled = () => { const e = new Error('provider_error'); e.diagnostic = { stage: 'invoke', code: 'ThrottlingException', status: 429 }; return e; };

beforeEach(() => { delete process.env.AI_MAX_CONCURRENT; delete process.env.AI_MAX_QUEUE_WAIT_MS; q._resetForTests({ sleep: async () => {} }); });

test('never more than the limit in flight, and the line moves in order', async () => {
  process.env.AI_MAX_CONCURRENT = '2';
  const gates = [deferred(), deferred(), deferred(), deferred()];
  const started = [];
  const runs = gates.map((g, i) => q.run(() => { started.push(i); return g.p; }));
  await tick();
  expect(started).toEqual([0, 1]);
  expect(q.snapshot()).toEqual(expect.objectContaining({ active: 2, waiting: 2 }));
  gates[1].resolve('b'); await tick();
  expect(started).toEqual([0, 1, 2]);
  gates[0].resolve('a'); await tick();
  expect(started).toEqual([0, 1, 2, 3]);
  gates[2].resolve('c'); gates[3].resolve('d');
  await expect(Promise.all(runs)).resolves.toEqual(['a', 'b', 'c', 'd']);
  expect(q.snapshot()).toEqual(expect.objectContaining({ active: 0, waiting: 0 }));
});

test('a burst of 20 all succeed, with at most 4 at once by default', async () => {
  let now = 0; let peak = 0;
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => q.run(async () => { now++; peak = Math.max(peak, now); await tick(); now--; return i; })));
  expect(results).toHaveLength(20);
  expect(peak).toBe(4);
});

test('a rate-limited call waits and tries again, with growing pauses', async () => {
  const pauses = [];
  q._resetForTests({ sleep: async (ms) => { pauses.push(ms); } });
  let calls = 0;
  await expect(q.run(async () => { if (++calls < 3) throw throttled(); return 'ok'; })).resolves.toBe('ok');
  expect(calls).toBe(3);
  expect(pauses).toHaveLength(2);
  expect(pauses[1]).toBeGreaterThan(pauses[0]);
});

test('it gives up after its retries, and the error says why', async () => {
  let calls = 0;
  await expect(q.run(async () => { calls++; throw throttled(); })).rejects.toThrow('provider_error');
  expect(calls).toBe(5);
  expect(q.snapshot().active).toBe(0);
});

test('never retried: other faults, guardrail stops, or once a word has been shown', async () => {
  for (const msg of ['provider_error', 'guardrail_intervened']) {
    let calls = 0;
    await expect(q.run(async () => { calls++; throw new Error(msg); })).rejects.toThrow(msg);
    expect(calls).toBe(1);
  }
  let calls = 0;
  await expect(q.run(async () => { calls++; throw throttled(); }, { canRetry: () => false })).rejects.toThrow('provider_error');
  expect(calls).toBe(1);
});

test('what counts as a rate limit', () => {
  expect(q.isRateLimited(throttled())).toBe(true);
  expect(q.isRateLimited({ diagnostic: { code: 'RateLimitError', status: null } })).toBe(true);
  expect(q.isRateLimited({ diagnostic: { code: 'ServiceUnavailableException' } })).toBe(true);
  expect(q.isRateLimited({ diagnostic: { code: 'AccessDeniedException', status: 403 } })).toBe(false);
  expect(q.isRateLimited(new Error('guardrail_intervened'))).toBe(false);
});

test('nobody waits for ever: past the wait limit the call fails as busy, and the slot still works', async () => {
  process.env.AI_MAX_CONCURRENT = '1';
  process.env.AI_MAX_QUEUE_WAIT_MS = '1000';
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  try {
    const hold = deferred();
    const first = q.run(() => hold.p);
    const waiting = q.run(async () => 'never');
    const outcome = waiting.catch((e) => e);
    jest.advanceTimersByTime(1100);
    const err = await outcome;
    expect(err.message).toBe('ai_busy');
    expect(err.aiBusy).toBe(true);
    hold.resolve('done');
    await expect(first).resolves.toBe('done');
    await expect(q.run(async () => 'next')).resolves.toBe('next');
  } finally { jest.useRealTimers(); }
});

test('a failed call always gives its slot back', async () => {
  process.env.AI_MAX_CONCURRENT = '1';
  await expect(q.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  await expect(q.run(async () => 'fine')).resolves.toBe('fine');
});
