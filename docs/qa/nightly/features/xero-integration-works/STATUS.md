# Xero Integration Works

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-18T19:20Z UTC, commit `0726dde`): **no** — underlying code
  untouched tonight
- Created (any located code): **yes**

## Located files

Re-verified fresh tonight (commit `cec0a03`) — unchanged from last night's mapping:

- **"Financial Dashboard"** → `GET /api/finance/dashboard` in `backend/finance-routes.js`,
  aggregated by `backend/finance-db.js` over the `xero_invoices_cache` table, plus live
  `/RepeatingInvoices` and `/Reports/ProfitAndLoss` reads via `backend/xero-api.js`. Frontend:
  `frontend/current/finance.js`/`.css` (`?v=1`).
- **"Payroll Automation"** → `GET /api/finance/payroll/overview` and
  `GET /api/finance/payroll/pay-runs/:id` in `finance-routes.js` (via `backend/xero-payroll-api.js`),
  plus the pre-existing onboarding-time payroll setup
  (`backend/onboarding-payroll-routes.js` + `backend/xero-payroll-{api,connection,db,mapping,sync}.js`).
- `mockup_v3.html`'s `ACCOUNTING TAB (owner-only)` and `FINANCE TAB (owner-only)` banners both
  shifted +14 lines (now 5291 and 5377) purely from tonight's unrelated theme commit (`fc769fe`)
  inserting an Appearance control earlier in the file — content of both banners is identical to
  last night.
- `git log 0726dde..HEAD --oneline -- backend/finance-routes.js backend/finance-db.js
  backend/xero-api.js backend/xero-payroll-*.js backend/accounting-routes.js
  backend/onboarding-payroll-routes.js frontend/current/finance.js frontend/current/finance.css` —
  empty. Confirmed untouched.

## Guard check

`finance-routes.js` — every one of its 5 routes uses `const ownerOnly = [requireAuth,
requireRole('owner')]` inline; verified directly (line 44 onward). `accounting-routes.js` — 28
routes, same inline `ownerOnly` pattern, unchanged. `onboarding-payroll-routes.js` —
`router.use('/api/onboarding/journey', requireAuth)` + `requirePermission('onboarding.payroll')` on
every route. No unguarded route found.

## Tests run

Re-run fresh tonight against an isolated database (`DB_NAME=therapy_scheduler_n4a`), no code
changed here since last audit:

- `npx jest tests/finance-routes.test.js` — **PASS 6/6**.
- `npx jest tests/finance-flags.test.js tests/xero-payroll-api.test.js
  tests/xero-payroll-mapping.test.js tests/xero-payroll-sync.test.js` — **PASS 64/64** (4 suites).
- `DB_NAME=therapy_scheduler_n4a DB_PASSWORD=audit npx jest --config jest.integration.config.js
  tests/integration/finance-routes.itest.js --runInBand` — **PASS 3/3**.
- `DB_NAME=therapy_scheduler_n4a DB_PASSWORD=audit npx jest --config jest.integration.config.js
  tests/integration/accounting-phase2.itest.js tests/integration/accounting-routes.itest.js
  tests/integration/onboarding-payroll-xero.itest.js --runInBand` — **PASS 36/36 combined** (3
  suites; matches last night's 17+11+8).
- `npx jest tests/assessment-surface-guards.test.js` — **PASS 82/82**, includes `finance.js`/
  `finance.css` v1 pins, current tonight.

All numbers match last night exactly; no regression, no new failure. No TODO/FIXME found in
`finance-routes.js`, `finance-db.js`, or `frontend/current/finance.js`.

## Why not `proven`

`docs/qa/BROWSER_QA_RESULTS.md` flow H (dated 2026-08-01) only proves the Accounting tab; it
predates the Finance tab by six weeks and never opens it. `e2e/tests/portal.spec.js` only asserts
`[data-tab="accounting"]`/`/api/accounting/*` — nothing targets `[data-tab="finance"]` or
`/api/finance/*`. No new browser/E2E artifact appeared in tonight's window.

## Disagreement

Tracker stage is idea; evidence shows a built, guarded, unit- and integration-tested Finance
module (plus the pre-existing Accounting/payroll infrastructure it sits on) — materially ahead of
"idea," just not browser-proven yet under its new, more literal name.
