# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven** (Financial Dashboard); Payroll Automation is proven — see breakdown
- Addressed in change window (since last audit, 2026-10-23): no — zero commits in the window; develop is frozen at the same commit audited last night
- Created (code exists): yes, both tasks

## Financial Dashboard — tab-unproven
- Located: `backend/finance-routes.js` (`/api/finance/dashboard`, `/status`, `/payroll/overview`, `/payroll/pay-runs/:id`, `/invoicing/summary`) + `backend/finance-db.js`, `backend/finance-flags.js`; also `backend/accounting-routes.js` (Xero connect/sync/reconciliation/contacts/pricing) + `backend/accounting-db.js`, `backend/xero-api.js`, `backend/xero-sync.js`. Frontend: owner-only Finance/Accounting tabs in `mockup_v3.html` (`data-owner-only="1"`).
- Guard: **owner-only confirmed** — every route in both files uses `requireAuth` + `requireRole('owner')` (the `finance-routes.js` file header even states "frontend hide is cosmetic").
- Tests: `tests/finance-flags.test.js`, `tests/finance-routes.test.js` (unit) — **all pass** (re-run tonight, 2026-10-24); `tests/integration/finance-routes.itest.js`, `tests/integration/accounting-routes.itest.js`, `tests/integration/accounting-phase2.itest.js` — **all pass** (re-run tonight, 2026-10-24).
- Browser/E2E proof: no E2E spec. `docs/qa/BROWSER_QA_RESULTS.md` row H confirms the owner-gated view renders with Xero disconnected and all write flags false, but explicitly notes "no Xero connection attempted, no write action exercised" — nobody has proven the dashboard renders real connected figures.

## Payroll Automation — proven, tracker checklist is stale
- Code exists, **contrary to the checklist's all-unchecked state**: `backend/xero-payroll-api.js`, `xero-payroll-connection.js`, `xero-payroll-db.js`, `xero-payroll-mapping.js`, `xero-payroll-sync.js`, wired into `/api/finance/payroll/*` (owner-only) and the onboarding payroll data flow.
- Tests: `tests/xero-payroll-api.test.js`, `xero-payroll-mapping.test.js`, `xero-payroll-sync.test.js`, `onboarding-payroll.test.js` (unit) — **all pass** (re-run tonight, 2026-10-24); `tests/integration/onboarding-payroll-xero.itest.js` — **pass** (re-run tonight, 2026-10-24).
- Not a tab/page in its own right (a background sync process), so no browser-proof requirement applies.

No TODO/FIXME found in any `xero-*.js`/`accounting-*.js`/`finance-*.js` file.

## Open tasks from the tracker
"Financial Dashboard" (todo, detailed checklist, unchecked), "Payroll Automation" (todo, detailed checklist, unchecked — but see disagreement).

## Commits in window that touched it
None.

## Disagreement
Payroll Automation's tracker checklist shows every item unchecked, but substantial guarded, tested code already exists — the evidence is ahead of the tracker here, the opposite of most other cards in this snapshot.
