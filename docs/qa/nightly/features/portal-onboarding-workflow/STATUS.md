# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window (commits since 2026-10-02 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-02); the audited commit (`aacf8e6`) is still unchanged. This is the fourth consecutive reconfirmation night on this exact code.
- Created (any located code at all): **yes**

## Located files
- All 11 onboarding-*-routes.js files (employee, workflow, journey, pack, returns, payroll, defaults, package-docs, assignment, library, onboarding-routes.js itself) plus ~37 supporting modules
- frontend/current/onboarding.js; ONBOARDING TAB banner at mockup_v3.html:4162
- backend/onboarding-policies/ does NOT exist (no such directory)
- Stage mapping (from file-header comments): Stage 1 = onboarding-journey-routes.js. Stage 2 = onboarding-pack-routes.js, onboarding-returns-routes.js, onboarding-defaults-routes.js, onboarding-package-docs-routes.js. Stage 3 = onboarding-payroll-routes.js, onboarding-assignment-routes.js.

## Guard check
All 11 route files guarded. onboarding-employee-routes.js: requireAuth on /api/onboarding/me; the public /api/onboarding-invite/* routes are deliberately outside requireAuth by design (documented IDOR mitigation — no user-id parameter). The rest: requireAuth + per-route requirePermission('onboarding.*'). permissions.js defines 11 independent delegated onboarding.* permissions in 3 bundles — solid design, no gaps.

## Tests and results
23 unit test files: re-run tonight, 22 pass; 1 fails — onboarding-document-reader.test.js (14/15 pass, 1 failure: "Cannot find module '@tesseract.js-data/eng/package.json'"). Re-confirmed again tonight via `ls node_modules/@tesseract.js-data` (no such directory): this is a MISSING OCR LANGUAGE-DATA NPM PACKAGE in this sandbox (an environment/dependency gap this audit is barred from fixing via npm install), not an application code defect. Fourth consecutive night with the identical single failure.
Integration: onboarding-defaults.itest.js, onboarding-journey.itest.js, onboarding-pack.itest.js, onboarding-workflow.itest.js, onboarding.itest.js — re-run tonight, 160/160 pass, identical to the last three nights.
Browser QA: docs/qa/BROWSER_QA_RESULTS.md item C (Onboarding/profile chain, 7/7) directly exercises this.

## Open tasks (from the tracker)
- Stage 1 — build, todo
- Stage 2 — build, todo
- stage 3 — build, todo

## Compare with the tracker
Tracker shows all three stages todo, but Stage 1 and Stage 3 are clearly built and well-tested. Stage 2 genuinely has an open gap (SharePoint storage), so "todo" is accurate there specifically — the tracker isn't wrong about Stage 2, just imprecise about treating all three stages the same way.
