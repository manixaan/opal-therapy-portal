# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in this change window (2026-09-24 → 2026-09-25): no — zero commits landed in this window at all
- Created (any located code): yes

## Located files

- Routes: `backend/learning-routes.js` (Assign Learning catalogue), `backend/induction-assistant-routes.js` (AI helper chat), `backend/walkthrough-routes.js` (owner-authoring API for the interactive-induction builder — the tracker's "Induction Playground" is called **"Workshop"** in code/docs; the literal word "Playground" appears nowhere), `backend/tutorial-routes.js` (learner-facing walkthrough progress)
- Data access: `backend/learning-content.js`, `walkthrough-content.js`, `walkthrough-catalogue.js`, `walkthrough-anchors.js`, `onboarding-learning-bridge.js`
- Frontend: `frontend/current/induction.js` (tutorial engine/player), `induction-modules.js` (19 built-in modules: 11 `portal-*` + 8 `splose-*` — this single file is the tracker's "Portal Inductions" and "Splose Inductions" tasks, distinguished only by key prefix), `induction-assistant.js`/`.css`, `workshop.js`/`.css` (the builder). Entry is via the Resource Hub's "Assign Learning"/induction surfaces, not a static top-level tab.

## Guard check

`learning-routes.js`: `router.use('/api/learning', requireAuth)` + owner-only per admin route. `induction-assistant-routes.js`: `router.use('/api/learning/assistant', requireAuth, requireRole('owner'))`. `walkthrough-routes.js`: `router.use('/api/walkthroughs', requireAuth)` + owner-only per-route. `tutorial-routes.js`: `router.use('/api/tutorials', requireAuth)`, seed endpoint owner-gated. No guard defects found.

AI-gateway routing (data-residency waiver) confirmed clean: the induction assistant goes through `backend/ai/ai-gateway.js`; `ab55bbc`'s direct-vendor-API path is a registered, policy-gated exception inside the gateway (falls back to Bedrock if no vendor key configured), not a bypass.

## Tests (re-run fresh tonight)

- Unit: `induction-assistant.test.js`, `induction-registry.test.js`, `learning-admin-routes.test.js`, `learning-content.test.js`, `learning-routes.test.js`, `walkthrough-content.test.js`, `assign-learning-guards.test.js` — this session ran the 6-file core group directly (6 suites / 223 tests, all pass); broader combined runs with Resource Hub tests were also clean.
- Integration: `induction-assistant.itest.js`, `learning-admin.itest.js`, `learning.itest.js`, `onboarding-induction.itest.js`, `tutorial-progress.itest.js` — run tonight in the PD/Profile + Inductions/Resources batch (12 suites / 176 tests, only the unrelated `readonly-and-hardening.itest.js` artifact failed elsewhere in that batch — nothing in the induction/learning files failed).
- Browser/E2E: `e2e/tests/tutorials.spec.js` covers the owner's Assign Learning catalogue vs. learner dashboard, and the walkthrough lifecycle. **Confirmed stale tonight**: line 59 asserts `page.getByRole('heading', { name: 'All learning' })`, but `grep -n "All learning" frontend/current/resourcehub.js` returns no match — the string was removed by `56f3aaa` (2026-09-17, "redesign Assign Learning as a course-builder workflow"), replaced by a tab strip (Inductions/Assignments/Staff progress). This assertion would fail if the spec ran, and has now been stale for 8 consecutive nights (2026-09-17 → 2026-09-25), unfixed.

## Open tasks from the tracker

- "Induction Playground" — `todo`. Checklist covers reviewing the existing builder, choosing step types (photos/directions/quiz/hold points), choosing an AI service, walling it off from clinical data. `workshop.js` already has these step types, and the AI wall-off is enforced through the gateway's policy/classification system.
- "Portal Inductions", "Splose Inductions" — `todo`, no further notes; both are rows in the same `induction-modules.js` catalogue, not separate builds.

## Commits in the window that touched it

None — `develop` sits on `74601fc` again tonight (fourth night running). Re-verified fresh: unit and integration both re-run tonight with the same results as prior nights — no regression. The stale `tutorials.spec.js:59` assertion is still unfixed; no e2e file changed.

## Disagreement

1. Tracker naming ("Induction Playground") vs. code/docs naming ("Workshop") is a real mismatch — `workshop.js` matches the task's own described functionality (photo/directions/quiz/hold-point step types, AI integrator) far better than the flat module catalogue. Needs a person to confirm which task `workshop.js` was actually meant to satisfy.
2. The stale `tutorials.spec.js:59` assertion means the one E2E spec that would otherwise prove this tab works is not currently trustworthy — `needs-refinement` rather than `proven` remains the more honest label.
