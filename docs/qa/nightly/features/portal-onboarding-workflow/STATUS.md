# Portal Onboarding Workflow

Tracker stage: idea · Tracker environment: none
Evidence label: **needs-refinement**
Addressed this window (since 2026-11-13): no
Created (any located code): yes

## Located files

- **Stage 1** (Letter of Offer): `backend/onboarding-offer-template.js`,
  `backend/onboarding-offer-docx.js`, `backend/onboarding-offer-pdf.js`,
  `backend/onboarding-offer-letter.js`, `backend/onboarding-offer-email.js`, routed via
  `backend/onboarding-employee-routes.js` / `backend/onboarding-workflow-routes.js`.
- **Stage 2** (SharePoint + portal default categories, dynamic contract):
  `backend/onboarding-package-docs-routes.js`, `backend/onboarding-pack-routes.js`,
  `backend/onboarding-pack.js`, `backend/onboarding-contract-docx.js`,
  `backend/onboarding-catalogue.js`. **SharePoint storage specifically: not found** — no
  SharePoint client/API integration anywhere under `backend/` (a case-insensitive grep for
  "sharepoint" across the backend turns up nothing beyond tracker text and
  `docs/launch/*`). Documents are stored only in the portal's own storage today.
- **Stage 3**: nothing recorded in the tracker, nothing located in code.
- Frontend: `============ ONBOARDING TAB ============` (`mockup_v3.html:4634`).

## Guard check

`onboarding-employee-routes.js`: `router.use('/api/onboarding/me', requireAuth)`, header states
"AUTHENTICATED and STRICTLY SELF-SCOPED… scoped to req.user.id and nothing else" — self-scoped
by design. `onboarding-pack-routes.js`, `onboarding-workflow-routes.js`,
`onboarding-package-docs-routes.js` all carry explicit `requirePermission`/`requireRole` guards
in addition to `requireAuth`. No unguarded route found.

## Tests

- Unit (27 files, `onboarding-*.test.js`): **26/27 suites passed, 653/654 tests passed**. The
  one failure (`onboarding-document-reader.test.js`) is a confirmed environment artifact — it
  resolves a bundled OCR model file (`@tesseract.js-data/eng`) that isn't installed in this
  sandbox, not a code defect.
- Integration (9 files): `onboarding-workflow.itest.js`, `onboarding-journey.itest.js`,
  `onboarding-returns.itest.js`, `onboarding-portal-route.itest.js`, `onboarding-pack.itest.js`,
  `onboarding-induction.itest.js`, `onboarding-payroll-xero.itest.js`,
  `onboarding-wizard-link.itest.js`, `onboarding-defaults.itest.js` — **9/9 suites, 169/169
  tests passed**.
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` row C ("Onboarding/profile chain", 2026-08-01)
  confirms login routes a new therapist to `/onboarding` and the setup card renders truthfully
  — this proves the shell, not the Letter-of-Offer preview/PDF/doc/send flow or Stage 2.

## Open tasks (from tracker)

- **Stage 1** — todo overall; 3 of 7 checklist items done (confirm what exists, decide
  wording/layout, create the template). Still open: editable preview on the portal, making
  preview/PDF/doc downloads look identical, the Send-by-email button, and testing the full
  flow end to end.
- **Stage 2** — todo; 1 of 7 checklist items done (show documents in the portal under default
  categories). Still open: finalise documents into SharePoint (confirmed not built), check the
  Stage 1→2 flow and button-by-button operation, simplify the layout, decide the fixed-vs-
  dynamic contract split, and make the employee contract dynamic like the Letter of Offer.
- **Stage 3** — todo, no detail recorded.

## Commits in window (since 2026-11-13)

None touch any `onboarding-*.js` file.

## Disagreement

None on stage. The tracker's own gap call (SharePoint storage still absent) is confirmed
accurate by this audit.
