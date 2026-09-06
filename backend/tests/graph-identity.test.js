'use strict';

/**
 * MICROSOFT 365 PROVISIONING — the client that creates and closes accounts.
 *
 * What is pinned here is the order and the refusals, because they are what
 * keep the step from costing money or leaving debris:
 *
 *   - the feature is OFF until configured, and "off" is a plain-words message
 *     about the admin, not a stack trace;
 *   - the licence pool is checked BEFORE the account is created, and an empty
 *     pool creates nothing;
 *   - a taken address creates nothing;
 *   - a licence failure AFTER creation is reported, not hidden, and the
 *     account is still returned so it can be retried;
 *   - the password reaches Graph exactly once, with a forced change, and is
 *     never logged;
 *   - offboarding disables and releases, never deletes;
 *   - a 401/403 from Graph is "ask your admin", never retried.
 */

jest.mock('axios');
const axios = require('axios');

const graph = require('../graph-identity');

const ENV = {
  M365_PROVISIONING_ENABLED: 'true',
  M365_DOMAIN: 'opaltherapy.com.au',
  M365_LICENCE_SKU_BASIC: 'sku-basic',
  M365_LICENCE_SKU_FULL: 'sku-full',
  MICROSOFT_CLIENT_ID: 'client',
  MICROSOFT_CLIENT_SECRET: 'secret',
  MICROSOFT_TENANT_ID: 'tenant',
};

const saved = {};
beforeEach(() => {
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k]; }
  graph._resetTokenCache();
  axios.post.mockReset();
  axios.mockReset();
  axios.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } });
});
afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

/** Queue Graph responses in call order. Each is {data} or {status,data} to reject. */
function graphSequence(responses) {
  const calls = [];
  axios.mockImplementation(async (cfg) => {
    calls.push(cfg);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected Graph call ${cfg.method} ${cfg.url}`);
    if (next.status) {
      const err = new Error('graph'); err.response = { status: next.status, data: next.data || {} }; throw err;
    }
    return { data: next.data };
  });
  return calls;
}

const SKUS = { value: [
  { skuId: 'sku-basic', skuPartNumber: 'O365_BUSINESS_ESSENTIALS', prepaidUnits: { enabled: 5 }, consumedUnits: 4 },
  { skuId: 'sku-full', skuPartNumber: 'O365_BUSINESS_PREMIUM', prepaidUnits: { enabled: 2 }, consumedUnits: 2 },
] };

// ═════════════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═════════════════════════════════════════════════════════════════════════════

describe('configState', () => {
  test('off by default, with the admin message', () => {
    process.env.M365_PROVISIONING_ENABLED = 'false';
    const st = graph.configState();
    expect(st.ok).toBe(false);
    expect(st.code).toBe('disabled');
    expect(st.message).toMatch(/ask your Microsoft admin/i);
  });

  test('enabled but missing the secret is "misconfigured", still the admin message', () => {
    delete process.env.MICROSOFT_CLIENT_SECRET;
    const st = graph.configState();
    expect(st.ok).toBe(false);
    expect(st.code).toBe('misconfigured');
    expect(st.message).toBe(graph.ADMIN_MESSAGE);
  });

  test('a bad domain is refused', () => {
    process.env.M365_DOMAIN = 'not a domain';
    expect(graph.configState().ok).toBe(false);
  });

  test('complete configuration is ok and names the domain', () => {
    expect(graph.configState()).toMatchObject({ ok: true, domain: 'opaltherapy.com.au' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  NAMING
// ═════════════════════════════════════════════════════════════════════════════

describe('address derivation', () => {
  test.each([
    ['Jane Smith', 'jane.smith'],
    ['Jane-Marie O\'Brien', 'jane-marie.obrien'],
    ['Zoë Ångström', 'zoe.angstrom'],
    ['  Priya   Anne   Nair ', 'priya.nair'],
    ['Cher', 'cher'],
    ['', ''],
  ])('%s → %s', (name, nick) => {
    expect(graph.mailNickname(name)).toBe(nick);
  });

  test('the suggestion is on the configured domain', () => {
    expect(graph.suggestUserPrincipalName('Jane Smith')).toBe('jane.smith@opaltherapy.com.au');
  });

  test('a typed address must be on the practice domain', () => {
    expect(graph.validateUserPrincipalName('jane@gmail.com').ok).toBe(false);
    expect(graph.validateUserPrincipalName('Jane.Smith@OpalTherapy.com.au'))
      .toMatchObject({ ok: true, upn: 'jane.smith@opaltherapy.com.au', nickname: 'jane.smith' });
    expect(graph.validateUserPrincipalName('..jane@opaltherapy.com.au').ok).toBe(false);
    expect(graph.validateUserPrincipalName('').ok).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  PROVISION — order and refusals
// ═════════════════════════════════════════════════════════════════════════════

const PERSON = {
  displayName: 'Jane Smith', givenName: 'Jane', surname: 'Smith',
  upn: 'jane.smith@opaltherapy.com.au', nickname: 'jane.smith', password: 'Anchor-basket-1',
};

describe('provision', () => {
  test('an empty pool creates NOTHING and says to buy one first', async () => {
    const calls = graphSequence([{ data: SKUS }]);
    await expect(graph.provision({ ...PERSON, licenceKey: 'full' }))
      .rejects.toMatchObject({ code: 'no_licence', message: expect.stringMatching(/buy one/i) });
    expect(calls.map((c) => c.method)).toEqual(['get']);
  });

  test('a taken address creates nothing', async () => {
    const calls = graphSequence([
      { data: SKUS },
      { data: { id: 'existing', userPrincipalName: PERSON.upn } },
    ]);
    await expect(graph.provision({ ...PERSON, licenceKey: 'basic' })).rejects.toMatchObject({ code: 'upn_taken' });
    expect(calls.filter((c) => c.method === 'post')).toHaveLength(0);
  });

  test('the happy path: pool → lookup → create → licence, password sent once with a forced change', async () => {
    const calls = graphSequence([
      { data: SKUS },
      { status: 404 },
      { data: { id: 'obj-1', userPrincipalName: PERSON.upn } },
      { data: {} },
    ]);
    const out = await graph.provision({ ...PERSON, licenceKey: 'basic' });
    expect(out).toMatchObject({ objectId: 'obj-1', upn: PERSON.upn, licenceAssigned: true, licenceError: null });

    const create = calls.find((c) => c.url.endsWith('/users'));
    expect(create.data.passwordProfile).toEqual({ forceChangePasswordNextSignIn: true, password: PERSON.password });
    expect(create.data.usageLocation).toBe('AU');
    expect(create.data.userPrincipalName).toBe(PERSON.upn);

    const licence = calls.find((c) => c.url.endsWith('/assignLicense'));
    expect(licence.url).toContain('obj-1');
    expect(licence.data.addLicenses).toEqual([{ skuId: 'sku-basic', disabledPlans: [] }]);

    // The password appears in exactly one request.
    expect(calls.filter((c) => JSON.stringify(c.data || {}).includes(PERSON.password))).toHaveLength(1);
  });

  test('a licence failure after creation is reported, and the account is still returned', async () => {
    graphSequence([
      { data: SKUS },
      { status: 404 },
      { data: { id: 'obj-2', userPrincipalName: PERSON.upn } },
      { status: 400, data: { error: { code: 'Request_BadRequest', message: 'Subscription with SKU sku-basic does not have any available licenses.' } } },
    ]);
    const out = await graph.provision({ ...PERSON, licenceKey: 'basic' });
    expect(out.objectId).toBe('obj-2');
    expect(out.licenceAssigned).toBe(false);
    expect(out.licenceError.code).toBe('no_licence');
  });

  test('a 403 from Graph is "ask your admin"', async () => {
    graphSequence([{ status: 403, data: { error: { code: 'Authorization_RequestDenied' } } }]);
    await expect(graph.provision({ ...PERSON, licenceKey: 'basic' }))
      .rejects.toMatchObject({ code: 'grant_missing', message: graph.ADMIN_MESSAGE });
  });

  test('a failed token request is also the grant, never transient', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 401, data: { error: 'invalid_client' } } }));
    await expect(graph.licenceAvailability()).rejects.toMatchObject({ code: 'grant_missing' });
  });

  test('an unknown tier is refused before any call', async () => {
    const calls = graphSequence([]);
    await expect(graph.provision({ ...PERSON, licenceKey: 'gold' })).rejects.toMatchObject({ code: 'bad_request' });
    expect(calls).toHaveLength(0);
  });

  test('the app token is cached across calls', async () => {
    graphSequence([{ data: SKUS }, { data: SKUS }]);
    await graph.licenceAvailability();
    await graph.licenceAvailability();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

describe('licenceAvailability', () => {
  test('reports each configured tier with what is left', async () => {
    graphSequence([{ data: SKUS }]);
    const pool = await graph.licenceAvailability();
    expect(pool.basic).toMatchObject({ configured: true, total: 5, used: 4, available: 1 });
    expect(pool.full).toMatchObject({ configured: true, total: 2, used: 2, available: 0 });
  });

  test('an unconfigured tier is marked so, not invented', async () => {
    delete process.env.M365_LICENCE_SKU_FULL;
    graphSequence([{ data: SKUS }]);
    const pool = await graph.licenceAvailability();
    expect(pool.full).toMatchObject({ configured: false, available: 0 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  DECOMMISSION — disable and release, never delete
// ═════════════════════════════════════════════════════════════════════════════

describe('decommission', () => {
  test('disables, revokes sessions, releases every licence — and never issues a DELETE', async () => {
    const calls = graphSequence([
      { data: {} },                                    // PATCH accountEnabled
      { data: {} },                                    // revokeSignInSessions
      { data: { value: [{ skuId: 'sku-basic' }] } },   // licenseDetails
      { data: {} },                                    // assignLicense remove
    ]);
    const out = await graph.decommission('obj-1');
    expect(out).toEqual({ disabled: true, licencesReleased: 1 });
    expect(calls[0]).toMatchObject({ method: 'patch', data: { accountEnabled: false } });
    expect(calls[3].data).toEqual({ addLicenses: [], removeLicenses: ['sku-basic'] });
    expect(calls.some((c) => c.method === 'delete')).toBe(false);
  });

  test('a failed licence release still reports the disable', async () => {
    graphSequence([{ data: {} }, { data: {} }, { status: 500 }]);
    await expect(graph.decommission('obj-1')).resolves.toEqual({ disabled: true, licencesReleased: 0 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE REPORTING LINE
// ═════════════════════════════════════════════════════════════════════════════

describe('setManager', () => {
  test('puts the manager reference on the user, nothing else', async () => {
    const calls = graphSequence([{ data: {} }]);
    await expect(graph.setManager('obj-1', 'mgr-9')).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('put');
    expect(calls[0].url).toContain('/users/obj-1/manager/$ref');
    expect(calls[0].data).toEqual({ '@odata.id': 'https://graph.microsoft.com/v1.0/users/mgr-9' });
  });

  test('a missing grant is reported as grant_missing, not swallowed', async () => {
    graphSequence([{ status: 403 }]);
    await expect(graph.setManager('obj-1', 'mgr-9')).rejects.toMatchObject({ code: 'grant_missing' });
  });
});
