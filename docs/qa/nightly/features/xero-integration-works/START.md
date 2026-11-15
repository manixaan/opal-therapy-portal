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

## Where it lives today
backend/accounting-routes.js, backend/xero-api.js, backend/xero-payroll-*.js. CRITICAL-level
(accounting/Xero). Well tested at unit (57/57) and integration (28/28) level; guard/visibility layer
proven in the browser (section H, 9/9).

## Start here
This is primarily a hand-check, as the tracker's own next_action says: "Connect a real Xero sandbox,
confirm the Finance tab's numbers populate correctly in a browser, and record that check." No sandbox
credentials exist in this audit environment, so this cannot be done from a nightly run — it needs a
person with access to a real (or sandbox) Xero account. Record the result in
docs/qa/BROWSER_QA_RESULTS.md once done.

## Done means
A docs/qa/BROWSER_QA_RESULTS.md entry proves the Finance tab's numbers populate correctly against a
real Xero connection. Evidence label should move to `proven` once that entry lands.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
