'use strict';

/**
 * Federation tests: managed identity → Entra token → STS → temporary AWS
 * credentials.
 *
 * No network, no AWS, no Azure. `fetchImpl` is injected everywhere, which is
 * the reason those functions take it — the exchange has to be exercisable
 * without the environment it runs in, because localhost has no App Service
 * managed identity and never will.
 *
 * Every value here is synthetic. No real ARN, tenant, audience or account id.
 */

const entra = require('../ai/aws/entra-token');
const sts = require('../ai/aws/sts-web-identity');
const creds = require('../ai/aws/credential-provider');
const config = require('../ai/aws/bedrock-config');

// ── Synthetic fixtures ──────────────────────────────────────────────────────

const FAKE_ROLE = 'arn:aws:iam::000000000000:role/OpalPortalStagingBedrockRole';
const FAKE_AUDIENCE = 'api://opal-portal-staging-test';
const FAKE_TOKEN = 'header.payload.signature';
const REGION = 'ap-southeast-2';

const ENV_KEYS = [
  'AWS_ROLE_ARN', 'AZURE_BEDROCK_AUDIENCE', 'AWS_REGION', 'BEDROCK_MODEL_ID',
  'BEDROCK_GUARDRAIL_ID', 'BEDROCK_GUARDRAIL_VERSION', 'AWS_ROLE_SESSION_NAME',
  'IDENTITY_ENDPOINT', 'IDENTITY_HEADER',
];
let saved;

function setValidEnv(overrides = {}) {
  Object.assign(process.env, {
    AWS_ROLE_ARN: FAKE_ROLE,
    AZURE_BEDROCK_AUDIENCE: FAKE_AUDIENCE,
    AWS_REGION: REGION,
    BEDROCK_MODEL_ID: 'au.anthropic.claude-test-profile',
    BEDROCK_GUARDRAIL_ID: 'gr-test-0000',
    BEDROCK_GUARDRAIL_VERSION: '1',
    IDENTITY_ENDPOINT: 'http://127.0.0.1:42424/msi/token',
    IDENTITY_HEADER: 'synthetic-identity-header',
  }, overrides);
}

const stsXml = (expiration) => `<?xml version="1.0"?>
<AssumeRoleWithWebIdentityResponse><AssumeRoleWithWebIdentityResult><Credentials>
<AccessKeyId>ASIAFAKEFAKEFAKE</AccessKeyId>
<SecretAccessKey>fakesecretfakesecret</SecretAccessKey>
<SessionToken>fakesessiontoken</SessionToken>
<Expiration>${expiration}</Expiration>
</Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`;

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const okXml = (xml) => ({ ok: true, status: 200, text: async () => xml });

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  creds._resetForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ── Configuration ───────────────────────────────────────────────────────────

describe('configuration is fail-closed', () => {
  test('every required setting is named when nothing is configured', () => {
    const r = config.resolve();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bedrock_config_incomplete');
    expect(r.missing).toEqual(expect.arrayContaining(config.REQUIRED));
  });

  test.each(config.REQUIRED)('a missing %s stops the call', (name) => {
    setValidEnv();
    delete process.env[name];
    const r = config.resolve();
    expect(r.ok).toBe(false);
    expect(r.missing).toContain(name);
  });

  test('a complete configuration resolves', () => {
    setValidEnv();
    const r = config.resolve();
    expect(r.ok).toBe(true);
    expect(r.config.roleArn).toBe(FAKE_ROLE);
    expect(r.config.region).toBe(REGION);
  });

  test('a region outside the Australia-only policy is refused before any call', () => {
    setValidEnv({ AWS_REGION: 'us-east-1' });
    expect(config.resolve()).toMatchObject({ ok: false, reason: 'region_not_permitted' });
  });

  test.each(['ap-southeast-2', 'ap-southeast-4'])('%s is permitted', (region) => {
    setValidEnv({ AWS_REGION: region });
    expect(config.resolve().ok).toBe(true);
  });

  test.each([
    ['global.anthropic.claude-x', 'global routing'],
    ['apac.anthropic.claude-x', 'apac reaches Tokyo, Seoul, Mumbai, Singapore'],
    ['anthropic.claude-x', 'no geo prefix at all'],
  ])('a non-Australian profile (%s) is refused', (modelId) => {
    setValidEnv({ BEDROCK_MODEL_ID: modelId });
    expect(config.resolve()).toMatchObject({ ok: false, reason: 'model_not_au_geo_profile' });
  });

  test('there is no default model id — it must be supplied', () => {
    setValidEnv();
    delete process.env.BEDROCK_MODEL_ID;
    // The intended profile could not be verified against the AWS account, so
    // nothing is guessed: an absent id is a hard stop, not a fallback.
    expect(config.resolve().missing).toContain('BEDROCK_MODEL_ID');
  });

  test('a malformed role ARN is refused', () => {
    setValidEnv({ AWS_ROLE_ARN: 'not-an-arn' });
    expect(config.resolve()).toMatchObject({ ok: false, reason: 'role_arn_malformed' });
  });

  test('managed identity is reported absent on a developer machine', () => {
    setValidEnv();
    delete process.env.IDENTITY_ENDPOINT;
    expect(config.hasManagedIdentity()).toBe(false);
  });
});

// ── Entra token ─────────────────────────────────────────────────────────────

describe('Entra token acquisition', () => {
  test('calls the App Service identity endpoint with the audience as resource', async () => {
    setValidEnv();
    let seenUrl = null;
    let seenHeaders = null;
    const fetchImpl = async (url, init) => {
      seenUrl = url; seenHeaders = init.headers;
      return okJson({ access_token: FAKE_TOKEN, expires_on: '1800000000' });
    };
    const out = await entra.acquire({ audience: FAKE_AUDIENCE, fetchImpl });

    expect(out.token).toBe(FAKE_TOKEN);
    expect(seenUrl).toContain(`resource=${encodeURIComponent(FAKE_AUDIENCE)}`);
    expect(seenUrl).toContain(`api-version=${entra.API_VERSION}`);
    // The identity header is the only thing authorising this call.
    expect(seenHeaders['X-IDENTITY-HEADER']).toBe('synthetic-identity-header');
  });

  test('without App Service identity it fails closed', async () => {
    setValidEnv();
    delete process.env.IDENTITY_ENDPOINT;
    await expect(entra.acquire({ audience: FAKE_AUDIENCE, fetchImpl: async () => okJson({}) }))
      .rejects.toMatchObject({ reason: 'managed_identity_unavailable' });
  });

  test('a non-200 surfaces the status only — never the body', async () => {
    setValidEnv();
    const fetchImpl = async () => ({
      ok: false, status: 400,
      json: async () => ({ error: 'invalid_resource', resource: FAKE_AUDIENCE }),
    });
    await expect(entra.acquire({ audience: FAKE_AUDIENCE, fetchImpl }))
      .rejects.toMatchObject({ reason: 'identity_endpoint_status_400' });
  });

  test('a network failure never echoes the URL (which carries the audience)', async () => {
    setValidEnv();
    const fetchImpl = async () => { throw new Error(`connect ECONNREFUSED ${FAKE_AUDIENCE}`); };
    const err = await entra.acquire({ audience: FAKE_AUDIENCE, fetchImpl }).catch((e) => e);
    expect(err.reason).toBe('network_error');
    expect(err.message).not.toContain(FAKE_AUDIENCE);
  });

  test('a response without a token is rejected', async () => {
    setValidEnv();
    await expect(entra.acquire({ audience: FAKE_AUDIENCE, fetchImpl: async () => okJson({}) }))
      .rejects.toMatchObject({ reason: 'token_missing_from_response' });
  });

  test('a missing audience is refused before any request', async () => {
    setValidEnv();
    let called = false;
    await expect(entra.acquire({ fetchImpl: async () => { called = true; return okJson({}); } }))
      .rejects.toMatchObject({ reason: 'audience_missing' });
    expect(called).toBe(false);
  });
});

// ── STS exchange ────────────────────────────────────────────────────────────

describe('STS AssumeRoleWithWebIdentity', () => {
  test('posts an unsigned form to the REGIONAL endpoint', async () => {
    let seenUrl = null; let seenBody = null;
    const fetchImpl = async (url, init) => {
      seenUrl = url; seenBody = init.body;
      return okXml(stsXml(new Date(Date.now() + 3600e3).toISOString()));
    };
    const out = await sts.assumeRole({
      roleArn: FAKE_ROLE, webIdentityToken: FAKE_TOKEN, region: REGION, fetchImpl,
    });

    expect(seenUrl).toBe(`https://sts.${REGION}.amazonaws.com/`);
    expect(seenUrl).not.toContain('sts.amazonaws.com/');   // never the global endpoint
    expect(seenBody).toContain('Action=AssumeRoleWithWebIdentity');
    expect(seenBody).toContain(encodeURIComponent(FAKE_ROLE));
    expect(out.accessKeyId).toBe('ASIAFAKEFAKEFAKE');
    expect(out.sessionToken).toBe('fakesessiontoken');
    expect(out.expiration instanceof Date).toBe(true);
  });

  test('the session name is sanitised for CloudTrail', async () => {
    let seenBody = null;
    await sts.assumeRole({
      roleArn: FAKE_ROLE, webIdentityToken: FAKE_TOKEN, region: REGION,
      sessionName: 'note for Riley Thompson/urgent',
      fetchImpl: async (_u, init) => {
        seenBody = init.body;
        return okXml(stsXml(new Date(Date.now() + 3600e3).toISOString()));
      },
    });
    const name = new URLSearchParams(seenBody).get('RoleSessionName');
    expect(name).not.toMatch(/[/\s]/);
    expect(name.length).toBeLessThanOrEqual(64);
  });

  test('an STS error surfaces the CODE, never the message', async () => {
    const fetchImpl = async () => ({
      ok: false, status: 403,
      text: async () => `<ErrorResponse><Error><Code>AccessDenied</Code>`
        + `<Message>Not authorized to perform sts:AssumeRoleWithWebIdentity on ${FAKE_ROLE}</Message>`
        + `</Error></ErrorResponse>`,
    });
    const err = await sts.assumeRole({
      roleArn: FAKE_ROLE, webIdentityToken: FAKE_TOKEN, region: REGION, fetchImpl,
    }).catch((e) => e);
    expect(err.reason).toBe('sts_AccessDenied');
    expect(err.message).not.toContain(FAKE_ROLE);
  });

  test('an unparseable expiry is refused rather than assumed', async () => {
    const fetchImpl = async () => okXml(stsXml('not-a-date'));
    await expect(sts.assumeRole({
      roleArn: FAKE_ROLE, webIdentityToken: FAKE_TOKEN, region: REGION, fetchImpl,
    })).rejects.toMatchObject({ reason: 'sts_expiration_unparseable' });
  });

  test('an incomplete credential set is refused', async () => {
    const fetchImpl = async () => okXml('<Credentials><AccessKeyId>A</AccessKeyId></Credentials>');
    await expect(sts.assumeRole({
      roleArn: FAKE_ROLE, webIdentityToken: FAKE_TOKEN, region: REGION, fetchImpl,
    })).rejects.toMatchObject({ reason: 'sts_response_incomplete' });
  });

  test('a missing web identity token is refused before any request', async () => {
    let called = false;
    await expect(sts.assumeRole({
      roleArn: FAKE_ROLE, region: REGION,
      fetchImpl: async () => { called = true; return okXml(''); },
    })).rejects.toMatchObject({ reason: 'web_identity_token_missing' });
    expect(called).toBe(false);
  });
});

// ── Caching and refresh ─────────────────────────────────────────────────────

describe('temporary credentials are cached and refreshed early', () => {
  const wire = (expiresInMs, counter) => async (url) => {
    if (String(url).includes('sts.')) {
      counter.sts += 1;
      return okXml(stsXml(new Date(Date.now() + expiresInMs).toISOString()));
    }
    counter.entra += 1;
    return okJson({ access_token: FAKE_TOKEN, expires_on: '1800000000' });
  };

  test('a fresh credential is reused without a second exchange', async () => {
    setValidEnv();
    const n = { sts: 0, entra: 0 };
    const fetchImpl = wire(3600e3, n);
    const a = await creds.getCredentials({ fetchImpl });
    const b = await creds.getCredentials({ fetchImpl });
    expect(a).toBe(b);
    expect(n.sts).toBe(1);
    expect(n.entra).toBe(1);
  });

  test('it refreshes BEFORE expiry, not after', async () => {
    setValidEnv();
    const n = { sts: 0, entra: 0 };
    const fetchImpl = wire(3600e3, n);
    await creds.getCredentials({ fetchImpl });
    // Inside the refresh margin but still technically valid: must re-exchange
    // rather than hand out a credential about to die mid-request.
    const nearExpiry = Date.now() + 3600e3 - (creds.REFRESH_MARGIN_MS - 1000);
    await creds.getCredentials({ fetchImpl, now: nearExpiry });
    expect(n.sts).toBe(2);
  });

  test('concurrent callers share one exchange', async () => {
    setValidEnv();
    const n = { sts: 0, entra: 0 };
    const fetchImpl = wire(3600e3, n);
    const [x, y, z] = await Promise.all([
      creds.getCredentials({ fetchImpl }),
      creds.getCredentials({ fetchImpl }),
      creds.getCredentials({ fetchImpl }),
    ]);
    expect(n.sts).toBe(1);
    expect(x).toBe(y);
    expect(y).toBe(z);
  });

  test('a failed exchange clears the cache and never serves a stale credential', async () => {
    setValidEnv();
    const n = { sts: 0, entra: 0 };
    await creds.getCredentials({ fetchImpl: wire(3600e3, n) });
    expect(creds.cacheStatus().cached).toBe(true);

    const failing = async (url) => (String(url).includes('sts.')
      ? { ok: false, status: 403, text: async () => '<Error><Code>AccessDenied</Code></Error>' }
      : okJson({ access_token: FAKE_TOKEN }));

    const past = Date.now() + 3600e3;   // force a refresh
    await expect(creds.getCredentials({ fetchImpl: failing, now: past })).rejects.toThrow();
    expect(creds.cacheStatus().cached).toBe(false);
  });

  test('incomplete configuration fails before any network call', async () => {
    // no env at all
    let called = false;
    await expect(creds.getCredentials({
      fetchImpl: async () => { called = true; return okJson({}); },
    })).rejects.toMatchObject({ reason: 'bedrock_config_incomplete' });
    expect(called).toBe(false);
  });

  test('cacheStatus reports a countdown, never the credential', async () => {
    setValidEnv();
    const n = { sts: 0, entra: 0 };
    await creds.getCredentials({ fetchImpl: wire(3600e3, n) });
    const status = creds.cacheStatus();
    expect(status.secondsRemaining).toBeGreaterThan(0);
    expect(JSON.stringify(status)).not.toMatch(/ASIA|fakesecret|fakesessiontoken/);
  });
});

// ── No static credentials anywhere ──────────────────────────────────────────

describe('no static AWS credentials', () => {
  test('the federation modules never read AWS key environment variables', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'ai', 'aws');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src).not.toMatch(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN/);
    }
  });
});
