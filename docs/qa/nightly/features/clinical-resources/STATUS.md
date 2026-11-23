# Clinical resources

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **proven**
- Addressed since the last audit (2026-11-22..2026-11-23): **no**
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
- integration: `resource-file-upload.itest.js, resource-hub-r2.itest.js, resource-hub-v1.itest.js, resource-ingestion.itest.js, resource-library-sharepoint.itest.js, resource-library.itest.js, resources.itest.js` — **pass** (7 files / 168 tests). `resource-library.itest.js` failed once tonight in the 43-file targeted batch with `error: deadlock detected` on a `TRUNCATE` between suites; re-run alone immediately after: **53/53 pass, clean**. Same test-isolation flakiness class documented last night (a leaked async operation from an earlier suite bleeding into the next one's `TRUNCATE`), not a code defect — see Technical detail in tonight's brief.

## Tab / browser proof
e2e/tests/portal.spec.js:116 still has the Resource Hub assertion ("Resource Hub shows approved starter content, no authoring, no public URLs") — real E2E coverage of the tab, confirmed present tonight.

## Recency
Not touched since the last audit — tonight was the quietest window this audit has seen: **zero commits** landed in `backend/` or `frontend/current/` between 18:13 UTC 2026-11-22 (last audit) and tonight's run.

## Open tasks (from the tracker)
(no tasks recorded on this card)

## Reason for the label
Code located, guarded, every test passes, no open task (0 tasks on this card), no TODO/FIXME found, and the tracker's own next_action already says "No action needed — evidence supports moving this card's stage up." Unchanged from last night, now confirmed nine nights running.

## Disagreement with the tracker
Opposite-direction disagreement: the tracker stage ("idea") badly UNDER-claims maturity — this remains the one card in the whole snapshot that evidence says is actually done.
