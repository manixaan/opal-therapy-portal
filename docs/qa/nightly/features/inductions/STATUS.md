# Inductions

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement** — re-confirmed tonight (2026-11-06) by independent code
  reading and a fresh test run, not by trusting last night's brief. Consistent with 2026-11-05.
- Addressed in this change window (since the 2026-11-05 audit, commit `8853376`): no — the 4
  commits landed since then (`704a51f`, `0a365c4`, `cd8c4a8`, `e3c0b90`) touch theme/calendar,
  Splose sync and Opal Assist, none of them this feature.
- Created (any located code): **yes** — substantial build

## Located files
- Backend: `backend/induction-assistant-routes.js` (owner-only AI builder), `backend/walkthrough-routes.js`, `backend/tutorial-routes.js`, `backend/learning-routes.js`, `backend/walkthrough-content.js` (step-type registry)
- Frontend: `frontend/current/induction.js`, `induction-assistant.js`, `induction-modules.js`
- Guards: `induction-assistant-routes.js:69` `requireAuth, requireRole('owner')`; `walkthrough-routes.js:36-37` `requireAuth` + owner-only on admin actions; `tutorial-routes.js:47` `requireAuth`; `learning-routes.js:56-57` `requireAuth` + owner-only admin actions. No unguarded route found.
- Tests — unit: `tests/induction-assistant.test.js`, `induction-registry.test.js`, `learning-admin-routes.test.js`, `learning-content.test.js`, `learning-routes.test.js`, `walkthrough-content.test.js`, `assign-learning-guards.test.js`
- Tests — integration: `tests/integration/induction-assistant.itest.js`, `learning-admin.itest.js`, `learning.itest.js`, `onboarding-induction.itest.js`, `tutorial-progress.itest.js`, `walkthrough-authoring.itest.js`, `walkthrough-catalogue.itest.js`, `walkthrough-evidence.itest.js`
- E2E: **`e2e/tests/tutorials.spec.js` exists and genuinely covers this feature** — dashboard render, walkthrough start/advance/highlight, pause/resume across reload and re-login, completion persistence, role restriction, missing-anchor degradation. Crediting this explicitly so the feature is not mistaken for `tab-unproven` — the reason it stays `needs-refinement` is the open tracker tasks below, not a lack of browser proof.

## Tests run tonight
- Unit (re-run from scratch): 7 suites, **258/258 pass**.
- Integration (`DB_NAME=therapy_scheduler_audit_d`, re-run from scratch): 8 suites, **130/130 pass**.
- E2E not executed (never run per-feature by this audit); spec file read and confirmed relevant.

## Open tracker tasks (all status: `todo`)
- "Induction Playground" — redesign builder UX, pick an AI service, wire AI help in safely; large checklist, nothing checked.
- "Portal Inductions" / "Splose Inductions" — no detail recorded.
These open `todo` tasks are what forces `needs-refinement` rather than `proven`, per the classification rule (a task still `todo` overrides otherwise-complete test/guard evidence).

## Independent re-verification of the "hold point" claim
Checked fresh tonight, not copied from 2026-11-05: `grep -rn "hold.point" backend/ frontend/current/` → **no match**. A literally-named "hold point" step type does not exist — confirmed, matching prior nights. Noting the nuance again: `backend/walkthrough-content.js:49-61` defines `STEP_TYPES` including `checkpoint`/`acknowledgement` as `BLOCKING_TYPES` — "steps a learner may not simply page past" — which is functionally a hold point under a different name. `screenshot`/`callout`/`quiz` already cover photos, written directions and quiz steps from the original idea.

## Disagreement
None in the "tracker claims more than evidence shows" sense — the tracker (stage `idea`, environment `none`) understates how built and tested this already is.
