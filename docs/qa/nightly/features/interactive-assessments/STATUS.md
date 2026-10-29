# Interactive Assessments

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed since the last audit (develop unchanged since 2026-10-28, also commit `15acf0c`): no — confirmed by `git log --since=2026-10-15` on every located file, all empty.
- Created (any located code): yes.

## Located

- Routes: `backend/fca-routes.js`, `backend/letter-routes.js`, `backend/whodas-routes.js`, `backend/assessments-routes.js` (catalogue/history/share layer above WHODAS).
- Data/engine: `backend/fca/`, `backend/whodas/`, `backend/templates/`.
- Frontend: `frontend/current/fca.js`/`.css`, `letter.js`/`.css`, `assessment.js`/`.css`, `whodas.js`/`.css`. No dedicated tab banner — these are full-page/overlay surfaces mounted as direct children of `<body>` (`#fca-root`, `#letter-root`, `#assessment-root`, ~`mockup_v3.html:26267-26286`), entered from the Resources Library "Templates" collection or the NDIS case assessment flow, not from a tab click.

## Guard check

All five route files mount `requireAuth` plus a role gate (`CLINICAL_ROLES` + `read_only`; admin explicitly excluded from clinical data). `whodas-routes.js` additionally feature-gates every route behind `ENABLE_WHODAS_ASSESSMENT === 'true'` (404 when off, by design). No unguarded route. `node --check` clean on all five.

## Tests and results

| Command | Result |
|---|---|
| assessment-catalogue, assessment-surface-guards, fca-docx-engine, fca-frontend-helpers, fca-preview-lifecycle, fca-preview-pages, fca-resolve-scalars, fca-wizard-behaviour, letter-docx-engine, letter-frontend-helpers, letter-template-map, whodas-external-completion, whodas-frontend-guards, whodas-scoring, whodas-templates (15 unit files) | PASS — all green |
| `fca-reports.itest.js`, `progress-note-letters.itest.js`, `whodas.itest.js`, `assessments.itest.js` (4 integration files) | PASS — all green |

No failures anywhere in this feature's test surface.

## Commits in window touching located files

None — confirmed by real `git log --since=2026-10-15` on each located backend/frontend file, not inferred from a commit-subject summary.

## Classification evidence

Every matching unit and integration test passes, but nothing in the repository proves a human (or Playwright) ever opened the FCA/letter/WHODAS/Assessments wizard in a browser and watched it produce a document. `e2e/tests/portal.spec.js` and `tutorials.spec.js` contain zero mentions of fca/whodas/letter/template/assessment. `docs/qa/BROWSER_QA_RESULTS.md`'s only "Assessment" hit is an unrelated table column header ("Console errors | Assessment") — no flow touches these wizards.

## Open tracker tasks

`[todo]` Assessment Review — no corresponding code change or browser-QA entry found; still open, consistent with tab-unproven.

## Disagreement / notes

Agree with the prior claude_update in full, including the "unchanged" recency claim.
