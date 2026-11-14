# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (2026-11-13 to 2026-11-14): no (no commits to
  the located files)
- Created at all: yes

## Located files

- Routes: `backend/finance-routes.js` (owner-only Finance dashboard),
  `backend/accounting-routes.js` (owner-only Accounting/Xero extraction),
  `backend/onboarding-payroll-routes.js` (payroll setup under onboarding
  journey, `requirePermission('onboarding.payroll')`)
- Xero clients: `backend/xero-api.js`, `backend/xero-sync.js`,
  `backend/xero-payroll-api.js`, `backend/xero-payroll-connection.js`,
  `backend/xero-payroll-db.js`, `backend/xero-payroll-mapping.js`,
  `backend/xero-payroll-sync.js`
- Frontend: `frontend/current/finance.js`, `frontend/current/invoicing.js`;
  tabs `data-tab="finance"` and `data-tab="accounting"` in `mockup_v3.html`
  (both `data-owner-only="1"`, hidden by default)
- Unit tests: `tests/finance-flags.test.js`, `tests/finance-routes.test.js`,
  `tests/invoicing-billing-mark.test.js`, `tests/onboarding-payroll.test.js`,
  `tests/xero-payroll-api.test.js`, `tests/xero-payroll-mapping.test.js`,
  `tests/xero-payroll-sync.test.js`
- Integration tests: `tests/integration/accounting-phase2.itest.js`,
  `tests/integration/accounting-routes.itest.js`,
  `tests/integration/finance-routes.itest.js`,
  `tests/integration/invoicing.itest.js`,
  `tests/integration/onboarding-payroll-xero.itest.js`

## Guard check

`finance-routes.js`: every route `requireAuth` + `requireRole('owner')`.
`accounting-routes.js`: same pattern, `ownerOnly = [requireAuth,
requireRole('owner')]`. `onboarding-payroll-routes.js`:
`requirePermission('onboarding.payroll')` on every payroll-setup route. All
guarded correctly — no finding.

## Tests run

- Unit: 81/81 passed (7 suites).
- Integration: 63/63 passed (5 suites), against `therapy_scheduler_audit_test`
  with 85 migrations applied cleanly. Xero itself is correctly reported
  offline in test (`WARN finance: recurring invoices unavailable {"error":
  "xero offline in test"}`) — expected, not a failure.

## Recency

Not touched in the change window (since the 2026-11-13 audit). Built
earlier; no regression risk surfaced by recent commits.

## Why tab-unproven, not proven

Both the Financial Dashboard and Payroll Automation pass every test against
mocked/offline Xero responses, but nothing in this repository proves either
one against a real Xero sandbox or in a real browser: `e2e/tests/` has no
Finance or Accounting spec, and `docs/qa/BROWSER_QA_RESULTS.md` (2026-08-01)
only covers the older Accounting tab's visibility/403 boundaries — not the
Finance dashboard's figures rendering correctly, and not a live Xero
connection.

## Open tasks (from tracker)

- Financial Dashboard — todo. Checklist still has "Decide: confirm the exact
  metrics for the dashboard" and "Check the connection to Xero is working"
  as open items — these are product decisions, not just missing tests.
- Payroll Automation — todo.

## Commits in the window touching this

None.

## Disagreement

Tracker stage is `idea` (lowest). Evidence is: fully built, fully covered by
passing unit and integration tests, against two owner-only routes with
correct RBAC. The gap is real but narrow — a live Xero sandbox connection
and a browser check, not missing code. Unchanged from the prior nightly
audit (2026-11-13).
