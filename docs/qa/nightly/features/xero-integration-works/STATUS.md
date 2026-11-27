# Xero Integration Works

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven**
Addressed since last audit (2026-11-26, commit `f5fc28d` — unchanged, zero new commits tonight): no
Created (any located code): yes

## Located files

- Financial Dashboard → `backend/finance-routes.js` (dashboard/payroll-overview/
  invoicing-summary endpoints). Frontend tab: `============ FINANCE TAB (owner-only)
  ============` (`mockup_v3.html:5865`).
- Payroll Automation → `backend/finance-routes.js` payroll endpoints +
  `backend/accounting-routes.js` (Xero sync/reconciliation/candidates) +
  `backend/onboarding-payroll-routes.js`. Adjacent tabs sharing the Xero boundary:
  `INVOICING TAB` (`mockup_v3.html:5889`), `ACCOUNTING TAB (owner-only)`
  (`mockup_v3.html:5775`).

## Guard check

`finance-routes.js` and `accounting-routes.js`: every route is `...ownerOnly`
(`requireAuth` + `requireRole('owner')`) — the file header states this explicitly.
`invoicing-routes.js`: router-level `requireAuth` + `requirePermission('manage_billing')`. All
CRITICAL-sensitivity routes solidly guarded.

## Tests

- Unit: `finance-flags.test.js`, `finance-routes.test.js`, `xero-payroll-api.test.js`,
  `xero-payroll-mapping.test.js`, `xero-payroll-sync.test.js`, `onboarding-payroll.test.js`,
  `invoicing-billing-mark.test.js` — **6/6 suites, 74/74 tests passed**. `billing-*.test.js`
  (bundled under the same claim in a prior night's tracker note) — **3/3 suites, 72/72 tests
  passed**.
- Integration: `finance-routes.itest.js`, `accounting-routes.itest.js`,
  `accounting-phase2.itest.js`, `invoicing.itest.js`, `invoicing-splose.itest.js` — all passed
  clean as part of a 16-file shared batch. `onboarding-payroll-xero.itest.js` also passed as
  part of the onboarding integration batch (169/169).
- Browser/E2E: no E2E spec for finance/payroll/accounting. `docs/qa/BROWSER_QA_RESULTS.md` row
  H (2026-08-01) only confirms tab-hide/403 role-gating and that Xero shows disconnected — it
  explicitly states "no Xero connection attempted, no write action exercised." A real Xero
  sandbox connection has never been confirmed live in a browser.

## Open tasks (from tracker)

- Financial Dashboard — todo, unchanged.
- Payroll Automation — todo; the live Xero connection is still unconfirmed.

## Commits since last audit (2026-11-26)

None — `origin/develop` is unchanged at `f5fc28d`. (The invoicing-Xero commits this audit
first noticed — `79ab915`, `0f261aa`, `915f795` — all predate 2026-11-26 and are already
reflected in the passing test counts above; they are not new tonight.)

## Technical note

During the onboarding integration run, a startup warning fired:
`ONBOARDING_ENCRYPTION_KEY is not set — falling back to TOKEN_ENCRYPTION_KEY` (test
environment only — `onboarding-crypto` module). The warning itself says rotating the OAuth
token key would otherwise make every stored tax/bank value permanently unreadable. Worth
confirming a dedicated `ONBOARDING_ENCRYPTION_KEY` is actually provisioned in staging/production
secrets, since this feature stores payroll/bank data behind that key.

## Disagreement

None on stage. Matches the tracker's own long-running claim: heavily tested against a mocked
Xero client, but a real sandbox connection has never been confirmed live — twelfth night
running per the tracker's own note.
