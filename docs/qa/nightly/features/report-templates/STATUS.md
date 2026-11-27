# Report Templates

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven**
Addressed this window (since 2026-11-13): no
Created (any located code): yes

## Located files

- FCA → `backend/fca-routes.js`
- Progress Letter → `backend/letter-routes.js`
- Client Agreement Form → `backend/templates-routes.js` + `backend/service-agreements/templates/`
  (static source documents consumed by the export pipeline; no routes of their own)
- Frontend: no own tab banner; `#fca-root` placeholder (`mockup_v3.html:28406`) — an embedded
  surface inside the client profile, not a top-level tab.

## Guard check

`fca-routes.js` / `letter-routes.js`: `requireAuth` + per-route `requireClinicalRead`/
`requireClinicalWrite`. `templates-routes.js`: `requireAuth` + per-route `requireTemplateRead`/
`requireTemplateWrite` (role checks against `CLINICAL_ROLES` plus org-scoping). All guarded
correctly.

## Tests

- Unit: `fca-docx-engine.test.js`, `fca-frontend-helpers.test.js`, `fca-preview-lifecycle.test.js`,
  `fca-preview-pages.test.js`, `fca-resolve-scalars.test.js`, `fca-wizard-behaviour.test.js`,
  `letter-docx-engine.test.js`, `letter-frontend-helpers.test.js`, `letter-template-map.test.js`,
  `templates-service-agreement-map.test.js` — **15/15 suites, 626/626 tests passed**.
- Integration: `fca-reports.itest.js`, `progress-note-letters.itest.js` — both passed clean as
  part of a 16-file shared batch.
- No E2E spec, no entry in `docs/qa/BROWSER_QA_RESULTS.md` for fca/letter/agreement. Nobody has
  hand-checked a document through to a downloaded file, exactly as the tracker's own
  `next_action` says.

## Open tasks (from tracker)

- FCA, Progress Letter, Client Agreement Form — all todo, each with no recorded detail beyond
  the shared `next_action`: run all three document flows by hand through to a downloaded file.

## Commits in window (since 2026-11-13)

None touch `fca-routes.js`, `letter-routes.js` or `templates-routes.js`.

## Disagreement

None on stage. All three document types generate correctly under test; the only gap is a human
hand-check of the downloaded file.
