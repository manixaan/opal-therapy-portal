# Clinical resources

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed this window (since 2026-11-13): no
Created (any located code): yes

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

## Commits in window (since 2026-11-13)

None touch any resource-*.js file.

## Disagreement

None. This is the one card in the tracker with no open task, a passing guard, full unit +
integration coverage, and real browser/E2E proof of the tab rendering. Evidence supports
moving this card's stage up from `idea`.
