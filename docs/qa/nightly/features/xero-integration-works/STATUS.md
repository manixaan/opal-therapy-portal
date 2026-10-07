# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window (commits since 2026-10-06 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-06); the audited commit (`aacf8e68`) is still unchanged. This is the seventh consecutive reconfirmation night on this exact code. Tonight is not Sunday UTC, so targeted batches were run (not the complete suites) — see each section below for exactly what ran tonight.
- Created (any located code at all): **yes**

## Located files
- backend/accounting-routes.js, backend/finance-routes.js, backend/onboarding-payroll-routes.js (route files)
- backend/accounting-db.js, accounting-exceptions.js, finance-db.js, finance-flags.js (data access)
- backend/xero-api.js, xero-sync.js, xero-payroll-api.js, xero-payroll-sync.js, xero-payroll-mapping.js, xero-payroll-connection.js, xero-payroll-db.js, onboarding-payroll.js (real OAuth2, not a stub)
- Frontend: ACCOUNTING TAB (mockup_v3.html:5298) + FINANCE TAB (mockup_v3.html:5384), frontend/current/finance.js

## Guard check
All routes guarded. accounting-routes.js / finance-routes.js: const ownerOnly = [requireAuth, requireRole('owner')] on every route (file header: "the frontend hide is cosmetic"). onboarding-payroll-routes.js: requireAuth + requirePermission('onboarding.payroll'), with sync/retry/duplicate-resolution additionally requiring an inline owner-or-admin check before decrypting TFN/bank data. The Xero webhook is intentionally unauthenticated but HMAC-signature-verified and flag-gated — correct design, not a finding. No gaps found.

## Tests run tonight
- unit: `finance-routes.test.js, finance-flags.test.js, xero-payroll-api.test.js, xero-payroll-mapping.test.js, xero-payroll-sync.test.js, onboarding-payroll.test.js` — 77/77 pass
- integration: `finance-routes.itest.js, accounting-routes.itest.js, accounting-phase2.itest.js, onboarding-payroll-xero.itest.js` — 39/39 pass tonight

## Open tasks (from the tracker)
- Financial Dashboard — build, todo
- Payroll Automation — build, todo

## Compare with the tracker
Tracker stage is "idea" with both tasks todo, but the code is a real, guarded, heavily-tested OAuth2 integration. The concrete open item — unchanged across seven nights — is that neither sub-feature has ever been exercised against a real connected Xero sandbox account, which is exactly what the tracker's own next_action already says.
