# Clinical resources

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **no** · Created: **yes**

## Located files

This idea-stage card (no tasks, no detail text) maps onto the entire existing Resource Hub: `backend/resources-routes.js`, `backend/resource-hub-r2-routes.js`, `backend/resource-library-routes.js`, `backend/instrument-register-routes.js`, `backend/resource-ingestion-routes.js`. Frontend: `frontend/current/resourcehub.js`, the `RESOURCES TAB (Resource Hub R1)` banner.

Guarded, re-confirmed by direct grep tonight: `resources-routes.js` — `router.use('/api/resources', requireAuth, <inline role check>)`, denies admin by default, owner-only overrides on folder-create/approve/reject/archive/link-status. `resource-hub-r2-routes.js`/`resource-library-routes.js` — `requireAuth` plus `canAuthor`/`isOwner` helpers gating writes. `instrument-register-routes.js` — `router.use('/api/rh2', requireAuth)`. `resource-ingestion-routes.js` — every admin route is `requireAuth` plus inline `requireAdmin()` (owner/admin only). No unguarded route found.

## Tests

- Unit (14 files — 13 Resource Hub files + `store-search.test.js`, run together with Professional Development's `pd-catalogue-guards.test.js`): **454/466 pass, 12 skipped** (the same pre-existing skips as prior nights, not new).
- Integration (7 files): run tonight on isolated DB `therapy_scheduler_audit_g1_test` — **168/168 pass, clean on the first try**. The `resource-library.itest.js` `truncateAll()` deadlock seen on the two prior nights logged one `WARN ... deferred preview generation failed {"reason":"deadlock detected"}` from a background derivative job, but the test itself did not fail and no retry was needed tonight.

## Browser / E2E proof

`e2e/tests/portal.spec.js` ("Resource Hub shows approved starter content, no authoring, no public URLs") and `docs/qa/BROWSER_QA_RESULTS.md` entry G (16 approved resources across 14 folders, folder-create correctly 403) — unchanged since no commits landed in this window; re-confirmed present tonight.

## Open tasks from the tracker

None.

## Commits in the window touching this feature

None. No commits landed on `develop` since last night's audit — `develop` is still at `40669e7`, the exact commit audited last night and re-verified again tonight.

## Disagreement

None.

## Technical note

The intermittent `resource-library.itest.js` deadlock (seen two nights running as a full test failure) did not reproduce as a test failure tonight — only as a harmless background-job WARN log. Likely an unclosed connection/transaction timing issue in a prior test within that file rather than a defect in the routes under test; still worth a look independent of this audit if it recurs.
