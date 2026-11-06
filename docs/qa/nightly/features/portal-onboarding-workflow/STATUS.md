Feature: Portal Onboarding Workflow
Tracker stage: idea | Tracker environment: none
Evidence label: needs-refinement
Addressed this window (since 2026-10-23): no — no onboarding-prefixed commit appears in the 40-commit backend/frontend change list for this window.
Created at all: yes — this is one of the most built-out subsystems in the repo.

## Located
- Routes (all mounted in `backend/server.js`, requireAuth applied to the whole `/api/onboarding` prefix, then `requirePermission('onboarding.assign')` or `requirePermission('onboarding.view')` per route — these are the delegated `onboarding.*` permissions CLAUDE.md calls out):
  `onboarding-journey-routes.js` (Letter of Offer: edit terms, wording, preview/download/download.pdf, upload a hand-edited .docx, Outlook email draft, mark-sent, signed-copy upload/preview, verify/decline/withdraw/skip), `onboarding-package-docs-routes.js` (Stage 2 document packages: list/add/patch/delete/restore/reorder/history), `onboarding-workflow-routes.js`, `onboarding-employee-routes.js`, `onboarding-pack-routes.js`, `onboarding-returns-routes.js`, `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`, `onboarding-assignment-routes.js`, `onboarding-library-routes.js`, `onboarding-routes.js`.
- Data/doc generation: `onboarding-offer-letter.js`, `onboarding-offer-docx.js`, `onboarding-offer-pdf.js`, `onboarding-offer-template.js`, `onboarding-offer-email.js`, `onboarding-contract-docx.js` (Stage 2 Contract of Employment), `onboarding-journey-db.js`, `onboarding-workflow-db.js`.
- Frontend: `<!-- ============ ONBOARDING TAB ============ -->` in `frontend/current/mockup_v3.html` (owner/admin Edit Onboarding management view) plus the standalone employee-facing `frontend/current/onboarding.html` / `onboarding.js` / `onboarding-journey.js` self-serve wizard.
- Storage: **database-backed, not SharePoint.** No SharePoint reference exists anywhere under `backend/onboarding-*.js`; documents are stored via `onboarding-journey-db.js`/`onboarding-workflow-db.js` and served from Postgres. `sharepoint.com` only appears as an allowed CSP host in `server.js` and in `resource-library-routes.js` comments (unrelated Resource Hub feature), not as an onboarding integration.
- Dynamic contract: **already built**, contrary to the open checklist item. `onboarding-contract-docx.js` reads the Letter of Offer's own computed scalars (`offerDocx.buildScalars(...)`) for remuneration, pay cycle, superannuation, probation, signatory, etc., so the contract cannot disagree with the letter.

## Tests
- Unit (8 files, `npx jest tests/onboarding-contract-docx.test.js tests/onboarding-offer-docx.test.js tests/onboarding-offer-pdf.test.js tests/onboarding-offer-template.test.js tests/onboarding-journey.test.js tests/onboarding-workflow-guards.test.js tests/onboarding-journey-frontend-guards.test.js tests/onboarding-frontend-guards.test.js`): **239/239 passed.**
- Integration (`DB_NAME=therapy_scheduler_audit_b DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/onboarding-journey.itest.js --runInBand`): **26/26 passed.**
- Many further onboarding unit/integration files exist (`onboarding-pack`, `onboarding-payroll`, `onboarding-returns`, `onboarding-extraction`, etc.) that were not run tonight — out of scope for a non-weekly run; see `docs/qa/BROWSER_QA_RESULTS.md` row C for employee-facing wizard browser evidence (7/7 ✅, covers login → `/onboarding` routing → setup-card rendering), but that covers the self-serve wizard, not the admin "Edit Onboarding" management tab used to build/send the Letter of Offer and Stage 2 packages — no browser/E2E coverage was found for that admin flow.

## Open tracker tasks
- Stage 1: "Add an editable preview on the portal" and "Make preview, PDF, and document downloads look identical" marked not done — code review suggests these largely exist (preview/download/download.pdf endpoints all present and tested), so this checklist may be stale; "Add a Send button that emails the letter with the document attached" is implemented as an Outlook-draft-then-mark-sent flow rather than a single in-portal send click — functionally close but worth the team confirming it matches intent.
- Stage 2: "Finalise the onboarding documents and store them in SharePoint" — open; "Make the employee contract dynamic" — **code already does this**; the checklist item appears stale, not actually outstanding.
- Stage 2's "Decide: agree which parts of the employee contract are fixed and which change per applicant" is still an open decision task.
- "stage 3" task has no explanation/checklist at all.

## Commits in window
None touching `onboarding-*` found in the 14-day change list (since 2026-10-23, HEAD 704a51f).

## Disagreement
The tracker's own prior `claude_update` text claims this was "re-confirmed tonight" by a previous audit — but no dated brief exists anywhere under `docs/qa/nightly/` before this one, and `docs/qa/nightly/features/` did not exist before tonight. That claim could not have come from a prior run of this audit; tonight's findings are independently verified, not a "re-confirmation." Separately: the tracker's Stage 2 checklist still lists "Make the employee contract dynamic" as not done, but the code already implements it (`onboarding-contract-docx.js` pulls remuneration/pay/superannuation/probation straight from the Letter of Offer) — code is ahead of the tracker checklist here, worth a tracker tidy-up rather than more build work.
