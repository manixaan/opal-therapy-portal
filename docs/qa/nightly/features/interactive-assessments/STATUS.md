# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (2026-10-29 to 2026-11-12): yes — `backend/fca/docx-engine.js`, `backend/fca/templates/progress-report-v1.docx`, `support-letter-v1.docx`, `backend/templates-routes.js`, `backend/templates/catalogue.js`, `compose.js`, `progress-report-map.js`, `support-letter-map.js`, `frontend/current/templates.css/.js` — the `clinical-letter-templates` merge (`64e432f`) and `24aee93 feat(templates): Support Letter and Progress Report masters`
- Created (any code located): yes, extensively

## Located files

- Routes: `backend/fca-routes.js` (`/api/fca`), `backend/whodas-routes.js` (`/api/whodas`), `backend/assessments-routes.js` (`/api/assessments`), `backend/letter-routes.js` (`/api/letters`)
- Data access: `backend/fca/`, `backend/whodas/` directories, plus inline SQL
- Frontend: `frontend/current/assessment.js`, `fca.js`, `whodas.js`, `letter.js` — no standalone `ASSESSMENT TAB` banner; these render as builder entry points (`#fca-hub-entry`, `#letter-hub-entry`) inside the `RESOURCES TAB`'s Library → Templates collection (confirmed directly: `mockup_v3.html:5331-5339`)
- Unit tests (15 files): `assessment-catalogue.test.js`, `assessment-surface-guards.test.js`, `fca-docx-engine/frontend-helpers/preview-lifecycle/preview-pages/resolve-scalars/wizard-behaviour.test.js`, `letter-docx-engine/frontend-helpers/template-map.test.js`, `whodas-external-completion/frontend-guards/scoring/templates.test.js`
- Integration tests: `assessments.itest.js`, `fca-reports.itest.js`, `progress-note-letters.itest.js`, `whodas.itest.js`
- E2E: none.

## Guard check

Clean. All four routers carry `requireAuth` at the router level (`fca-routes.js:161`, `whodas-routes.js:99` plus a feature-flag gate at `:85`, `assessments-routes.js:62`, `letter-routes.js:166`). `fca-routes.js` and `letter-routes.js` document own-drafts-only scoping (even the owner is excluded) in their file headers — self-scoped by design, not flagged.

## Tests run

- Unit: 21 suites, 1107 tests — **all pass**
- Integration: `assessments.itest.js`, `fca-reports.itest.js`, `progress-note-letters.itest.js`, `whodas.itest.js` — all 4 included in the 245-test run (244 pass / 1 unrelated root-sandbox artifact failure — see brief Technical detail) — **pass**

## Open tasks from tracker

- "Assessment Review" — `todo`. A manual review/triage task for Ann (sort existing assessments into keep/remove, find originals, hand to Anthony/Pauli) — not a coding task.

## Disagreement — tracker is behind the evidence

The tracker's notes say: **"hudas 2.0 [WHODAS 2.0] is the only one that has actually been currently configured... there are heaps and heaps of other assessments that are pending or to be confirmed."** The code says otherwise: FCA (`fca-routes.js` + 6 unit test files + `fca-reports.itest.js`) and the Progress Report / Support Letter templates (`letter-routes.js`, `templates/progress-report-map.js`, `support-letter-map.js`, all added this window) are **just as built and tested** as WHODAS. This is a genuine disagreement — the tracker stage/notes understate what exists; flagging it so the "keep or remove" review in "Assessment Review" doesn't accidentally discard something that already works.

## Why tab-unproven, not proven

Despite the strongest unit/integration coverage of any feature in this audit, there is no E2E spec and no `docs/qa/BROWSER_QA_RESULTS.md` entry for opening an assessment/FCA/letter builder and completing an instrument in a real browser. The tracker's own `next_action` (pre-filled) already asks for exactly this.

## Commits in window touching it

Heavy — the entire `clinical-letter-templates` merge plus several induction packs for "Writing an FCA report" / "Writing a Progress Report" / "Writing a Case Note" (content, not code, but shows active team attention to this area).
