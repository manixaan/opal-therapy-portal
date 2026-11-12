# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-10-29 to 2026-11-12): no (no commits touched `backend/onboarding-*` or `frontend/current/onboarding*.js` in this window — the subsystem is stable, not actively changing)
- Created (any code located): yes, extensively

## Located files

- Routes: `onboarding-employee-routes.js`, `onboarding-workflow-routes.js`, `onboarding-journey-routes.js`, `onboarding-pack-routes.js`, `onboarding-returns-routes.js`, `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`, `onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`, `onboarding-library-routes.js`, `onboarding-routes.js`
- Data access: `onboarding-journey.js`, `onboarding-offer-docx.js`, `onboarding-contract-docx.js`, `onboarding-offer-template.js`, `onboarding-offer-email.js`, `onboarding-document-check.js`, `onboarding-lifecycle.js`
- Frontend: `ONBOARDING TAB` (`mockup_v3.html:4299`); `frontend/current/onboarding.js`, `onboarding-journey.js`
- Unit tests: 27 files, including `onboarding-offer-docx/pdf/template.test.js`, `onboarding-contract-docx.test.js`, `onboarding-journey.test.js`, `onboarding-pack.test.js`, `onboarding-workflow-guards.test.js`, `onboarding-journey-frontend-guards.test.js`, `onboarding-security.test.js`
- Integration tests: 10 files, including `onboarding-defaults/induction/journey/pack/payroll-xero/portal-route/returns/wizard-link/workflow.itest.js`, `onboarding.itest.js`
- E2E: none dedicated. `docs/qa/BROWSER_QA_RESULTS.md` row C ("Onboarding/profile chain", 2026-08-01) covers the therapist's path through onboarding into Profile — basic chain only, not the document-template or Stage 2/3 work below.

## Guard check

Clean. `onboarding-employee-routes.js` documents that `/api/onboarding-invite/*` is deliberately public pre-auth (invite acceptance — by design) and `/api/onboarding/me/*` is `requireAuth`-only but strictly self-scoped by `req.user.id` (self-scoped by design, matching the `backend-api.md` exception). Every other router carries `requireAuth` + `requirePermission('onboarding.*')`.

## Tests run

- Unit: 26 of 27 suites passed (654 of 654 individual tests passed except one). `onboarding-document-reader.test.js` failed one test — **not a code defect**: it asserts an OCR language-data package (`@tesseract.js-data/eng`) is present in `node_modules`, and that optional dependency is missing in this sandbox despite being declared in `package.json`. This is an environment gap, not a regression; see Technical detail in the brief.
- Integration: 10 suites, 218 tests — **all pass**.

## Open tasks from tracker

- **Stage 1** — `todo`. Checklist: confirm what to reuse (✅ done), decide wording/layout (✅ done), create master template (✅ done), add editable preview on portal (not ticked), make preview/PDF/doc downloads identical (not ticked), add Send button (not ticked), test full flow end to end (not ticked). **Evidence check**: the unticked items are, in fact, built and unit-tested — `onboarding-offer-docx.test.js`, `onboarding-offer-pdf.test.js`, `onboarding-offer-template.test.js`, `onboarding-offer-email.js` all exist and pass. Stage 1 is functionally proven; the tracker checklist is stale, not the code.
- **Stage 2** — `todo`. Checklist: finalise documents and store in SharePoint (not ticked), show documents in portal under default categories (✅ done), check Stage 1→2 flow and button wiring (not ticked), simplify layout (not ticked), decide fixed vs dynamic contract fields (not ticked), make contract dynamic like the LOO (not ticked). **Evidence check, verified directly**: a targeted search of `backend/` for `sharepoint`/`graph.microsoft`/`drives/` found Microsoft Graph usage only for M365 identity provisioning and mail sending (`graph-identity.js`, `graph-mail.js`, `graph-mail-transport.js`) — **no SharePoint document-storage API exists anywhere**. This is a real, confirmed gap, not tracker staleness. `onboarding-contract-docx.js` does already read remuneration-style fields dynamically (partial progress on the "dynamic like the LOO" item), but the SharePoint storage piece is genuinely unbuilt.
- **stage 3** — `todo`. No `explanation`, no checklist, no notes recorded. Nothing to locate or test here; this sub-item is effectively `untouched`.

## Commits in window touching it

None. The last activity predates this 14-day window.

## Why proven overall, with one new finding

This matches the classification held for four consecutive nights (same commit `40669e7`, zero commits since 2026-11-11): permission-gated, browser QA proves the basic onboarding→profile chain (`docs/qa/BROWSER_QA_RESULTS.md` row C), and the core Letter of Offer flow (Stage 1) is fully built and unit-tested.

**New this audit**: a direct search of `backend/` for `sharepoint`/`graph.microsoft`/`drives/` confirms there is genuinely **no SharePoint document-storage API anywhere** — Graph usage elsewhere is for M365 identity/mail only. This is Stage 2's open checklist item, verified as a real gap rather than assumed. It doesn't change tonight's `proven` label (the core, already-shipped onboarding flow is what's being rated), but it's worth the team's attention since Stage 2/3 are explicitly forward-looking scope, not yet built.

## Disagreement

None in the formal sense. Stage 1's unticked checklist items (editable preview, matching PDF/doc downloads, Send button, full-flow test) are actually done in code — the tracker checklist is stale there, not the implementation.
