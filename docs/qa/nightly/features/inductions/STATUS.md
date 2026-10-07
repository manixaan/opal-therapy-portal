# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed this window (commits since 2026-10-06 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-06); the audited commit (`aacf8e68`) is still unchanged. This is the seventh consecutive reconfirmation night on this exact code. Tonight is not Sunday UTC, so targeted batches were run (not the complete suites) — see each section below for exactly what ran tonight.
- Created (any located code at all): **yes**

## Located files
- Induction Playground: backend/induction-assistant-routes.js, backend/learning-routes.js, learning-content.js, backend/walkthrough-routes.js/-content.js/-catalogue.js/-anchors.js; frontend/current/induction-assistant.js/.css, resourcehub.js (the owner's 'Assign Learning' editor)
- Portal Inductions: frontend/current/induction.js (catalogue group 'portal'), induction-modules.js; backend/learning-routes.js builds 'The interactive portal induction' by filtering modules where group !== 'splose'
- Splose Inductions: frontend/current/induction-modules.js (group 'splose' — screenshot-led lessons from 'the Opal Splose Interactive Training Package'); backend/learning-routes.js builds a separate 'Splose Induction' workflow with a server-scored 10-question knowledge check

## Guard check
induction-assistant-routes.js: requireAuth + requireRole('owner') — guarded; AI gateway registration confirmed (induction_assistant policy, classification INTERNAL, clinical data explicitly excluded). learning-routes.js / walkthrough-routes.js: requireAuth globally + requireRole('owner') on every build/admin route; /api/learning/my/* self-service routes requireAuth only, intentionally (any employee may take their own induction). No gaps.

## Tests run tonight
- unit: `induction-assistant.test.js, induction-registry.test.js, learning-routes.test.js, learning-content.test.js, learning-admin-routes.test.js, assign-learning-guards.test.js` — run in isolation tonight as this exact set: 223/223 pass
- integration: `induction-assistant.itest.js, learning.itest.js, learning-admin.itest.js` — 209/209 pass tonight (run together with walkthrough-authoring/catalogue/evidence and tutorial-progress; all green)

## Open tasks (from the tracker)
- Induction Playground — build, todo
- Portal Inductions — build, todo
- Splose Inductions — build, todo

## Compare with the tracker
The tracker marks all three tasks todo and the feature as "idea" stage, but all three have located, guarded, tested code, and e2e/tests/tutorials.spec.js exercises real induction content (asserting the Splose induction card renders as its own group below the portal's). Recommend the team re-verify stage/task status for this card. Nuance worth tracking separately: the owner's visual *builder* UI itself (as opposed to the induction content it produces) still has no dedicated e2e of its own — tutorials.spec.js proves the player/dashboard, not the authoring flow.
