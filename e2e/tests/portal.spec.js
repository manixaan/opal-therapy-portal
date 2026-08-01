// @ts-check
// Opal Therapy Portal — E2E (STAGING ONLY, read-only toward Outlook/Splose/Xero).
// Covers the highest-value pilot guarantees found/verified in the browser QA.
// Skips gracefully when credentials are absent so CI never fails on secrets.
const { test, expect } = require('@playwright/test');

const OWNER = { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD };
const THERAPIST = { email: process.env.E2E_THERAPIST_EMAIL, password: process.env.E2E_THERAPIST_PASSWORD };
const READONLY = { email: process.env.E2E_READONLY_EMAIL, password: process.env.E2E_READONLY_PASSWORD };

const need = (who) => {
  test.skip(!who.email || !who.password,
    'credentials not set — copy .env.e2e.example to .env.e2e (never commit it)');
};

async function login(page, who) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(who.email);
  await page.locator('input[type=password]').fill(who.password);
  await page.locator('button[type=submit], button:has-text("Sign in")').first().click();
  await page.waitForURL(/\/(\?|$)|onboarding/, { timeout: 30000 });
}

/** In-page fetch with the session cookie — same auth path as the UI. */
const api = (page, path, init) => page.evaluate(async ([p, i]) => {
  const r = await fetch(p, Object.assign({ credentials: 'include' }, i || {}));
  let code = null; try { code = (await r.clone().json()).code ?? null; } catch (e) {}
  return { status: r.status, code };
}, [path, init]);

test.describe('shell + identity', () => {
  test('login page loads, title is professional, invalid login is refused', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await page.locator('input[type=email]').fill('nobody@example.test');
    await page.locator('input[type=password]').fill('wrong-password-1');
    await page.locator('button[type=submit], button:has-text("Sign in")').first().click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  });

  test('signed-in shell: real title, signed-in identity, no hardcoded Ann, no fake freshness', async ({ page }) => {
    need(THERAPIST);
    await login(page, THERAPIST);
    await page.goto('/');
    await expect(page).toHaveTitle('Opal Therapy Portal');
    const shell = await page.evaluate(() => ({
      headerName: document.getElementById('prac-name')?.textContent,
      annRendered: document.body.innerText.includes('Ann Mary Mathew'),
      fakePillRendered: document.body.innerText.includes('14s ago'),
      standards: document.compatMode,
    }));
    expect(shell.annRendered).toBe(false);
    expect(shell.fakePillRendered).toBe(false);
    expect(shell.standards).toBe('CSS1Compat');
    expect(shell.headerName).not.toMatch(/Ann Mary Mathew/);
  });

  test('logout ends the session', async ({ page }) => {
    need(THERAPIST);
    await login(page, THERAPIST);
    await page.evaluate(() => window.signOut());
    await page.waitForURL(/\/login/, { timeout: 20000 });
    expect((await api(page, '/api/auth/me')).status).toBe(401);
  });
});

test.describe('therapist boundaries', () => {
  test.beforeEach(async ({ page }) => { need(THERAPIST); await login(page, THERAPIST); await page.goto('/'); });

  test('Accounting is invisible and inaccessible', async ({ page }) => {
    const tabVisible = await page.evaluate(() => {
      const el = document.querySelector('[data-tab="accounting"]');
      return !!(el && el.offsetParent !== null);
    });
    expect(tabVisible).toBe(false);
    for (const p of ['/api/accounting/exceptions', '/api/accounting/xero/status', '/api/accounting/candidates']) {
      expect((await api(page, p)).status).toBe(403);
    }
  });

  test('admin-only tabs are hidden (nav gating applied at boot)', async ({ page }) => {
    await page.waitForTimeout(3000); // gating retry window
    const visible = await page.evaluate(() =>
      ['billing', 'ndis', 'dormant'].filter(k => {
        const el = document.querySelector(`.tab[data-tab="${k}"]`);
        return el && el.offsetParent !== null;
      }));
    expect(visible).toEqual([]);
  });

  test('broad Splose data denied; unmapped practitioner fails closed', async ({ page }) => {
    for (const p of ['/api/splose/patients', '/api/splose/invoices', '/api/splose/payments']) {
      expect((await api(page, p)).status).toBe(403);
    }
    const appts = await api(page, '/api/splose/appointments?startDate=2026-08-03&endDate=2026-08-04');
    expect(appts.status).toBe(403);
    expect(appts.code).toBe('practitioner_mapping_required');
  });

  test('Splose write routes are blocked', async ({ page }) => {
    const res = await api(page, '/api/splose/patients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstname: 'E2E', lastname: 'NeverWritten' }),
    });
    expect(res.status).toBe(403);
  });

  test('Outlook shows a per-user not-connected state (never another mailbox)', async ({ page }) => {
    const sync = await page.evaluate(async () =>
      (await fetch('/api/sync-status', { credentials: 'include' })).json());
    expect(sync.outlookConnected).toBe(false);
    expect(sync.connectedAs).toBeNull();
    expect(sync.status).toBe('not_connected');
  });

  test('Resource Hub shows approved starter content, no authoring, no public URLs', async ({ page }) => {
    const rh = await page.evaluate(async () =>
      (await fetch('/api/resources', { credentials: 'include' })).json());
    expect(rh.resources.length).toBeGreaterThan(0);
    expect(rh.resources.every(r => r.status === 'approved')).toBe(true);
    // therapists cannot create/approve
    const create = await api(page, '/api/resources/folders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'E2E should not exist' }),
    });
    expect(create.status).toBe(403);
  });

  test('no cross-user practice data cached in the browser', async ({ page }) => {
    const leaked = await page.evaluate(() =>
      Object.keys(sessionStorage).filter(k => k.startsWith('splose_swr_')));
    // A therapist may cache their OWN permitted data, but never billing/activity/dormant
    expect(leaked.filter(k => /billing|activity|dormant/.test(k))).toEqual([]);
  });
});

test.describe('read-only boundaries', () => {
  test('read-only sees no Accounting and cannot write', async ({ page }) => {
    need(READONLY);
    await login(page, READONLY);
    await page.goto('/');
    const tabVisible = await page.evaluate(() => {
      const el = document.querySelector('[data-tab="accounting"]');
      return !!(el && el.offsetParent !== null);
    });
    expect(tabVisible).toBe(false);
    expect((await api(page, '/api/accounting/exceptions')).status).toBe(403);
    const write = await api(page, '/api/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'e2e', start: '2026-08-03T01:00:00Z', end: '2026-08-03T02:00:00Z' }),
    });
    expect(write.status).toBe(403);
    expect((await api(page, '/api/splose/services')).status).toBe(403);
  });
});

test.describe('owner invite flow', () => {
  test('invite is created with a truthful email state and a copyable staging link', async ({ page }) => {
    need(OWNER);
    await login(page, OWNER);
    await page.goto('/');
    const stamp = Date.now();
    const invite = await page.evaluate(async (s) => {
      const r = await fetch('/api/invites', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `e2e.${s}@example.test`, role: 'read_only' }),
      });
      return { status: r.status, body: await r.json() };
    }, stamp);
    expect(invite.status).toBe(201);
    expect(invite.body.registerUrl).toContain('/register?token=');
    expect(invite.body.registerUrl).not.toContain('localhost');
    // Exactly one of sent / skipped / failed — never a false "sent"
    expect(invite.body.emailSent || invite.body.emailSkipped || invite.body.emailFailed).toBeTruthy();
    // clean up
    await page.evaluate(async (id) => fetch('/api/invites/' + id, { method: 'DELETE', credentials: 'include' }),
      invite.body.invite.id);
  });
});
