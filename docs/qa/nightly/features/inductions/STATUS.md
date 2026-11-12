# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-10-29 to 2026-11-12): yes — heavy activity: `backend/induction-packs/index.js`, `writing-a-case-note.json`, `writing-an-fca-report.json`, `learning-content.js`, `learning-routes.js`, `frontend/current/induction.css`, `induction.js`; commits include `feat(inductions): add "Booking Rules by Session Type" and "Cancellation Policy" induction packs`, `feat(inductions): add "Calendar booking fundamentals" induction pack`, `feat(inductions): place packs automatically...`, `feat(inductions): professional wording, confirmed-only content, cleaner images`, `feat(inductions): add "Writing an FCA report"/"Writing a Progress Report"/"Writing a Case Note" induction pack`, `feat(inductions): place induction packs without the Import button`
- Created (any code located): yes

## Located files

- Routes: `backend/learning-routes.js`, `backend/induction-assistant-routes.js`
- Data access: `backend/learning-content.js`
- Frontend: no static `TAB` banner — reached as a dynamic sub-view inside the `RESOURCES TAB` (`#resources/learning` via `OpalNav.go({tab:'resources', view:'learning'})`); scripts `frontend/current/induction.js`, `induction-modules.js`, `induction-assistant.js`
- Unit tests: `assign-learning-guards.test.js`, `induction-assistant.test.js`, `induction-packs.test.js`, `induction-registry.test.js`, `learning-admin-routes.test.js`, `learning-content.test.js`, `learning-routes.test.js`
- Integration tests: `induction-assistant.itest.js`, `learning-admin.itest.js`, `learning.itest.js`, `onboarding-induction.itest.js`
- E2E: `e2e/tests/tutorials.spec.js` — `describe('induction dashboard')`, navigates via `OpalNav.go({tab:'resources', view:'learning'})`, asserts the Owner's learning view is the Assign Learning catalogue, not a learner dashboard.

## Guard check

Clean. `induction-assistant-routes.js:69` — `requireAuth` + `requireRole('owner')`. `learning-routes.js:56` — `requireAuth` router-level, `ownerOnly = requireRole('owner')` applied per-route.

## AI integration — verified directly

The tracker's own notes ask for an AI helper "walled off" from the rest of the portal's clinical data. This **is** built and properly governed: `backend/ai/ai-policy.js` registers `induction_assistant` as an Owner-only course-builder that works on staff names only, "never client data", with de-identification explicitly waived for that reason (documented, not a bypass) — and it calls `backend/ai/ai-gateway.js`, respecting the single-gateway boundary. This is a stronger result than the "not yet decided" tone of the tracker notes suggested.

## Tests run

- Unit: 7 suites, 271 tests — **all pass** (one intentional `WARN`-level simulated AI-provider-error log line, not a failure)
- Integration: 4 files, included in a 10-suite/234-test run alongside the Resource Hub tests — **all pass**

## Open tasks from tracker

- "Induction Playground" — `todo`. Checklist (all unchecked): review existing builder; decide step types (photos, directions, quiz, hold points); decide AI service; decide how AI helps; make the builder feel visual/simple; add the engaging step types; connect the AI service safely; add the AI helper; test the full flow. **Evidence check**: `backend/learning-content.js` defines item types `content | resource | acknowledgement | quiz | task` — a full quiz engine exists, but there is no step type literally named "photo", "direction", or "hold point", and `frontend/current/induction.js`/`induction-modules.js` (checked directly) show no drag/reorder/add-step builder interaction code — the file that exists is induction-pack **content** (tutorial text), not a visual authoring UI. The AI-connection half of this task is done (see above); the visual-builder half is not.
- "Portal Inductions" / "Splose Inductions" — `todo`, no detail recorded. No separately locatable code beyond the above; likely the same subsystem viewed from two angles.

## Commits in window touching it

See header — this is one of the most actively developed areas in the window (induction pack content for calendar booking, cancellation policy, FCA reports, progress reports, case notes).

## Why proven overall, with a builder-UI nuance

This matches the classification held for four consecutive nights (same commit, zero changes since 2026-11-11): guarded, heavily tested, and `e2e/tests/tutorials.spec.js` proves the full **learner-facing** flow (the Assign Learning catalogue and induction dashboard). That's the core of what this card asks for, and it's genuinely proven.

The nuance, not a demotion: the tracker's "Induction Playground" also asks for a visual, drag-and-drop **authoring** experience (photos, directions, quiz, hold points) for the person *building* an induction, not just the person completing one. This audit looked directly at `frontend/current/induction.js`/`induction-modules.js` and found no add/reorder/delete-step builder interaction code — what exists there is induction-pack *content* (tutorial text), not an authoring UI. The AI-assistant half of that same ask, by contrast, **is** built and properly governed (see below) — ahead of what the tracker's tone suggests.

## Disagreement

None in the formal sense. Net position: the AI-assistant half of "Induction Playground" is further along than the tracker credits (fully built, governed, tested); the visual step-builder *authoring* UI half is further behind (tracker wants photos/directions/hold-points; code has a generic content/resource/acknowledgement/quiz/task model with no visual authoring surface found) — but the learner-facing delivery of inductions, which is the e2e-proven core, works.
