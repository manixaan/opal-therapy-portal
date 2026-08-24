// @ts-check
// Interactive induction — browser-level acceptance (local synthetic env by
// default via playwright.local.config.js; also runs against staging when the
// E2E_* staging credentials are provided to the staging config).
//
// Covers the core guarantees: the dashboard renders with real thumbnails,
// walkthroughs start/advance/highlight, pause + resume survives reload AND
// re-login, completion persists server-side, restart resets, roles restrict
// what is offered, a missing anchor degrades instead of crashing, and the
// overlay never traps the user or breaks normal navigation.
const { test, expect } = require('@playwright/test');

const OWNER = { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD };
const THERAPIST = { email: process.env.E2E_THERAPIST_EMAIL, password: process.env.E2E_THERAPIST_PASSWORD };

const need = (who) => {
  test.skip(!who.email || !who.password, 'credentials not set');
};

async function login(page, who) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(who.email);
  await page.locator('input[type=password]').fill(who.password);
  await page.locator('button[type=submit], button:has-text("Sign in")').first().click();
  await page.waitForURL(/\/(\?|#|$)|onboarding/, { timeout: 30000 });
  await page.waitForFunction(() => window.APP_USER && window.NAV_ALLOWED_TABS, null, { timeout: 20000 });
}

async function openMyLearning(page) {
  // Right after a reload the router's own boot restore can race a
  // programmatic go(); retry until the learning view is actually on screen.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.OpalNav.go({ tab: 'resources', view: 'learning' }));
    try {
      await expect(page.locator('.ind-dash')).toBeVisible({ timeout: 4000 });
      return;
    } catch (e) { /* retry */ }
  }
  await expect(page.locator('.ind-dash')).toBeVisible({ timeout: 8000 });
}

/** Reset the walkthrough state for a module via the API (test isolation). */
async function resetModule(page, key) {
  await page.evaluate(async (k) => {
    await fetch(`/api/tutorials/${k}/restart`, { method: 'POST', credentials: 'include' }).catch(() => {});
    localStorage.removeItem('opal_induction_progress_v1');
  }, key);
}

test.describe('induction dashboard', () => {
  test('the Owner\'s learning view is the Assign Learning catalogue, not a learner dashboard', async ({ page }) => {
    // Since the unified-catalogue redesign the Owner administers learning
    // (assign / edit / preview); the personal induction dashboard belongs to
    // the people the Owner assigns it to.
    need(OWNER);
    await login(page, OWNER);
    await page.evaluate(() => window.OpalNav.go({ tab: 'resources', view: 'learning' }));
    await expect(page.getByRole('heading', { name: 'Assign Learning' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'All learning' })).toBeVisible();
    await expect(page.locator('.ind-dash')).toHaveCount(0);
  });

  test('the learner dashboard leads with the induction: progress, modules, thumbnails — role-filtered', async ({ page }) => {
    need(THERAPIST);
    await login(page, THERAPIST);
    await openMyLearning(page);
    const dash = page.locator('.ind-dash');
    await expect(dash.getByText('Getting Started with the Opal Portal')).toBeVisible();
    await expect(dash.getByText(/of \d+/).first()).toBeVisible();
    await expect(dash.getByText('Inviting Therapists')).toHaveCount(0);
    await expect(dash.getByText('The Master Scheduler')).toHaveCount(0);

    // Card imagery is real: every dashboard thumbnail decodes to pixels.
    const broken = await page.$$eval('.ind-dash-thumb', (imgs) =>
      imgs.filter((i) => i.complete && i.naturalWidth === 0).length);
    expect(broken).toBe(0);
  });
});

test.describe('walkthrough lifecycle', () => {
  // The lifecycle is the LEARNER's: since the unified-catalogue redesign the
  // Owner's learning view is Assign Learning, so the therapist is the account
  // that reaches the induction dashboard these flows start from.
  test.beforeEach(async ({ page }) => {
    need(THERAPIST);
    await login(page, THERAPIST);
    await resetModule(page, 'portal-getting-started');
  });

  test('start → highlight → advance → pause → resume (reload AND re-login)', async ({ page }) => {
    await openMyLearning(page);
    await page.locator('.ind-dash-item', { hasText: 'Getting Started' }).getByRole('button', { name: /Start|Continue/ }).click();

    // Overlay up, card titled, step 1.
    const card = page.locator('#ind-card');
    await expect(card).toBeVisible();
    await expect(card.getByText('Step 1 of')).toBeVisible();

    // Advance to a highlight step — the spotlight ring must sit on a real,
    // visible element.
    await card.getByRole('button', { name: 'Next' }).click();
    await expect(card.getByText('Step 2 of')).toBeVisible();
    await expect(page.locator('#ind-ring')).toBeVisible();
    const ringBox = await page.locator('#ind-ring').boundingBox();
    expect(ringBox.width).toBeGreaterThan(10);

    await card.getByRole('button', { name: 'Next' }).click();
    await expect(card.getByText('Step 3 of')).toBeVisible();

    // Pause via Escape — overlay closes cleanly, portal stays usable.
    await page.keyboard.press('Escape');
    await expect(page.locator('#ind-layer')).toHaveCount(0);
    await page.evaluate(() => window.switchTab('calendar'));
    await expect(page.locator('#view-calendar')).toHaveClass(/active/);

    // Resume after a full reload: same step.
    await page.reload();
    await page.waitForFunction(
      () => window.APP_USER && window.NAV_ALLOWED_TABS && window.OpalInduction,
      null, { timeout: 20000 });
    await openMyLearning(page);
    await expect(page.locator('.ind-dash-item', { hasText: 'Getting Started' }).getByText('Step 3 of')).toBeVisible();
    await page.locator('.ind-dash-item', { hasText: 'Getting Started' }).getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('#ind-card').getByText('Step 3 of')).toBeVisible();
    await page.keyboard.press('Escape');

    // Resume survives logout/login (server-side persistence, not this browser).
    await page.evaluate(() => window.signOut());
    await page.waitForURL(/\/login/, { timeout: 20000 });
    await login(page, THERAPIST);
    await openMyLearning(page);
    await expect(page.locator('.ind-dash-item', { hasText: 'Getting Started' }).getByText('Step 3 of')).toBeVisible();
  });

  test('complete a module end to end; completion persists; restart resets', async ({ page }) => {
    await openMyLearning(page);
    await page.locator('.ind-dash-item', { hasText: 'Getting Started' }).getByRole('button', { name: /Start|Continue/ }).click();
    const card = page.locator('#ind-card');
    await expect(card).toBeVisible();

    // Walk every step. Quiz steps need an answer before Check enables Next.
    for (let guard = 0; guard < 30; guard++) {
      if (await card.getByRole('button', { name: 'Finish module' }).count()) break;
      if (await card.locator('.ind-quiz').count()) {
        await card.locator('.ind-q-opt input').first().check();
        await card.getByRole('button', { name: 'Check answer' }).click();
        // Wrong first answers show an explanation; Next is always available
        // after checking (knowledge checks never block completion).
      }
      await card.getByRole('button', { name: /^Next$|^Skip$/ }).first().click();
      await page.waitForTimeout(350);
    }
    await card.getByRole('button', { name: 'Finish module' }).click();
    await expect(page.locator('#ind-layer')).toHaveCount(0);

    // Server state: completed.
    const state = await page.evaluate(async () => {
      const r = await fetch('/api/tutorials/progress', { credentials: 'include' });
      const d = await r.json();
      return d.progress.find((p) => p.tutorial_key === 'portal-getting-started');
    });
    expect(state.status).toBe('completed');
    expect(state.completed_at).toBeTruthy();

    // Dashboard shows it; Review + Restart offered.
    await openMyLearning(page);
    const item = page.locator('.ind-dash-item', { hasText: 'Getting Started' });
    await expect(item.getByText('Completed')).toBeVisible();
    await expect(item.getByRole('button', { name: 'Review' })).toBeVisible();

    // Restart asks for confirmation, then resets to step 1.
    await item.getByRole('button', { name: 'Restart' }).click();
    await expect(item.getByText('Start over?')).toBeVisible();
    await item.locator('.ind-restart-confirm').getByRole('button', { name: 'Restart' }).click();
    await expect(page.locator('#ind-card').getByText('Step 1 of')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('a missing anchor degrades gracefully — never a crash or a trap', async ({ page }) => {
    await openMyLearning(page);
    // Remove the anchor that step 2 (the top bar) points at.
    await page.evaluate(() => {
      const el = document.querySelector('[data-help="app-header"]');
      if (el) el.removeAttribute('data-help');
    });
    await page.locator('.ind-dash-item', { hasText: 'Getting Started' }).getByRole('button', { name: /Start|Continue/ }).click();
    const card = page.locator('#ind-card');
    await card.getByRole('button', { name: 'Next' }).click();

    // The degraded step still teaches (title + flag), and the tour continues.
    await expect(card.getByText('Step 2 of')).toBeVisible({ timeout: 15000 });
    await expect(card.getByText(/isn’t on screen right now/)).toBeVisible();
    await card.getByRole('button', { name: 'Next' }).click();
    await expect(card.getByText('Step 3 of')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ind-layer')).toHaveCount(0);
  });

  test('walkthrough from a tutorial resource page', async ({ page }) => {
    await page.evaluate(() => { window.location.hash = '#resources/detail/portal-getting-started'; });
    await expect(page.getByRole('button', { name: /interactive walkthrough/ })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /interactive walkthrough/ }).click();
    await expect(page.locator('#ind-card')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
