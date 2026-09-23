# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in this change window (2026-09-22 → 2026-09-23): no — zero commits landed in this window at all
- Created (any located code): yes — but as the existing Resource Hub, not a distinct "clinical resources" subsystem

## Important: this tracker item has no distinct implementation of its own

"Clinical resources" has no code, route, or doc scoped narrower than the
existing Resource Hub. `backend/server.js:554` mounts it with the comment
"Resource Hub (governed clinical resource repository; backend-enforced
RBAC)", and `docs/resources/RESOURCE_HUB_PIPELINE.md` is formally titled
"Resource Hub / Clinical Resource Repository — Module Spec," whose
Objective section explicitly covers clinical, educational, therapy,
product, PD and practice resources, with a locked "Clinical safety
principle" (client-linked suggestions must show a disclaimer, no inferred
diagnoses, no unsupported medical claims, no identifiable client data to
external AI). This audit recommends the team either merge this tracker
card into a single "Resource Hub" entry or mark it a duplicate.

## Located files

- Routes (all under a shared `/api/rh2` namespace for the R2 set): `backend/resources-routes.js` (R1: folders, files, link-status, approve/reject/archive), `backend/resource-hub-r2-routes.js` (R2: learning, standards, PD/CPD), `backend/resource-library-routes.js` (`/api/rh2/library`), `backend/instrument-register-routes.js` (controlled instrument register), `backend/resource-ingestion-routes.js` (admin-only source-vault accounting, `/api/rh2/admin/ingestion/*`)
- Data access: `resource-cleanroom-content.js`, `resource-cleanroom-plan.js`, `resource-governance.js`, `resource-ingestion.js`, `resource-instrument-map.js`, `resource-official-links.js`, `resource-preview-service.js`, `resource-privacy-scan.js`, `resource-file-intake.js`, `resource-file-quality.js`, `resource-file-storage.js`
- Frontend: `frontend/current/resourcehub.js`/`.css`

## Guard check

`resources-routes.js`: `router.use('/api/resources', requireAuth, ...)` + several `requireRole('owner')` gates on writes. `resource-hub-r2-routes.js`: `router.use('/api/rh2', requireAuth, ...)`. `resource-library-routes.js`: `router.use('/api/rh2/library', requireAuth, ...)`. `instrument-register-routes.js`: `router.use('/api/rh2', requireAuth)`, relies on the shared `/api/rh2` guard chain. `resource-ingestion-routes.js`: **this audit specifically verified** its header comment's claim ("owner and admin only... behind a role gate") against the code — each of its 6 routes carries only `requireAuth` at the router level, but every handler calls an in-function `requireAdmin(req, res)` helper (`canAdmin = role === 'owner' || 'admin'`) as its first line, confirmed present in all 6 handlers. **Not a guard defect** — just an in-handler pattern instead of middleware, which this audit checked directly rather than taking on faith.

## Tests

- Unit (all pass, run with Inductions): `resource-file-delivery.test.js`, `resource-file-quality.test.js`, `resource-governance.test.js`, `resource-hub-badge-guards.test.js`, `resource-hub-final.test.js`, `resource-ingestion.test.js`, `resource-library-frontend-guards.test.js`, `resource-privacy-scan.test.js`, `resource-seed-guards.test.js`, `resource-source-scan.test.js` — 0 failures
- Integration (all pass): `resource-file-upload.itest.js`, `resource-hub-r2.itest.js`, `resource-hub-v1.itest.js`, `resource-ingestion.itest.js`, `resource-library.itest.js`, `resources.itest.js` — 6 suites, 133 tests, 0 failures. No dedicated test file matched "instrument" specifically — `instrument-register-routes.js` appears exercised only indirectly via the R2/ingestion suites; possible coverage gap worth a closer look if that register is relied on.
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` row G ("Resource Hub"): "Therapist sees 16 approved starter resources across 14 folders; no non-official external URLs; folder-create 403" (4/4 ✅). This is general Resource Hub evidence, not anything clinical-specific, but it does satisfy the tab-rendering bar.

## Open tasks from the tracker

None — no tasks recorded for this feature.

## Commits in the window that touched it

None — `develop` did not move since last night (both audits sit on `74601fc`). Re-verified fresh
anyway: unit (10 suites, shared run with Inductions) and integration (6 suites, 133/133, shared run)
both re-run tonight with identical results to last night — no regression.

## Disagreement

The tracker card implies a distinct feature that isn't there — see the note above. Not a "tracker ahead of evidence" case exactly, more a duplicate/ambiguous card worth tidying up.
