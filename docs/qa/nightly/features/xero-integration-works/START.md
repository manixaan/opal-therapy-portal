/opal-feature

## Idea
Xero Integration Works

## Why
(not yet written in the tracker)

## Who uses it
(not yet written in the tracker)

## What they see
(not yet written in the tracker)

## What should happen
(not yet written in the tracker)

## Outcome
(not yet written in the tracker)

## Decisions
(not yet written in the tracker)

## Where it lives today
backend/accounting-routes.js, backend/finance-routes.js, backend/onboarding-payroll-routes.js (route files) backend/accounting-db.js, accounting-exceptions.js, finance-db.js, finance-flags.js (data access) backend/xero-api.js, xero-sync.js, xero-payroll-api.js, xero-payroll-sync.js, xero-payroll-mapping.js, xero-payroll-connection.js, xero-payroll-db.js, onboarding-payroll.js (Xero integration logic — real OAuth2, not a stub) Migrations 004, 006, 051, 062 Frontend: ACCOUNTING TAB (mockup_v3.html:5298) + FINANCE TAB (mockup_v3.html:5384), finance.js/finance.css

## Start here
Connect a Xero sandbox account (owner credentials) and click through the Finance tab to confirm the dashboard renders real income/expense/tax figures, and that the Accounting tab's reconciliation flow works against live data. No new code is obviously needed — this is a verification task, following the pattern in docs/qa/BROWSER_QA_RESULTS.md item H.

## Done means
A new row in docs/qa/BROWSER_QA_RESULTS.md confirming the Finance and Accounting tabs render correctly against a connected Xero sandbox account, reaching "proven".

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
