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

## Task notes, verbatim (Financial Dashboard)

"We will add a new Finance page inside the owner portal only. It will pull live figures from
Xero and combine them with your own invoicing data already in Opal. We show the figures as
clear cards and lists: income, expenses, revenue, outstanding and late invoices, tax owed, and
a few more. First we confirm the Xero connection works, then we gather the numbers, then we
display them."

"Want to create a finance dashboard on the owner portal that has all the expenses, income,
revenue, oustanding invoices, late invoices, accumulated tax and any other USEFUL metrics.
Combination of xero API and internal invoicing that will form this dashboard. This will only
be accessible on the owner portal"

## Task notes, verbatim (Payroll Automation)

"We will let Opal Portal send payroll information straight into Xero, so Anthony stops typing
it in by hand. First we learn exactly what Xero allows and needs, using Xero's own official
connection guide. Then we set up a secure link between the portal and the company's Xero
account. Finally we take the payroll data already gathered from documents in stage 2, reshape
it into the exact layout Xero expects, and send it across."

"From stage 2 - we should have all the necessary info to trigger the payroll automation which
includes gathering the data from the documents, collating it in the format that the xero API
requires and then transferring it to XERO via API. Need to intergate the company secure
connection to the portal so that XERO can work. Be worth understanding the requirements and
what can be automated and what needs to be manually done. FInd the API handbook or dictionary
from xero and then upload that to claude and ask the limiations and features we could have"

## Where it lives today

`backend/finance-routes.js` (Finance tab, owner-only), `backend/accounting-routes.js` (Xero
sync/reconciliation), `backend/onboarding-payroll-routes.js`, `backend/invoicing-routes.js`.
All owner-gated. 128 unit tests and 96 integration tests pass tonight, all against a mocked
Xero client.

## Start here

This is CRITICAL-level work (accounting/Xero, owner-only financial data). Before writing any
more code, confirm a real Xero sandbox connection live: open the Accounting tab as the owner in
a real browser against staging, and attempt the OAuth connect flow with a genuine Xero
developer sandbox account. Record whatever happens — success, or the specific error — in
`docs/qa/BROWSER_QA_RESULTS.md`. Every test so far mocks Xero, so this is the one thing no
amount of further unit/integration testing can substitute for.

## Done means

A real Xero sandbox OAuth connection is attempted and the outcome recorded in
`docs/qa/BROWSER_QA_RESULTS.md`, with `xeroWrite`/`draftInvoiceCreate` flags confirmed in
whatever state they end up in.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
