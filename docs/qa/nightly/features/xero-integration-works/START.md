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

## Decision
(not yet written in the tracker)

## Where it lives today
- backend/xero-api.js, backend/xero-sync.js
- backend/xero-payroll-{api,connection,db,mapping,sync}.js
- backend/accounting-routes.js, backend/finance-routes.js, backend/invoicing-routes.js
- backend/onboarding-payroll-routes.js
- backend/billing/{billing-issues,billing-profiles,billing-settings,invoice-generation,invoice-lifecycle,payer-directory,session-billing,splose-billing-source,travel-billing,xero-invoice-push}.js
- frontend tabs: ACCOUNTING TAB, FINANCE TAB, INVOICING TAB (mockup_v3.html)

## Start here
A lot landed overnight 2026-11-21 (NDIS travel-billing rule book, batch invoice send, one-Xero-copy-per-invoice, a new payer directory) — all mocked-Xero tests, 215 unit + 90 integration, all passing. Re-tick the Financial Dashboard/Payroll Automation checklists against the running code, then confirm a real Xero sandbox connection in a browser and record it in docs/qa/BROWSER_QA_RESULTS.md — that is the one thing no test here can prove.

## Done means
A Xero sandbox connection is confirmed live in a browser; label becomes `proven`.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
