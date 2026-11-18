# Clinical resources

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **proven**
- Addressed in the 2026-11-04..2026-11-18 change window: **no**
- Created (any located code): **yes**

## Located files
- backend/resources-routes.js
- backend/resource-hub-r2-routes.js
- backend/resource-library-routes.js (requireAuth + requireRole('owner')/requireManager on writes)
- frontend: RESOURCES TAB (Resource Hub R1) banner + frontend/current/resourcehub.js

## Guard check
OK — requireAuth + requireRole('owner') / requireManager on writes.

## Tests run
- unit: `resource-file-delivery.test.js, resource-file-quality.test.js, resource-governance.test.js, resource-hub-badge-guards.test.js, resource-hub-final.test.js, resource-ingestion.test.js, resource-library-frontend-guards.test.js, resource-library-rules.test.js, resource-privacy-reasons.test.js, resource-privacy-scan.test.js, resource-seed-guards.test.js, resource-source-scan.test.js` — **pass** (12 files / 398 passed + 12 skipped)
- integration: `resource-file-upload.itest.js, resource-hub-r2.itest.js, resource-hub-v1.itest.js, resource-ingestion.itest.js, resource-library-sharepoint.itest.js, resource-library.itest.js, resources.itest.js` — **pass** (7 files / 168 tests)

## Tab / browser proof
e2e/tests/portal.spec.js: "Resource Hub shows approved starter content, no authoring, no public URLs" — real E2E coverage of the tab.

## Recency
Not touched in-window.

## Open tasks (from the tracker)
(no tasks recorded on this card)

## Reason for the label
Code located, guarded, every test passes, no open task (0 tasks on this card), no TODO/FIXME found, and the tracker's own next_action already says "No action needed — evidence supports moving this card's stage up."

## Disagreement with the tracker
Opposite-direction disagreement: the tracker stage ("idea") badly UNDER-claims maturity — this is the one card in the whole snapshot that evidence says is actually done.
