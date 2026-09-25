# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-24 → 2026-09-25): no — zero commits landed in this window at all. The one commit that built this feature (`427a063`, "Finance tab — dashboard, payroll and invoicing over Xero") landed 2026-09-17, over a week before this window.
- Created (any located code): yes — extensively

## Located files

- Routes: `backend/finance-routes.js` (Finance tab: dashboard, payroll, invoicing — read-only), `backend/accounting-routes.js` (older Accounting tab: Xero connect/sync/candidates/reconciliation/contacts, includes writes such as draft-invoice creation)
- Data access: `backend/finance-db.js`, `accounting-db.js`, `finance-flags.js`, `xero-api.js`, `xero-payroll-api.js`, `xero-payroll-connection.js`, `xero-payroll-db.js`, `xero-payroll-mapping.js`, `xero-payroll-sync.js`, `xero-sync.js`, `accounting-exceptions.js`
- Also relevant, pre-existing and unrelated to this tracker card: `backend/onboarding-payroll-routes.js`/`onboarding-payroll.js` — the *only* place that actually writes to Xero Payroll (creates/configures new-starter employee records), gated by `requirePermission('onboarding.payroll')`. This serves new-starter setup, not recurring payroll sends.
- Frontend: `frontend/current/finance.js`/`.css` under `<!-- FINANCE TAB (owner-only) -->`; a separate, older `<!-- ACCOUNTING TAB (owner-only) -->` covers Xero connection/sync/reconciliation/contacts (inline JS in `mockup_v3.html`, no separate `accounting.js` file)

## Guard check

Both route files guard every route with `requireAuth` + `requireRole('owner')`, applied per-route. `finance-routes.js`'s own header states this explicitly and notes the frontend hide is cosmetic only. No unguarded route found.

## Tests (re-run fresh tonight)

- Unit: `finance-flags.test.js`, `finance-routes.test.js`, `xero-payroll-api.test.js`, `xero-payroll-mapping.test.js`, `xero-payroll-sync.test.js` (plus `onboarding-payroll.test.js` when bundled) — 6 suites / 77 tests, all pass.
- Integration: `accounting-phase2.itest.js`, `accounting-routes.itest.js`, `finance-routes.itest.js` — run tonight in the combined Xero+Report Templates+Assessments batch (8 suites / 232 tests total, 0 failures).
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` row H covers the *Accounting* tab (owner-gated, Xero unconnected, write flags false, 9/9 ✅) — dated 2026-08-01, predates the Finance tab entirely (added 2026-09-17), and never mentions Finance/dashboard/payroll. `e2e/tests/portal.spec.js` only exercises `/api/accounting/*` 403s for non-owner roles. **No browser or E2E evidence exists for the Finance tab specifically.**

## Open tasks from the tracker

- "Financial Dashboard" — `todo`. Checklist (metrics, Xero connection, gathering figures, building the page, owner-only access, testing accuracy) all appear satisfied by the code found; the checklist itself is untouched (still all unchecked) in the tracker.
- "Payroll Automation" — `todo`. Checklist covers Xero API research, mapping onboarding document data into Xero's layout, sending and confirming, sign-off — a **write**/send capability. The built code (`finance-routes.js`) is explicit in its own header that it is **read-only**: "no new writes to Xero... every payroll call uses the read scopes the payroll Custom Connection already holds." Only `GET /api/finance/payroll/overview` and `GET /api/finance/payroll/pay-runs/:id` exist. No path in this codebase sends/writes recurring payroll data into Xero from the Finance tab — the task's own stated ambition is not yet built, only a read-only overview.

## Commits in the window that touched it

None — `develop` sits on `74601fc` again tonight (fourth night running on the same commit). Re-verified fresh: unit (26/26 suites in the shared Xero+Report Templates+Assessments cluster, 1127/1127 tests) and integration (8/8 suites, 232/232 tests in the combined batch) both re-run tonight — no regression.

## Disagreement

Tracker stage says `idea` (implying nothing started) while the evidence shows a fully built, guarded, tested Finance tab — the tracker undersells the work on the Financial Dashboard side. On Payroll Automation specifically, the opposite gap exists: the tracker's task describes writing payroll data *into* Xero, but only a read-only overview was found — if a write path exists it isn't under any finance/xero/accounting/payroll file name searched.
