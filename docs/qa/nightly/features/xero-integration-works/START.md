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

## Decisions
(not yet written in the tracker)

## Where it lives today
- backend/accounting-routes.js, backend/finance-routes.js, backend/onboarding-payroll-routes.js (route files)
- backend/accounting-db.js, accounting-exceptions.js, finance-db.js, finance-flags.js (data access)
- backend/xero-api.js, xero-sync.js, xero-payroll-api.js, xero-payroll-sync.js, xero-payroll-mapping.js, xero-payroll-connection.js, xero-payroll-db.js, onboarding-payroll.js (real OAuth2, not a stub)
- Frontend: ACCOUNTING TAB (mockup_v3.html:5298) + FINANCE TAB (mockup_v3.html:5384), frontend/current/finance.js

## Start here
Open backend/finance-routes.js, backend/finance-db.js and frontend/current/finance.js (the owner-only Finance tab). Every route already has requireAuth + requireRole('owner') and 77 unit + 39 integration tests pass. What's missing: a real connected Xero sandbox account to confirm the dashboard and payroll sync against live figures (the tracker's own next_action already asks for this), plus browser-level proof the Finance tab renders.

## Done means
A confirmed live Xero sandbox connection and a passing e2e/BROWSER_QA_RESULTS.md entry for the Finance tab; the evidence label moves to `proven`.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
