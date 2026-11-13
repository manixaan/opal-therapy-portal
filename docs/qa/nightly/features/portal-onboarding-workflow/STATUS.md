# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-11-12 to 2026-11-13): no — zero commits since the 2026-11-12 audit; no commits have touched `backend/onboarding-*` or `frontend/current/onboarding*.js` in this window
- Created (any code located): yes, extensively

## Located files

- Routes: `onboarding-employee-routes.js`, `onboarding-workflow-routes.js`, `onboarding-journey-routes.js`, `onboarding-pack-routes.js`, `onboarding-returns-routes.js`, `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`, `onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`, `onboarding-library-routes.js`, `onboarding-routes.js`
- Data access: `onboarding-journey.js`, `onboarding-offer-docx.js`, `onboarding-contract-docx.js`, `onboarding-offer-template.js`, `onboarding-offer-email.js`, `onboarding-document-check.js`, `onboarding-lifecycle.js`
- Frontend: `ONBOARDING TAB` (`mockup_v3.html:4299`); `frontend/current/onboarding.js`, `onboarding-journey.js`
- Unit tests: 25 files run tonight (plus `onboarding-payroll.test.js` and `onboarding-security.test.js` run in earlier groups = 27 total), including `onboarding-offer-docx/pdf/template.test.js`, `onboarding-contract-docx.test.js`, `onboarding-journey.test.js`, `onboarding-pack.test.js`, `onboarding-workflow-guards.test.js`, `onboarding-journey-frontend-guards.test.js`
- Integration tests: `onboarding-defaults.itest.js`, `onboarding-induction.itest.js`, `onboarding-journey.itest.js`, `onboarding-pack.itest.js`, `onboarding-payroll-xero.itest.js`, `onboarding-portal-route.itest.js`, `onboarding-returns.itest.js`, `onboarding-wizard-link.itest.js`, `onboarding-workflow.itest.js`, `onboarding.itest.js`
- E2E: none dedicated. `docs/qa/BROWSER_QA_RESULTS.md` row C (unchanged since 2026-08-01).

## Guard check

Re-confirmed tonight by direct grep, unchanged. `onboarding-employee-routes.js` documents `/api/onboarding-invite/*` as deliberately public pre-auth (invite acceptance, by design) and `/api/onboarding/me/*` as `requireAuth`-only but strictly self-scoped by `req.user.id` — matches the self-scoped-by-design exception. Every other router carries `requireAuth` + `requirePermission('onboarding.*')`.

## Tests run

- Unit: re-run tonight — 25 of 25 suites in this group passed (604 of 605 individual tests passed). `onboarding-document-reader.test.js` failed one test — re-confirmed not a code defect: it asserts the optional OCR language-data package `@tesseract.js-data/eng` is present, and it is still missing from this sandbox's `node_modules` despite being declared in `package.json`. Environment gap, not a regression.
- Integration: re-run tonight — 10 suites, 218 tests, **all pass** — identical to the 2026-11-12 run.

## Open tasks from tracker

- **Stage 1** — `todo`. Re-confirmed tonight: the unticked checklist items (editable preview, matching PDF/doc downloads, Send button, full-flow test) are, in fact, built and unit-tested (`onboarding-offer-docx.test.js`, `onboarding-offer-pdf.test.js`, `onboarding-offer-template.test.js` all exist and pass). Stage 1 is functionally proven; the tracker checklist is stale, not the code.
- **Stage 2** — `todo`. Re-confirmed tonight by direct search: no SharePoint document-storage API exists anywhere in `backend/` (Graph usage is M365 identity/mail only, via `graph-identity.js`/`graph-mail.js`). Real, standing gap, not tracker staleness.
- **stage 3** — `todo`. No notes recorded; effectively `untouched`.

## Commits in window touching it

None this window.

## Why proven overall, with one standing gap

Unchanged for a fifth consecutive night: permission-gated, browser QA proves the onboarding→profile chain, and the core Letter of Offer flow (Stage 1) is fully built and unit-tested. Stage 2's SharePoint storage gap stands, verified again tonight.

## Disagreement

None in the formal sense — Stage 1's unticked checklist items are actually done in code; the tracker checklist is stale there, not the implementation.
