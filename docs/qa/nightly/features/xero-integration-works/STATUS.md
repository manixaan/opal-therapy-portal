# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window (commits since 2026-10-03 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-03); the audited commit (`aacf8e6`) is still unchanged. This is the fifth consecutive reconfirmation night on this exact code; tonight is the weekly Sunday deep run (complete `npm test` + `npm run test:integration`).
- Created (any located code at all): **yes**

## Located files
- backend/accounting-routes.js, backend/finance-routes.js, backend/onboarding-payroll-routes.js (route files)
- backend/accounting-db.js, accounting-exceptions.js, finance-db.js, finance-flags.js (data access)
- backend/xero-api.js, xero-sync.js, xero-payroll-api.js, xero-payroll-sync.js, xero-payroll-mapping.js, xero-payroll-connection.js, xero-payroll-db.js, onboarding-payroll.js (Xero integration logic — real OAuth2, not a stub)
- Migrations 004, 006, 051, 062
- Frontend: ACCOUNTING TAB (mockup_v3.html:5298) + FINANCE TAB (mockup_v3.html:5384), finance.js/finance.css

## Guard check
All routes guarded: ownerOnly (requireAuth + requireRole('owner')) on accounting-routes.js and finance-routes.js (file header: "frontend hide is cosmetic"); onboarding-payroll-routes.js requires requireAuth + requirePermission('onboarding.payroll'). OAuth callback is self-scoped by design with an in-handler role check. The Xero webhook handler is intentionally unauthenticated but HMAC-signature-verified and flag-gated — correct design, not a finding. No gaps found.

## Tests and results
Unit: onboarding-pack.test.js 9/9, onboarding-payroll.test.js 7/7, onboarding-reconcile.test.js 10/10, xero-payroll-api.test.js 11/11, xero-payroll-mapping.test.js 24/24, xero-payroll-sync.test.js 15/15, finance-routes.test.js 6/6, finance-flags.test.js 14/14 — reconfirmed tonight inside the full `npm test` deep run, 96/96 pass, identical to the last four nights.
Integration: accounting-routes.itest.js, accounting-phase2.itest.js, finance-routes.itest.js, onboarding-payroll-xero.itest.js — reconfirmed tonight inside the full `npm run test:integration` deep run, 39/39 pass, identical.
E2E: e2e/tests/portal.spec.js asserts Accounting is invisible/403 for non-owner roles (not run tonight, per the audit's own rule against running full suites off-schedule).

## Open tasks (from the tracker)
- Financial Dashboard — build, todo
- Payroll Automation — build, todo

## Compare with the tracker
Tracker stage is "idea" with both tasks marked todo, but the code is a real, guarded, heavily-tested OAuth2 integration with write features deliberately flag-gated off (ENABLE_XERO_WRITE=false etc., only ENABLE_XERO_READ=true). The tracker understates how much is already built.
