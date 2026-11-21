# Xero Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-11-20..2026-11-21): **yes — heavily**
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
- unit: `billing-engine, splose-billing-source, travel-parity, finance-flags, finance-routes, invoicing-billing-mark, pricing-engine, reconciliation-engine, xero-payroll-api, xero-payroll-mapping, xero-payroll-sync, mmm-locality` — **pass** (12 files / 215 tests)
- integration: `invoicing-splose, invoicing, accounting-routes, accounting-phase2, finance-routes, onboarding-payroll-xero` — **pass** (6 files / 90 tests, includes expected "Xero offline in test" warnings — correct fail-closed behaviour, not failures). First attempt against the shared `DB_NAME=therapy_scheduler_audit` showed 46/51 failures (deadlocks) because a sibling audit worker (the Splose-Outlook-feature fork) was running its own integration suite against the same database name concurrently — a cross-process DB collision, not a code defect. Re-run against an isolated database name gave a clean pass. **Flagged in the brief's Technical detail: tonight's bootstrap should give each verification worker its own `DB_NAME` suffix.**

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md row H (owner-gated, Xero connected:false) — dated 2026-08-01, stale relative to this window, but exists.

## Recency
**Heavily addressed tonight.** 14 commits in the window touch billing/invoicing/Xero specifically: a new NDIS travel-billing rule book (detours, mixed zones, trip hours — e.g. "a metro client's drive home is billed on a mixed-zone day"), batch invoice sending ("tick invoices and send them all, each exactly once"), one-Xero-copy-per-invoice ("every sent invoice is copied to Xero once, with the same number"), a new payer directory, and a follow-up fixing "the Xero and email gaps found in review". Unit test count rose from 81 (7 files) to 215 (12 files); integration rose from 63 (5 files) to 90 (6 files) — all green, no regression.

## Open tasks (from the tracker)
- Financial Dashboard — todo
- Payroll Automation — todo

## Reason for the label
Tonight's work substantially deepened the invoicing/billing logic and it is fully guarded and heavily tested — but every Xero-touching test mocks the Xero client, so no real/sandbox Xero call has ever been exercised. The "never confirmed live in a browser" gap from every prior night stands exactly as before, which is why this stays `tab-unproven` rather than moving to `proven`.

## Disagreement with the tracker
Tracker stage is "idea" while the backend is built and now even more heavily tested than last night — the tracker under-describes how much exists.
