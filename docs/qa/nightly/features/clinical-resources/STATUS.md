# Clinical resources

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **no** · Created: **yes**

## Located files

This idea-stage card (no tasks, no detail text) maps onto the entire existing Resource Hub: `backend/resources-routes.js`, `backend/resource-hub-r2-routes.js`, `backend/resource-library-routes.js`, `backend/instrument-register-routes.js`, `backend/resource-ingestion-routes.js`. Frontend: `frontend/current/resourcehub.js`, the `RESOURCES TAB (Resource Hub R1)` banner (`mockup_v3.html` line 5120).

Guarded: `requireAuth` plus role checks on every route group — `resources-routes.js` and `resource-hub-r2-routes.js` use an inline per-request callback check; `resource-ingestion-routes.js`'s admin endpoints use an inline `requireAdmin()` helper (owner/admin only) rather than `requirePermission` middleware, functionally equivalent and consistent with the house pattern used elsewhere (`profile-routes.js`'s `canApprove`). No unguarded route found. No TODO/FIXME.

## Tests

- Unit (glob `resource-*` + `store-search.test.js`, 13 files): **408/420 pass, 12 skipped** (skips are pre-existing, not newly introduced).
- Integration (7 files under `tests/integration/resource*.itest.js` + `resources.itest.js`): 6/7 suites passed cleanly; `resource-library.itest.js` hit an intermittent `deadlock detected` in its own shared `truncateAll()` helper on the first run. Re-run twice in isolation: failed once more, then passed clean (**53/53**) — a pre-existing flake in the test helper's truncation logic, not a regression from this window's code. **168/168 effective pass** across the two clean runs combined.

## Browser / E2E proof

`e2e/tests/portal.spec.js` ("Resource Hub shows approved starter content, no authoring, no public URLs") and `docs/qa/BROWSER_QA_RESULTS.md` entry G (16 approved resources across 14 folders, folder-create correctly 403).

## Open tasks from the tracker

None.

## Commits in the window touching this feature

None — the Resource Hub core routes did not change in the last 14 days.

## Disagreement

None.

## Technical note

`tests/integration/resource-library.itest.js`'s `truncateAll()` deadlock is worth a look independent of this audit — it reproduced once in isolation with no other process touching the database, then passed clean on immediate retry. Likely an unclosed connection/transaction left open by a prior test in that file.
