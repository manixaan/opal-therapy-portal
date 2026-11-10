# Report Templates

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven**
Addressed in this change window: **no** · Created: **yes**

## Located files

`backend/templates-routes.js`, `backend/fca-routes.js`, `backend/letter-routes.js`. No standalone service-agreement route file — service agreements are a template inside this subsystem (`backend/templates/service-agreement-map.js` + `backend/service-agreements/templates/*.docx|*.pdf`). `backend/fca/` holds the docx engine + progress-report/support-letter templates. Frontend: not a separate shell tab — `frontend/current/templates.js` renders into `#templates-root` inside the Resource Hub's Library view.

Guarded, re-confirmed by direct grep tonight: `templates-routes.js` applies `router.use('/api/templates', requireAuth)` then gates by `CLINICAL_ROLES = {therapist, owner}`; `letter-routes.js` applies `router.use('/api/letters', requireAuth)` then every individual route (drafts, generate, download, clients, contacts) carries `requireClinicalRead` or `requireClinicalWrite`, backed by the same role set (admin excluded by design). No unguarded route found.

## Tests

- Unit (9 files, templates/letters-specific; the FCA-specific files are verified under Interactive Assessments to avoid duplicate runs): `letter-docx-engine.test.js`, `letter-frontend-helpers.test.js`, `letter-template-map.test.js`, `templates-appendices.test.js`, `templates-clinical-maps.test.js`, `templates-export-boundary.test.js`, `templates-frontend-guards.test.js`, `templates-routes.test.js`, `templates-service-agreement-map.test.js` — **369/369 pass** (own run tonight).
- Integration (2 files; `fca-reports.itest.js` verified under Interactive Assessments): `templates.itest.js`, `progress-note-letters.itest.js` — **82/82 pass** on isolated DB `therapy_scheduler_audit_g2_test`. Two expected WARN log lines ("splose client list unavailable") are fail-closed test fixtures, not failures.

## Browser / E2E proof

**None found** — re-confirmed tonight by a fresh grep. Zero matches for "template" (case-insensitive) in `e2e/tests/*.spec.js` or `docs/qa/BROWSER_QA_RESULTS.md`. No end-to-end flow proves a user can open Resource Hub → Templates and generate an FCA report, progress letter or service agreement.

## Open tasks from the tracker

"FCA" (todo), "Progress Letter" (todo), "Client Agreement Form" (todo) — no further detail text.

## Commits in the window touching this feature

None for this feature. `develop` moved from `34cf881` (last night's audit commit) to `40669e7` between the 2026-11-09 audit and tonight — one commit, "feat(booking): Travel block booking type …" — but it touches only the Smart Booking/calendar/profile surface (see `portal-splose-outlook-integration-works/STATUS.md` and `employee-personal-page-my-profile-tab/STATUS.md`), nothing located under this feature.

## Disagreement

None.
