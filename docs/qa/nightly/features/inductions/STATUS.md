# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (bundles three sub-things that differ
  — see split below)
- Addressed this window: no (no commits since 2026-09-27)
- Created at all: yes

## Located files

- Routes: `backend/induction-assistant-routes.js` (AI co-author chat,
  owner-only, `/api/learning/assistant`), `backend/learning-routes.js`
  (workflow CRUD, publish/assign, `importExistingInductions()` at line 586
  creating "Opal Portal Induction" and "Splose Induction" as assignable
  workflows), `backend/walkthrough-authoring/catalogue/content` modules.
- Data: `backend/learning-content.js`, `walkthrough-content.js`,
  `walkthrough-catalogue.js`, `walkthrough-anchors.js`.
- Frontend: `frontend/current/induction.js`, `induction-modules.js`,
  `induction-assistant.js`/`.css` — wired into `mockup_v3.html` with
  cache-bust pins present.
- AI: `backend/ai/ai-policy.js` — `induction_assistant` IS registered
  (INTERNAL classification, AU region, PUBLIC/INTERNAL data only — no
  clinical-data path). Feature flag `INDUCTION_AI_ENABLED` defaults OFF.
- Tests: unit `induction-assistant.test.js`, `induction-registry.test.js`,
  `learning-content.test.js`, `learning-routes.test.js`,
  `learning-admin-routes.test.js`, `assign-learning-guards.test.js`,
  `walkthrough-content.test.js`; integration `induction-assistant.itest.js`,
  `onboarding-induction.itest.js`, `learning.itest.js`, `learning-admin.itest.js`,
  `walkthrough-authoring.itest.js`, `walkthrough-catalogue.itest.js`,
  `walkthrough-evidence.itest.js`. E2E: `e2e/tests/tutorials.spec.js`
  (learner induction dashboard + walkthrough lifecycle).

## Guard status

`router.use('/api/learning', requireAuth)` + owner-only on every admin
route in `learning-routes.js`; `router.use('/api/learning/assistant',
requireAuth, requireRole('owner'))`. All org-scoped. No unguarded routes.

## Tests run

- `npx jest tests/induction-assistant.test.js tests/induction-registry.test.js tests/learning-content.test.js tests/learning-routes.test.js tests/learning-admin-routes.test.js tests/assign-learning-guards.test.js tests/walkthrough-content.test.js` → 7 suites / 258 tests passed.
- `DB_NAME=therapy_scheduler_auditC DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/induction-assistant.itest.js tests/integration/onboarding-induction.itest.js --runInBand` → 2 suites / 7 tests passed.
- `...tests/integration/learning.itest.js tests/integration/learning-admin.itest.js tests/integration/walkthrough-authoring.itest.js tests/integration/walkthrough-catalogue.itest.js tests/integration/walkthrough-evidence.itest.js --runInBand` → 5 suites / 104 tests passed (`learning-admin.itest.js` specifically drives `/api/learning/workflows/import` and asserts "Opal Portal Induction" and "Splose Induction" are created, including the 403 guard for non-owner roles).
- `node --check` clean on both route files. No TODO/FIXME found.

## Classification by sub-thing

- **Existing induction/learning system** (chapters, walkthroughs,
  assignment, progress) → **proven**. 369 tests passing, e2e coverage via
  `tutorials.spec.js`.
- **"Portal Inductions" / "Splose Inductions" tracker tasks** → **proven,
  not todo**. Despite empty checklists implying nothing started, the code
  already fully implements both as one-click imports, each
  integration-tested by title.
- **Induction Assistant (AI co-author)** → **tab-unproven**. Code, guard,
  AI-gateway registration and server-side tests are solid, but nothing in
  e2e or `docs/qa/BROWSER_QA_RESULTS.md` exercises the chat UI in a browser,
  and it ships flagged OFF by default.

## Open tasks from the tracker

- "Induction Playground" (todo) — mostly real refinement (step types,
  AI vendor choice, safe AI wiring), narrower than the checklist implies
  since the AI gateway registration and server tests already exist.
- "Portal Inductions" (todo) — **already built**, contradicts the tracker's
  own "todo" status.
- "Splose Inductions" (todo) — **already built**, same disagreement.

## Commits in the window

None.

## Disagreement note

Refines, and partly contradicts, the previous `claude_update`. "Live system
solid and tested, three planned upgrades still on the to-do list" is correct
for the AI-assistant-browser-proof gap, but wrong to lump Portal Inductions
and Splose Inductions in with "still to-do" — those two are built, guarded,
and integration-tested today. The AI wiring is further along than "still
just a plan" too: it's flagged off and browser-unproven, not untouched.
