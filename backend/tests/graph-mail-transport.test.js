'use strict';

/**
 * Email through Microsoft Graph (EMAIL_TRANSPORT=graph, 19 Oct 2026).
 * The transport is driven with a fake HTTP client: no Microsoft call is made.
 */

const gm = require('../graph-mail-transport');

const ENV = {
  EMAIL_SENDER: 'portal@opal.example',
  MICROSOFT_CLIENT_ID: 'cid', MICROSOFT_CLIENT_SECRET: 'secret', MICROSOFT_TENANT_ID: 'tenant-1',
};

function fakeHttp({ sendStatus = 202, tokenFails = false } = {}) {
  const calls = [];
  return {
    calls,
    async post(url, body, config) {
      calls.push({ url, body, config });
      if (url.includes('/oauth2/v2.0/token')) {
        if (tokenFails) { const e = new Error('401'); e.response = { status: 401, data: { error: 'invalid_client' } }; throw e; }
        return { status: 200, data: { access_token: 'tok-' + calls.length, expires_in: 3600 } };
      }
      if (sendStatus >= 300) { const e = new Error(String(sendStatus)); e.response = { status: sendStatus, data: { error: { code: 'ErrorAccessDenied' } } }; throw e; }
      return { status: sendStatus, data: '' };
    },
  };
}

describe('buildGraphMessage', () => {
  test('HTML body, recipients, the fixed sender and EMAIL_FROM display name', () => {
    const b = gm.buildGraphMessage(
      { from: 'Opal Therapy <someone@else>', to: 'a@x.test, Bea <b@x.test>', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' },
      { sender: 'portal@opal.example' });
    expect(b.saveToSentItems).toBe(true);
    expect(b.message.body).toEqual({ contentType: 'HTML', content: '<p>Hi</p>' });
    expect(b.message.toRecipients).toEqual([
      { emailAddress: { address: 'a@x.test' } },
      { emailAddress: { name: 'Bea', address: 'b@x.test' } },
    ]);
    // The mailbox is always EMAIL_SENDER — never whatever `from` claims.
    expect(b.message.from).toEqual({ emailAddress: { name: 'Opal Therapy', address: 'portal@opal.example' } });
  });

  test('text only, reply-to from settings, attachments as base64 file attachments', () => {
    const b = gm.buildGraphMessage(
      { to: ['c@x.test'], subject: 'S', text: 'plain', attachments: [{ filename: 'a.pdf', content: Buffer.from('PDF'), contentType: 'application/pdf' }] },
      { sender: 'portal@opal.example', replyTo: 'Ann <ann@opal.example>' });
    expect(b.message.body).toEqual({ contentType: 'Text', content: 'plain' });
    expect(b.message.replyTo).toEqual([{ emailAddress: { name: 'Ann', address: 'ann@opal.example' } }]);
    expect(b.message.attachments[0]).toEqual({
      '@odata.type': '#microsoft.graph.fileAttachment', name: 'a.pdf', contentType: 'application/pdf', contentBytes: Buffer.from('PDF').toString('base64'),
    });
  });

  test('refuses a message with no recipient, and attachments too big for one Graph request', () => {
    expect(() => gm.buildGraphMessage({ to: '', subject: 'x', text: 'x' }, { sender: 's@x' })).toThrow(/No recipient/);
    const big = Buffer.alloc(Math.ceil(gm.MAX_INLINE_ATTACHMENT_BYTES) + 1);
    expect(() => gm.buildGraphMessage({ to: 'a@x', text: 'x', attachments: [{ filename: 'big.pdf', content: big }] }, { sender: 's@x' }))
      .toThrow(/too large/);
  });
});

describe('createGraphTransport', () => {
  test('gets an app token, sends as the sender mailbox, and reuses the token', async () => {
    const http = fakeHttp();
    const t = gm.createGraphTransport({ env: ENV, http });
    const info = await t.sendMail({ to: 'a@x.test', subject: 'One', text: 'x' });
    await t.sendMail({ to: 'b@x.test', subject: 'Two', text: 'x' });
    const token = http.calls.filter((c) => c.url.includes('/token'));
    const sends = http.calls.filter((c) => c.url.endsWith('/sendMail'));
    expect(token).toHaveLength(1);
    expect(token[0].url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    expect(token[0].body).toContain('grant_type=client_credentials');
    expect(token[0].body).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
    expect(sends).toHaveLength(2);
    expect(sends[0].url).toBe('https://graph.microsoft.com/v1.0/users/portal%40opal.example/sendMail');
    expect(sends[0].config.headers.Authorization).toBe('Bearer tok-1');
    expect(info.messageId).toMatch(/^graph-/);
  });

  test('a refused send names the missing permission; a token failure names the app settings', async () => {
    await expect(gm.createGraphTransport({ env: ENV, http: fakeHttp({ sendStatus: 403 }) }).sendMail({ to: 'a@x', text: 'x' }))
      .rejects.toThrow(/Mail\.Send/);
    await expect(gm.createGraphTransport({ env: ENV, http: fakeHttp({ tokenFails: true }) }).sendMail({ to: 'a@x', text: 'x' }))
      .rejects.toThrow(/MICROSOFT_CLIENT_ID/);
  });

  test('configured only with the sender and all three app settings', () => {
    expect(gm.isGraphMailConfigured(ENV)).toBe(true);
    expect(gm.isGraphMailConfigured({ ...ENV, EMAIL_SENDER: '' })).toBe(false);
    expect(gm.isGraphMailConfigured({ ...ENV, MICROSOFT_CLIENT_SECRET: '' })).toBe(false);
  });
});

describe('email.js with EMAIL_TRANSPORT=graph', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; jest.resetModules(); jest.dontMock('axios'); });

  function load(env) {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    for (const k of ['EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_FROM', 'EMAIL_TRANSPORT', 'EMAIL_SENDER', 'EMAIL_REPLY_TO']) delete process.env[k];
    Object.assign(process.env, { APP_BASE_URL: 'https://portal.example.test' }, env);
    const http = fakeHttp();
    jest.doMock('axios', () => http);
    return { email: require('../email'), http };
  }

  test('an invite goes out through Graph — no SMTP settings needed', async () => {
    const { email, http } = load({ EMAIL_TRANSPORT: 'graph', ...ENV, EMAIL_FROM: 'Opal Therapy <portal@opal.example>' });
    expect(email.isEmailConfigured()).toBe(true);
    const res = await email.sendInviteEmail({ toEmail: 'new.ot@x.test', inviteToken: 'abc', role: 'therapist', inviterName: 'Ann', organisationName: 'Opal Therapy' });
    expect(res.sent).toBe(true);
    const send = http.calls.find((c) => c.url.endsWith('/sendMail'));
    expect(send.body.message.toRecipients[0].emailAddress.address).toBe('new.ot@x.test');
    expect(send.body.message.body.content).toContain('https://portal.example.test/register?token=abc');
  });

  test('graph selected but incomplete → skipped (copy-link mode), never a throw', async () => {
    const { email, http } = load({ EMAIL_TRANSPORT: 'graph', ...ENV, EMAIL_SENDER: '' });
    expect(email.isEmailConfigured()).toBe(false);
    const res = await email.sendInviteEmail({ toEmail: 'x@x.test', inviteToken: 't', role: 'therapist' });
    expect(res.skipped).toBe(true);
    expect(http.calls).toHaveLength(0);
  });
});
