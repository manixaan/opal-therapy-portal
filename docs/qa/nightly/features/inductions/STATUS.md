# Inductions

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-17..2026-11-18): **no**
- Created (any located code): **yes**

## Located files
- backend/induction-assistant-routes.js (requireAuth + requireRole('owner') router-wide)
- frontend: induction.js, induction-modules.js, induction-assistant.js, induction.css, induction-assistant.css

## Could not locate / notable gaps
- No 'photo'/image step type anywhere in the induction frontend (only 'quiz' and 'checkpoint'/hold-point exist) — this matches the tracker's own next_action exactly ('start with photo'), so it is not a disagreement, just confirmation.

## Guard check
OK — requireAuth + requireRole('owner').

## Tests run
- unit: `induction-assistant.test.js, induction-packs.test.js, induction-registry.test.js` — **pass** (3 files / 92 tests)
- integration: `induction-assistant.itest.js, onboarding-induction.itest.js` — **pass** (2 files / 7 tests)

## Tab / browser proof
e2e/tests/tutorials.spec.js proves the LEARNER side end-to-end (start, highlight, advance, pause, resume across reload/re-login, complete, restart) — real E2E coverage. No coverage of the creator/builder or AI-helper side.

## Recency
Not touched since the last audit (2026-11-17). For orientation, 8+ commits adding induction PACKS (content) landed 2026-11-07..2026-11-14 — booking rules, cancellation policy, calendar fundamentals, FCA/progress-report/case-note writing packs, professional wording — but not the builder itself.

## Open tasks (from the tracker)
- Induction Playground — todo
- Portal Inductions — todo
- Splose Inductions — todo

## Reason for the label
All three tasks (Induction Playground, Portal Inductions, Splose Inductions) are todo; the visual step-editor, AI helper and photo step type the tasks describe are still open work.

## Disagreement with the tracker
Tracker "idea" stage vs. a working, E2E-proven learner experience and a real owner-only, AI-assisted content-authoring pipeline already shipping new packs regularly.
