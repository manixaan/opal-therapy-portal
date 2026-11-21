# Xero Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-11-19..2026-11-20): **no**
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
a Xero sandbox connection has not been confirmed live this run (no browser access)

## Guard check
OK — ownerOnly / requirePermission('manage_billing') / requirePermission('onboarding.payroll'), re-confirmed. One documented exception noted tonight: `/api/mmm-zone/lookup` is requireAuth-only, with a code comment stating it is an intentional read-only lookup — not a gap.

## Tests run
- unit: `xero-payroll-api.test.js, xero-payroll-mapping.test.js, xero-payroll-sync.test.js, finance-flags.test.js, finance-routes.test.js, invoicing-billing-mark.test.js, onboarding-payroll.test.js` — **pass** (7 files / 81 tests)
- integration: `accounting-phase2.itest.js, accounting-routes.itest.js, finance-routes.itest.js, invoicing.itest.js, onboarding-payroll-xero.itest.js` — **pass** (5 files / 63 tests; includes expected "Xero offline in test" warnings, which are correct fail-closed behaviour, not failures)

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md row H (owner-gated, Xero connected:false) — dated 2026-08-01, stale relative to this window, but exists.

## Recency
Not touched since the last audit (2026-11-19) — zero commits landed in `backend/` or `frontend/current/` anywhere in the repository between 18:39 UTC 2026-11-19 and tonight's audit.

## Open tasks (from the tracker)
- Financial Dashboard — todo
- Payroll Automation — todo

## Reason for the label
The gap here is proof, not missing functionality: Financial Dashboard and Payroll Automation are both substantially built, owner-guarded and 144 tests pass. The one thing never actually done is connecting a real Xero sandbox and watching it work in a browser. Unchanged from last night.

## Disagreement with the tracker
Tracker stage is "idea" while the backend is built and heavily tested — the tracker under-describes how much exists.
