# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-22 → 2026-09-23): no — zero commits landed in this window at all
- Created (any located code): yes — WHODAS 2.0 is fully built; every other instrument is a deliberate "source required" placeholder, not a bug

## Located files

- Routes: `backend/whodas-routes.js` (`/api/whodas/*`), `backend/assessments-routes.js` (`/api/assessments/*` — cross-instrument catalogue, client history, share prep)
- Data access: `backend/whodas/instrument.js`, `scoring.js`, `build-instrument-data.js`, `instrument-data.json`, `completed-pdf.js`, `template-registry.js`, `extract-templates.js`, field maps and hash-checked WHO source PDFs under `backend/whodas/templates/`; `backend/assessments/definitions.js` (single shape for every standardised assessment — only WHODAS is `implemented`, the rest are `REGISTER_ONLY`/`NEW_INSTRUMENTS` returning `sourceRequiredDefinition()`), `availability.js`, `share.js`
- Frontend: `frontend/current/assessment.js`/`.css` (dedicated full-page surface, `#assessment-root`, reached via `#assessment/record/:id`), `frontend/current/whodas.js`/`.css` (mounted per-client into the client profile drawer's Assessments section) — again no static tab banner; entry is through the Resource Hub's "Assessments" nav destination

## Guard check

`whodas-routes.js`: a feature-flag gate (`ENABLE_WHODAS_ASSESSMENT`) runs before `requireAuth`, then local `requireClinicalRead`/`requireClinicalWrite` restrict to therapist/owner (write) and read_only (read) plus org membership — header states admin has **no access** (WHODAS is clinical, admin is a non-clinical scheduling role). `assessments-routes.js`: `requireAuth` then `requireCatalogue`/`requireClinicalRead`/`requireClinicalWrite`, deliberately not feature-flag-gated so the catalogue can report an instrument as switched off even when WHODAS itself is disabled; admin gets catalogue-only, no client records. No guard defects found; own-only applies only to in-progress drafts, same pattern as Report Templates.

**Feature flag note**: `ENABLE_WHODAS_ASSESSMENT=false` in `.env.example` (off by default), and `server.js` force-disables it at boot if the WHO source-PDF hash check or field-map integrity check fails (fail-closed on template tampering). Whether it's actually enabled in the live environment wasn't checked by this audit — worth confirming if the team believes Assessment Review is currently reachable in production.

## Tests

- Unit (all pass, run together with the Report Templates batch): `assessment-catalogue.test.js`, `assessment-surface-guards.test.js`, `whodas-scoring.test.js`, `whodas-templates.test.js`, `whodas-frontend-guards.test.js`, `whodas-external-completion.test.js` — 0 failures across the combined 1050-test run
- Integration (all pass): `assessments.itest.js`, `whodas.itest.js` (run together with Report Templates: 5 suites, 201 tests, 0 failures)
- Browser/E2E: **none.** No mention of WHODAS or Assessment Review in either e2e spec or `docs/qa/BROWSER_QA_RESULTS.md`; given the flag is off by default, this feature likely wasn't even visible on the staging build that QA pass covered.

## Open tasks from the tracker

- "Assessment Review" — `todo`. This is explicitly a human review/sourcing task (Ann sorts existing tracker assessments into keep/remove, finds original source material, hands to Anthony/Pauly to build). It is not a coding task, and its checklist is about a spreadsheet/document process outside this repository — the code found here (WHODAS fully built, everything else a deliberate placeholder) already reflects the state the task describes ("Hudas 2.0 is the only one that has actually been currently configured").

## Commits in the window that touched it

None — `develop` did not move since last night (both audits sit on `74601fc`). Re-verified fresh
anyway: unit (1050/1050, shared run with Report Templates) and integration (201/201, shared run)
both re-run tonight with identical results to last night — no regression.

## Disagreement

None significant — the tracker task description already matches what the code shows (WHODAS done, rest pending by design). The gap worth flagging is the same as Report Templates: no browser/E2E proof exists for the one instrument that is built.
