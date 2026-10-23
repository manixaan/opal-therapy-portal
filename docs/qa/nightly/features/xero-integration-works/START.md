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
(none recorded)

## Where it lives today
Financial Dashboard: `backend/finance-routes.js`, `backend/accounting-routes.js`. Payroll Automation: `backend/xero-payroll-*.js` — already built and tested, despite its tracker checklist showing nothing done.

## Start here
This is CRITICAL level (accounting/Xero). Open the Finance tab as an owner in a real browser with a connected Xero sandbox account (not just disconnected, which is already proven per `docs/qa/BROWSER_QA_RESULTS.md` row H), and confirm the Dashboard screen renders real figures (income/expenses/revenue/outstanding/late invoices/tax). Add a browser QA row or E2E check for that connected-state render — the disconnected state is already covered.

## Done means
A passing check proves the dashboard renders real Xero-backed figures for an owner; evidence label reaches `proven`.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
