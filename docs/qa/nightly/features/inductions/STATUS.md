# Inductions

- Tracker stage: idea | Tracker environment: none
- Evidence label: **needs-refinement**
- Created: yes
- Addressed this window: yes — heavily touched, 8 commits adding induction packs

## Located files
- Backend: learning-routes.js (5 guards), induction-assistant-routes.js (2 guards),
  learning-content.js, onboarding-induction.js, onboarding-learning-bridge.js
- Frontend: frontend/current/induction*.js

## Guard check
OK — both route files guarded.

## Tests
- Unit: 7 suites / 271 tests — PASS
- Integration: 4 suites / 68 tests — PASS (DB_NAME=therapy_scheduler_audit_learning). PDF "Invalid PDF
  structure" warnings logged during onboarding-extraction tests are an expected test fixture, non-fatal.
- Tab coverage: e2e/tests/tutorials.spec.js covers the induction dashboard and walkthrough lifecycle
  end to end.

## Open tasks (from tracker)
- "Induction Playground" — todo. Confirmed genuinely open: grepped for "Induction Playground" and its
  richer step types (photos, quizzes, hold points) across backend/ — no match.
- "Portal Inductions" — todo.
- "Splose Inductions" — todo.

## Commits in window touching this
34cf881, 47ebb70, 5b7f901, 70d4c8b, 554fcea, cb08ca8, 4e7de4f, c19a488 (eight induction-pack commits:
booking rules, calendar fundamentals, cancellation policy, FCA report writing, case note writing,
progress report writing), plus d5030613 (sections unlock in order).

## Disagreement
None directionally — the underlying induction-pack delivery mechanism is proven and heavily exercised
this window; the open tasks are real, specific gaps (Induction Playground's richer step types), not a
tracker/evidence mismatch.
