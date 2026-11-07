# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window: no
- Created (any located code): yes

## Located files
- backend/finance-routes.js (Finance tab API, owner-only)
- backend/accounting-routes.js (Accounting extraction, owner-only)
- backend/onboarding-payroll-routes.js (Payroll-to-Xero sync, onboarding.payroll permission)
- frontend/current/finance.css, finance.js
- mockup_v3.html: ACCOUNTING TAB (line 5422), FINANCE TAB (line 5508)

## Guard check
requireAuth + requireRole('owner') on finance-routes.js and accounting-routes.js (ownerOnly array); onboarding-payroll-routes.js uses requirePermission('onboarding.payroll'). No unguarded route found.

## Tests and results
- unit: finance-flags.test.js, finance-routes.test.js, onboarding-payroll.test.js, xero-payroll-api.test.js, xero-payroll-mapping.test.js, xero-payroll-sync.test.js — 77 passed
- integration: accounting-phase2.itest.js, accounting-routes.itest.js, finance-routes.itest.js, onboarding-payroll-xero.itest.js — 39 passed

## Open tracker tasks
- Financial Dashboard (todo)
- Payroll Automation (todo)

## Commits in the 14-day change window touching this feature
Not touched in the 14-day change window (no commit under finance-routes.js, accounting-routes.js or onboarding-payroll-routes.js since 2026-10-24).

## Why this label
Owner-only Finance/Accounting/Payroll code is built, guarded and fully covered by 116 passing tests (77 unit + 39 integration), but every Xero call in the integration run returns 'xero offline in test' — nothing here has exercised a real Xero sandbox connection or a live payroll push. Browser QA entry H confirms the tab renders and is gated for the owner role only, but explicitly notes no Xero connection was attempted.
