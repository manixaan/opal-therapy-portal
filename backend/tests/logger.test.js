'use strict';

/**
 * Logger redaction unit tests — the backstop that keeps credentials and
 * token-shaped values out of logs and telemetry.
 */

const { redact, scrubString, createLogger, requestContext } = require('../logger');

describe('scrubString', () => {
  test('masks Bearer tokens', () => {
    expect(scrubString('auth failed: Bearer eyAbCdEf123456789012345678'))
      .toBe('auth failed: Bearer [REDACTED]');
  });

  test('masks JWT-shaped values', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.sig';
    expect(scrubString(`token=${jwt}`)).not.toContain('eyJhbGciOi');
  });

  test('masks long hex (encryption keys, hashes)', () => {
    const hex = 'a'.repeat(64);
    expect(scrubString(`key ${hex} leaked`)).toBe('key [REDACTED_HEX] leaked');
  });

  test('masks secret-bearing query params', () => {
    const url = '/auth/callback?code=SECRETCODE123&state=xyz&other=keep';
    const out = scrubString(url);
    expect(out).not.toContain('SECRETCODE123');
    expect(out).toContain('code=[REDACTED]');
    expect(out).toContain('other=keep');
  });

  test('leaves ordinary text alone', () => {
    expect(scrubString('user 42 updated event 7')).toBe('user 42 updated event 7');
  });
});

describe('redact', () => {
  test('masks sensitive keys at any depth', () => {
    const out = redact({
      userId: 'u1',
      password: 'hunter2',
      nested: { refreshToken: 'rt-abc', apiKey: 'k', okField: 'visible' },
      authorization: 'Bearer zzz',
    });
    expect(out.userId).toBe('u1');
    expect(out.password).toBe('[REDACTED]');
    expect(out.nested.refreshToken).toBe('[REDACTED]');
    expect(out.nested.apiKey).toBe('[REDACTED]');
    expect(out.nested.okField).toBe('visible');
    expect(out.authorization).toBe('[REDACTED]');
  });

  test('masks DB/session/connection variants', () => {
    const out = redact({
      DB_PASSWORD: 'x', session_id: 's', connection_string: 'c',
      client_state: 'w', SPLOSE_API_KEY: 'k',
    });
    expect(Object.values(out).every(v => v === '[REDACTED]')).toBe(true);
  });

  test('serialises Errors to name+scrubbed message only (no stack leakage)', () => {
    const out = redact(new Error('boom Bearer abcdefgh12345678'));
    expect(out).toEqual({ name: 'Error', message: 'boom Bearer [REDACTED]' });
  });

  test('scrubs token-shaped strings inside values', () => {
    const out = redact({ note: 'retry with Bearer abcdef123456789' });
    expect(out.note).toBe('retry with Bearer [REDACTED]');
  });

  test('depth-limits pathological objects instead of recursing forever', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(JSON.stringify(redact(deep))).toContain('depth-limit');
  });
});

describe('createLogger output', () => {
  test('emits scrubbed message and redacted meta to stdout', () => {
    const chunks = [];
    const orig = process.stdout.write;
    process.stdout.write = (s) => { chunks.push(String(s)); return true; };
    try {
      createLogger('test-component').info('call with Bearer abc12345678 token', {
        password: 'nope', userId: 'u9',
      });
    } finally {
      process.stdout.write = orig;
    }
    const line = chunks.join('');
    expect(line).toContain('test-component');
    expect(line).toContain('Bearer [REDACTED]');
    expect(line).not.toContain('abc12345678');
    expect(line).not.toContain('nope');
    expect(line).toContain('u9');
  });
});

describe('requestContext middleware', () => {
  function run(headers = {}) {
    const req = { get: (h) => headers[h.toLowerCase()] || undefined };
    const res = { headers: {}, set(k, v) { this.headers[k] = v; } };
    let ranNext = false;
    requestContext(req, res, () => { ranNext = true; });
    return { req, res, ranNext };
  }

  test('generates a UUID request id and sets the response header', () => {
    const { req, res, ranNext } = run();
    expect(ranNext).toBe(true);
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['X-Request-Id']).toBe(req.requestId);
  });

  test('honours a well-formed incoming X-Request-Id', () => {
    const { req } = run({ 'x-request-id': 'lb-abc123.def' });
    expect(req.requestId).toBe('lb-abc123.def');
  });

  test('rejects malformed incoming ids (header injection shapes)', () => {
    const { req } = run({ 'x-request-id': 'bad id\r\nSet-Cookie: x' });
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
