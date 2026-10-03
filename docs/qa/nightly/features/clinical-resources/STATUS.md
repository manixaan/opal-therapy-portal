# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed this window (commits since 2026-10-02 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-02); the audited commit (`aacf8e6`) is still unchanged. This is the fourth consecutive reconfirmation night on this exact code.
- Created (any located code at all): **yes**

## Located files
- backend/resource-cleanroom-content.js, resource-cleanroom-plan.js, resource-file-intake.js, resource-file-quality.js, resource-file-quality-pdf-worker.js, resource-file-storage.js, resource-governance.js, resource-hub-r2-routes.js, resource-ingestion.js, resource-ingestion-routes.js, resource-instrument-map.js, resource-library-routes.js, resource-official-links.js, resource-preview-service.js, resource-privacy-scan.js, resources-routes.js, instrument-register-routes.js
- frontend/current/resourcehub.js (8418 lines), resourcehub.css

## Guard check
resources-routes.js, resource-hub-r2-routes.js, resource-library-routes.js, resource-ingestion-routes.js, instrument-register-routes.js: all guarded (requireAuth + role-based read/write split). Helper/logic modules (governance, instrument-map, cleanroom, file-*, privacy-scan, preview-service, official-links, ingestion.js) have no direct routes, as expected. No gaps.
MINOR FINDING (doc hygiene, not functional): the HTML comment `<!-- RESOURCES TAB (Resource Hub R1) -->` at mockup_v3.html:4954 actually wraps #view-purchases (the Purchasing queue), not the resource hub. The real Resource Hub R2 UI lives in an unlabeled section #view-resources at line 5061, mounted via resourcehub.js into #rh2-root. This is a stale/mislabeled comment from an earlier reorg, not evidence of an unbuilt "R1".

## Tests and results
Unit (10 suites, all pass): resource-file-delivery, resource-file-quality, resource-governance, resource-hub-badge-guards, resource-hub-final, resource-ingestion, resource-library-frontend-guards, resource-privacy-scan, resource-seed-guards, resource-source-scan — re-run tonight, 370 passed, 12 skipped, 382 total. Identical to the last three nights.
Integration (6 files, all pass): resource-file-upload.itest.js, resource-ingestion.itest.js, resource-hub-v1.itest.js, resource-library.itest.js, resource-hub-r2.itest.js, resources.itest.js — re-run tonight, 133/133 (the same FK-violation WARN log from deferred preview generation appeared again — it is the test deliberately exercising its own failure-handling path, not a new issue).

## Open tasks (from the tracker)
(none recorded)

## Compare with the tracker
None directly — but the card has no idea/why text at all, so "Clinical resources" is an assumed match to Resource Hub R2, not a confirmed one.
