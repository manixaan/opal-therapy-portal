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
`backend/accounting-routes.js`, `backend/finance-routes.js`, the
`backend/xero-payroll-*.js` family, and the owner-only `FINANCE TAB` /
`ACCOUNTING TAB` blocks in `frontend/current/mockup_v3.html`. All guarded
owner-only, 109 unit + integration tests passing, all against a mocked
Xero.

## Start here
Log in as the synthetic owner account and open the Finance tab in a
browser (local server or staging) to confirm it renders real figures. If
it does, add a Playwright spec for it following `e2e/tests/portal.spec.js`'s
pattern for the Accounting tab (flow H). Separately, connect a real Xero
sandbox account and walk one payroll sync through `xero-payroll-sync.js`
end to end — everything so far has only run against a mocked Xero.

## Done means
A browser/E2E check proves the Finance dashboard renders real figures for
the owner (and stays invisible to everyone else), and one payroll sync has
been run against a real Xero sandbox. Evidence label should reach `proven`.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
