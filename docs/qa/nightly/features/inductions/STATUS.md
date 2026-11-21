# Inductions

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-20..2026-11-21): **no**
- Created (any located code): **yes**

## Located files
- backend/induction-assistant-routes.js (requireAuth + requireRole('owner') router-wide)
- frontend: induction.js, induction-modules.js, induction-assistant.js, induction.css, induction-assistant.css

## Could not locate / notable gaps
No 'photo'/image step type anywhere in the induction frontend (only 'quiz' and 'checkpoint'/hold-point exist, re-confirmed tonight) — this matches the tracker's own next_action exactly ('start with photo'), so it is not a disagreement, just confirmation it is still open.

## Guard check
OK — requireAuth + requireRole('owner'), re-confirmed.

## Tests run
- unit: `induction-assistant.test.js, induction-packs.test.js, induction-registry.test.js` — **pass** (3 files / 92 tests)
- integration: `induction-assistant.itest.js, onboarding-induction.itest.js` — **pass** (2 files / 7 tests)

## Tab / browser proof
e2e/tests/tutorials.spec.js still exists and still covers the learner-side flow end-to-end (start, highlight, advance, pause, resume across reload/re-login, complete, restart). No coverage of the creator/builder or AI-helper side.

## Recency
Not touched since the last audit (2026-11-20) — none of the 77 commits that landed in `backend/` or `frontend/current/` between 18:52 UTC 2026-11-20 and tonight's audit touched any induction file (that window was calendar/booking/travel/Splose-sync and invoicing/billing/Xero work only).

## Open tasks (from the tracker)
- Induction Playground — todo
- Portal Inductions — todo
- Splose Inductions — todo

## Reason for the label
All three tasks (Induction Playground, Portal Inductions, Splose Inductions) are todo; the visual step-editor, AI helper and photo step type the tasks describe are still open work. Unchanged from last night.

## Disagreement with the tracker
Tracker "idea" stage vs. a working, E2E-proven learner experience and a real owner-only, AI-assisted content-authoring pipeline already shipping new packs regularly.
