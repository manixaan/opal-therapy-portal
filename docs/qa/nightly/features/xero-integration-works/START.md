/opal-critical (owner-only financial data + external Xero API, for both
sub-items below)

**Idea:** Xero Integration Works

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

Tracker task notes (quoted verbatim, Financial Dashboard): "Want to create
a finance dashboard on the owner portal that has all the expenses, income,
revenue, outstanding invoices, late invoices, accumulated tax and any other
USEFUL metrics. Combination of xero API and internal invoicing that will
form this dashboard. This will only be accessible on the owner portal"
(Payroll Automation): "From stage 2 - we should have all the necessary info
to trigger the payroll automation which includes gathering the data from
the documents, collating it in the format that the xero API requires and
then transferring it to XERO via API. Need to integrate the company secure
connection to the portal so that XERO can work."

## Where it lives today

`backend/finance-routes.js` (`/api/finance/dashboard`),
`backend/onboarding-payroll-routes.js` + `xero-payroll-mapping.js` +
`xero-payroll-sync.js`, `backend/xero-payroll-connection.js`.

## Start here

For the dashboard tab, the smallest next step is a browser QA pass or e2e
spec exercising `view-finance` as owner, the same way the existing browser
QA exercised `view-accounting` — no new backend code is needed, since
`/api/finance/dashboard` already passes its tests. For Payroll Automation's
real-world gap, the next step (beyond pure manual sign-off) is a staging
Xero Payroll AU **sandbox** connection test using
`xero-payroll-connection.js`'s existing `health()` check — nothing in the
mapping/sync code itself needs changing first.

## Done means

Financial Dashboard: a Playwright/manual-QA pass confirms the Finance tab
renders for the owner with real-looking figures — moves this from
`tab-unproven` to `proven`. Payroll Automation: a successful connection and
one safe test payroll run against a real Xero sandbox — moves this from
`needs-refinement` to `proven`.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
