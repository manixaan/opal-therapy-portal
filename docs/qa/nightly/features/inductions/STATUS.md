# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-11-12 to 2026-11-13): no — zero commits landed on `develop` since the 2026-11-12 audit. The heavy induction-pack activity (`feat(inductions): ...` commits) all predates this window (2026-11-08 through 2026-11-10).
- Created (any code located): yes

## Located files

- Routes: `backend/learning-routes.js`, `backend/induction-assistant-routes.js`
- Data access: `backend/learning-content.js`
- Frontend: no static `TAB` banner — reached as a dynamic sub-view inside the `RESOURCES TAB` (`#resources/learning` via `OpalNav.go({tab:'resources', view:'learning'})`); scripts `frontend/current/induction.js`, `induction-modules.js`, `induction-assistant.js`
- Unit tests: `assign-learning-guards.test.js`, `induction-assistant.test.js`, `induction-packs.test.js`, `induction-registry.test.js`, `learning-admin-routes.test.js`, `learning-content.test.js`, `learning-routes.test.js`
- Integration tests: `induction-assistant.itest.js`, `learning-admin.itest.js`, `learning.itest.js`, `onboarding-induction.itest.js`
- E2E: `e2e/tests/tutorials.spec.js` — `describe('induction dashboard')`, navigates via `OpalNav.go({tab:'resources', view:'learning'})`, asserts the Owner's learning view is the Assign Learning catalogue, not a learner dashboard.

## Guard check

Re-confirmed tonight by direct grep, unchanged. `induction-assistant-routes.js:69` — `requireAuth` + `requireRole('owner')`. `learning-routes.js:56` — `requireAuth` router-level, `ownerOnly = requireRole('owner')` applied per-route.

## AI integration — verified again

`backend/ai/ai-policy.js` still registers `induction_assistant` as an Owner-only course-builder scoped to staff names only ("never client data"), calling only `backend/ai/ai-gateway.js` — the single-gateway boundary is respected, unchanged.

## Tests run

- Unit: re-run tonight — 7 suites, 271 tests — **all pass** (identical to prior nights; one intentional `WARN`-level simulated AI-provider-error log line, not a failure)
- Integration: re-run tonight — 4 files, included in a 10-suite/234-test run alongside the Resource Hub tests — **all pass** (the run's one failure is `resource-library.itest.js`'s unrelated simulated-deadlock scenario — see `clinical-resources/STATUS.md`)

## Open tasks from tracker

- "Induction Playground" — `todo`. Checklist (all unchecked): review existing builder; decide step types (photos, directions, quiz, hold points); decide AI service; decide how AI helps; make the builder feel visual/simple; add the engaging step types; connect the AI service safely; add the AI helper; test the full flow. **Evidence check, unchanged**: `backend/learning-content.js` defines item types `content | resource | acknowledgement | quiz | task` — a full quiz engine exists, but there is no step type literally named "photo", "direction", or "hold point", and `frontend/current/induction.js`/`induction-modules.js` show no drag/reorder/add-step builder interaction code. The AI-connection half of this task is done; the visual-builder half is not.
- "Portal Inductions" / "Splose Inductions" — `todo`, no detail recorded. No separately locatable code beyond the above; likely the same subsystem viewed from two angles.

## Commits in window touching it

None this window. See the 2026-11-12 brief for the prior window's heavy induction-pack activity (calendar booking, cancellation policy, FCA/progress-report/case-note packs).

## Why proven overall, with a builder-UI nuance

This matches the classification held for five consecutive nights now (same commit `40669e7`, zero changes since 2026-11-11): guarded, heavily tested, and `e2e/tests/tutorials.spec.js` proves the full **learner-facing** flow. The nuance, not a demotion: the tracker's "Induction Playground" also asks for a visual, drag-and-drop **authoring** experience, which this audit again did not find in `induction.js`/`induction-modules.js`. The AI-assistant half of that same ask is built and governed, ahead of the tracker's tone.

## Disagreement

None in the formal sense — unchanged assessment from prior nights (see above nuance).
