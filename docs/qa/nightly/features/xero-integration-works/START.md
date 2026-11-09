/opal-critical

**Idea:** Xero Integration Works
**Why:** (not yet written in the tracker)
**Who uses it:** (not yet written in the tracker)
**What they see:** (not yet written in the tracker)
**What should happen:** (not yet written in the tracker)
**Outcome:** (not yet written in the tracker)
(No recorded decisions.)

## Where it lives today

`backend/accounting-routes.js`, `backend/finance-routes.js`, `backend/invoicing-routes.js`, the `xero-*.js` layer, and `frontend/current/finance.js` plus the owner-only Accounting/Finance/Invoicing/Billing tabs. Owner-gated, 70 unit + 63 integration tests pass, fail-closed when Xero isn't connected. Only a real Xero sandbox connection is unproven.

## Start here

Open the Finance tab (`frontend/current/finance.js`) as an Owner with a real Xero sandbox connected via `backend/accounting-routes.js`'s OAuth callback, and confirm `backend/finance-routes.js`'s profit-and-loss and recurring-invoice calls succeed instead of logging "xero offline in test". Follow `tests/integration/finance-routes.itest.js` for the request shapes, then add one integration test asserting a populated dashboard payload.

## Done means

An integration test proves a populated dashboard payload from a real (or realistically mocked) Xero sandbox connection, and a browser QA entry records the owner's live view → evidence label `proven`.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
