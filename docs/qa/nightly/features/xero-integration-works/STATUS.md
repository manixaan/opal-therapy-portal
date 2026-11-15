# Xero Integration Works

- Tracker stage: idea | Tracker environment: none
- Evidence label: **tab-unproven**
- Created: yes
- Addressed this window: no

## Located files
accounting-routes.js (3 guards), accounting-db.js, accounting-exceptions.js, xero-api.js,
xero-payroll-api.js, xero-payroll-connection.js, xero-payroll-db.js, xero-payroll-mapping.js,
xero-payroll-sync.js, xero-sync.js. No TODO/FIXME found in accounting-routes.js, xero-api.js or
xero-payroll-sync.js.

## Guard check
OK.

## Tests
- Unit: 4 suites / 57 tests — PASS (onboarding-payroll, xero-payroll-api, xero-payroll-mapping,
  xero-payroll-sync).
- Integration: 2 suites / 28 tests — PASS (accounting-phase2, accounting-routes;
  DB_NAME=therapy_scheduler_audit_xero). onboarding-payroll-xero.itest.js already run and passing
  under Portal Onboarding Workflow.
- Tab coverage: docs/qa/BROWSER_QA_RESULTS.md section H — Accounting/Finance tab, 9/9 pass, BUT
  explicitly notes "no Xero connection attempted, no write action exercised" — everything proven is
  the guard/visibility layer, never a real Xero sandbox round trip.

## Open tasks (from tracker)
- "Financial Dashboard" — todo.
- "Payroll Automation" — todo.

## Commits in window touching this
None directly.

## Disagreement
None — the one thing never done (a real Xero sandbox connection check) matches the tracker's own
next_action exactly: "Connect a real Xero sandbox, confirm the Finance tab's numbers populate
correctly in a browser, and record that check."

## Correction note
This audit's first pass called this `needs-refinement`. Corrected to `tab-unproven` before delivery,
matching how the 2026-11-14 audit classified this same card: the guard/visibility layer is proven in
the browser, but nothing proves the Finance tab's actual numbers against a real connection — the
substance of the gap is a browser/data-accuracy check, not a functional code gap.
