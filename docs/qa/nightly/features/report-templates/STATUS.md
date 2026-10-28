# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (since last audit, 2026-10-24): no — no commit this window touched `fca-routes.js`, `letter-routes.js` or `templates-routes.js`
- Created (code exists): yes, for all three tasks

## Per-task breakdown

### FCA
- Located: `backend/fca-routes.js` + `fca.js`; guarded (`requireClinicalRead`/`requireClinicalWrite`).
- Tests: `fca-docx-engine.test.js`, `fca-frontend-helpers.test.js`, `fca-preview-lifecycle.test.js`, `fca-preview-pages.test.js`, `fca-resolve-scalars.test.js`, `fca-wizard-behaviour.test.js` (unit) — **all pass** (re-run tonight); `tests/integration/fca-reports.itest.js` — **pass** (re-run tonight).
- Browser/E2E proof: none.

### Progress Letter
- Located: `backend/letter-routes.js` + `letter.js`; guarded identically.
- Tests: `letter-docx-engine.test.js`, `letter-frontend-helpers.test.js`, `letter-template-map.test.js` (unit) — **all pass** (re-run tonight); `tests/integration/progress-note-letters.itest.js` — **pass** (re-run tonight).
- Browser/E2E proof: none.

### Client Agreement Form
- **Not a standalone wizard** — implemented inside the generic Resource Hub → Templates system: `backend/templates-routes.js` + `templates.js`, mapped via `backend/templates/service-agreement-map.js`; guarded (`requireTemplateRead`/`requireTemplateWrite`).
- Tests: `templates-routes.test.js`, `templates-appendices.test.js`, `templates-export-boundary.test.js`, `templates-frontend-guards.test.js`, `templates-service-agreement-map.test.js` (unit) — **all pass** (re-run tonight); `tests/integration/templates.itest.js` — **pass** (re-run tonight).
- Browser/E2E proof: none.

No TODO/FIXME found in any of these route files.

## Open tasks from the tracker
"FCA", "Progress Letter", "Client Agreement Form" — all `todo`, no notes recorded on any.

## Commits in window that touched it
None — tonight's 8 commits touched none of this feature's files.

## Disagreement
None against tracker stage. One internal note: the tracker treats "Client Agreement Form" as its own generator, but it actually lives inside the shared Templates system alongside other document templates — worth knowing before assigning separate work to it.

## Re-verified 2026-10-27
No commit since last night's audit (`896ace1`) touched this feature's files — the true window (`896ace1..41f45ed`) holds only Calendar sync-settings/Outlook/Splose work (see Portal - Splose - Outlook's folder). Re-ran the unit suite tonight (interview-templates, templates-*, whodas-templates): 218/218 passed, same as last night. Evidence label unchanged.

## Re-verified 2026-10-28
Real window tonight is `41f45ed..15acf0c` (travel desk-work, place-names autocomplete, a
dependency patch — see the morning brief §6); none of it touches `fca-routes.js`,
`letter-routes.js` or `templates-routes.js`. Re-ran the 14-file FCA/letter/templates
unit batch (569 pass) and the `fca-reports.itest.js`/`progress-note-letters.itest.js`/
`templates.itest.js` integration set (part of a 172-pass batch) tonight — all pass.
Still no browser/E2E proof for any of the three wizards. Evidence label unchanged.
