# Xero Integration Works

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window: no
- Created (any located code): **yes** — both sub-tasks substantially built

## Located files

- Backend: `backend/accounting-routes.js`/`accounting-db.js`/`accounting-exceptions.js`
  (Xero connect/sync/candidates/reconciliation), `backend/xero-api.js` (OAuth + token refresh
  client), `backend/xero-sync.js`, `backend/xero-payroll-{api,connection,db,mapping,sync}.js`
  (Xero Payroll AU), `backend/finance-{routes,db,flags}.js` (owner Finance dashboard).
- Frontend: `mockup_v3.html:5422` `ACCOUNTING TAB (owner-only)`, `:5508` `FINANCE TAB
  (owner-only)`; `frontend/current/finance.js/.css`.
- Guards: all `accounting-routes.js`/`finance-routes.js` endpoints use
  `ownerOnly = [requireAuth, requireRole('owner')]`. Only exception:
  `GET /api/accounting/xero/callback` is `requireAuth`-only — expected, it's the OAuth redirect
  target, not a data endpoint. Payroll sync trigger gated by the delegated `onboarding.payroll`
  permission. No unguarded routes.

## Tests and results

- Unit: `finance-flags.test.js`, `finance-routes.test.js`, `xero-payroll-{api,mapping,sync}.test.js`
  — **all pass** (70 tests: 14+6+11+24+15 — corrects the 2026-11-04 brief's "120", a miscount in
  that run, not a code change; re-counted individually tonight to confirm).
- Integration: `accounting-phase2.itest.js`, `accounting-routes.itest.js`,
  `finance-routes.itest.js` — **all pass** (31 tests).

## Open tasks from the tracker

- "Financial Dashboard" — todo, all checklist items unchecked.
- "Payroll Automation" — todo, all checklist items unchecked.

## Browser QA

`docs/qa/BROWSER_QA_RESULTS.md:29` has an Accounting-tab entry (owner-gated, Xero unconnected,
every write flag false, ✅ 9/9) but no separate Finance-tab entry, and no browser proof of either
the Financial Dashboard combining Xero + internal invoicing, or the Payroll→Xero push, actually
working against a live or sandboxed Xero connection.

## Disagreement

Both tracker tasks read as checklists fully undone (`todo`, 0 items checked), but substantial,
guarded, tested code already exists for both: `finance-routes.js:95` `GET /api/finance/dashboard`
combines internal invoicing with live Xero reads (RepeatingInvoices, Profit & Loss), degrading
gracefully on Xero failure; `xero-payroll-sync.js` performs the full Employees/Superfunds push
with idempotency keys, driven from onboarding stage-2 data. The tracker significantly
**underclaims** what's already built here.
