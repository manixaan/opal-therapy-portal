# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in this change window (2026-09-22 → 2026-09-23): no — zero commits landed in this window at all. No commit touched `workshop.js`, `induction-modules.js`, `learning-routes.js`, or `walkthrough-routes.js` in the prior window either, beyond a tangential test-anchor update (`7b55537`).
- Created (any located code): yes

## Located files

- Routes: `backend/learning-routes.js` (Assign Learning catalogue), `backend/induction-assistant-routes.js` (AI helper chat), `backend/walkthrough-routes.js` (owner-authoring API for the interactive-induction builder — the tracker's "Induction Playground" is called **"Workshop"** throughout the code and docs; the literal word "Playground" appears nowhere), `backend/tutorial-routes.js` (learner-facing progress for the built-in walkthrough modules)
- Data access: `backend/learning-content.js`, `walkthrough-content.js`, `walkthrough-catalogue.js`, `walkthrough-anchors.js`, `onboarding-learning-bridge.js`
- Frontend: `frontend/current/induction.js` (tutorial engine/player), `induction-modules.js` (19 built-in modules: 11 `portal-*` + 8 `splose-*` — this single file **is** the tracker's "Portal Inductions" and "Splose Inductions" tasks, distinguished only by key prefix, not separate code), `induction-assistant.js`/`.css`, `workshop.js`/`.css` (the actual builder — Note/Spotlight/Do this/Warning/Picture/Question/Checkpoint/Page/Sign-here step blocks), plus a form editor inside `resourcehub.js` for the DB-backed `learning_workflows` side
- Design doc: `docs/INDUCTION_WORKSHOP.md` (states "9 modules" — stale; actual count is 19)
- No static tab banner exists for this feature; entry is via the Resource Hub's "Assign Learning"/induction surfaces, not a `<!-- ============ TAB ============ -->` section

## Guard check

`learning-routes.js`: `router.use('/api/learning', requireAuth)` + owner-only per-route. `induction-assistant-routes.js`: `router.use('/api/learning/assistant', requireAuth, requireRole('owner'))` — owner-only for the whole assistant surface. `walkthrough-routes.js`: `router.use('/api/walkthroughs', requireAuth)` + owner-only per-route. `tutorial-routes.js`: `router.use('/api/tutorials', requireAuth)`, seed endpoint owner-gated. No guard defects found.

**AI gateway routing (data residency waiver) confirmed clean**: the induction assistant goes through `backend/ai/ai-gateway.js`, not a bypass. The commit `ab55bbc` ("direct vendor API under a data residency waiver — induction assistant only") added a policy-gated provider *inside* the gateway (`ai/providers/direct-api-provider.js`, `ai-policy.js`'s `induction_assistant` entry with `dataResidencyWaiver: true`), routed to only when the request is both waived and non-clinical, and falls back to Bedrock if no vendor key is configured. This matches `.claude/rules/ai-gateway.md`'s requirement that the gateway is the only door to a model — this is a registered exception inside it, not an escape hatch.

## Tests

- Unit (all pass): `induction-assistant.test.js`, `induction-registry.test.js`, `learning-admin-routes.test.js`, `learning-content.test.js`, `learning-routes.test.js`, `walkthrough-content.test.js`, `assign-learning-guards.test.js`, `ai-direct-provider.test.js` (18 suites total with Resource Hub, 639 passed / 12 skipped, 0 failed)
- Integration (all pass): `induction-assistant.itest.js`, `learning-admin.itest.js`, `learning.itest.js`, `tutorial-progress.itest.js`, `walkthrough-authoring.itest.js`, `walkthrough-catalogue.itest.js`, `walkthrough-evidence.itest.js` — 7 suites, 128 tests, 0 failures
- Browser/E2E: `e2e/tests/tutorials.spec.js` (210 lines) covers both the owner's Assign Learning catalogue vs. learner dashboard (role-filtered), and the full walkthrough lifecycle: start → highlight → advance → pause → resume across reload **and** re-login, complete-and-persist, restart-reset, graceful degrade on a missing anchor, and launching from a tutorial resource page. **This audit read the spec file directly (not run — E2E is out of scope for a nightly) and confirmed line 59 asserts a heading that no longer exists**: `await expect(page.getByRole('heading', { name: 'All learning' })).toBeVisible();` — `grep -n "All learning" frontend/current/resourcehub.js` returns no match; the Owner's Assign Learning view now shows `<h1 class="rh2-h1">Assign Learning</h1>` with three tabs (Inductions/Assignments/Staff progress). This assertion would fail the moment the spec actually ran. This is the same finding an earlier audit (2026-09-20) made and it is still unfixed. `e2e/**` is read-only for this task (report-only), so this audit did not fix it.

## Open tasks from the tracker

- "Induction Playground" — `todo`. Checklist covers reviewing the existing builder, choosing step types (photos/directions/quiz/hold points), choosing an AI service, connecting it safely walled off from clinical data, and testing the full flow. Code matches: `workshop.js` already has these step types (Note/Spotlight/Do this/Warning/Picture/Question/Checkpoint), and the AI wall-off is enforced through the gateway's policy/classification system, not a manual boundary.
- "Portal Inductions", "Splose Inductions" — `todo`, no further notes; both are rows in the same `induction-modules.js` catalogue, not separate builds.

## Commits in the window that touched it

None (2026-09-22 → 2026-09-23) — `develop` did not move since last night (both audits sit on
`74601fc`). Re-verified fresh anyway: unit (639 passed/12 skipped, shared run) and integration
(13 suites shared with Clinical resources, 261/261 combined) both re-run tonight with identical
results to last night — no regression. The stale `tutorials.spec.js:59` assertion (re-confirmed by
grep tonight — the line is still there, `resourcehub.js` still has no "All learning" heading) is
still unfixed; no e2e file changed in this window.

Prior window's dense activity on 2026-09-17: 22fddf1, 3b79708, 1de867d, eff653f, 149e8a3, adeaa71, e15e5a5, 0f19b1e, 71bd2c5, ab55bbc, 7bc1f37, 3c08197, ba26286, 5aa863f, ee052e1, e446091, 56f3aaa (rich text, floating assistant, role-gate removal, simpler step pane, live library refresh, dictation/read-aloud, the AI residency waiver, builder-style step rail, course-player rail, Assign Learning redesign).

## Disagreement

Two things, both worth a person's attention:

1. Tracker naming ("Induction Playground") vs. code/docs naming ("Workshop") is a real mismatch.
   This audit maps `workshop.js` (the owner-authoring builder: Note/Spotlight/Do this/Warning/
   Picture/Question/Checkpoint step blocks, plus the AI helper) directly onto the "Induction
   Playground" task's own description (a builder with photos/directions/quiz/hold-point step
   types and an AI integrator) — but a prior audit night (2026-09-20) reached a *different*
   conclusion: it grepped literally for the word "playground", found nothing, and reported
   "Induction Playground... still does not exist under any name," bucketing `workshop.js` instead
   under the "Portal/Splose Inductions" tasks. This audit disagrees with that reading — the literal
   grep misses a rename, and the task's own described functionality matches `workshop.js` far more
   than it matches the flat module catalogue (`induction-modules.js`) that "Portal/Splose
   Inductions" actually are. Needs a person to confirm which task `workshop.js` was actually meant
   to satisfy.
2. The stale `tutorials.spec.js:59` assertion (see Tests above) means the one E2E spec that would
   otherwise prove this tab works is not currently trustworthy as proof — it would fail if run.
   Combined with tracker task #1 above being unresolved, `needs-refinement` rather than `proven` is
   the more honest label tonight, matching three prior audit nights' classification even though
   this audit's own reasoning about "Induction Playground" differs from theirs.
