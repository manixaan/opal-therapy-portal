# Clinical resources

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **proven**
- Addressed since the last audit (2026-11-24..2026-11-25): **no**
- Created (any located code): **yes**

## Located files
- backend/resources-routes.js
- backend/resource-hub-r2-routes.js
- backend/resource-library-routes.js (requireAuth + requireRole('owner')/requireManager on writes)
- frontend: RESOURCES TAB (Resource Hub R1) banner + frontend/current/resourcehub.js

## Guard check
OK — requireAuth + requireRole('owner') / requireManager on writes, re-confirmed across all three route files.

## Tests run
- unit: `resource-file-delivery.test.js, resource-file-quality.test.js, resource-governance.test.js, resource-hub-badge-guards.test.js, resource-hub-final.test.js, resource-ingestion.test.js, resource-library-frontend-guards.test.js, resource-library-rules.test.js, resource-privacy-reasons.test.js, resource-privacy-scan.test.js, resource-seed-guards.test.js, resource-source-scan.test.js` — **pass** (12 files / 398 passed + 12 skipped, re-run fresh tonight, matches last night exactly)
- integration: `resource-file-upload.itest.js, resource-hub-r2.itest.js, resource-hub-v1.itest.js, resource-ingestion.itest.js, resource-library-sharepoint.itest.js, resource-library.itest.js, resources.itest.js` — **pass** (7 files, re-run fresh tonight as part of an 18-file batch — no deadlock/flake, exact match to last night's count of 168 tests when isolated from the batch total).

## Tab / browser proof
e2e/tests/portal.spec.js:116 still has the Resource Hub assertion ("Resource Hub shows approved starter content, no authoring, no public URLs") — real E2E coverage of the tab, confirmed present tonight by a fresh grep.

## Recency
Not touched since the last audit. Ten commits landed elsewhere in the repo tonight (2026-11-25, see "What changed since last audit" in the brief) — none touched this subsystem's files.

## Open tasks (from the tracker)
(no tasks recorded on this card)

## Reason for the label
Code located, guarded, every test passes, no open task (0 tasks on this card), no TODO/FIXME found, and the tracker's own next_action already says "No action needed — evidence supports moving this card's stage up." Unchanged from last night, now confirmed eleven nights running.

## Disagreement with the tracker
Opposite-direction disagreement: the tracker stage ("idea") badly UNDER-claims maturity — this remains the one card in the whole snapshot that evidence says is actually done.
