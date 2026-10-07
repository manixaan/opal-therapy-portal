# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window (commits since 2026-10-06 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-06); the audited commit (`aacf8e68`) is still unchanged. This is the seventh consecutive reconfirmation night on this exact code. Tonight is not Sunday UTC, so targeted batches were run (not the complete suites) — see each section below for exactly what ran tonight.
- Created (any located code at all): **yes**

## Located files
- Stage 1: backend/onboarding-offer-letter.js, onboarding-offer-docx.js, onboarding-offer-pdf.js, onboarding-offer-template.js, onboarding-offer-email.js, onboarding-journey-routes.js, onboarding-defaults-routes.js, backend/graph-mail.js (real Microsoft Graph integration)
- Stage 2: backend/onboarding-pack-routes.js, onboarding-pack.js, onboarding-pack-db.js, onboarding-pack-email.js, backend/onboarding-contract-docx.js (the dynamic employee contract — fills OPAL_COE_* content controls from the SAME Stage-1 offer terms)
- Stage 3: backend/onboarding-induction.js, backend/onboarding-journey.js (projectInduction(), STAGE3_STATUSES), backend/onboarding-journey-routes.js
- Frontend: ONBOARDING TAB (mockup_v3.html:4162), frontend/current/onboarding-journey.js (all three stage panels, including the 'Edit onboarding' default-categories screen)

## Guard check
All 11 onboarding-*-routes.js files guarded. The public /api/onboarding-invite/* routes are deliberately outside requireAuth by design (no user-id parameter, documented IDOR mitigation). Everything else: requireAuth + per-route requirePermission('onboarding.view' | 'onboarding.assign' | 'onboarding.manage_packages'). No gaps.

## Tests run tonight
- unit: `onboarding-offer-docx.test.js, onboarding-offer-pdf.test.js, onboarding-offer-template.test.js, onboarding-journey.test.js, onboarding-journey-frontend-guards.test.js, onboarding-contract-docx.test.js, onboarding-pack.test.js` — run in isolation tonight: 111/111 pass
- integration: `onboarding-journey.itest.js, onboarding-defaults.itest.js, onboarding-pack.itest.js, onboarding-induction.itest.js` — 34/34 pass tonight

## Open tasks (from the tracker)
- Stage 1 — build, todo
- Stage 2 — build, todo
- stage 3 — build, todo

## Compare with the tracker
Tracker shows all three stages todo, but Stage 1 and Stage 3 are clearly built and well-tested. Stage 2 genuinely has an open gap: the dynamic employee contract the team asked for is fully delivered, but storing finished documents in SharePoint (the other half of the same task) is not — grepped again tonight: the only "sharepoint" hit anywhere in the repo is a CSP domain allowance in server.js, not a document-storage integration. "todo" is accurate for Stage 2 specifically; it's imprecise to treat all three stages the same way.

## Also run tonight (wider scope, not feature-specific)
`onboarding-returns.itest.js` and `stage2-pilot-readiness.itest.js` were run tonight as part of a broader sweep (6 Onboarding/Snapshot-adjacent integration files, 42 pass / 1 fail). The one failure (`readonly-and-hardening.itest.js`, a storage-write-failure fault-injection case) is a root-bypassed-permission-check environment artifact — this sandbox runs as root, so the test's `chmod` cannot actually block the write — not a code regression; the same artifact was already documented in the 2026-10-04 Sunday deep run.
