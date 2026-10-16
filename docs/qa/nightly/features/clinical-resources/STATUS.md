Feature: Clinical resources
Tracker stage: idea
Tracker environment: none
Evidence label: proven
Addressed in change window (2026-10-02 to 2026-10-16): no
Created (any located code): yes

## Located files
`backend/resources-routes.js` (`router.use('/api/resources', requireAuth, ...)`
plus `requireRole('owner')` on write/approve/reject/archive routes),
`backend/resource-library-routes.js`, `backend/resource-ingestion-routes.js`,
`backend/instrument-register-routes.js`, `backend/resource-hub-r2-routes.js`
(clinical classification + CPD + approval workflow).

## Guard check
Pass.

## Tests run
- Unit: `resource-file-delivery`, `resource-file-quality`,
  `resource-governance`, `resource-hub-badge-guards`, `resource-hub-final`,
  `resource-ingestion`, `resource-library-frontend-guards`,
  `resource-privacy-scan`, `resource-seed-guards`, `resource-source-scan`
  → 10 suites / 382 tests (370 passed, 12 skipped, 0 failed)
- Integration (`DB_NAME=therapy_scheduler_audit`): `resource-hub-v1.itest.js`,
  `resource-library.itest.js`, `resources.itest.js`,
  `resource-file-upload.itest.js`, `resource-ingestion.itest.js`,
  `content-seed.itest.js` → all PASS. Plus `resource-hub-r2.itest.js`
  (33 tests PASS), which covers the clinical classification and
  approval workflow directly.

## Browser / E2E evidence
`e2e/tests/portal.spec.js` and `docs/qa/BROWSER_QA_RESULTS.md` flow G
both confirm content browsing (16 approved resources, 14 folders,
folder-create blocked for non-owners). Neither specifically walks
through the clinical-review/approval workflow as owner in a browser —
that one piece is covered only at the integration-test level.

## Open tasks from tracker
None recorded.

## Commits in window touching this feature
None.

## Disagreement with tracker
None. This matches the tracker's own prior assessment closely: guarded
and heavily tested, including the approval workflow, with one narrow gap
(no browser walkthrough of clinical classification specifically).
