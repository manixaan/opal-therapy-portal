# Xero Integration Works

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-17T18:21Z UTC): **yes — mapping changed** (see below); underlying code untouched
- Created (any located code): **yes**

## Located files — mapping changed tonight

Commit `427a063` ("Finance tab — dashboard, payroll and invoicing over Xero, owner-only, read-only", landed 2026-09-17T18:26Z, just after last night's cutoff) added a **new, separate** Finance tab. It is not a rename of Accounting — both banners exist side by side in `mockup_v3.html`:

- `<!-- ============ ACCOUNTING TAB (owner-only) ============ -->` at line 5277 (unchanged: Xero sync, reconciliation, settings, exceptions).
- `<!-- ============ FINANCE TAB (owner-only) ============ -->` at line 5363 (new): subnav `Dashboard` / `Payroll` / `Invoicing`.

The two tracker tasks now map far more literally to the **new** Finance tab than to Accounting:

- **"Financial Dashboard"** → `GET /api/finance/dashboard` in `backend/finance-routes.js`, aggregated by `backend/finance-db.js` (`computeFinancials`) over the `xero_invoices_cache` table, plus live (best-effort) `/RepeatingInvoices` and `/Reports/ProfitAndLoss` reads via `backend/xero-api.js`. Frontend: `frontend/current/finance.js` / `finance.css` (`?v=1`), the `fin-dashboard` section.
- **"Payroll Automation"** → two things now: (a) `GET /api/finance/payroll/overview` and `GET /api/finance/payroll/pay-runs/:id` in `finance-routes.js`, reading Xero Payroll AU calendars/employees/pay runs via `backend/xero-payroll-api.js` (the `fin-payroll` section — new tonight); (b) the pre-existing onboarding-time payroll setup, `backend/onboarding-payroll-routes.js` + `backend/xero-payroll-{api,connection,db,mapping,sync}.js` (unchanged since last audit).
- Old mapping (Accounting tab, `backend/accounting-routes.js` / `xero-sync.js`) is still real and still owner-only, but is now the *adjacent* surface, not the best match for either task name.

## Guard check

- `finance-routes.js`: every one of its 5 routes uses `const ownerOnly = [requireAuth, requireRole('owner')]` inline — no top-level `router.use`, same pattern as `accounting-routes.js`. Read flags (`ENABLE_XERO_READ`, `ENABLE_FINANCE_DASHBOARD`) fail closed to 403 per the file's own header comment; live Xero failures degrade to a page warning, never a 500 leak. No unguarded route found.
- `accounting-routes.js`: unchanged, 28 routes all inline `ownerOnly`.
- `onboarding-payroll-routes.js`: unchanged, `router.use('/api/onboarding/journey', requireAuth)` + `requirePermission('onboarding.payroll')` on every route.

No unguarded route found anywhere in this feature's surface.

## Tests run

Fresh tonight. First pass, run together against the shared `therapy_scheduler_audit_test` database named in the task instructions, showed non-reproducible failures (1/36 failed on one run, 16/36 failed on a re-run of the identical command seconds later) — `pg_stat_activity` showed 3 live connections to that database at the time, confirming another session was truncating/using the same shared DB concurrently. Per `.claude/rules/tests.md`'s concurrency guidance, re-ran everything against a dedicated session-only database (`therapy_scheduler_qaaudit3feat`) for a trustworthy result:

- `tests/finance-routes.test.js` (new tonight) — **PASS 6/6**. Covers the 401/403 boundary for every route and that no Xero module is called on a denial.
- `tests/integration/finance-routes.itest.js` (new tonight) — **PASS 3/3**, real database, real org scoping.
- `tests/finance-flags.test.js`, `tests/xero-payroll-api.test.js`, `tests/xero-payroll-mapping.test.js`, `tests/xero-payroll-sync.test.js` — **PASS 64/64** combined.
- `tests/integration/accounting-phase2.itest.js` — **PASS 17/17**.
- `tests/integration/accounting-routes.itest.js` — **PASS 11/11**.
- `tests/integration/onboarding-payroll-xero.itest.js` — **PASS 8/8**.
- `tests/assessment-surface-guards.test.js` — **PASS 82/82**, includes the Finance tab's new pins (`finance.js`/`finance.css` v1) and the Business-nav entry, re-pinned in commit `1f1e9ed` the same night as the Finance feature.
- Combined dedicated-DB run of the four Finance/accounting/payroll integration files: **PASS 39/39**.

No TODO/FIXME found in `finance-routes.js`, `finance-db.js`, or `frontend/current/finance.js`.

## Why not `proven`

The rubric requires a browser/E2E proof of the tab itself. `docs/qa/BROWSER_QA_RESULTS.md` flow H (dated 2026-08-01) only proves the **Accounting** tab's owner-gated, no-write rendering — it predates the Finance tab by six weeks and never opens it. `e2e/tests/portal.spec.js` also only asserts against `[data-tab="accounting"]` and `/api/accounting/*` — nothing targets `[data-tab="finance"]` or `/api/finance/*`. So both tracker tasks now rest on a tab with excellent guard and API-level test coverage but zero browser proof of the Dashboard/Payroll/Invoicing screens actually rendering correctly for an owner. That is a downgrade from last night's `proven`, driven entirely by the mapping correction, not by any code regression — the underlying Xero/accounting/payroll code is unchanged and still green.

## Disagreement

Tracker stage is idea; evidence shows a built, guarded, unit- and integration-tested Finance module (plus the pre-existing Accounting/payroll infrastructure it sits on) — materially ahead of "idea," just not browser-proven yet under its new, more literal name.
