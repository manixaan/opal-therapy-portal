# Xero Integration Works

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven** (both sub-parts — see Disagreement below on Payroll Automation)
- Addressed since the last audit (window `15acf0c..338f5dc`, 5 commits): **no**. None of the 5 commits touch any backend file listed below. 3 of the 5 commits (`08da79d`, `a56173c`, `dc5dbc4`) touch `frontend/current/mockup_v3.html`, but their diff hunks are confined to lines 103–170 and 4103–4113 (the travel feature and the script-pin block) and the case-notes region near line 127 — nowhere near the Finance tab banner (line 5500) or anything Xero/payroll-related. Verified directly with `git show <commit> -- frontend/current/mockup_v3.html | grep '^@@'`.
- Created (any located code): yes.

## Located

- `backend/finance-routes.js` — mounted at `backend/server.js:646`. Routes: `GET /api/finance/status`, `/dashboard`, `/payroll/overview`, `/payroll/pay-runs/:id`, `/invoicing/summary`. Header comment: "every route: requireAuth + requireRole('owner'); the frontend hide is cosmetic... live Xero calls are GET only."
- `backend/accounting-routes.js` (mounted `server.js:644`, webhook at `:643`), `backend/invoicing-routes.js` (mounted `server.js:648`) — the Splose→Xero sync/invoicing pipeline.
- `backend/xero-payroll-api.js`, `xero-payroll-mapping.js`, `xero-payroll-sync.js`, `xero-payroll-connection.js` — Xero Payroll AU integration; `xero-payroll-sync.js` is the "approved onboarding snapshot → employee in Xero" orchestration = tracker task **Payroll Automation**.
- `backend/onboarding-payroll-routes.js` (mounted `server.js:569`) — mounted payroll-automation routes: `/api/onboarding/journey/records/:id/payroll-setup*` (config, approve, request-changes, sync, retry, recheck, resolve-duplicate, manual-actions). 12 routes, all under this file.
- Frontend: FINANCE TAB banner at `frontend/current/mockup_v3.html:5500` (owner-only, `view-finance`), served by `finance.js` (pinned `?v=1`, `mockup_v3.html:126`), Dashboard/Payroll/Invoicing sub-nav.
- Frontend payroll-setup UI: `frontend/current/onboarding-journey.js` (pinned `?v=81`, `mockup_v3.html:155`) — real rendered panel `payrollPanel`/`payrollConfigForm`, step `oj-payroll-config` (line 1917+), inside the Onboarding Journey tab, **not** the Finance tab. This is a genuine UI, not just an API.

## Guard check

- `finance-routes.js`: `const ownerOnly = [requireAuth, requireRole('owner')];` (line 44), applied via `...ownerOnly` to all 5 routes (lines 73, 95, 167, 203, 221). Re-grepped directly tonight — confirmed.
- `onboarding-payroll-routes.js`: `router.use('/api/onboarding/journey', requireAuth)` (line 148) plus `requirePermission('onboarding.payroll')` on each of the 12 individual payroll-setup routes (lines 150–333). Re-grepped directly tonight — confirmed, no route missing the permission check.
- `accounting-routes.js`: `const ownerOnly = [requireAuth, requireRole('owner')];` (line 62); the Xero OAuth callback at line 102 is `requireAuth` only (expected for an OAuth redirect target).
- `invoicing-routes.js`: `const guard = [requireAuth, requirePermission('manage_billing')];` (line 39); one route (`/api/mmm-zone/lookup`) is `requireAuth` only with a header comment explaining it is read-only and open to any signed-in user — documented, not a defect.
- All guarded correctly. No unguarded endpoint found.

## Tests and results (re-run fresh tonight)

| Command | Result |
|---|---|
| `npx jest tests/finance-routes.test.js tests/finance-flags.test.js tests/xero-payroll-api.test.js tests/xero-payroll-mapping.test.js tests/xero-payroll-sync.test.js tests/invoicing-billing-mark.test.js tests/onboarding-payroll.test.js` (7 unit files) | **PASS — 81/81**, 7/7 suites |
| `DB_NAME=therapy_scheduler_auditg1 DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/accounting-phase2.itest.js tests/integration/accounting-routes.itest.js tests/integration/finance-routes.itest.js tests/integration/invoicing.itest.js --runInBand` | **PASS — 55/55**, 4/4 suites |
| `DB_NAME=therapy_scheduler_auditg1 DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/onboarding-payroll-xero.itest.js --runInBand` | **PASS — 8/8** |
| `node --check` on all 8 located backend files | all OK, no syntax error |
| TODO/FIXME grep on all located backend + frontend files | none found |

Total: **144/144 passing**, zero failures, across 12 test files.

**Correction to last night's file list:** `tests/integration/reconcile-safety.itest.js` was included in last night's table but is unrelated to this feature — it tests the guarded *Outlook calendar* reconciliation (empty-response protection, dry-run, deletion thresholds), not Xero/finance/payroll/invoicing. Confirmed by reading its header comment and grepping it for "xero|finance|payroll|invoic" — zero matches. Dropped from tonight's list; this also explains the apparent test-count drop from last night's "62/62" to tonight's "55/55" for that batch (the 7 reconcile-safety tests were never part of this feature).

No E2E/browser-QA record covers the Finance tab, the Payroll sub-tab, or the onboarding-journey payroll-setup panel. `docs/qa/BROWSER_QA_RESULTS.md` §"Accounting/Xero extraction status" (dated 2026-08-01, build `188334d`) only covers the older `/api/accounting/*` tab-visibility checks, predating the Finance tab's creation (commit `427a063`, 2026-09-17) — confirmed zero mentions of "finance"/"payroll" there otherwise. `e2e/tests/portal.spec.js` is the only e2e spec matching the keyword search (matched on "xero") but only exercises the same old accounting-extraction visibility/403 checks, not Finance, Payroll, or Invoicing sub-nav, and not the onboarding-journey payroll panel.

## Commits in window touching located files

None of the 5 commits in `15acf0c..338f5dc` touch any backend or frontend file listed under "Located" in a way that is substantively relevant to this feature (see the recency note above re: `mockup_v3.html`).

## Breakdown

- **Financial Dashboard (Finance tab): tab-unproven** — no change from last night.
- **Payroll Automation: tab-unproven** — no change from last night (the prior night's downgrade from "proven" still holds; re-verified independently tonight, see Disagreement).

## Open tracker tasks

Both tracker tasks are `status: "todo"` in tonight's snapshot (unchanged):
- Financial Dashboard — all 6 checklist groups unchecked; `next_action` still open. Backend is in fact built and tested (contrary to the todo-looking checklist), but needs a browser/E2E check.
- Payroll Automation — all 6 checklist groups unchecked; backend is fully built and tested (contrary to the todo-looking checklist) with a real UI panel (`onboarding-journey.js`), but that panel is unproven in a browser; needs a browser/E2E check, not just a tracker-checklist update.

## Disagreement / notes

Agree with last night's finding on both counts:

1. **Financial Dashboard is tab-unproven** — confirmed again: the one relevant browser-QA record predates the Finance tab's creation by a month (`427a063`, 2026-09-17 vs. the record's 2026-08-01 date).
2. **Payroll Automation should stay tab-unproven, not "proven."** The backend is fully tested (81/81 unit + 63/63 integration passing tonight across all files touching it) and correctly guarded, and it has a real frontend panel (`payrollPanel`/`payrollConfigForm` in `onboarding-journey.js`) — but no browser or E2E test exercises that panel. Per the rubric ("proven ... and (for a tab) a browser or E2E test covers the tab"), a feature with a real but browser-unverified UI panel is `tab-unproven`. Re-verified independently tonight by re-reading the rubric, re-running every test, and re-confirming the absence of any browser-QA or e2e coverage of that panel — same conclusion as last night, now with fresh evidence rather than carried-over numbers.

The tracker's own `claude_update`/`next_action` (checked in the snapshot) already reflect this tab-unproven-for-both-parts position and the "open Finance tab + onboarding-journey payroll panel, add browser/E2E checks" next step — no disagreement with the tracker's current text tonight.
