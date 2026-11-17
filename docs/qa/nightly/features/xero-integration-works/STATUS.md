# Xero Integration Works

- Tracker stage: idea | Tracker environment: none
- Evidence label: **tab-unproven**
- Created: yes
- Addressed this window: no

## Located files
accounting-routes.js (3 guards), accounting-db.js, accounting-exceptions.js, xero-api.js,
xero-payroll-api.js, xero-payroll-connection.js, xero-payroll-db.js, xero-payroll-mapping.js,
xero-payroll-sync.js, xero-sync.js. No TODO/FIXME found in accounting-routes.js, xero-api.js or
xero-payroll-sync.js (re-confirmed tonight by grep; unchanged file set, zero commits since last
audit).

## Guard check
OK — re-confirmed tonight.

## Tests (re-run fresh tonight, not copied from last night)
- Unit: 4 suites / 57 tests — PASS (xero-payroll-api, xero-payroll-mapping, xero-payroll-sync,
  onboarding-payroll).
- Integration: 2 suites / 28 tests — PASS (accounting-phase2, accounting-routes;
  DB_NAME=therapy_scheduler_audit_xero).
- Tab coverage: docs/qa/BROWSER_QA_RESULTS.md section H — Accounting/Finance tab, unchanged since
  last night, still explicitly notes "no Xero connection attempted, no write action exercised."

## Open tasks (from tracker)
- "Financial Dashboard" — todo.
- "Payroll Automation" — todo.

## Commits in window touching this
None — zero commits anywhere in backend/frontend since 2026-11-15.

## Disagreement
None — the one thing never done (a real Xero sandbox connection check) matches the tracker's own
next_action exactly.

## Additional detail (2026-11-17)
Tonight's independent locate pass found a wider file set than previously recorded, which changes
the picture of how much is actually built: `backend/finance-routes.js` (the owner-only Financial
Dashboard — `/api/finance/status|dashboard|payroll/overview|payroll/pay-runs/:id|invoicing/summary`,
every route `requireAuth + requireRole('owner')`) and `backend/onboarding-payroll-routes.js` +
`backend/xero-payroll-sync.js` (a genuine 10-step orchestrated Xero employee-creation pipeline —
duplicate check, super-fund resolution/creation, POST /Employees, configure, pay template, read-back
verification, pay-run readiness — not a stub). Running the fuller matching test set gives
**81 unit + 63 integration = 144 passing tests** (including `finance-routes.test.js`,
`invoicing-billing-mark.test.js`, `tests/integration/finance-routes.itest.js`,
`invoicing.itest.js`, and `onboarding-payroll-xero.itest.js`, none of which were in last night's
file list). Both tracker tasks ("Financial Dashboard", "Payroll Automation") are substantially built
and owner-guarded despite reading as 100% unticked — the tracker understates this one, if anything,
rather than overstating it. The classification (`tab-unproven`) and the one real remaining gap (a
live Xero sandbox check) are unchanged.

## Note
No change in label from the 2026-11-16 audit. Independently re-verified fresh tonight (separate
parallel audit pass, its own throwaway database) — same conclusion, wider and more specific evidence
(see above).
