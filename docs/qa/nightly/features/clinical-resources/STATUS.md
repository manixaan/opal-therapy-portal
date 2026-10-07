# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed this window (commits since 2026-10-06 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-06); the audited commit (`aacf8e68`) is still unchanged. This is the seventh consecutive reconfirmation night on this exact code. Tonight is not Sunday UTC, so targeted batches were run (not the complete suites) — see each section below for exactly what ran tonight.
- Created (any located code at all): **yes**

## Located files
- backend/resource-hub-r2-routes.js and the backend/resource-*.js family — the Resource Hub's Clinical Excellence pillar (CLINICAL_POPULATIONS / CLINICAL_SETTINGS categories)
- frontend/current/resourcehub.js

## Guard check
requireAuth + role-based read/write split on every route checked. No gaps.

## Tests run tonight
- unit: `resource-file-delivery.test.js, resource-file-quality.test.js, resource-governance.test.js, resource-hub-badge-guards.test.js, resource-hub-final.test.js, resource-ingestion.test.js, resource-library-frontend-guards.test.js, resource-privacy-scan.test.js, resource-seed-guards.test.js, resource-source-scan.test.js` — run in isolation tonight: 370/382 pass, 12 skipped (env-gated, not failures)
- integration: `resource-hub-r2.itest.js, resource-library.itest.js, resources.itest.js` — 88/88 pass — run directly tonight as this exact trio, including resource-library.itest.js alongside the others (no deadlock; the contention artifact noted on the 2026-10-04 Sunday deep run was not reproduced tonight)

## Open tasks (from the tracker)
- (none recorded)

## Compare with the tracker
None directly — but the card has no idea/why text at all, so "Clinical resources" is an assumed match to Resource Hub R2, not a confirmed one. The Resource Hub's own "Clinical Excellence" category is the closest and best-evidenced match: guarded, heavily tested, and backed by e2e (e2e/tests/portal.spec.js, tutorials.spec.js) and a recorded browser QA pass (BROWSER_QA_RESULTS.md flow G, 16 resources / 14 folders, 4/4).
