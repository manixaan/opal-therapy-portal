/opal-critical

# Xero Integration Works

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
- backend/finance-routes.js (Finance tab API, owner-only)
- backend/accounting-routes.js (Accounting extraction, owner-only)
- backend/onboarding-payroll-routes.js (Payroll-to-Xero sync, onboarding.payroll permission)
- frontend/current/finance.css, finance.js
- mockup_v3.html: ACCOUNTING TAB (line 5422), FINANCE TAB (line 5508)

## Start here
Open the Finance tab (frontend/current/finance.js) as an Owner with a real Xero sandbox connected via backend/accounting-routes.js's OAuth callback, and watch backend/finance-routes.js's profit-and-loss and recurring-invoice calls succeed instead of logging 'xero offline in test'. Follow the pattern in tests/integration/finance-routes.itest.js for the request shapes, then add one integration test that asserts a populated (not 'unavailable') dashboard payload.

## Done means
tests/integration/finance-routes.itest.js gains a passing case with a live/mocked-live Xero response, moving the evidence label from tab-unproven to proven.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
