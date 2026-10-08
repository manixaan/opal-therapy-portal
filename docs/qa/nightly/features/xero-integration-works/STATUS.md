# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window (commits since 2026-10-07 touching its located files): **no** — zero commits have landed
  on `develop` under `backend/` or `frontend/current/` since the last audit (2026-10-07); the audited commit
  (`aacf8e68`) is unchanged. This is the eighth consecutive reconfirmation night on this exact code.
- Created (any located code at all): **yes**

## Located files
- `backend/finance-routes.js` — Financial Dashboard (`/api/finance/dashboard`, `/api/finance/payroll/overview`,
  `/api/finance/invoicing/summary`, etc.)
- `backend/accounting-routes.js` — Xero connect/sync/webhook (`/api/accounting/xero/*`)
- `backend/onboarding-payroll-routes.js` — Payroll Automation / Xero payroll setup
- `backend/finance-db.js`, `backend/accounting-db.js`, `backend/xero-payroll-db.js` — data access (token
  encryption, read-only Xero-cache aggregation)
- `backend/xero-api.js`, `backend/xero-payroll-api.js`, `backend/xero-payroll-connection.js`,
  `backend/xero-payroll-mapping.js`, `backend/xero-payroll-sync.js`, `backend/xero-sync.js` — integration helpers
- Frontend: `<!-- ACCOUNTING TAB (owner-only) -->` (mockup_v3.html:5298) and `<!-- FINANCE TAB (owner-only) -->`
  (mockup_v3.html:5384), backed by `frontend/current/finance.js`/`finance.css`

## Guard check
Every route in `finance-routes.js` and `accounting-routes.js` uses `ownerOnly = [requireAuth, requireRole('owner')]`,
with one exception: `GET /api/accounting/xero/callback` (accounting-routes.js:102) uses `requireAuth` alone (no
`requireRole('owner')`) — this is the OAuth redirect endpoint. It does not fit the self-scoped exception (it isn't
personal data), but it also performs no state-changing action without a subsequent owner-gated step; flagging as a
guard-adjacent observation, not "broken: unguarded endpoint", consistent with how this audit treats similar
guard-adjacent findings elsewhere (see Splose/Outlook). `onboarding-payroll-routes.js` uses
`requirePermission('onboarding.payroll')` throughout. No gaps found beyond this one observation.

## Tests run tonight
- unit: `finance-routes.test.js, finance-flags.test.js, xero-payroll-api.test.js, xero-payroll-mapping.test.js,
  xero-payroll-sync.test.js` — 70/70 pass
- integration (`DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit`): `finance-routes.itest.js,
  accounting-routes.itest.js, accounting-phase2.itest.js, onboarding-payroll-xero.itest.js` — 39/39 pass

## Open tasks (from the tracker)
- Financial Dashboard — build, todo
- Payroll Automation — build, todo

## Compare with the tracker
None new. The tracker's own `claude_update` already says this is built, guarded and tested, with the open item
being confirmation against a real connected Xero sandbox account — matches the evidence exactly.
