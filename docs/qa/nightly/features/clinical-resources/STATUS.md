# Clinical resources

- Tracker stage: idea | Tracker environment: none
- Evidence label: **proven**
- Created: yes
- Addressed this window: not directly (no resource-*.js commits in the window; zero commits at all)

## Located files
- Backend: resources-routes.js (8 guards), resource-library-routes.js (5), resource-hub-r2-routes.js (3),
  resource-ingestion-routes.js (7), resource-governance.js, resource-privacy-scan.js,
  resource-recycle-bin.js, and the rest of the resource-*.js family.
- Frontend: frontend/current/resourcehub.js

## Guard check
All located route files guarded. OK (re-confirmed tonight).

## Tests (re-run fresh tonight)
- Unit: 13 suites / 444 passed, 12 skipped, 456 total — PASS (resource-file-delivery,
  resource-file-quality, resource-governance, resource-hub-badge-guards, resource-hub-final,
  resource-ingestion, resource-library-frontend-guards, resource-library-rules,
  resource-privacy-reasons, resource-privacy-scan, resource-seed-guards, resource-source-scan,
  pd-catalogue-guards).
- Integration: 7 suites / 168 tests — PASS (resource-hub-r2, resource-hub-v1, resource-file-upload,
  resource-ingestion, resource-library-sharepoint, resource-library, resources;
  DB_NAME=therapy_scheduler_audit_resources). One WARN logged (resource-file-intake deferred preview
  generation hit a foreign-key violation on resource_file_derivatives) but did not fail the suite —
  same benign warning as last night.
- Tab coverage: docs/qa/BROWSER_QA_RESULTS.md section G — Resource Hub, unchanged since last night.

## Open tasks (from tracker)
None.

## Commits in window touching this
None.

## Disagreement
Tracker stage "idea" understates reality — nothing material is outstanding here, matching the
tracker's own next_action verbatim ("Move this card's tracker stage up to reflect reality"). This
audit does not change the tracker; reporting the gap only.

## Note
No change from the 2026-11-15 audit. Re-verified fresh tonight: same code, same tests, same result.
