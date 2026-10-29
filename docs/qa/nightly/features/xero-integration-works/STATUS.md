# Xero Integration Works

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven** (both sub-parts — see disagreement on Payroll Automation below)
- Addressed since the last audit (develop unchanged since 2026-10-28, also commit `15acf0c`): no — confirmed by real `git log --since=2026-10-15` on every located file, all empty.
- Created (any located code): yes.

## Located

- `backend/finance-routes.js` — `GET /api/finance/{status,dashboard,payroll/overview,payroll/pay-runs/:id,invoicing/summary}`. Header: "every route: requireAuth + requireRole('owner')... live Xero calls are GET only."
- `backend/accounting-routes.js`, `backend/invoicing-routes.js` — the Splose→Xero sync/invoicing pipeline (writes gated behind fail-closed flags per header comments).
- `backend/xero-payroll-api.js`, `xero-payroll-mapping.js`, `xero-payroll-sync.js`, `xero-payroll-connection.js` — Xero Payroll AU integration; `xero-payroll-sync.js` is the "one approved onboarding snapshot → one employee in Xero" orchestration = tracker task **"Payroll Automation"**.
- `backend/onboarding-payroll-routes.js` — the actual mounted payroll-automation routes: `/api/onboarding/journey/records/:id/payroll-setup*` (config, approve, request-changes, sync, retry, recheck, resolve-duplicate, manual-actions).
- Frontend: FINANCE TAB (owner-only, `mockup_v3.html:5492`), rendered by `finance.js`, with Dashboard/Payroll/Invoicing sub-nav — **added in commit `427a063` (2026-09-17)**: "feat(finance): Finance tab — dashboard, payroll and invoicing over Xero (owner-only, read-only)."
- Frontend payroll-setup UI: `frontend/current/onboarding-journey.js` has a real rendered panel (`payrollPanel`, `payrollConfigForm`, step `oj-payroll-config`) inside the Onboarding Journey tab — **not** inside the Finance tab. This is a genuine UI, not just an API.

## Guard check

`finance-routes.js`: `const ownerOnly = [requireAuth, requireRole('owner')];` applied to every one of its 5 routes — verified by direct grep. `onboarding-payroll-routes.js`: `requireAuth` plus `requirePermission('onboarding.payroll')` on every individual payroll-setup route (12 routes checked). Both correctly guarded.

## Tests and results

| Command | Result |
|---|---|
| `finance-routes`, `finance-flags`, `xero-payroll-api`, `xero-payroll-mapping`, `xero-payroll-sync`, `invoicing-billing-mark` (6 unit files) | PASS — 74/74 |
| `npx jest tests/onboarding-payroll.test.js` | PASS — 7/7 |
| `DB_NAME=therapy_scheduler_audit_g5` `accounting-phase2.itest.js`, `accounting-routes.itest.js`, `finance-routes.itest.js`, `invoicing.itest.js`, `reconcile-safety.itest.js` | PASS — 62/62 |
| `onboarding-payroll-xero.itest.js` | PASS — 8/8 |

No failures. No E2E/browser-QA record covers the Finance tab, payroll tab-content, or the onboarding-journey payroll panel — confirmed by zero mentions of "finance" in `docs/qa/BROWSER_QA_RESULTS.md` (dated 2026-08-01, build `188334d`, which predates commit `427a063` from 2026-09-17 that created the Finance tab), and zero mentions of finance/xero/payroll/invoicing in either e2e spec file (only `/api/accounting/*` visibility checks for a different, older tab).

## Commits in window touching located files

None.

## Breakdown

- **Financial Dashboard (Finance tab): tab-unproven** — no disagreement with the prior night.
- **Payroll Automation: tab-unproven** (downgraded from the prior night's "proven" — see below).

## Open tracker tasks

`[todo]` Financial Dashboard — needs browser/E2E check. `[todo]` Payroll Automation — backend proven by tests; a real UI panel exists (`onboarding-journey.js`) but is unproven in a browser; needs a browser/E2E check, not just a tracker-checklist update.

## Disagreement / notes

Agree on Financial Dashboard being tab-unproven, and on the browser-QA record predating the Finance tab — now confirmed with the exact commit (`427a063`, 2026-09-17, vs. the QA record dated 2026-08-01).

**Disagree on Payroll Automation's prior "proven" label.** The backend is fully tested (15/15 passing tests) and correctly guarded, and it does have a real frontend panel (`payrollPanel`/`payrollConfigForm` in `onboarding-journey.js`) — but no browser or E2E test exercises that panel. Per the PROMPT.md rubric ("proven ... and (for a tab) a browser or E2E test covers the tab"), a feature with a real, untested UI panel should be `tab-unproven`, not `proven`. The prior next_action ("Open the Finance tab... confirm the Dashboard renders real figures, then add a browser/E2E check") remains the right next step and should be extended to also cover the onboarding-journey payroll-setup panel.
