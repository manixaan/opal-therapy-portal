# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window: **no** — zero commits since 2026-10-07 touching `backend/` or `frontend/current/`.
  Eighth consecutive reconfirmation night.
- Created (any located code at all): **yes**

## Located files
- `backend/onboarding-employee-routes.js`, `onboarding-workflow-routes.js`, `onboarding-journey-routes.js`
  (Stage 1 — Letter of Offer), `onboarding-pack-routes.js` (Stage 2 — document pack), `onboarding-returns-routes.js`,
  `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js` ("Edit Onboarding" tab),
  `onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`, `onboarding-library-routes.js`,
  `onboarding-routes.js`
- Data access: `onboarding-db.js`, `onboarding-journey-db.js`, `onboarding-pack-db.js`, `onboarding-returns-db.js`,
  `onboarding-workflow-db.js`; supporting: `onboarding-offer-docx.js/-pdf.js/-email.js/-template.js/-letter.js`,
  `onboarding-engine.js`, `onboarding-induction.js` (Stage 3)
- Frontend: `<!-- ONBOARDING TAB -->` (mockup_v3.html:4162), `frontend/current/onboarding.js` +
  `onboarding-journey.js` (Stage 1/2/3 panels, "Edit onboarding" tab)

## Guard check
Every one of the 11 route files sits behind `router.use('<prefix>', requireAuth)` plus per-route
`requirePermission(...)` (`onboarding.view`, `onboarding.assign`, `onboarding.review`, `onboarding.activate`,
`onboarding.payroll`, `onboarding.manage_packages`, etc.). No unguarded routes found.
**SharePoint claim re-checked tonight**: repo-wide case-insensitive grep for "sharepoint" returns only the CSP
`OFFICE_FRAME_ANCESTORS` allowlist entry in `backend/server.js:408` (`'https://*.sharepoint.com'`, for Office
Online iframe embedding) — no SharePoint storage integration, upload or sync code exists anywhere. Stage 2
documents are stored only via the portal's own document-pack mechanism (own upload → pinned library version →
library current version → text body → nothing).

## Tests run tonight
- unit (26 files, Onboarding + frontend-stage guards): 860/861 pass, 1 failed —
  `onboarding-document-reader.test.js › the OCR language data is shipped with the portal, not fetched when a
  document arrives` fails with `Cannot find module '@tesseract.js-data/eng/package.json'`. This is the
  `@tesseract.js-data` OCR language-data package genuinely missing from `node_modules` in this sandbox (the test
  asserts the data ships with the package) — an environment gap, not a code regression; cannot be fixed without
  `npm install`, which this audit may not run.
- integration (9 files, re-run in isolation after an earlier contended run produced 22 spurious failures from two
  jest processes truncating the same test database concurrently): **202/202 pass** —
  `onboarding-defaults.itest.js, onboarding-induction.itest.js, onboarding-journey.itest.js,
  onboarding-pack.itest.js, onboarding-returns.itest.js, onboarding-workflow.itest.js, onboarding.itest.js,
  stage1-launch-blockers.itest.js, stage2-pilot-readiness.itest.js`

## Open tasks (from the tracker)
- Stage 1 — build, todo
- Stage 2 — build, todo
- stage 3 — build, todo

## Compare with the tracker
Stage 1 and Stage 3 are built and tested. Stage 2's dynamic employee contract/pack-finalise step is done, but the
task's own description of storing finished documents "in SharePoint and the portal" has not been started for the
SharePoint half — confirmed again tonight, no SharePoint code exists anywhere in the repo.
