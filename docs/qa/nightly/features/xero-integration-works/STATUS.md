# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (real external-system verification
  still outstanding; everything testable in-repo already passes)
- Addressed this window: no (no commits since 2026-09-27)
- Created at all: yes

## Located files

`backend/accounting-routes.js`, `backend/finance-routes.js`,
`backend/xero-api.js`, `backend/xero-payroll-api.js`,
`xero-payroll-connection.js`, `xero-payroll-db.js`, `xero-payroll-mapping.js`,
`xero-payroll-sync.js`, `backend/accounting-db.js`, `accounting-exceptions.js`;
onboarding side: `backend/onboarding-payroll-routes.js`,
`onboarding-payroll.js`. Frontend: ACCOUNTING TAB owner-only
(`mockup_v3.html:5298`) and FINANCE TAB owner-only (`mockup_v3.html:5384`,
with Dashboard/Payroll/Invoicing sub-nav calling `/api/finance/dashboard`,
`/api/finance/payroll/overview`, `/api/finance/invoicing/summary`). Tests: 5
unit files (xero-payroll-api, xero-payroll-mapping, xero-payroll-sync,
finance-flags, finance-routes) + 4 integration files (onboarding-payroll-xero,
accounting-routes, accounting-phase2, finance-routes) + `onboarding-payroll.test.js`.

## Guard status

**Every** route in `accounting-routes.js` and `finance-routes.js` is
owner-only (`[requireAuth, requireRole('owner')]`) — confirmed across all 28
accounting routes and all 5 finance routes, zero exceptions among the
data-serving/mutating endpoints. The one bare-`requireAuth` route is the
OAuth redirect target `GET /api/accounting/xero/callback`
(`accounting-routes.js:102`), which performs an inline
`if (req.user?.role !== 'owner') return res.status(403)...` check plus
OAuth `state` CSRF validation and an audit log on mismatch — a deliberate,
correct design for a redirect target that needs a custom HTML error page,
not a guard gap.

## Tests run

- `npx jest tests/xero-payroll-api.test.js tests/xero-payroll-mapping.test.js tests/xero-payroll-sync.test.js tests/finance-flags.test.js tests/finance-routes.test.js` → 5 suites, 70 tests passed.
- `DB_NAME=therapy_scheduler_auditD DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/onboarding-payroll-xero.itest.js tests/integration/accounting-routes.itest.js tests/integration/accounting-phase2.itest.js tests/integration/finance-routes.itest.js --runInBand` → 4 suites, 39 tests passed (logs show `xero offline in test` warnings handled gracefully — tests run against a mocked/offline Xero).
- `npx jest tests/onboarding-payroll.test.js` → 1 suite, 7 tests passed.
- **"116 tests" claim: confirmed exactly.** 70 + 39 + 7 = 116 passing tests
  across these 10 files. No TODO/FIXME found; `node --check` clean on all
  touched files.

## Classification by sub-thing

- **Xero OAuth connection code: proven.** `xero-api.js` (standard accounting
  Xero OAuth2) and `xero-payroll-connection.js` (separate client-credentials
  config) both exist, owner-gated, tested; `isConfigured()` correctly treats
  a placeholder as unconfigured.
- **Financial Dashboard: tab-unproven.** The backend genuinely does what the
  tracker idea asks — `finance-routes.js:95` `/api/finance/dashboard` reads
  live Xero `RepeatingInvoices` and `/Reports/ProfitAndLoss`, merged with
  internal invoicing data, and it's tested (part of the 116). But no e2e
  spec and no `docs/qa/BROWSER_QA_RESULTS.md` entry mentions the Finance
  tab or its Dashboard/Payroll/Invoicing sub-nav by name — the doc's "Billing
  tab" discussion covers the separate Accounting tab and Billing Dashboard
  tab, not this one.
- **Payroll Automation: proven at the code+test level, needs-refinement for
  the live-external-system gap.** `onboarding-payroll-routes.js` +
  `xero-payroll-mapping.js`/`sync.js` already implement real field mapping
  and sync logic, owner-only, covered by `onboarding-payroll-xero.itest.js`.
  The open tracker item is dominantly "register the portal with a real
  Xero account" / live-sandbox verification, not an engineering gap.
  `docs/qa/BROWSER_QA_RESULTS.md`: "no Xero connection attempted, no write
  action exercised."

## Open tasks from the tracker

- "Financial Dashboard" (todo, 0/6 checked) — backend is well ahead of the
  checklist; the dashboard tab itself has never been exercised in a
  browser.
- "Payroll Automation" (todo, 0/6 checked) — field mapping/sync already
  implemented; the open item is live-Xero verification, not "learn what
  Xero needs."

## Commits in the window

None.

## Disagreement note

Confirms the core claim, refines the dashboard-tab nuance. "Built,
owner-gated, 116 passing tests, only verified against a pretend Xero" is
now verified independently and exactly (test count matched to the test).
The Financial Dashboard's *tab* specifically has zero browser/E2E evidence
even though its API is solid — worth tracking separately from Payroll
Automation, which has its real-world caveat already flagged correctly.
