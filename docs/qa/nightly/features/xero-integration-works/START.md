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
Financial Dashboard: `backend/finance-routes.js` + `frontend/current/finance.js` (FINANCE TAB, owner-only, `mockup_v3.html:5500`). Payroll Automation: `backend/xero-payroll-sync.js` + `backend/onboarding-payroll-routes.js` + the `payrollPanel`/`payrollConfigForm` UI inside `frontend/current/onboarding-journey.js`. This touches accounting/Xero — CRITICAL level.

## Start here
Log in as Owner with a connected Xero account. First, open the Finance tab and confirm the Dashboard renders real figures (not placeholder zeros) across Dashboard/Payroll/Invoicing sub-nav. Second, separately, open an onboarding journey record and walk the payroll-setup panel (`payrollConfigForm`) end to end — config → approve → sync. Add a Playwright spec or a dated `docs/qa/BROWSER_QA_RESULTS.md` entry covering both; they are two different tabs and need two different walkthroughs, not one. Copy the pattern used for the existing accounting-extraction browser-QA entry (`docs/qa/BROWSER_QA_RESULTS.md`, "Accounting/Xero extraction status") — owner-gated visibility check, flags read before any write — but extend it onto the newer Finance tab and the onboarding-journey payroll panel it doesn't yet cover.

## Done means
A browser or E2E check confirms both the Finance tab Dashboard and the onboarding-journey payroll-setup panel render and work. Evidence label should move from `tab-unproven` to `proven` for each independently.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
