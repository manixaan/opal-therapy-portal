/opal-feature

**Idea**
Xero Integration Works

**Why** / **Who uses it** / **What they see** / **What should happen** / **Outcome**
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

`backend/finance-routes.js` (dashboard/payroll/invoicing, **read-only**,
owner-only) and `backend/accounting-routes.js` (Xero connect/sync/
reconciliation/contacts, includes writes). Frontend: `frontend/current/
finance.js` + `finance.css` under the Finance tab. Unit and integration
tests all pass — see STATUS.md. Note: the Payroll Automation task asks for
a *write* path into Xero; only a read-only payroll overview exists today.

## Start here

Two separate gaps: (1) the Finance tab (dashboard/payroll/invoicing) has
solid backend and test coverage but zero browser proof — add a Playwright
check to `e2e/tests/portal.spec.js` (follow the existing Accounting-tab
403-check pattern) that logs in as owner, opens Finance, and confirms the
sections render, then confirms a non-owner gets it hidden/403'd; (2)
Payroll Automation's actual ask (send payroll data into Xero) has no
corresponding write capability yet — that's new backend work, not proof
work, and should be scoped and decided with the team before building
(financial-write risk).

## Done means

For the Finance tab: an E2E or documented browser QA pass proving it
renders for an owner and is hidden/403 for everyone else moves the
dashboard/invoicing half to `proven`. For Payroll Automation: a decision
and scope from the team before any write-to-Xero code is built.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
