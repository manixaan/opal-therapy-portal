# Inductions

- Tracker stage: idea | Tracker environment: none
- Evidence label: **needs-refinement**
- Created: yes
- Addressed this window: no — zero commits anywhere since the 2026-11-15 audit (last window's
  8 induction-pack commits were already accounted for in that audit)

## Located files
- Backend: learning-routes.js (5 guards), induction-assistant-routes.js (2 guards),
  learning-content.js, onboarding-induction.js, onboarding-learning-bridge.js
- Frontend: frontend/current/induction*.js

## Guard check
OK — both route files guarded (re-confirmed tonight).

## Tests (re-run fresh tonight)
- Unit: 7 suites / 271 tests — PASS (induction-assistant, induction-packs, induction-registry,
  learning-admin-routes, learning-content, learning-routes, assign-learning-guards).
- Integration: 4 suites / 68 tests — PASS (learning, learning-admin, induction-assistant,
  onboarding-induction; DB_NAME=therapy_scheduler_audit_learning). Same benign PDF
  "Invalid PDF structure" warning as last night (expected test fixture, non-fatal).
- Tab coverage: e2e/tests/tutorials.spec.js covers the induction dashboard and walkthrough lifecycle
  end to end (confirmed unchanged tonight).

## Open tasks (from tracker)
- "Induction Playground" — todo. Re-confirmed genuinely open tonight: grepped for
  "Induction Playground" and its richer step types (photos, quizzes, hold points) across backend/
  — no match.
- "Portal Inductions" — todo.
- "Splose Inductions" — todo.

## Commits in window touching this
None.

## Disagreement
None directionally — the underlying induction-pack delivery mechanism is proven and heavily
exercised; the open tasks are real, specific gaps (Induction Playground's richer step types), not a
tracker/evidence mismatch.

## Note
No change from the 2026-11-16 audit. Independently re-verified fresh tonight (separate parallel
audit pass, its own throwaway database). Also confirmed the AI side specifically: an AI co-author
(`induction_assistant`, owner-only side chat, properly governed — INTERNAL classification, Australia
region, fail-closed) exists, but it's a side chat, not the inline "ask AI to improve this step"
button the Induction Playground checklist describes — that gap is still open, same conclusion as
last night.
