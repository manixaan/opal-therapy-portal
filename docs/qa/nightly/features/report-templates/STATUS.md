# Report Templates

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window: no
- Created (any located code): **yes** — all three sub-items built

## Located files

- Backend: `backend/fca-routes.js` (FCA report draft/generate/download), `backend/letter-routes.js`
  (Progress Letter drafts, same composition machinery as FCA, different template),
  `backend/templates-routes.js` (Resource Hub Templates — completes a master template including
  the Client Agreement/service agreement, exports stripped Word/PDF; masters live under
  `backend/service-agreements/templates/`). There is no standalone `service-agreement-routes.js`.
- Frontend: all three are overlay roots appended to `<body>` in `mockup_v3.html`, not inside a
  named tab block — FCA wizard (`#fca-root`, `fca.js?v=5`), Progress Letter wizard
  (`letter.js?v=2`), Client Agreement handled generically through Templates (`templates.js?v=8`).
- Guards: all three guarded — `requireAuth` + per-route `requireClinicalRead`/`Write`
  (`fca-routes.js`, `letter-routes.js`) or `requireTemplateRead`/`Write` (`templates-routes.js`).

## Tests and results

- Unit: `fca-*` (6 files), `letter-*` (3 files), `templates-*` (5 files) — **all pass**
  (part of the 15-suite/897-test and 5-suite/153-test batches run this audit).
- Integration: `fca-reports.itest.js`, `progress-note-letters.itest.js`, `templates.itest.js` —
  **all pass**.
- No E2E spec exists for any of the three (`e2e/tests/` has only `portal.spec.js`,
  `tutorials.spec.js`). No browser QA entries for fca/letter/template/agreement in
  `docs/qa/BROWSER_QA_RESULTS.md`.

## Open tasks from the tracker

- "FCA", "Progress Letter", "Client Agreement Form" — all three empty, no explanation recorded.

## Findings

No code defects found. All three wizards have solid unit + integration coverage, but zero
browser/E2E proof any of them actually completes end to end for a user — exactly what the
tracker's own `next_action` asks for.
