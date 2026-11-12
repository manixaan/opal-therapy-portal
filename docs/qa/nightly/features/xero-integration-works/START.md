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

### Task notes — "Financial Dashboard" (verbatim from tracker)
"Want to create a finance dashboard on the owner portal that has all the expenses, income, revenue, oustanding invoices, late invoices, accumulated tax and any other USEFUL metrics. Combination of xero API and internal invoicing that will form this dashboard. This will only be accessible on the owner portal"

### Task notes — "Payroll Automation" (verbatim from tracker)
"From stage 2 - we should have all the necessary info to trigger the payroll automation which includes gathering the data from the documents, collating it in the format that the xero API requires and then transferring it to XERO via API. Need to intergate the company secure connection to the portal so that XERO can work. Be worth understanding the requirements and what can be automated and what needs to be manually done. FInd the API handbook or dictionary from xero and then upload that to claude and ask the limiations and features we could have"

## Where it lives today
`backend/finance-routes.js` + `xero-api.js`/`xero-sync.js` (Financial Dashboard); `backend/onboarding-payroll-routes.js` + `xero-payroll-*.js` (Payroll Automation). Both are owner-only guarded and pass their tests against mocked Xero responses.

## Start here
This is marked `/opal-critical` — it's accounting/Xero, CRITICAL level per CLAUDE.md §6. Do not connect a real Xero account without the team's sign-off first (CLAUDE.md §7 also forbids any deploy/staging action from a normal task). The concrete next step the tracker itself asks for: connect a Xero sandbox (not production) account, confirm the Finance tab's dashboard populates with real figures, and add an integration test for that specific payload shape, following the existing mocked-response pattern in `finance-routes.itest.js`.

## Done means
An integration test that exercises a real (sandbox) Xero response shape end to end, plus a browser check that the owner's Finance tab renders real income/expense/invoice figures — recorded in `docs/qa/BROWSER_QA_RESULTS.md`. That moves this from `tab-unproven` to `proven`.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
