# Xero Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Created (any code located): yes
- Addressed since the last audit (2026-11-05, cutoff `8853376`, through tonight's HEAD `704a51f` — 4 commits: `704a51f`, `0a365c4`, `cd8c4a8`, `e3c0b90`): no — none of the 4 touches `accounting-routes.js`, `accounting-db.js`, `accounting-exceptions.js`, `xero-api.js`, `xero-payroll-*.js`, or `xero-sync.js`.

## Located
- `backend/accounting-routes.js`, `backend/accounting-db.js`, `backend/accounting-exceptions.js` — Financial Dashboard + accounting extraction.
- `backend/xero-api.js`, `backend/xero-sync.js` — Xero OAuth/API client and sync.
- `backend/xero-payroll-api.js`, `backend/xero-payroll-connection.js`, `backend/xero-payroll-db.js`, `backend/xero-payroll-mapping.js`, `backend/xero-payroll-sync.js` — Payroll Automation.
- `backend/server.js:644-648` mounts the module with the comment "Accounting / Xero module (owner-only; every route enforces role server-side)" and a dedicated raw-body mount for the Xero webhook HMAC signature.
- Frontend: Finance page inside the owner portal (`frontend/current/mockup_v3.html`), gated by `data-owner-only="1"` per `docs/qa/BROWSER_QA_RESULTS.md` §H.
- A browser-QA entry already exists: `docs/qa/BROWSER_QA_RESULTS.md` §"H — Accounting extraction status" (9/9 ✅) — confirms therapist/read-only get tab hidden + 403, owner sees the tab gated, Xero shows `connected:false`/`xeroWrite:false`/`draftInvoiceCreate:false`, and explicitly notes "no Xero connection attempted, no write action exercised."

## Guard check
Pass. `const ownerOnly = [requireAuth, requireRole('owner')]` applied to 25 of 26 routes. The one exception, `GET /api/accounting/xero/callback`, uses `requireAuth` at the router level but enforces the owner check inline (`if (req.user?.role !== 'owner') return res.status(403)...`) because it is an OAuth redirect target — functionally owner-only, just checked in the handler instead of the route array, with a code comment confirming this is deliberate ("Owner-only, even though this is a redirect target.").

## Tests run
Unit:
```
npx jest tests/finance-flags.test.js tests/finance-routes.test.js tests/onboarding-payroll.test.js \
  tests/xero-payroll-api.test.js tests/xero-payroll-mapping.test.js tests/xero-payroll-sync.test.js
```
Result: **6 suites passed, 77 tests passed, 0 failed.**

Integration (own test DB, `DB_NAME=therapy_scheduler_audit_e`):
```
DB_NAME=therapy_scheduler_audit_e DB_PASSWORD=audit npx jest --config jest.integration.config.js \
  tests/integration/accounting-phase2.itest.js tests/integration/accounting-routes.itest.js \
  tests/integration/finance-routes.itest.js tests/integration/onboarding-payroll-xero.itest.js --runInBand
```
Result: **4 suites passed, 39 tests passed, 0 failed** (Xero calls correctly fail over to "xero offline in test" rather than hitting a real network).

**Real total: 10 suites, 116 tests, all passing.**

## Open tracker tasks
- "Financial Dashboard" (todo) — checklist 0/5 top-level items done.
- "Payroll Automation" (todo) — checklist 0/5 top-level items done.

## Commits in window touching it
None since the 2026-11-05 audit's cutoff.

## Disagreement note
The tracker's `claude_update` text claims "70 tests ... corrected from a miscounted 120 last time" and cites a checklist still at "0 of N done." This is a genuine real prior finding, not fabricated — the 2026-11-05 brief on `origin/claude/nightly-audit` independently recounted this same test surface file-by-file as exactly 70 unit tests, correcting the 2026-11-04 brief's "120" (confirmed against that real brief's own text). Tonight's recount is **116 tests (77 unit + 39 integration)** — wider than 70 because tonight's batch additionally included `tests/xero-payroll-sync.test.js` (unit) and `tests/integration/onboarding-payroll-xero.itest.js` (integration), both of which genuinely exercise Xero payroll code but weren't named in the 2026-11-05 count. No code changed (0 commits touch this subsystem since then), so this is a scope correction to a more complete test list, not a contradiction of a prior count — worth a human noting so the "116" figure, not "70," becomes the one that's tracked going forward. The "0 of N done" checklist claim is independently correct (verified directly against the tracker's own checklist data). Real disagreement stands, carried from every prior audit: the tracker stage is `idea` with 0% of either task's checklist ticked, while the code is fully built, owner-guarded, and passing all 116 tests — substantially ahead of what the stage/checklist implies. The one genuine gap, also independently confirmed via the existing browser-QA entry, is that no flow has been exercised against a live Xero sandbox — unresolved across every audit so far.
