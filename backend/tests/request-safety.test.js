'use strict';

/**
 * request-safety.js — the pure helpers behind login throttling (audit M-3)
 * and the OAuth return-path check (audit L-10).
 */

const {
  normaliseClientIp, createIpRateLimiter, createFailureTracker, safeReturnPath,
} = require('../request-safety');

describe('normaliseClientIp', () => {
  test.each([
    ['203.0.113.5:51001', '203.0.113.5'],
    ['203.0.113.5', '203.0.113.5'],
    ['[2001:db8::1]:443', '2001:db8::1'],
    ['[2001:DB8::1]', '2001:db8::1'],
    ['2001:DB8::1', '2001:db8::1'],
    ['::1', '::1'],
    ['::ffff:203.0.113.5', '203.0.113.5'],
    ['::FFFF:203.0.113.5', '203.0.113.5'],
    ['fe80::1%eth0', 'fe80::1'],
    ['203.0.113.5:51001, 10.0.0.1', '203.0.113.5'],
    ['  198.51.100.2  ', '198.51.100.2'],
    ['', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
  ])('%p → %p', (input, expected) => {
    expect(normaliseClientIp(input)).toBe(expected);
  });

  test('every port of one IPv4 client is one key', () => {
    const keys = new Set([1, 2, 3, 65535].map((p) => normaliseClientIp(`203.0.113.9:${p}`)));
    expect([...keys]).toEqual(['203.0.113.9']);
  });

  test('a bare IPv6 address is never truncated at its last colon', () => {
    expect(normaliseClientIp('2001:db8:0:0:0:0:0:8080')).toBe('2001:db8:0:0:0:0:0:8080');
  });
});

describe('createIpRateLimiter', () => {
  function fakeRes() {
    return {
      statusCode: 200, headers: {}, body: null,
      set(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
  }

  test('allows max requests per IP (ports ignored), then 429s with Retry-After', () => {
    const limit = createIpRateLimiter({ windowMs: 60000, max: 3, message: (s) => `wait ${s}` });
    let passed = 0;
    for (let i = 0; i < 3; i += 1) limit({ ip: `198.51.100.1:${4000 + i}` }, fakeRes(), () => { passed += 1; });
    expect(passed).toBe(3);
    const res = fakeRes();
    limit({ ip: '198.51.100.1:9999' }, res, () => { passed += 1; });
    expect(passed).toBe(3);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBeDefined();
    expect(res.body.error).toMatch(/^wait \d+$/);
    // A different client is unaffected; reset() clears everyone.
    limit({ ip: '198.51.100.2' }, fakeRes(), () => { passed += 1; });
    expect(passed).toBe(4);
    limit.reset();
    limit({ ip: '198.51.100.1' }, fakeRes(), () => { passed += 1; });
    expect(passed).toBe(5);
  });
});

describe('createFailureTracker', () => {
  test('locks after max failures, case-insensitively, and clear() unlocks', () => {
    const t = createFailureTracker({ windowMs: 60000, max: 3 });
    t.recordFailure('Ann@Example.test');
    t.recordFailure('ann@example.test ');
    expect(t.isLocked('ann@example.test')).toBe(false);
    t.recordFailure('ANN@EXAMPLE.TEST');
    expect(t.isLocked('ann@example.test')).toBe(true);
    expect(t.retryAfterSec('ann@example.test')).toBeGreaterThan(0);
    expect(t.isLocked('other@example.test')).toBe(false);
    t.clear('ann@example.test');
    expect(t.isLocked('ann@example.test')).toBe(false);
  });

  test('failures expire with the window', () => {
    jest.useFakeTimers();
    try {
      const t = createFailureTracker({ windowMs: 1000, max: 1 });
      t.recordFailure('x@example.test');
      expect(t.isLocked('x@example.test')).toBe(true);
      jest.setSystemTime(Date.now() + 1001);
      expect(t.isLocked('x@example.test')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('safeReturnPath (OAuth return URL)', () => {
  test.each([
    ['/', '/'],
    ['/#calendar', '/#calendar'],
    ['/settings?tab=integrations', '/settings?tab=integrations'],
    ['/a/b?c=d#e', '/a/b?c=d#e'],
  ])('keeps the same-origin path %p', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });

  test.each([
    ['//evil.example'],
    ['/\\evil.example'],
    ['/\\/evil.example'],
    ['\\\\evil.example'],
    ['https://evil.example/'],
    ['javascript:alert(1)'],
    ['/\tevil'],
    ['/\nevil'],
    ['evil.example'],
    [''],
    [null],
    [undefined],
    [42],
  ])('refuses %p', (input) => {
    expect(safeReturnPath(input)).toBe('/');
  });
});
