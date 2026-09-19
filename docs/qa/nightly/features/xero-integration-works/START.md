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
(none recorded in the tracker)

## Where it lives today
The new Finance tab (`backend/finance-routes.js` + `finance-db.js`, `frontend/current/finance.js`/`finance.css`, `FINANCE TAB` banner in `mockup_v3.html:5363`) is now the best match for both "Financial Dashboard" and "Payroll Automation" — see STATUS.md for why this replaces last night's Accounting-tab mapping. The older Accounting tab (`accounting-routes.js`) and onboarding-time payroll setup (`onboarding-payroll-routes.js`) are still real and still relevant background.

## Start here
The code, guards and unit/integration tests are already solid (39/39 passing tonight on a clean database) — this is a proof gap, not a build gap. Add a browser check or short E2E spec that: (1) logs in as owner, opens the Finance tab, confirms the Dashboard/Payroll/Invoicing subnav renders with `connected:false` gracefully when Xero isn't connected (mirror the pattern `e2e/tests/portal.spec.js` already uses for `[data-tab="accounting"]`, just targeting `[data-tab="finance"]` and `/api/finance/*`); (2) confirms a therapist/admin/read_only role sees the tab hidden and gets 403 from every `/api/finance/*` route. Record the result as a new row in `docs/qa/BROWSER_QA_RESULTS.md`.

## Done means
A passing E2E spec (or a fresh, dated `BROWSER_QA_RESULTS.md` entry) proving the Finance tab renders and is owner-gated in a real browser. Evidence label should then reach `proven`.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
