'use strict';

/**
 * Email + link-building unit tests (Stage 1 launch blockers).
 * The load-bearing properties: every emailed link derives from APP_BASE_URL,
 * localhost can never leak outside development/test, the three delivery
 * states (sent / skipped / failed) are distinguishable, and no secret
 * material appears in results or fallback logs.
 */

const ORIGINAL_ENV = { ...process.env };

function fresh(env) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.APP_BASE_URL;
  for (const k of ['EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_FROM']) delete process.env[k];
  Object.assign(process.env, env);
  return require('../email');
}

afterEach(() => { process.env = { ...ORIGINAL_ENV }; jest.resetModules(); });

describe('getBaseUrl / buildRegisterUrl', () => {
  test('uses APP_BASE_URL verbatim (trailing slash stripped)', () => {
    const email = fresh({ APP_BASE_URL: 'https://portal.example.test/' });
    expect(email.getBaseUrl()).toBe('https://portal.example.test');
    expect(email.buildRegisterUrl('tok/1')).toBe('https://portal.example.test/register?token=tok%2F1');
  });

  test('falls back to localhost ONLY in development/test', () => {
    const email = fresh({ NODE_ENV: 'test' });
    expect(email.getBaseUrl()).toBe('http://localhost:5001');
  });

  test('REFUSES to build a localhost link in staging and production', () => {
    for (const NODE_ENV of ['staging', 'production']) {
      const email = fresh({ NODE_ENV });
      expect(() => email.getBaseUrl()).toThrow(/APP_BASE_URL/);
    }
  });
});

describe('delivery states', () => {
  test('unconfigured email → skipped:true with a usable registerUrl (no crash, no false success)', async () => {
    const email = fresh({ APP_BASE_URL: 'https://portal.example.test' });
    const result = await email.sendInviteEmail({ toEmail: 'x@y.test', inviteToken: 'tok', role: 'therapist' });
    expect(result.skipped).toBe(true);
    expect(result.sent).toBeUndefined();
    expect(result.registerUrl).toBe('https://portal.example.test/register?token=tok');
  });

  test('configured + working transporter → sent:true with messageId', async () => {
    const email = fresh({ APP_BASE_URL: 'https://portal.example.test' });
    let captured = null;
    email._setTransporterForTests({ sendMail: async (opts) => { captured = opts; return { messageId: 'mid-1' }; } });
    const result = await email.sendInviteEmail({ toEmail: 'x@y.test', inviteToken: 'tok', role: 'therapist' });
    expect(result.sent).toBe(true);
    expect(result.messageId).toBe('mid-1');
    expect(captured.html).toContain('https://portal.example.test/register?token=tok');
    expect(captured.html).not.toContain('localhost');
  });

  test('failing transporter → throws (the route converts this to emailFailed + manual link)', async () => {
    const email = fresh({ APP_BASE_URL: 'https://portal.example.test' });
    email._setTransporterForTests({ sendMail: async () => { throw new Error('SMTP 550'); } });
    await expect(email.sendInviteEmail({ toEmail: 'x@y.test', inviteToken: 'tok', role: 'therapist' }))
      .rejects.toThrow('SMTP 550');
  });
});

describe('reset + verification links follow the same base-URL rules', () => {
  test('password reset link uses APP_BASE_URL', async () => {
    const email = fresh({ APP_BASE_URL: 'https://portal.example.test' });
    let captured = null;
    email._setTransporterForTests({ sendMail: async (o) => { captured = o; return { messageId: 'm' }; } });
    await email.sendPasswordResetEmail({ toEmail: 'x@y.test', token: 'rt-1', name: 'X' });
    expect(captured.html).toContain('https://portal.example.test/');
    expect(captured.html).toContain('rt-1');
    expect(captured.html).not.toContain('localhost');
  });

  test('verification link uses APP_BASE_URL', async () => {
    const email = fresh({ APP_BASE_URL: 'https://portal.example.test' });
    let captured = null;
    email._setTransporterForTests({ sendMail: async (o) => { captured = o; return { messageId: 'm' }; } });
    await email.sendVerificationEmail({ toEmail: 'x@y.test', token: 'vt-1', name: 'X' });
    expect(captured.html).toContain('https://portal.example.test/');
    expect(captured.html).toContain('vt-1');
    expect(captured.html).not.toContain('localhost');
  });
});

describe('no secrets leak', () => {
  test('send results never contain the SMTP password; skipped-mode console output logs the link only', async () => {
    const logs = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
    try {
      const email = fresh({ APP_BASE_URL: 'https://portal.example.test', EMAIL_PASS: 'sup3r-secret-pass' });
      // PASS set but HOST/USER missing → still skipped mode
      const result = await email.sendInviteEmail({ toEmail: 'x@y.test', inviteToken: 'tok', role: 'therapist' });
      expect(JSON.stringify(result)).not.toContain('sup3r-secret-pass');
      expect(logs.join('\n')).not.toContain('sup3r-secret-pass');
    } finally { spy.mockRestore(); }
  });

  test('env-validation now treats APP_BASE_URL as boot-critical (https) in strict envs', () => {
    jest.resetModules();
    const { validateEnvironment } = require('../env-validation');
    const base = {
      NODE_ENV: 'staging', SESSION_SECRET: 'x'.repeat(40), TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
      DB_PASSWORD: 'p', ALLOWED_ORIGINS: 'https://x', MICROSOFT_CLIENT_ID: 'i',
      MICROSOFT_CLIENT_SECRET: 's', MICROSOFT_REDIRECT_URI: 'https://x/cb', SPLOSE_API_KEY: 'k',
    };
    expect(validateEnvironment(base).ok).toBe(false); // APP_BASE_URL missing
    expect(validateEnvironment({ ...base, APP_BASE_URL: 'http://insecure' }).ok).toBe(false);
    expect(validateEnvironment({ ...base, APP_BASE_URL: 'https://portal.example.test' }).ok).toBe(true);
  });
});
