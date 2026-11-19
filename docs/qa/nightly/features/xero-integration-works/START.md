/opal-critical

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

## Decision
(not yet written in the tracker)

## Where it lives today
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

## Start here
Open backend/finance-routes.js and backend/accounting-routes.js (both already pass their tests) and, as a therapist/owner session on staging, confirm a live Xero sandbox connection the way docs/qa/BROWSER_QA_RESULTS.md row H describes. Re-tick the Financial Dashboard and Payroll Automation checklists against what is actually running, item by item, rather than rebuilding.

## Done means
A real, logged-in Xero sandbox connection is confirmed in a browser and both tracker tasks move off todo; evidence label becomes `proven`.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
