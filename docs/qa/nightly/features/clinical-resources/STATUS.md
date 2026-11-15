# Clinical resources

- Tracker stage: idea | Tracker environment: none
- Evidence label: **proven**
- Created: yes
- Addressed this window: not directly (no resource-*.js commits in the 14-day window)

## Located files
- Backend: resources-routes.js (8 guards), resource-library-routes.js (5), resource-hub-r2-routes.js (3),
  resource-ingestion-routes.js (7), resource-governance.js, resource-privacy-scan.js,
  resource-recycle-bin.js, and the rest of the resource-*.js family.
- Frontend: frontend/current/resourcehub.js

## Guard check
All located route files guarded. OK.

## Tests
- Unit: 12 suites / 398 passed, 12 skipped, 410 total — PASS
- Integration: 7 suites / 168 tests — PASS (DB_NAME=therapy_scheduler_audit_resources). One WARN logged
  (resource-file-intake deferred preview generation hit a foreign-key violation on
  resource_file_derivatives) but did not fail the suite.
- Tab coverage: docs/qa/BROWSER_QA_RESULTS.md section G — Resource Hub, 4/4 pass; section J confirms
  read-only access returns 200 (correct).

## Open tasks (from tracker)
None.

## Commits in window touching this
None directly.

## Disagreement
Tracker stage "idea" understates reality — nothing material is outstanding here, matching the
tracker's own next_action verbatim ("Move this card's tracker stage up to reflect reality"). This
audit does not change the tracker; reporting the gap only.
