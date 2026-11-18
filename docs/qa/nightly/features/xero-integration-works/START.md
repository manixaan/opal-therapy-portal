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
`backend/accounting-routes.js`, `backend/xero-api.js`, `backend/xero-payroll-*.js`,
`backend/finance-routes.js` (owner-only Financial Dashboard), `backend/onboarding-payroll-routes.js`
+ `backend/xero-payroll-sync.js` (a real 10-step Xero employee-creation pipeline for Payroll
Automation). CRITICAL-level (accounting/Xero). Owner-guarded and tested at 144 passing tests total;
guard/visibility layer proven in the browser (section H).

## Start here
This is primarily a hand-check, as the tracker's own next_action says: "Connect a real Xero sandbox,
confirm the Finance tab's numbers populate correctly in a browser, and record that check." No sandbox
credentials exist in this audit environment, so this cannot be done from a nightly run — it needs a
person with access to a real (never production) Xero sandbox account. Record the result in
docs/qa/BROWSER_QA_RESULTS.md once done. Before that: both tasks' checklists in the tracker read as
100% unticked despite substantial built-and-tested code already behind them (see STATUS.md) — worth
re-ticking against the running code first.

## Done means
A docs/qa/BROWSER_QA_RESULTS.md entry proves the Finance tab's numbers populate correctly against a
real Xero connection. Evidence label should move to `proven` once that entry lands.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
