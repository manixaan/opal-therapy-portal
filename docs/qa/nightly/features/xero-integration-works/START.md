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
(none recorded)

## Where it lives today
`backend/accounting-routes.js`, `backend/accounting-db.js`, `backend/xero-api.js`,
`backend/xero-sync.js`, `backend/xero-payroll-*.js`, and the `FINANCE TAB
(owner-only)` block in `frontend/current/mockup_v3.html` (~line 5500, Dashboard /
Payroll / Invoicing subnav). Already covered by 86 passing unit + integration
tests (see STATUS.md).

## Start here
The code and its tests are done — this is not a build task. Open the portal as
Owner with a Xero sandbox connected, click the Finance tab, and walk Dashboard →
Payroll → Invoicing, noting anything that doesn't render or match Xero's own
figures. Follow the same browser-walkthrough pattern used for the Resource Hub
Library tab in `docs/qa/BROWSER_QA_RESULTS.md` flow G, then add a new dated row
there (or an E2E spec in `e2e/tests/`) for Finance specifically — the existing
flow H only covers the separate Accounting tab and is three months stale.

## Done means
A current `docs/qa/BROWSER_QA_RESULTS.md` entry (or E2E spec) confirming the
Finance tab's Dashboard/Payroll/Invoicing subnav renders real figures for an
Owner with Xero connected. Once that exists, this becomes `proven`.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
