# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-11-13 to 2026-11-14): no — the 5
  induction-pack commits below are from 2026-11-07/08, predating this
  window
- Created at all: yes

## Located files

- Routes: `backend/learning-routes.js`, `backend/induction-assistant-routes.js`
  (owner-only AI authoring helper, routed through `backend/ai/ai-gateway.js`
  — confirmed, no raw SDK import)
- Content/registry: `backend/learning-content.js` (includes Splose-specific
  induction content), induction-pack registry
- Frontend: `frontend/current/induction.js`, `induction-modules.js`,
  `induction-pack*.js`
- Unit tests: `tests/assign-learning-guards.test.js`,
  `tests/induction-assistant.test.js`, `tests/induction-packs.test.js`,
  `tests/induction-registry.test.js`, `tests/learning-admin-routes.test.js`,
  `tests/learning-content.test.js`, `tests/learning-routes.test.js`
- Integration tests: `tests/integration/induction-assistant.itest.js`,
  `tests/integration/learning-admin.itest.js`,
  `tests/integration/learning.itest.js`,
  `tests/integration/onboarding-induction.itest.js`
- **E2E**: `e2e/tests/tutorials.spec.js` — `induction dashboard` describe
  block proves (a) the owner's learning view renders "Assign Learning" /
  "All learning" (not a learner dashboard), and (b) the learner's induction
  dashboard renders real content with real thumbnails, including the
  Splose induction group card (`#ind-dash-h-splose`, "Splose at Opal: The
  Big Picture"). This spec exists but is RELEASE-level only — this audit
  confirmed it exists and what it asserts; it did not run it.

## Guard check

`learning-routes.js`: `router.use('/api/learning', requireAuth)` +
`ownerOnly = requireRole('owner')` on admin routes.
`induction-assistant-routes.js`: `router.use('/api/learning/assistant',
requireAuth, requireRole('owner'))`. No finding.

## Tests run

- Unit: 271/271 passed (7 suites).
- Integration: 68/68 passed (4 suites), against
  `therapy_scheduler_audit_test`.
- AI boundary (touched by the Induction Playground's AI help): confirmed
  `induction-assistant-routes.js` imports `./ai/ai-gateway` only; the
  shared `ai-gateway-boundary.test.js` + `ai-single-gateway-guards.test.js`
  (30/30) pass.

## Recency

Not touched in the change window (since the 2026-11-13 audit). The
induction-pack activity below predates the window:
- `5b7f901` (2026-11-08) place packs automatically; Progress Report tour
  uses the new template
- `df677e4` (2026-11-08) fix(walkthroughs): template tour steps open their
  own screen
- `d503061` (2026-11-07) sections that unlock in order, whole-tile launch,
  large walkthrough card
- `cb08ca8` (2026-11-07) place induction packs without the Import button
- `c19a488` (2026-11-07) add "Writing a Case Note" induction pack

## Classify

`proven`. Code located, guarded, every targeted unit/integration test
passes, and an existing E2E spec proves the induction dashboard renders for
both roles, including the Splose-specific content. One caveat: the
Induction Playground's AI-assisted authoring step specifically has no
direct browser-level assertion in `tutorials.spec.js` (which tests
consumption, not the owner's AI-assisted creation flow) — minor, noted
rather than downgrading the whole feature.

## Open tasks (from tracker)

- Induction Playground — todo. "A basic induction builder already exists
  in the owner's portal... adding engaging step types like photos,
  directions, quizzes and hold points, and weaving in AI help." The
  builder and AI help both exist (`induction-assistant-routes.js`); richer
  step types are the open scope.
- Portal Inductions — todo. Matches the evidence; E2E proves it renders.
- Splose Inductions — todo. Matches the evidence; E2E proves the Splose
  group card renders.

## Commits in the window touching this

None (see Recency for predating induction-pack work).

## Disagreement

Tracker stage `idea`, all three tasks `todo`. Evidence: this is one of the
most mature features in the tracker — built, guarded, extensively tested,
and the only feature in this snapshot with real E2E proof. Recommend
moving this card's stage up and closing Portal Inductions / Splose
Inductions; Induction Playground's richer step types remain genuine open
scope.
