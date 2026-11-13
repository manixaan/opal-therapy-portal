# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-11-12 to 2026-11-13): no — zero commits landed on `develop` since the 2026-11-12 audit
- Created (any code located): yes

## Located files

This card is the **Resource Hub** (confirmed by literal match — `backend/server.js` carries the comment "Resource Hub (governed clinical resource repository; backend-enforced RBAC)"; `resource-hub-r2-routes.js` also uses the phrase "clinical resource").

- Routes: `backend/resources-routes.js`, `backend/resource-hub-r2-routes.js`, `backend/resource-library-routes.js`, `backend/resource-ingestion-routes.js`
- Data access: `backend/resource-ingestion.js`, `backend/setup/seed-resource-hub-r2.js`, `backend/resource-recycle-bin.js`
- Frontend: `RESOURCES TAB (Resource Hub R1)` — `frontend/current/mockup_v3.html:5140`; Resource Hub R2 is a set of dynamic sub-views (home/library/saved/learning/admin/detail/pd/instruments/assignment/lwedit) inside the same tab, driven by `frontend/current/navigation.js`
- Unit tests: `resource-file-delivery.test.js`, `resource-file-quality.test.js`, `resource-governance.test.js`, `resource-hub-badge-guards.test.js`, `resource-hub-final.test.js`, `resource-ingestion.test.js`, `resource-library-frontend-guards.test.js`, `resource-library-rules.test.js`, `resource-privacy-reasons.test.js`, `resource-privacy-scan.test.js`, `resource-seed-guards.test.js`, `resource-source-scan.test.js`
- Integration tests: `resource-file-upload.itest.js`, `resource-hub-r2.itest.js`, `resource-hub-v1.itest.js`, `resource-ingestion.itest.js`, `resource-library.itest.js`, `resource-library-sharepoint.itest.js`, `resources.itest.js`
- E2E: `e2e/tests/portal.spec.js:116` — "Resource Hub shows approved starter content, no authoring, no public URLs"

## Guard check

Re-confirmed tonight by direct grep, unchanged. `resources-routes.js` — `requireAuth` + `requireRole('owner')` on writes. `resource-library-routes.js` — `requireAuth` + `requireManager`/`requireOwnerOnly` on sensitive routes. `resource-hub-r2-routes.js` — `requireAuth` router-level. `resource-ingestion-routes.js` — `requireAuth` router-level plus an inline `canAdmin(req.user)` check (owner/admin only, 403 otherwise) before every admin handler — functionally equivalent to a role guard, not flagged as unguarded.

## Tests run

- Unit: re-run tonight — 12 suites, 398 passed, 12 skipped — **pass** (identical to the 2026-11-12 run)
- Integration: re-run tonight — `resource-ingestion.itest.js`, `resource-hub-r2.itest.js`, `resource-hub-v1.itest.js`, `resource-file-upload.itest.js`, `resource-library.itest.js`, `resource-library-sharepoint.itest.js`, `resources.itest.js` — all included in a 10-suite/234-test run alongside the learning tests: 233 passed, 1 failed. The failure is `resource-library.itest.js`'s "uploading into a folder › accepts an explicit title when one is given" test, which raises a deliberately simulated `error: deadlock detected` — an intentional failure-path scenario, not a real defect (same artifact seen on prior nights).

## Open tasks from tracker

None recorded.

## Commits in window touching it

None. Zero commits landed on `develop` since the 2026-11-12 audit (still at commit `40669e7`). The most recent real activity on this subsystem (`frontend/current/resourcehub.css`/`.js`) predates this window.

## Disagreement

None — tracker stage (`idea`) understates the evidence (the code is extensively built, guarded, tested, and has e2e proof), but this is not the "tracker claims more than the evidence" pattern the audit calls a disagreement. Worth a human updating the tracker stage regardless.
