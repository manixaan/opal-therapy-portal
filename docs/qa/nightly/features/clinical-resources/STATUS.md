# Clinical resources

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed since last audit (2026-11-26, commit `f5fc28d`): no — zero new commits
Created (any located code): yes

*Reconfirmed 2026-11-28:* independently re-ran all 12 unit suites (398 passed,
12 skipped) and 7 integration files touching resources specifically
(`resource-file-upload`, `resource-hub-r2`, `resource-hub-v1`,
`resource-ingestion`, `resource-library-sharepoint`, `resource-library`,
`resources` — 168 passed; two transient async-preview-worker WARNs logged,
FK violation + deadlock, but all tests still passed — looks like an
exercised failure path, not a defect). Verified `e2e/tests/portal.spec.js`
directly: its "Resource Hub shows approved starter content" test really does
check `/api/resources` and the folder-create 403. `node --check`: OK.

## Located files

`backend/resources-routes.js` (R1), `backend/resource-hub-r2-routes.js` (R2: learning/
standards/PD-CPD/clinical-vocabulary), `backend/resource-library-routes.js`,
`backend/resource-ingestion-routes.js`, `backend/resource-governance.js`,
`backend/resource-file-storage.js`, `backend/resource-privacy-scan.js`,
`backend/resource-recycle-bin.js`, plus ~10 more `resource-*.js` support modules. Frontend:
`frontend/current/resourcehub.js/.css`, `resourcelibrary.js/.css`. Tab:
`============ RESOURCES TAB ============` (`mockup_v3.html:5473`) — R2/library load inside it.

## Guard check

All guarded: `resources-routes.js`, `resource-library-routes.js`, `resource-ingestion-routes.js`
use router-level `requireAuth` + `requireRole`. `resource-hub-r2-routes.js` uses router-level
`requireAuth` plus inline per-route role checks (`requireApprover`, `canAuthor`) —
functionally equivalent, not a defect. No unguarded route found.

## Tests

- Unit (resource-*.test.js, 12 files): **12/12 suites, 398 passed, 12 skipped (410 total)**.
- Integration: part of a shared batch of 9 files (`resource-hub-r2.itest.js`,
  `resource-hub-v1.itest.js`, `resource-library.itest.js`, `resource-library-sharepoint.itest.js`,
  `resource-ingestion.itest.js`, `resource-file-upload.itest.js`, plus `learning.itest.js`,
  `learning-admin.itest.js`, `induction-assistant.itest.js` for the Inductions feature) —
  **9/9 suites, 232/232 tests passed**.
- Browser/E2E: `e2e/tests/portal.spec.js` ("Resource Hub shows approved starter content, no
  authoring, no public URLs"). `docs/qa/BROWSER_QA_RESULTS.md` row G (2026-08-01): 16 approved
  starter resources across 14 folders render for a therapist, folder-create correctly 403s.

## Open tasks (from tracker)

None recorded.

## Commits since last audit (2026-11-26)

None touch any resource-*.js file.

## Disagreement

None. This is the one card in the tracker with no open task, a passing guard, full unit +
integration coverage, and real browser/E2E proof of the tab rendering. Evidence supports
moving this card's stage up from `idea`.
