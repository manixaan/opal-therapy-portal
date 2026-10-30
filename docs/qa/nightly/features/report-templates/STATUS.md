# Report Templates

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed since the last audit (window `15acf0c..338f5dc`, 5 commits: 08da79d travel, e1af24e mobile diary, a56173c case-note approval-on-edit, dc5dbc4 casenotes revert, 338f5dc travel-traffic test fix): no — `git log --name-only 15acf0c..338f5dc` lists exactly those 5 commits' files (backend/routes.js, mobile/database.js, case-note-routes.js, ai-audit.js, casenotes.js/css, travel.js/travel-alerts.js, mockup_v3.html, and their own tests); none of this feature's located files (`fca-routes.js`, `letter-routes.js`, `templates-routes.js`, `backend/fca/`, `backend/templates/`, `backend/service-agreements/`, `frontend/current/templates.js`) appear in that list.
- Created (any located code): yes.

## Located

Shares the same FCA/letter engine as Interactive Assessments (`backend/fca-routes.js`, `backend/letter-routes.js`, `backend/fca/`, `frontend/current/fca.js`, `letter.js`).

**"Client Agreement Form"** maps to the service-agreement master served through `backend/templates-routes.js` (`/api/templates/*`) + `backend/templates/service-agreement-map.js`, which describes the real file `backend/service-agreements/templates/service-agreement-v2.2.docx` (121 unique content-control tags, verified against the shipped `.docx` by `templates-service-agreement-map.test.js`). This is the generic "complete an Opal master inside the portal, take an independent document away" capability. `backend/service-agreement-routes.js` does **not** exist as a separate file — the service agreement is served via `templates-routes.js`.

Frontend: `frontend/current/templates.js`/`.css` (shares the Library/Templates-collection entry point with `fca.js`/`letter.js`).

## Guard check

`templates-routes.js` mounts `router.use('/api/templates', requireAuth)` plus the same `CLINICAL_ROLES` (therapist/owner) write gate and `read_only`-inclusive read gate used by fca/letter/whodas (admin excluded from writes). Document access is re-fetched under `(organisation, creator)` on every request (own-only, 404 not 403 on a miss, matching the org-isolation pattern used elsewhere). No unguarded route. `node --check templates-routes.js` (and `fca-routes.js`, `letter-routes.js`) clean.

## Tests and results (re-run fresh tonight)

Unit — `npx jest tests/<file>.test.js` for all 20 located files at once (20 suites, 1050 tests): **PASS, all green**. Files: `assessment-catalogue`, `fca-wizard-behaviour`, `fca-frontend-helpers`, `fca-preview-lifecycle`, `fca-preview-pages`, `fca-resolve-scalars`, `fca-docx-engine`, `letter-docx-engine`, `letter-frontend-helpers`, `letter-template-map`, `templates-routes`, `templates-service-agreement-map`, `templates-export-boundary`, `templates-frontend-guards`, `templates-appendices`, `whodas-scoring`, `whodas-templates`, `whodas-frontend-guards`, `whodas-external-completion`, `assessment-surface-guards`.

Integration — `DB_NAME=therapy_scheduler_auditg2 DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/<file>.itest.js --runInBand` for `templates.itest.js`, `fca-reports.itest.js`, `progress-note-letters.itest.js` (run together with `assessments.itest.js`, `whodas.itest.js`): **5 suites, 201 tests, PASS**. ("splose client list unavailable" WARN lines are expected synthetic-env noise, not failures.)

No failures anywhere.

## Commits in window touching located files

None. Note: `backend/tests/assessment-surface-guards.test.js` (shared frontend-asset cache-bust ledger, used here only for its `templates.js`/`fca.js`-adjacent asset-pin assertions — the file's assessment/WHODAS-specific behavioural blocks are not part of this feature) *did* change in `08da79d`, but only to bump the unrelated `travel.js` pin and add two new `travel-alerts.*` pin entries — no line touching `templates.js`, `fca.js`, `letter.js` or their pins was changed. Confirmed via `git show 08da79d -- backend/tests/assessment-surface-guards.test.js`. Treated as not addressing this feature.

## Open tracker tasks

`[todo]` FCA, `[todo]` Progress Letter, `[todo]` Client Agreement Form — all three still open, all three map to tested-but-unproven-in-browser code.

## Disagreement / notes

Agree with the prior claude_update and with tonight's unchanged classification. Worth surfacing explicitly here since the tracker card never names it: "Client Agreement Form" is concretely `templates-routes.js` + `service-agreement-v2.2.docx`.
