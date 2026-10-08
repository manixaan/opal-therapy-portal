# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed this window: **no** — zero commits since 2026-10-07 touching `backend/` or `frontend/current/`.
  Eighth consecutive reconfirmation night.
- Created (any located code at all): **yes**

## Located files
- `backend/learning-routes.js`, `backend/learning-content.js` — Owner-controlled learning/induction-content
  builder ("Induction Playground" most plausibly maps here; literal strings "Induction Playground", "Portal
  Inductions", "Splose Inductions" do not appear anywhere in the repo)
- `backend/induction-assistant-routes.js` — AI co-author chat on top of the builder
- `backend/tutorial-routes.js`, `backend/walkthrough-routes.js`, `backend/onboarding-induction.js` — adjacent but
  distinct subsystems (the interactive portal-tutorial overlay, and onboarding Stage 3's induction-pack delivery;
  do not conflate with the builder above — three different things share the word "induction" in this codebase)
- Frontend: no dedicated tab banner for the builder itself; `frontend/current/induction.js`/`induction-modules.js`
  (tutorial overlay), `frontend/current/induction-assistant.js` (AI chat side-panel)

## Guard check
`learning-routes.js:40`: `router.use('/api/learning', requireAuth);` with `ownerOnly = requireRole('owner')` on
every management route; `/api/learning/my/*` relies on the documented self-scoping (`WHERE user_id =
req.user.id`), not an extra middleware — consistent with its header's claim. `induction-assistant-routes.js`:
`router.use('/api/learning/assistant', requireAuth, requireRole('owner'))`. No gaps found.
Step-type note: `learning-content.js`'s item-type enum (`content/resource/acknowledgement/quiz/task`) and
`walkthrough-content.js`'s step-type enum (`intro/highlight/action/screenshot/callout`) do not yet include
"photo", "direction" or "hold point" as named in the tracker's Induction Playground task — that visual-builder
work is still ahead, but does not change tonight's evidence label since it isn't a test or guard gap.

## Tests run tonight
- unit: `induction-assistant.test.js, induction-registry.test.js, learning-admin-routes.test.js,
  learning-content.test.js, learning-routes.test.js, assign-learning-guards.test.js` — 223/223 pass
- integration: `induction-assistant.itest.js, learning-admin.itest.js, learning.itest.js` — 63/63 pass (re-run in
  isolation tonight after an earlier run collided with a concurrent onboarding integration job on the same test
  database and reported spurious deadlock failures)
- e2e: `e2e/tests/tutorials.spec.js` — `describe('induction dashboard')` and `describe('walkthrough lifecycle')`
  with named tests covering the learner dashboard's induction progress/modules and full module completion —
  confirmed directly tonight

## Open tasks (from the tracker)
- Induction Playground — build, todo
- Portal Inductions — build, todo
- Splose Inductions — build, todo

## Compare with the tracker
The literal task names ("Induction Playground", "Portal Inductions", "Splose Inductions") don't appear in code,
but the underlying learning/induction-content builder they describe is built, guarded, tested and has real e2e
coverage of the induction content itself.
