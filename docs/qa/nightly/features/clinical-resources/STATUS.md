# Clinical resources

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **no** · Created: **yes**

## Located files

This idea-stage card (no tasks, no detail text) maps onto the entire existing Resource Hub: `backend/resources-routes.js`, `backend/resource-hub-r2-routes.js`, `backend/resource-library-routes.js`, `backend/instrument-register-routes.js`, `backend/resource-ingestion-routes.js`. Frontend: `frontend/current/resourcehub.js`, the `RESOURCES TAB (Resource Hub R1)` banner.

Guarded, re-confirmed by direct grep tonight: `resources-routes.js` — `router.use('/api/resources', requireAuth, <inline role check>)`, denies admin by default, owner-only overrides on folder-create/approve/reject/archive/link-status. `resource-hub-r2-routes.js`/`resource-library-routes.js` — `requireAuth` plus `canAuthor`/`isOwner` helpers gating writes. `instrument-register-routes.js` — `router.use('/api/rh2', requireAuth)`. `resource-ingestion-routes.js` — every admin route is `requireAuth` plus inline `requireAdmin()` (owner/admin only). No unguarded route found.

## Tests

- Unit (13 Resource Hub files + `store-search.test.js`): **454/466 pass across the combined run with Professional Development, 12 skipped** (the 12 skips are the same pre-existing ones from prior nights, not new). Isolating the Resource Hub's own share: 408 pass / 12 skip of 420.
- Integration (7 files): first pass tonight — 6 suites passed, 1 failed: `resource-library.itest.js` hit `error: deadlock detected` in its own shared `truncateAll()` helper, the same pre-existing intermittent flake seen on prior nights. Retried that file alone: **53/53 pass, clean**. Combined effective result: **168/168 pass**.

## Browser / E2E proof

`e2e/tests/portal.spec.js` ("Resource Hub shows approved starter content, no authoring, no public URLs") and `docs/qa/BROWSER_QA_RESULTS.md` entry G (16 approved resources across 14 folders, folder-create correctly 403) — both re-confirmed tonight.

## Open tasks from the tracker

None.

## Commits in the window touching this feature

None. Zero commits landed on `develop` between the 2026-11-08 audit and tonight — `develop` is at the same commit (`34cf881`) both nights.

## Disagreement

None.

## Technical note

`tests/integration/resource-library.itest.js`'s `truncateAll()` deadlock reproduced again tonight, on the first run, in isolation. This is the second consecutive night it has shown this flake and is worth a look independent of this audit — a retry passes clean both times, so it reads as an unclosed connection/transaction left open by a prior test in that file rather than a real defect in the routes under test.
