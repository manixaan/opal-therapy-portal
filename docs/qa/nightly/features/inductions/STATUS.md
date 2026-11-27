# Inductions

Tracker stage: idea · Tracker environment: none
Evidence label: **needs-refinement**
Addressed since last audit (2026-11-26, commit `f5fc28d` — unchanged, zero new commits tonight): no
Created (any located code): yes

## Located files

`backend/learning-routes.js` (workflow builder + assignments + employee "My Learning"),
`backend/induction-assistant-routes.js` (owner AI-helper chat, feature `induction_assistant`),
`backend/onboarding-induction.js`, `backend/onboarding-learning-bridge.js`. Frontend:
`induction.js/.css`, `induction-assistant.js/.css`, `induction-modules.js`. No dedicated
`TAB` banner — reached as a sub-panel inside Onboarding/Learning, not a top-level tab.

## Guard check

All guarded: router-level `requireAuth` + `requireRole` on `learning-routes.js` and
`induction-assistant-routes.js`. No unguarded route found.

## Tests

- Unit: `induction-*.test.js` — **3/3 suites, 92/92 passed**; `learning-*.test.js` /
  `assign-learning-guards.test.js` — **4/4 suites, 179/179 passed**.
- Integration: part of the shared 9-file batch with Clinical resources —
  `learning.itest.js`, `learning-admin.itest.js`, `induction-assistant.itest.js` all included
  in **9/9 suites, 232/232 tests passed**. `onboarding-induction.itest.js` also passed as part
  of the onboarding integration batch (9/9 suites, 169/169 tests).
- Browser/E2E: `e2e/tests/tutorials.spec.js` — 6 tests covering the **learner** side only
  (induction dashboard, walkthrough start/advance, pause/resume, completion, role
  restriction). No E2E or browser-QA coverage exists for the owner-side **builder** or the
  AI helper.

## Open tasks (from tracker)

- **Induction Playground** — todo. Every checklist item is unchecked: review the existing
  builder, decide which interactive step types (photos, directions, quiz, hold points) to
  support, decide the AI service and how it helps, make the builder visual/simple, add the
  new step types, connect the AI service safely and wall it off from clinical data, then test
  the whole create-an-induction flow. The learner-consumption side already works and is
  E2E-proven; this checklist is almost entirely about the **owner-side builder and AI
  helper**, which the located code only partially covers (a basic builder + an AI chat route
  exist; the specific step types and AI-assisted drafting described in the checklist were not
  confirmed built).
- **Portal Inductions** / **Splose Inductions** — todo, no detail recorded in the tracker.

## Commits since last audit (2026-11-26)

None touch `learning-routes.js`, `induction-assistant-routes.js`, `onboarding-induction.js` or
`onboarding-learning-bridge.js`.

## Disagreement

None on the tracker stage. Worth noting: the learner side of Inductions is already solidly
proven; the open checklist is about expanding the owner-side builder, not fixing anything
broken.
