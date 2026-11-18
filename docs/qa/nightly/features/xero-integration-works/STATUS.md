# Xero Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed in the 2026-11-04..2026-11-18 change window: **no**
- Created (any located code): **yes**

## Located files
- backend/xero-api.js
- backend/xero-payroll-api.js
- backend/xero-payroll-connection.js
- backend/xero-payroll-db.js
- backend/xero-payroll-mapping.js
- backend/xero-payroll-sync.js
- backend/xero-sync.js
- backend/accounting-routes.js
- backend/finance-routes.js
- backend/invoicing-routes.js
- backend/onboarding-payroll-routes.js
- frontend tabs: ACCOUNTING TAB, FINANCE TAB, INVOICING TAB (mockup_v3.html)

## Could not locate / notable gaps
- a Xero sandbox connection has not been confirmed live this run (no browser access)

## Guard check
OK — ownerOnly / requirePermission('manage_billing') / requirePermission('onboarding.payroll')

## Tests run
- unit: `xero-payroll-api.test.js, xero-payroll-mapping.test.js, xero-payroll-sync.test.js, finance-flags.test.js, finance-routes.test.js, invoicing-billing-mark.test.js, onboarding-payroll.test.js` — **pass** (7 files / 81 tests)
- integration: `accounting-phase2.itest.js, accounting-routes.itest.js, finance-routes.itest.js, invoicing.itest.js, onboarding-payroll-xero.itest.js` — **pass** (5 files / 63 tests)

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md row H (owner-gated, Xero connected:false) — dated 2026-08-01, stale relative to this window, but exists.

## Recency
Not touched in the 2026-11-04..2026-11-18 window.

## Open tasks (from the tracker)
- Financial Dashboard — todo
- Payroll Automation — todo

## Reason for the label
Code, guards and 144 backend tests for Xero/payroll/finance/invoicing all pass, but both tracker tasks (Financial Dashboard, Payroll Automation) are still todo and the next_action ("confirm a Xero sandbox connection in a browser") is open.

## Disagreement with the tracker
Tracker stage is "idea" while the backend is built and heavily tested — the tracker under-describes how much exists.
