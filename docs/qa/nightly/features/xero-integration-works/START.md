/opal-feature

**Idea**
Xero Integration Works

**Why**
(not yet written in the tracker)

**Who uses it**
(not yet written in the tracker)

**What they see**
(not yet written in the tracker)

**What should happen**
(not yet written in the tracker)

**Outcome**
(not yet written in the tracker)

No decisions recorded yet at the feature level. Task-level notes (verbatim):

- **Financial Dashboard**: "Want to create a finance dashboard on the owner
  portal that has all the expenses, income, revenue, oustanding invoices,
  late invoices, accumulated tax and any other USEFUL metrics. Combination
  of xero API and internal invoicing that will form this dashboard. This
  will only be accessible on the owner portal"
- **Payroll Automation**: "From stage 2 - we should have all the necessary
  info to trigger the payroll automation which includes gathering the data
  from the documents, collating it in the format that the xero API
  requires and then transferring it to XERO via API. Need to intergate the
  company secure connection to the portal so that XERO can work. Be worth
  understanding the requirements and what can be automated and what needs
  to be manually done. FInd the API handbook or dictionary from xero and
  then upload that to claude and ask the limiations and features we could
  have"

## Where it lives today

`backend/finance-routes.js` (dashboard/payroll/invoicing, read-only,
owner-only) and `backend/accounting-routes.js` (Xero connect/sync/
reconciliation/contacts, includes writes). Frontend: `frontend/current/
finance.js` + `finance.css` under the Finance tab in `mockup_v3.html`.
Unit and integration tests all pass (see STATUS.md).

## Start here

The backend and unit/integration test coverage already look solid — the
gap is proof the Finance tab actually renders for an owner. Open
`frontend/current/finance.js` and `docs/qa/BROWSER_QA_RESULTS.md`; add a
Playwright check to `e2e/tests/portal.spec.js` (follow the pattern already
used for the Accounting tab's 403 checks) that logs in as owner, opens the
Finance tab, and confirms the dashboard/payroll/invoicing sections render
without error — then confirms a non-owner role gets the tab hidden and the
API 403'd, matching `finance-routes.js`'s own guard comment.

## Done means

An E2E or documented browser QA pass proving the Finance tab renders for
an owner and is hidden/403 for everyone else moves this from
`tab-unproven` to `proven`. The existing unit/integration suites already
pass and don't need to be re-run for that alone.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
