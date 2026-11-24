# Clinical resources

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **proven**
- Addressed since the last audit (2026-11-23..2026-11-24): **no**
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
- integration: `resource-file-upload.itest.js, resource-hub-r2.itest.js, resource-hub-v1.itest.js, resource-ingestion.itest.js, resource-library-sharepoint.itest.js, resource-library.itest.js, resources.itest.js` — **pass** (7 files, all clean on the first run tonight as part of a 31-file batch — no deadlock/flake this time, unlike 2026-11-23's one-off `resource-library.itest.js` TRUNCATE deadlock).

## Tab / browser proof
e2e/tests/portal.spec.js:116 still has the Resource Hub assertion ("Resource Hub shows approved starter content, no authoring, no public URLs") — real E2E coverage of the tab, confirmed present tonight.

## Recency
Not touched since the last audit. Two commits landed elsewhere in the repo tonight (21:42 UTC 2026-11-23, after last night's 18:35 UTC audit): the mobile drag-to-move feature and the `event-move.js` calendar-save refactor (see Opa Mobile Companion and Portal - Splose - Outlook's folders) — neither touched this subsystem's files.

## Open tasks (from the tracker)
(no tasks recorded on this card)

## Reason for the label
Code located, guarded, every test passes, no open task (0 tasks on this card), no TODO/FIXME found, and the tracker's own next_action already says "No action needed — evidence supports moving this card's stage up." Unchanged from last night, now confirmed ten nights running.

## Disagreement with the tracker
Opposite-direction disagreement: the tracker stage ("idea") badly UNDER-claims maturity — this remains the one card in the whole snapshot that evidence says is actually done.
