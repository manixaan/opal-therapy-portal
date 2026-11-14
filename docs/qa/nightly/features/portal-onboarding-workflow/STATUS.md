# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven** (Stage 1 and Stage 2); Stage 3 has no defined
  scope to verify
- Addressed in change window (2026-11-13 to 2026-11-14): no
- Created at all: yes

## Located files

- Routes: `backend/onboarding-workflow-routes.js`,
  `backend/onboarding-employee-routes.js`, `backend/onboarding-journey-routes.js`,
  `backend/onboarding-pack-routes.js`, `backend/onboarding-returns-routes.js`,
  `backend/onboarding-defaults-routes.js`, `backend/onboarding-package-docs-routes.js`,
  `backend/onboarding-assignment-routes.js`, `backend/onboarding-library-routes.js`,
  `backend/onboarding-routes.js`
- Letter of Offer (Stage 1): `onboarding-offer-docx.test.js`,
  `onboarding-offer-pdf.test.js`, `onboarding-offer-template.test.js` — one
  master, edited/previewed/downloaded identically, emailed with the
  document attached
- Employee contract dynamic (Stage 2): `onboarding-contract-docx.test.js`
  (reads the Letter of Offer and fills remuneration etc. automatically)
- Edit Onboarding tab (Stage 2): `frontend/current/onboarding-journey.js`
  `viewDefaults()` — only `PKG_OT_FULL_TIME` is wired up today ("Packages
  whose master default can be opened from Edit onboarding. Everything else
  is greyed out for now.")
- Frontend: `frontend/current/onboarding.js`, `onboarding-journey.js`;
  `ONBOARDING TAB` banner in `mockup_v3.html` (line ~4324)
- 26 unit test files (`onboarding-accounts` through `onboarding-workflow-guards`)
- Integration tests: `onboarding-defaults.itest.js`, `onboarding-journey.itest.js`,
  `onboarding-pack.itest.js`, `onboarding-portal-route.itest.js`,
  `onboarding-returns.itest.js`, `onboarding-wizard-link.itest.js`,
  `onboarding-workflow.itest.js`, `onboarding.itest.js`
- **Browser QA**: `docs/qa/BROWSER_QA_RESULTS.md` flow C ("Onboarding/profile
  chain") — 7/7 checks passed live on staging: login routes a new therapist
  to `/onboarding`, the review step returns 200, the setup card renders
  truthfully with ordered next steps, and state persists after reload.

## Guard check

Every route file: `requireAuth` plus `requirePermission('onboarding.*')` on
the relevant actions (these are the delegated onboarding permissions
CLAUDE.md calls out as not in any role's defaults except owner). No
finding.

## Tests run

- Unit: **646/647 passed.** The one failure
  (`onboarding-document-reader.test.js`, OCR language-pack path) is a
  missing optional dependency in this sandbox
  (`@tesseract.js-data/eng` is absent from `backend/node_modules` —
  confirmed by `ls`), not a code defect. Per the audit's hard limits this
  was not fixed by installing the package; flagged here instead.
- Integration: **208/208 passed** on a clean re-run against
  `therapy_scheduler_audit_test` (85 migrations applied). An earlier run in
  this same session showed 7 failures; that run overlapped with a separate
  integration suite hitting the same database (a Postgres deadlock was
  observed in that other suite at the same time) — a self-inflicted
  concurrency artifact from this audit session, not a reproducible finding.
  Re-run alone, it is fully clean.

## Recency

Not touched in the change window (since the 2026-11-13 audit).

## Classify

`proven` for Stage 1 (Letter of Offer) and Stage 2 (document storage +
dynamic contract): code located, guarded, 854 total tests passing, and
live browser QA confirms the onboarding chain renders and persists state
correctly. **Stage 3 has no recorded scope at all** — the tracker task
"stage 3" has an empty title-only entry with no explanation, so there is
nothing to locate or verify against it.

## Open tasks (from tracker)

- Stage 1 — todo. Matches the evidence; built and tested.
- Stage 2 — todo. Matches the evidence for storage/categories and the
  dynamic contract; the "Edit Onboarding" default-package wiring is
  deliberately limited to one package (`PKG_OT_FULL_TIME`) today — real
  open scope, not a defect.
- stage 3 — todo, and empty. Nothing recorded to build against.

## Commits in the window touching this

None.

## Disagreement

Tracker stage `idea`. Evidence: Stage 1 and the core of Stage 2 are built,
tested and the only feature in this snapshot with a positive live browser
QA result on record. Recommend closing Stage 1 and most of Stage 2, and
either filling in "stage 3" with real scope or archiving it.
