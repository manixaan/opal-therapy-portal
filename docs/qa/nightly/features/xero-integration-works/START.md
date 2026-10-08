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

(No decisions recorded in the tracker.)

## Where it lives today
- `backend/finance-routes.js`, `backend/accounting-routes.js`, `backend/onboarding-payroll-routes.js` (routes)
- `backend/finance-db.js`, `backend/accounting-db.js`, `backend/xero-payroll-db.js` (data access)
- Frontend: ACCOUNTING TAB and FINANCE TAB in `mockup_v3.html`, `frontend/current/finance.js`

## Start here
The code is built, guarded (owner-only) and well-tested (70/70 unit, 39/39 integration tonight) against a mocked
Xero. The real gap is that nobody has confirmed the Financial Dashboard and Payroll Automation against a real,
connected Xero sandbox account. Before writing more code, connect a Xero sandbox account on staging and walk
`backend/finance-routes.js`'s `/api/finance/dashboard` and `/api/finance/payroll/overview` against live figures.
Separately, note `GET /api/accounting/xero/callback` (accounting-routes.js:102) uses `requireAuth` alone, unlike
every sibling route's `requireAuth + requireRole('owner')` — worth a second look even though it performs no
state-changing action on its own.

## Done means
A person has confirmed the dashboard and payroll sync against a real Xero sandbox account with live figures, and
the existing test suites (`npx jest tests/finance-routes.test.js tests/xero-payroll-sync.test.js` and the matching
integration files) still pass. Evidence label should move from needs-refinement toward proven once a browser/e2e
check against the sandbox is added.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
