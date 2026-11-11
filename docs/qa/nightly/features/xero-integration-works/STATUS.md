# Xero Integration Works

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven**
Addressed in this change window: **no** · Created: **yes**

## Located files

`backend/accounting-routes.js`, `backend/finance-routes.js`, `backend/invoicing-routes.js`, plus `backend/accounting-exceptions.js`, `backend/accounting-db.js`, `backend/xero-sync.js`, `backend/xero-api.js`, `backend/xero-payroll-db.js`, `backend/xero-payroll-connection.js`, `backend/xero-payroll-sync.js`, `backend/xero-payroll-api.js`, `backend/xero-payroll-mapping.js`. Frontend: standalone `frontend/current/finance.js/.css`; accounting UI lives inline in `mockup_v3.html` (`ACCOUNTING TAB` line 5422, `FINANCE TAB` line 5508, `INVOICING TAB` line 5532, `BILLING DASHBOARD TAB` line 5538, all owner-only).

Guarded, re-confirmed by direct grep tonight: `accounting-routes.js`'s `ownerOnly = [requireAuth, requireRole('owner')]` on every route except the OAuth callback (`requireAuth` only — correct, an external redirect can't carry a role check); `finance-routes.js` applies `requireAuth + requireRole('owner')` to all 5 routes; `invoicing-routes.js` uses `requirePermission('manage_billing')` (one incidental `requireAuth`-only route, `/api/mmm-zone/lookup`, is explicitly commented as intentional — "any signed-in user may book"). No unguarded route found.

Fail-closed design confirmed again tonight: tonight's own integration run logged `WARN finance: recurring invoices unavailable {"error":"xero offline in test"}` and the matching profit-and-loss line — no live Xero sandbox reachable, and the code reports that honestly rather than faking data.

## Tests

- Unit (5 files): `xero-payroll-api.test.js`, `xero-payroll-mapping.test.js`, `xero-payroll-sync.test.js`, `finance-flags.test.js`, `finance-routes.test.js` — run tonight as part of a combined 17-file batch with Inductions and Opa Mobile Companion; all 17 files passed (539/539). `invoicing-billing-mark.test.js` also run tonight on its own — **4/4 pass**.
- Integration (5 files): `accounting-routes.itest.js`, `accounting-phase2.itest.js`, `finance-routes.itest.js`, `invoicing.itest.js` run tonight on isolated DB `therapy_scheduler_audit_g5_test` as part of a combined 14-file batch with the Splose/Outlook integration tests (all 14 passed, 159/159); `onboarding-payroll-xero.itest.js` run tonight on isolated DB `therapy_scheduler_audit_g4_test` as part of the onboarding integration batch (all 10 passed, 218/218).

## Browser / E2E proof

`e2e/tests/portal.spec.js` has two tests proving the hide/gate boundary for non-owners (tab/section hidden, `/api/accounting/*` 403). `docs/qa/BROWSER_QA_RESULTS.md` entry H confirms the owner sees the tab gated by `data-owner-only="1"` with `connected:false`, `xeroWrite:false`, `draftInvoiceCreate:false`, and explicitly states "no Xero connection attempted, no write action exercised." Nothing anywhere proves a real Xero sandbox OAuth connection or a live payroll/invoice push. Unchanged since no commits landed in this window.

## Open tasks from the tracker

"Financial Dashboard" (todo), "Payroll Automation" (todo) — no further detail text.

## Commits in the window touching this feature

None. No commits landed on `develop` since last night's audit — `develop` is still at `40669e7`, the exact commit audited last night and re-verified again tonight.

## Disagreement

None.
