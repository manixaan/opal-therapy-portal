# Xero Integration Works

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven**
Addressed since last audit (2026-11-26, commit `f5fc28d`): **yes** — 4 new commits tonight
Created (any located code): yes

## Located files
- `backend/accounting-routes.js`, `backend/invoicing-routes.js`, `backend/finance-routes.js`
- `backend/xero-api.js`, `backend/xero-sync.js`
- `backend/xero-payroll-api.js`, `backend/xero-payroll-mapping.js`, `backend/xero-payroll-sync.js`,
  `backend/xero-payroll-connection.js`, `backend/xero-payroll-db.js`
- `backend/billing/` (engine, nf2f-timer, run-jobs, quick-fix)
- Frontend: `ACCOUNTING TAB`, `FINANCE TAB`, `INVOICING TAB` (all owner-only) in `mockup_v3.html`

## Guard check
`requireAuth` + `requirePermission`/`requireRole` on every route in accounting-routes.js,
invoicing-routes.js and finance-routes.js. No missing guards found.

## Tests (run tonight)
- Unit: 8 suites / **128 passed** (xero-payroll-api/mapping/sync, invoicing-billing-mark,
  invoicing-run-jobs, billing-engine, finance-flags, finance-routes). This is a narrower
  grouping than a prior night's "146" figure (which also folded in onboarding-payroll.test.js);
  both counts are consistent with each other, just drawn with a different boundary.
- Integration (`DB_NAME=therapy_scheduler_audit`): 6 suites / **96 passed**
  (accounting-phase2, accounting-routes, finance-routes, invoicing-quick-fix,
  invoicing-splose, invoicing). Logs showed `WARN finance: ... "xero offline in test"` —
  every Xero-touching test mocks the Xero client; nothing here exercises a real connection.
- `node --check`: all located files OK. No TODO/FIXME found.

## Browser/tab evidence
`docs/qa/BROWSER_QA_RESULTS.md` row H (2026-08-01): owner sees the Accounting tab, correctly
gated; `xeroWrite:false`, `xero connected:false`; explicitly "no Xero connection attempted,
no write action exercised." No E2E spec covers it. A real Xero sandbox connection has still
never been confirmed live, in a browser, with a real account — this is the specific, narrow
gap driving the `tab-unproven` label tonight, same as every prior night.

## Open tasks from the tracker
- **Financial Dashboard** (todo) — every checklist item unchecked (confirm metrics,
  confirm Xero connection, build the page, show figures, test with real figures).
- **Payroll Automation** (todo) — every checklist item unchecked (learn Xero's API,
  decide fields, set up the connection, map data, send and confirm).

## Disagreement
Both tasks' checklists read as if nothing has started, but the Accounting/Finance/
Invoicing tabs and the full Xero payroll pipeline (api/mapping/sync/connection/db)
already exist, are guarded, and are heavily tested. The tracker undersells what is
built. The one thing genuinely missing, on both the task list and the evidence, is a
**real** Xero sandbox connection proven live — every test still mocks it.

## Commits since last audit (2026-11-26, commit f5fc28d)
4 new commits tonight, all `feat(invoicing)`: `d8c861c` (block review → Needs attention),
`1445bc7` (practice ABN on every invoice), `0a17228` (Fix/Dismiss attention list, Xero-driven
status), `4e542d9` (edit invoices in place, quick fixes, drafts in background). None of these
touch the real Xero connection question above — they're all portal-side invoicing UI/logic.
