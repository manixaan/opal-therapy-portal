# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in this change window (2026-09-23 → 2026-09-24): no — zero commits landed in this window at all
- Created (any located code): yes — but as the existing Resource Hub, not a distinct "clinical resources" subsystem

## Important: this tracker item has no distinct implementation of its own

"Clinical resources" has no code, route, or doc scoped narrower than the
existing Resource Hub. `backend/server.js:554` mounts it with the comment
"Resource Hub (governed clinical resource repository; backend-enforced
RBAC)", and `docs/resources/RESOURCE_HUB_PIPELINE.md` is formally titled
"Resource Hub / Clinical Resource Repository — Module Spec." This audit
again recommends the team either merge this card into a single "Resource
Hub" entry or mark it a duplicate.

## Located files

- Routes: `backend/resources-routes.js` (R1), `backend/resource-hub-r2-routes.js` (R2: learning, standards, PD/CPD), `backend/resource-library-routes.js`, `backend/instrument-register-routes.js`, `backend/resource-ingestion-routes.js` (admin-only)
- Data access: `resource-cleanroom-content.js`, `resource-cleanroom-plan.js`, `resource-governance.js`, `resource-ingestion.js`, `resource-instrument-map.js`, `resource-official-links.js`, `resource-preview-service.js`, `resource-privacy-scan.js`, `resource-file-intake.js`, `resource-file-quality.js`, `resource-file-storage.js`
- Frontend: `frontend/current/resourcehub.js`/`.css`

## Guard check

`resources-routes.js`: `requireAuth` + `requireRole('owner')` gates on writes. `resource-hub-r2-routes.js`/`resource-library-routes.js`: `requireAuth` at router level plus inline `canAuthor`/`isOwner` checks on writes. `resource-ingestion-routes.js`: `requireAuth` at router level, plus an in-handler `requireAdmin()` check confirmed present in every one of its 6 handlers (an in-handler pattern, not a defect). No unguarded route found.

## Tests (re-run fresh tonight)

- Unit: `resource-file-delivery.test.js`, `resource-file-quality.test.js`, `resource-governance.test.js`, `resource-hub-badge-guards.test.js`, `resource-hub-final.test.js`, `resource-ingestion.test.js`, `resource-library-frontend-guards.test.js`, `resource-privacy-scan.test.js`, `resource-seed-guards.test.js`, `resource-source-scan.test.js` — 10 suites / 382 tests, 370 passed, 12 skipped, 0 failed.
- Integration: `resource-file-upload.itest.js`, `resource-hub-r2.itest.js`, `resource-hub-v1.itest.js`, `resource-ingestion.itest.js`, `resource-library.itest.js`, `resources.itest.js` — run tonight as part of the PD/Profile + Inductions/Resources batch (12 suites / 176 tests, 1 known non-code failure elsewhere in that batch — see Employee Personal Page — nothing in the resource-hub files failed).
- Browser/E2E: `e2e/tests/portal.spec.js` "Resource Hub shows approved starter content, no authoring, no public URLs" directly exercises the tab live. `docs/qa/BROWSER_QA_RESULTS.md` row G: 4/4 ✅ (16 approved resources, 14 folders, no non-official URLs, folder-create 403).

## Open tasks from the tracker

None — no tasks recorded for this feature.

## Commits in the window that touched it

None — `develop` sits on `74601fc` again tonight. Re-verified fresh: both unit and integration batches re-run tonight with identical (passing) results — no regression.

## Disagreement

The tracker card implies a distinct feature that isn't there — see the note above. Not a "tracker ahead of evidence" case exactly, more a duplicate/ambiguous card worth tidying up.
