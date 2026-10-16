Feature: Xero Integration Works
Tracker stage: idea
Tracker environment: none
Evidence label: tab-unproven
Addressed in change window (2026-10-02 to 2026-10-16): no
Created (any located code): yes

## Located files
- `backend/accounting-routes.js` — owner-only (`requireAuth` + `requireRole('owner')`)
- `backend/finance-routes.js` — owner-only (`requireAuth` + `requireRole('owner')`), header comment
  documents this explicitly: "every route: requireAuth + requireRole('owner'); the frontend hide is cosmetic"
- `backend/xero-payroll-api.js`, `backend/xero-payroll-connection.js`, `backend/xero-payroll-db.js`,
  `backend/xero-payroll-mapping.js`, `backend/xero-payroll-sync.js`, `backend/xero-sync.js`,
  `backend/onboarding-payroll.js`, `backend/onboarding-payroll-routes.js`
- Frontend tabs: `FINANCE TAB (owner-only)` and `ACCOUNTING TAB (owner-only)` in
  `frontend/current/mockup_v3.html` (lines 5384 and 5298)

## Guard check
Pass. Every route located sits behind `requireAuth` plus `requireRole('owner')`.
No unguarded endpoint found.

## Tests run
- Unit: `tests/finance-flags.test.js`, `tests/finance-routes.test.js`,
  `tests/xero-payroll-api.test.js`, `tests/xero-payroll-mapping.test.js`,
  `tests/xero-payroll-sync.test.js` → 5 suites / 70 tests, all PASS
- Integration (`DB_NAME=therapy_scheduler_audit`): `accounting-phase2.itest.js`,
  `accounting-routes.itest.js`, `finance-routes.itest.js`,
  `onboarding-payroll-xero.itest.js` → 4 suites / 39 tests, all PASS

## Browser / E2E evidence
None for the Finance dashboard specifically. `docs/qa/BROWSER_QA_RESULTS.md`
(2026-08-01) covers the Accounting tab's visibility and 403 guards (flow H)
but explicitly states "no Xero connection attempted, no write action
exercised", and never opens the Finance tab. No Playwright spec covers it.

## Open tasks from tracker
- Financial Dashboard [todo]
- Payroll Automation [todo]

## Commits in window touching this feature
None — no commits since 2026-09-27 touch `accounting-*`, `finance-*`, `xero-*`,
or `onboarding-payroll*`.

## Disagreement with tracker
None. Tracker stage is `idea`; the evidence (tab-unproven, strongly built and
tested underneath) is well ahead of that stage, not behind it, so there is
nothing to flag as a disagreement.
