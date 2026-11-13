# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (2026-11-12 to 2026-11-13): no — no commits touched `backend/finance-*`, `accounting-*`, `xero-*`, or `onboarding-payroll-*` in this window
- Created (any code located): yes, both sub-tasks

## Located files

- "Financial Dashboard" → `backend/finance-routes.js`, `backend/finance-db.js`, `backend/finance-flags.js`, `backend/xero-api.js`, `backend/xero-sync.js`; `FINANCE TAB (owner-only)` `mockup_v3.html:5528`. (`backend/accounting-routes.js`/`accounting-db.js`/`accounting-exceptions.js`, `ACCOUNTING TAB (owner-only)` `mockup_v3.html:5442`, is a related/earlier owner-only finance surface.)
- "Payroll Automation" → `backend/onboarding-payroll-routes.js`, `backend/xero-payroll-api.js`, `backend/xero-payroll-connection.js`, `backend/xero-payroll-db.js`, `backend/xero-payroll-mapping.js`, `backend/xero-payroll-sync.js`
- Unit tests: `finance-flags.test.js`, `finance-routes.test.js`, `onboarding-payroll.test.js`, `xero-payroll-api/mapping/sync.test.js`
- Integration tests: `accounting-phase2.itest.js`, `accounting-routes.itest.js`, `finance-routes.itest.js`, `onboarding-payroll-xero.itest.js`
- E2E: `e2e/tests/portal.spec.js:70` — "Accounting is invisible and inaccessible" (re-confirmed at this line tonight). Manual QA: `docs/qa/BROWSER_QA_RESULTS.md` row H (unchanged since 2026-08-01) — no real Xero connection was ever exercised.

## Guard check

Re-confirmed tonight, unchanged. `finance-routes.js:44` and `accounting-routes.js:62` both declare `const ownerOnly = [requireAuth, requireRole('owner')]`, applied to every route checked.

## Tests run

- Unit: re-run tonight — 6 suites, 77 tests — **all pass**
- Integration: re-run tonight — `accounting-phase2.itest.js`, `accounting-routes.itest.js`, `finance-routes.itest.js` — part of a 7-suite/47-test run, **all pass** (two `WARN`-level "xero offline in test" log lines are an intentional simulated-unavailability test path, not a failure). `onboarding-payroll-xero.itest.js` re-run tonight as part of the 10-suite/218-test onboarding batch — **pass**.

## Open tasks from tracker

- "Financial Dashboard" — `todo`. Per the tracker's own `next_action`: connect a real Xero sandbox and confirm the Finance tab's dashboard populates, then add an integration test for that payload — unchanged, still not done.
- "Payroll Automation" — `todo`. Unticked, unchanged.

## Disagreement

None in the formal sense. CRITICAL-level territory (accounting/Xero per CLAUDE.md §6) — this audit made no destructive or live-Xero calls, consistent with the hard limits. The gap is genuine and unchanged: code is built and passes tests against mocked Xero responses, but nobody has verified it against a real Xero sandbox.

## Commits in window touching it

None.
