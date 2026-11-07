# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in this change window: yes
- Created (any located code): yes

## Located files
- backend/learning-routes.js, backend/learning-content.js (Induction Playground / Portal Inductions)
- backend/induction-assistant-routes.js, backend/onboarding-induction.js (Splose Inductions — onboarding-induction.js's checklist explicitly covers Splose account setup)
- frontend/current/induction.js, induction-modules.js, induction-assistant.js

## Guard check
requireAuth on /api/learning; induction-assistant-routes.js additionally requires requireRole('owner') on /api/learning/assistant. No unguarded route found.

## Tests and results
- unit: assign-learning-guards.test.js, learning-admin-routes.test.js, learning-content.test.js, learning-routes.test.js, induction-assistant.test.js, induction-registry.test.js — 223 passed
- integration: learning-admin.itest.js, learning.itest.js, induction-assistant.itest.js, onboarding-induction.itest.js — 65 passed

## Open tracker tasks
- Induction Playground (todo)
- Portal Inductions (todo)
- Splose Inductions (todo)

## Commits in the 14-day change window touching this feature
Not touched in the 14-day change window.

## Why this label
288 tests (223 unit + 65 integration) pass, routes are guarded, and e2e/tests/tutorials.spec.js end-to-end proves a learner can start, pause, resume and complete an induction module with progress persisting across reload and re-login.
