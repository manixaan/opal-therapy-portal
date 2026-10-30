# Interactive Assessments

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed since the last audit (window `15acf0c..338f5dc`, 5 commits: 08da79d travel, e1af24e mobile diary, a56173c case-note approval-on-edit, dc5dbc4 casenotes revert, 338f5dc travel-traffic test fix): no — `git log --name-only 15acf0c..338f5dc` lists exactly those 5 commits' files; none of this feature's located files (`fca-routes.js`, `letter-routes.js`, `whodas-routes.js`, `assessments-routes.js`, `backend/fca/`, `backend/whodas/`, `backend/templates/`, `frontend/current/fca.js`, `letter.js`, `whodas.js`, `assessment.js`) appear in that list.
- Created (any located code): yes.

## Located

- Routes: `backend/fca-routes.js`, `backend/letter-routes.js`, `backend/whodas-routes.js`, `backend/assessments-routes.js` (catalogue/history/share layer above WHODAS).
- Data/engine: `backend/fca/`, `backend/whodas/`, `backend/templates/`.
- Frontend: `frontend/current/fca.js`/`.css`, `letter.js`/`.css`, `assessment.js`/`.css`, `whodas.js`/`.css`. No dedicated tab banner — these are full-page/overlay surfaces mounted as direct children of `<body>` (`#fca-root`, `#letter-root`, `#assessment-root`, ~`mockup_v3.html:26267-26286`), entered from the Resources Library "Templates" collection or the NDIS case assessment flow, not from a tab click.

## Guard check

All five route files mount `requireAuth` plus a role gate (`CLINICAL_ROLES` = therapist/owner, read extended to `read_only`; admin explicitly excluded from clinical data). `whodas-routes.js` additionally feature-gates every route behind `ENABLE_WHODAS_ASSESSMENT === 'true'` (404 when off, by design). No unguarded route. `node --check` clean on all five (re-run tonight).

## Tests and results (re-run fresh tonight)

Unit — `npx jest tests/<file>.test.js` for all 20 located files at once (20 suites, 1050 tests): **PASS, all green**. Files: `assessment-catalogue`, `assessment-surface-guards`, `fca-docx-engine`, `fca-frontend-helpers`, `fca-preview-lifecycle`, `fca-preview-pages`, `fca-resolve-scalars`, `fca-wizard-behaviour`, `letter-docx-engine`, `letter-frontend-helpers`, `letter-template-map`, `whodas-external-completion`, `whodas-frontend-guards`, `whodas-scoring`, `whodas-templates` (plus the 5 `templates-*` files, shared with Report Templates — see that feature's STATUS.md).

Integration — `DB_NAME=therapy_scheduler_auditg2 DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/<file>.itest.js --runInBand` for `fca-reports.itest.js`, `progress-note-letters.itest.js`, `whodas.itest.js`, `assessments.itest.js` (run together with `templates.itest.js`): **5 suites, 201 tests, PASS**. ("splose client list unavailable" WARN lines are expected synthetic-env noise, not failures.)

No failures anywhere in this feature's test surface.

## Commits in window touching located files

None — confirmed by real `git log --name-only 15acf0c..338f5dc` against each located backend/frontend file, not inferred from a commit-subject summary. One file worth naming explicitly: `backend/tests/assessment-surface-guards.test.js` *did* change inside the window, as part of `08da79d` (the travel-alerts feature commit). That file carries both (a) this feature's own behavioural guards (assessment-is-a-page, no-appointment-surface-leak, back navigation, availability badges, draft deletion, etc.) and (b) the shell's shared asset-pin ledger for every `<script>`/`<link>` version in `mockup_v3.html`, per `backend/CLAUDE.md`'s own description of the file as "the asset-pin guard test." `git show 08da79d -- backend/tests/assessment-surface-guards.test.js` shows the only change was bumping the `travel.js` pin from 51→52 and adding two new `travel-alerts.js`/`travel-alerts.css` pin entries — nothing in the assessment/WHODAS-specific assertions changed. Judgement call: this does not count as the travel commit "addressing" Interactive Assessments; it is incidental use of a shared ledger file, not a change to assessment logic or tests.

## Classification evidence

Every matching unit and integration test passes, but nothing in the repository proves a human (or Playwright) ever opened the FCA/letter/WHODAS/Assessments wizard in a browser and watched it produce a document. `e2e/tests/` has zero mentions of fca/whodas/letter/template/assessment (re-checked tonight: no matching spec file). `docs/qa/BROWSER_QA_RESULTS.md`'s only "Assessment" hit is an unrelated table column header ("Error | Assessment") — no flow touches these wizards.

## Open tracker tasks

`[todo]` Assessment Review — this task is a human review/triage exercise (go through the Assessment tab's catalogue, sort keep/remove, find source material for keepers), not a code task. No corresponding code change or browser-QA entry found; still open, consistent with tab-unproven.

## Disagreement / notes

Agree with the prior claude_update in full, including the "unchanged" recency claim. Flagging the `assessment-surface-guards.test.js` in-window change above purely for completeness — it does not change the classification or the recommended next action.
