# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (one real gap — SharePoint storage;
  everything else is further along than the tracker checklist suggests)
- Addressed this window: no (no commits since 2026-09-27)
- Created at all: yes

## Located files

- Stage 1 (Letter of Offer): `backend/onboarding-journey-routes.js`
  (offer/wording, offer-template, offer/letter/preview.docx, /download,
  /download.pdf, offer/email/draft, offer/mark-sent),
  `onboarding-offer-docx.js`, `onboarding-offer-pdf.js`,
  `onboarding-offer-template.js`, `onboarding-offer-letter.js`,
  `onboarding-offer-email.js`, `onboarding-pack-email.js`. Frontend:
  `frontend/current/onboarding-journey.js` (+.css) — real editable-wording
  UI (`editTerms()`, "Save the wording", "Edit the offer details").
- Stage 2 (docs/defaults/contract): `backend/onboarding-defaults-routes.js`,
  `onboarding-pack-routes.js`, `onboarding-pack-db.js`,
  `onboarding-contract-docx.js`.
- Stage 3 (induction): `onboarding-journey.js` §Stage 3,
  `onboarding-induction.js`, `onboarding-lifecycle.js`.
- SharePoint storage: `grep -ril sharepoint backend frontend/current` found
  only a CSP `frame-ancestors` allowlist entry in `backend/server.js` (for
  Office/SharePoint iframing) — **no SharePoint storage integration code
  exists anywhere.**
- `backend/onboarding-policies/` (named in CLAUDE.md's repo map) does **not
  exist** in the repository.
- Tests: 15 unit files + 7 integration files across offer/pack/journey/
  defaults/induction/workflow/payroll/returns/reconcile.

## Guard status

Every onboarding route guards `requireAuth` then per-route
`requirePermission('onboarding.*')` (view/assign/review/manage_packages/
manage_documents/manage_compliance/payroll/audit). No unguarded route found.

## Tests run

- `npx jest tests/onboarding-offer-docx.test.js tests/onboarding-offer-pdf.test.js tests/onboarding-offer-template.test.js tests/onboarding-contract-docx.test.js tests/onboarding-journey.test.js tests/onboarding-pack.test.js tests/onboarding-document-check.test.js tests/onboarding-payroll.test.js` → 8 suites, 76 tests passed.
- `npx jest tests/onboarding-frontend-guards.test.js tests/onboarding-journey-frontend-guards.test.js tests/onboarding-workflow-guards.test.js tests/onboarding-security.test.js tests/onboarding-returns-match.test.js tests/onboarding-returns-zip.test.js tests/onboarding-reconcile.test.js` → 7 suites, 264 tests passed.
- `DB_NAME=therapy_scheduler_auditD DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/onboarding-journey.itest.js tests/integration/onboarding-pack.itest.js --runInBand` → 2 suites, 31 tests passed.
- `...tests/integration/onboarding-defaults.itest.js tests/integration/onboarding-induction.itest.js tests/integration/onboarding-workflow.itest.js tests/integration/onboarding-returns.itest.js tests/integration/onboarding.itest.js --runInBand` → 5 suites, 143 tests passed.
- **Totals: 22 files, 514 tests, all passed, 0 failures.** No TODO/FIXME
  found.

## Classification by sub-thing

- **Stage 1 (Letter of Offer): proven.** Code, tests, guards and real
  editable-wording/preview/send UI all present. `onboarding-offer-email.js`
  composes an Outlook Graph **draft** (not a literal auto-send) with the
  letter attached, with full dispatch audit and mark-sent tracking — a
  complete implementation of "the Send button." PDF and DOCX both derive
  from the same `offerDocx.buildScalars()` source, giving content parity.
  `docs/qa/BROWSER_QA_RESULTS.md` flow C gives browser coverage.
- **Stage 2 SharePoint storage: untouched.** Zero integration code found.
- **Stage 2 "show documents under default categories" + dynamic contract:
  proven.** `onboarding-contract-docx.js:62` literally calls
  `offerDocx.buildScalars(...)` — the contract already dynamically pulls
  from the Letter of Offer, tested and passing.
- **Stage 3 (induction): proven**, tested via `onboarding-induction.itest.js`
  despite the tracker's bare, empty "stage 3" entry.

## Open tasks from the tracker

- "Stage 1" (todo, 3/7 checklist items checked) — checklist is stale: the
  remaining 4 items (editable preview, PDF/doc parity, Send button, full
  flow test) are already built and tested.
- "Stage 2" (todo, 1/7 checked) — SharePoint storage genuinely missing;
  everything else listed (flow check, layout, dynamic contract) is already
  done.
- "stage 3" (todo, bare title) — already built and tested.

## Commits in the window

None.

## Disagreement note

Refines, substantially. The previous `claude_update` ("Letter of Offer and
induction thoroughly tested and contract already pulls from offer, only
SharePoint missing") is confirmed correct on the SharePoint gap and the
dynamic-contract point. But the tracker's own checklists (3/7, 1/7) are
**stale relative to code** — they should not be read as representing real
engineering state; most of what they list as open is already built.
