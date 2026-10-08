# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed this window: **no** — zero commits since 2026-10-07 touching `backend/` or `frontend/current/`.
  Eighth consecutive reconfirmation night.
- Created (any located code at all): **yes**

## Located files
- `backend/resources-routes.js`, `backend/resource-hub-r2-routes.js`, `backend/resource-library-routes.js`,
  `backend/resource-ingestion-routes.js` — mounted with comment "Resource Hub (governed clinical resource
  repository; backend-enforced RBAC)" (server.js:554)
- `backend/resource-governance.js`, `backend/resource-file-storage.js`, `backend/resource-privacy-scan.js`, and
  the rest of the `resource-*.js` family
- `backend/setup/r2-content/ndis-clinical.js` — clinical guide seed content
- Frontend: `<!-- RESOURCES TAB (Resource Hub R1) -->` (mockup_v3.html:4954), `frontend/current/resourcehub.js`

## Guard check
`router.use('/api/rh2', requireAuth, flagGate)` at the top of `resource-hub-r2-routes.js`, with per-route
`canAuthor`/role checks on writes. No gaps found.

## Tests run tonight
- unit: `resource-file-delivery.test.js, resource-file-quality.test.js, resource-governance.test.js,
  resource-hub-badge-guards.test.js, resource-hub-final.test.js, resource-ingestion.test.js,
  resource-library-frontend-guards.test.js, resource-privacy-scan.test.js, resource-seed-guards.test.js,
  resource-source-scan.test.js` (run together with `credential-surface-guards.test.js` and
  `pd-catalogue-guards.test.js` in a 12-file batch) — 444 passed, 12 skipped, 0 failed for the full batch
- integration: `resource-hub-r2.itest.js, resource-hub-v1.itest.js, resource-file-upload.itest.js,
  resource-ingestion.itest.js, resource-library.itest.js, resources.itest.js` — 133/133 pass
- e2e: `e2e/tests/portal.spec.js` — `'Resource Hub shows approved starter content, no authoring, no public URLs'`
- browser QA: `docs/qa/BROWSER_QA_RESULTS.md` flow G — "Therapist sees 16 approved starter resources across 14
  folders; no non-official external URLs; folder-create 403" — ✅ 4/4 (verified directly tonight)

## Open tasks (from the tracker)
(no tasks recorded in the tracker — the card has a title only)

## Compare with the tracker
None. This matches the existing, guarded, heavily-tested Resource Hub, with both e2e and recorded browser QA
proof that the tab renders correctly. The tracker card itself has no why/who/what — still an assumed match by
title, not a confirmed one (see open questions in the dated brief).
