# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-22 → 2026-09-23): no — zero commits landed in this window at all
- Created (any located code): yes — extensively

## Located files

- Routes: `backend/finance-routes.js` (Finance tab: dashboard, payroll, invoicing summary — all read-only), `backend/accounting-routes.js` (Xero connect/sync/candidates/reconciliation/contacts — the older Accounting tab, includes writes such as draft-invoice creation)
- Data access: `backend/finance-db.js`, `backend/accounting-db.js`, `backend/finance-flags.js`, `backend/xero-api.js`, `backend/xero-payroll-api.js`, `backend/xero-payroll-connection.js`, `backend/xero-payroll-db.js`, `backend/xero-payroll-mapping.js`, `backend/xero-payroll-sync.js`, `backend/xero-sync.js`, `backend/accounting-exceptions.js`
- Frontend: `frontend/current/finance.js` + `finance.css`, mounted at `<!-- ============ FINANCE TAB (owner-only) ============ -->` (mockup_v3.html:5377); a separate, older `<!-- ============ ACCOUNTING TAB (owner-only) ============ -->` (mockup_v3.html:5291) covers Xero connection/sync/reconciliation/contacts

## Guard check

Both route files guard every route with `requireAuth` + `requireRole('owner')` (`ownerOnly` array), applied per-route, not just at the router level. `finance-routes.js`'s own header states this explicitly and notes the frontend hide is cosmetic only — the backend guard is the real one. No unguarded route found.

## Tests

- Unit (all pass): `tests/finance-flags.test.js`, `tests/finance-routes.test.js`, `tests/xero-payroll-api.test.js`, `tests/xero-payroll-mapping.test.js`, `tests/xero-payroll-sync.test.js` — 5 suites, 70 tests, 0 failures
- Integration (all pass): `tests/integration/accounting-phase2.itest.js`, `tests/integration/accounting-routes.itest.js`, `tests/integration/finance-routes.itest.js` — 3 suites, 31 tests, 0 failures (DB: `therapy_scheduler_audit_test`)
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` row **H — Accounting extraction status** covers the *Accounting* tab (owner-gated, Xero unconnected, write flags false, 9/9 ✅) — but that QA run is dated 2026-08-01, predates this Finance tab entirely (added 2026-09-17), and never mentions Finance/dashboard/payroll. `e2e/tests/portal.spec.js` only exercises `/api/accounting/*` 403s for non-owner roles, not the Finance tab. **No browser or E2E evidence exists for the Finance tab (dashboard/payroll/invoicing) specifically.**

## Open tasks from the tracker

- "Financial Dashboard" — `todo`. Checklist confirms metrics, Xero connection, gathering figures, building the page, owner-only access, testing accuracy — all appear satisfied by the code found, but the checklist itself is untouched (still all unchecked).
- "Payroll Automation" — `todo`. Checklist covers Xero API research, which payroll fields to send, secure connection setup, mapping onboarding document data into Xero's layout, sending and confirming, and sign-off. The built code covers Xero Payroll AU *read* (overview, pay runs) — the checklist's "send payroll data into Xero" (a write path) was not located; this looks broader than what's built.

## Commits in the window that touched it

None (2026-09-22 → 2026-09-23) — `develop` did not move since last night (both audits sit on
`74601fc`). Re-verified fresh anyway: unit (70/70) and integration (31/31, run under a session-unique
`DB_NAME`) both re-run tonight with identical results to last night — no regression.

## Disagreement

Tracker stage says `idea` (implying nothing started) while the evidence shows a fully built, guarded, unit- and integration-tested Finance tab — the tracker *undersells* the work. This is not the "tracker ahead of evidence" kind of disagreement the brief prioritises, but it is worth a person's attention: the "Financial Dashboard" checklist items look done in code and could be ticked. Separately, the tracker's "Payroll Automation" task describes writing payroll data *into* Xero; only a read path was located — if that write path exists elsewhere it wasn't found under the finance/xero/accounting file names searched.
