# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-23 → 2026-09-24): no — zero commits landed in this window at all
- Created (any located code): yes — WHODAS 2.0 is fully built; every other instrument is a deliberate "source required" placeholder, not a bug

## Located files

- Routes: `backend/whodas-routes.js` (`/api/whodas/*`), `backend/assessments-routes.js` (`/api/assessments/*` — cross-instrument catalogue, client history, share prep)
- Data access: `backend/whodas/` (instrument.js, scoring.js, build-instrument-data.js, instrument-data.json, completed-pdf.js, template-registry.js, extract-templates.js, hash-checked WHO source PDFs under `templates/`); `backend/assessments/definitions.js` (only WHODAS is `implemented`, the rest return `sourceRequiredDefinition()`), `availability.js`, `share.js`
- Frontend: `frontend/current/assessment.js`/`.css`, `frontend/current/whodas.js`/`.css` — entry is through the Resource Hub's "Assessments" nav destination, no static tab banner

## Guard check

`whodas-routes.js`: a feature-flag gate (`ENABLE_WHODAS_ASSESSMENT`) runs before `requireAuth`, then `requireClinicalRead`/`requireClinicalWrite` restrict to therapist/owner (write) and read_only (read); admin has no access (WHODAS is clinical). `assessments-routes.js`: `requireAuth` then role-gated, deliberately not feature-flag-gated so the catalogue can report an instrument as switched off. No guard defects found.

`ENABLE_WHODAS_ASSESSMENT=false` in `.env.example` (off by default); `server.js` force-disables it at boot if the WHO source-PDF hash check or field-map integrity check fails. Whether it's actually enabled in the live environment was not checked (out of scope for a code-only audit).

## Tests (re-run fresh tonight)

- Unit: `assessment-catalogue.test.js`, `assessment-surface-guards.test.js`, `whodas-scoring.test.js`, `whodas-templates.test.js`, `whodas-frontend-guards.test.js`, `whodas-external-completion.test.js` — run tonight bundled with the Report Templates batch, 0 failures.
- Integration: `assessments.itest.js`, `whodas.itest.js` — run tonight in the combined Xero+Report Templates+Assessments batch (8 suites / 232 tests, 0 failures).
- Browser/E2E: none. No mention of WHODAS or Assessment Review in either e2e spec or `docs/qa/BROWSER_QA_RESULTS.md`; given the flag is off by default, this feature likely wasn't even visible on the staging build that QA pass covered.

## Open tasks from the tracker

- "Assessment Review" — `todo`. A human review/sourcing task (sort existing tracker assessments into keep/remove, find original source material, hand to a developer), not a coding task. The code already matches what the task describes (WHODAS done, rest pending by design).

## Commits in the window that touched it

None — `develop` sits on `74601fc` again tonight. Re-verified fresh: unit and integration both re-run tonight with identical results — no regression.

## Disagreement

None significant — the tracker task description already matches the code. The gap worth flagging: no browser/E2E proof exists for the one instrument that is built.
