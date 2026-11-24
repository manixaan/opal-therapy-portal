# Xero Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-11-23..2026-11-24): **no**
- Created (any located code): **yes**

## Located files
- backend/xero-api.js, backend/xero-sync.js
- backend/xero-payroll-{api,connection,db,mapping,sync}.js
- backend/accounting-routes.js, backend/finance-routes.js, backend/invoicing-routes.js
- backend/onboarding-payroll-routes.js
- backend/billing/{billing-issues,billing-profiles,billing-settings,invoice-generation,invoice-lifecycle,payer-directory,session-billing,splose-billing-source,travel-billing,xero-invoice-push}.js
- frontend: invoicing.js/.css, and the ACCOUNTING/FINANCE/INVOICING tabs in mockup_v3.html
- Migrations touched this window: `082_invoicing_splose_source.sql`, `083_billing_payer_directory.sql`, `091_invoice_email_send_state.sql`, `092_xero_invoice_links.sql`, `093_trip_travel_hours.sql` (not run beyond the integration suite's own migration runner)

## Could not locate / notable gaps
A Xero sandbox connection has still not been confirmed live in a browser this run (no browser access; every test that touches Xero mocks `xero-api`/`xero-payroll-api`/`xero-payroll-connection` — confirmed by grep across `finance-routes.test.js` and the integration suites).

## Guard check
OK — `accounting-routes.js` and `finance-routes.js` are `ownerOnly` throughout, including the Xero OAuth callback (can't use router-level middleware since it's a redirect target, but does an explicit `req.user?.role !== 'owner'` check plus CSRF `state` validation before touching tokens). `invoicing-routes.js` is `requireAuth` + `requirePermission('manage_billing')` router-wide, with one documented exception: `/api/mmm-zone/lookup` is requireAuth-only, code-commented as an intentional read-only lookup any signed-in user may hit to book — not a gap. Xero-gateway boundary check: `require('./xero-api')` appears only in `accounting-routes.js` and `finance-routes.js` — no stray imports elsewhere, re-confirmed tonight. No TODO/FIXME found. `node --check` clean on all 14 core files.

## Tests run
- unit: `billing-engine, splose-billing-source, travel-parity, finance-flags, finance-routes, invoicing-billing-mark, pricing-engine, reconciliation-engine, xero-payroll-api, xero-payroll-mapping, xero-payroll-sync, mmm-locality` — **pass** (12 files / 215 tests, re-run fresh tonight)
- integration: `invoicing-splose, invoicing, accounting-routes, accounting-phase2, finance-routes, onboarding-payroll-xero` — **pass** (6 files / 90 tests, re-run fresh tonight on an isolated `DB_NAME`, includes expected "Xero offline in test" / "recurring invoices unavailable" warnings — correct fail-closed behaviour, not failures)

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md row H (owner-gated, Xero connected:false) — dated 2026-08-01, stale relative to this window, but exists.

## Recency
Not touched since the last audit. Two commits landed elsewhere in the repo tonight (21:42 UTC 2026-11-23, after last night's 18:35 UTC audit): the mobile drag-to-move feature and the `event-move.js` calendar-save refactor (see Opa Mobile Companion and Portal - Splose - Outlook's folders) — neither touched this subsystem's files — test counts unchanged: 215 unit (12 files), 90 integration (6 files).

## Open tasks (from the tracker)
- Financial Dashboard — todo
- Payroll Automation — todo

## Reason for the label
The invoicing/billing logic is fully guarded and heavily tested — but every Xero-touching test mocks the Xero client, so no real/sandbox Xero call has ever been exercised. The "never confirmed live in a browser" gap from every prior night stands exactly as before, which is why this stays `tab-unproven` rather than moving to `proven`. Unchanged from last night.

## Disagreement with the tracker
Tracker stage is "idea" while the backend is built and now even more heavily tested than last night — the tracker under-describes how much exists.
