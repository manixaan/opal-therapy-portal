# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Created (any code located): yes
- Addressed since the last audit (2026-11-05, cutoff `8853376`, through tonight's HEAD `704a51f` — 4 commits: `704a51f`, `0a365c4`, `cd8c4a8`, `e3c0b90`): no — none of the 4 touches whodas-routes.js, assessments-routes.js, fca-routes.js, backend/whodas/, backend/fca/ or backend/assessments/.

## Located
- `backend/whodas-routes.js`, `backend/whodas/` (templates, scoring, registry)
- `backend/fca-routes.js` (FCA report engine, shared by this feature's framework layer)
- `backend/assessments-routes.js`, `backend/assessments/` (catalogue/definitions/availability/share — the cross-instrument framework; it answers even when an instrument is feature-flagged off)
- Frontend: assessment tab/wizard inside `frontend/current/mockup_v3.html`
- Feature flag: `backend/feature-flags.js` → `isWhodasAssessmentEnabled()` reads `process.env.ENABLE_WHODAS_ASSESSMENT === 'true'` — **off unless explicitly set**. `backend/server.js` mounts `whodas-routes.js` unconditionally, but every route 404s when the flag is off (confirmed by code comment at server.js:626-628) and a template-integrity check at startup can force the flag back to `false` if WHODAS templates fail verification.
- No `e2e/tests/*.spec.js` file mentions whodas/assessment/fca.
- No entry for "whodas" in `docs/qa/BROWSER_QA_RESULTS.md`.

## Guard check
Pass. `whodas-routes.js`: `router.use('/api/whodas', requireAuth)` then per-route `requireClinicalRead`/`requireClinicalWrite` on all 13 routes. `assessments-routes.js`: `router.use('/api/assessments', requireAuth)` plus an explicit `requireCatalogue` role check (`therapist/owner/admin/read_only`) and a `CLINICAL_ROLES` set gating client-record routes. No unguarded endpoint found.

## Tests run
Unit only (no matching integration test files found):
```
npx jest tests/assessment-catalogue.test.js tests/fca-docx-engine.test.js \
  tests/fca-frontend-helpers.test.js tests/fca-preview-lifecycle.test.js \
  tests/fca-preview-pages.test.js tests/fca-resolve-scalars.test.js \
  tests/fca-wizard-behaviour.test.js tests/whodas-external-completion.test.js \
  tests/whodas-frontend-guards.test.js tests/whodas-scoring.test.js tests/whodas-templates.test.js
```
Result: **11 suites passed, 656 tests passed, 0 failed.**

## Open tracker tasks
- "Assessment Review" (todo) — a human review job (Ann sorts existing catalogue entries into keep/remove, finds originals), not a code task. No bearing on the code classification.

## Commits in window touching it
None.

## Disagreement note
The tracker's own `claude_update` already states the correct conclusion (WHODAS is the only fully built instrument, well tested, flag off by default, nothing proves the wizard in a browser) — **but that text cannot be trusted as a prior finding**: this repository has no dated brief under `docs/qa/nightly/` and no `features/` folder before tonight, so there was no real previous audit to "re-confirm." Tonight's run independently verified the same conclusion from the code and tests directly, not by trusting that text. No disagreement with the tracker's `idea` stage — stage correctly understates maturity for the code that exists, which is itself worth flagging upward (substantial tested code sitting at `idea`).
