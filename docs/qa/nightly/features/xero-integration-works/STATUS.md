# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed this window (since 2026-11-01): No — no commits touched the Xero/accounting source files in that period.
- Created: Yes — substantial code exists, well beyond what the tracker's "idea" stage and checklists suggest.

## Located files

- Routes: `backend/accounting-routes.js` (owner-only everywhere; the Xero OAuth callback uses `requireAuth` plus an inline `req.user.role !== 'owner'` check, audited via `audit(req, 'finance.xero_oauth_state_mismatch'...)` / `'finance.xero_connected'`)
- Data/API: `backend/accounting-db.js`, `backend/xero-api.js`, `backend/xero-sync.js`, `backend/xero-payroll-api.js`, `backend/xero-payroll-sync.js`, `backend/xero-payroll-mapping.js`, `backend/xero-payroll-connection.js`, `backend/xero-payroll-db.js`
- Frontend: `frontend/current/mockup_v3.html` — `FINANCE TAB (owner-only)` (~line 5500) with Dashboard / Payroll / Invoicing subnav; a separate `ACCOUNTING TAB (owner-only)` (~line 5414) also exists

## Tests run

| Test | Result |
|---|---|
| `npx jest tests/xero-payroll-api.test.js tests/xero-payroll-mapping.test.js tests/xero-payroll-sync.test.js` | ✅ 3 suites / 50 tests passed (re-run 2026-11-02, unchanged) |
| `DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/accounting-phase2.itest.js tests/integration/accounting-routes.itest.js tests/integration/onboarding-payroll-xero.itest.js --runInBand` | ✅ 3 suites / 36 tests passed (re-run 2026-11-02, unchanged) |
| Browser/E2E coverage of the Finance tab itself | ❌ none current — see below |

`node --check accounting-routes.js` / `xero-sync.js` — clean.

## Guard check

Every `/api/accounting/*` route is wrapped in `...ownerOnly` (`requireAuth` + `requireRole('owner')`). The one exception, the OAuth callback (a redirect target that can't carry the normal middleware chain), enforces the same rule inline and audits a mismatch. No unguarded route found.

## Open tracker tasks

- Financial Dashboard — `todo`
- Payroll Automation — `todo`

## Commits in window touching this subsystem

None. `backend/accounting-*.js` and `backend/xero-*.js` were not touched since 2026-11-01.

## Disagreement

Tracker stage is `idea` with both checklists still `todo`, but the code is a mature, owner-gated, fully-tested Xero payroll sync and dashboard backend (86 passing tests). The tracker significantly **understates** what already exists — not a safety concern, but worth correcting so nobody re-builds it.

The one real gap is proof the **Finance tab itself** renders and shows correct figures in a browser: `docs/qa/BROWSER_QA_RESULTS.md` is dated 2026-08-01, predates the Oct 22+ onboarding/payroll rework, and its "Accounting extraction status" row (H) covers the separate Accounting tab, not Finance. No E2E spec covers either tab.
