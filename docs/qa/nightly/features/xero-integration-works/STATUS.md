# Xero Integration Works

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven**
Addressed in this change window: **no** · Created: **yes**

## Located files

`backend/accounting-routes.js`, `backend/finance-routes.js`, `backend/invoicing-routes.js`, plus `backend/accounting-exceptions.js`, `backend/accounting-db.js`, `backend/xero-sync.js`, `backend/xero-api.js`, `backend/xero-payroll-db.js`, `backend/xero-payroll-connection.js`, `backend/xero-payroll-sync.js`, `backend/xero-payroll-api.js`, `backend/xero-payroll-mapping.js`. Frontend: standalone `frontend/current/finance.js/.css`; accounting UI lives inline in `mockup_v3.html` (`ACCOUNTING TAB` line 5422, `FINANCE TAB` line 5508, `INVOICING TAB` line 5532, `BILLING DASHBOARD TAB` line 5538, all owner-only).

Guarded, all owner/permission-gated: `accounting-routes.js`'s `ownerOnly = [requireAuth, requireRole('owner')]` on every route except the OAuth callback (`requireAuth` only — correct, an external redirect can't carry a role check); `finance-routes.js` states the contract in its header ("every route: requireAuth + requireRole('owner')") and applies it to all 5 routes; `invoicing-routes.js` uses `requirePermission('manage_billing')` instead of hard owner-only, matching its tab banner's note. No unguarded route found. No TODO/FIXME.

Behaviour without a live Xero connection is a deliberate fail-closed design, not a silent mock: `xero-api.js`/`xero-payroll-connection.js` expose `isConfigured()`/`connected:false` rather than faking data; `xero-payroll-sync.js` gates writes behind `ENABLE_XERO_WRITE`/`ENABLE_XERO_PAYROLL_SYNC` feature flags and surfaces a `MANUAL_XERO_ACTION_REQUIRED` stop state. The literal string "xero offline in test" was confirmed at runtime tonight (`finance-routes.js`'s integration test logs `recurring invoices unavailable {"error":"xero offline in test"}` and `profit and loss unavailable {"error":"xero offline in test"}`).

## Tests

- Unit (5 files): `xero-payroll-api.test.js`, `xero-payroll-mapping.test.js`, `xero-payroll-sync.test.js`, `finance-flags.test.js`, `finance-routes.test.js` — **70/70 pass**
- Integration (5 files): `accounting-routes.itest.js`, `accounting-phase2.itest.js`, `finance-routes.itest.js`, `invoicing.itest.js`, `onboarding-payroll-xero.itest.js` — **63/63 pass**

## Browser / E2E proof

`e2e/tests/portal.spec.js` has two tests proving the hide/gate boundary for non-owners (tab/section hidden, `/api/accounting/*` 403). `docs/qa/BROWSER_QA_RESULTS.md` entry H confirms the owner sees the tab gated by `data-owner-only="1"` with `connected:false`, `xeroWrite:false`, `draftInvoiceCreate:false`, and explicitly states "no Xero connection attempted, no write action exercised." Nothing anywhere proves a real Xero sandbox OAuth connection or a live payroll/invoice push.

## Open tasks from the tracker

"Financial Dashboard" (todo), "Payroll Automation" (todo) — no further detail text.

## Commits in the window touching this feature

None — `backend/accounting-routes.js`, `finance-routes.js`, `invoicing-routes.js` did not change in the last 14 days.

## Disagreement

None.
