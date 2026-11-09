# Inductions

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **yes (heavy)** · Created: **yes**

## Located files

- `backend/learning-routes.js` — owner CRUD/assign/versioning + employee "My Learning" (self-scoped exception, documented in the file header)
- `backend/learning-content.js` — pure helper (quiz grading, employee-safe projection)
- `backend/tutorial-routes.js` — per-user tutorial/walkthrough progress
- `backend/walkthrough-routes.js` — owner authoring of walkthroughs
- `backend/induction-assistant-routes.js` — owner's AI co-author chat (via the AI gateway, feature key `induction_assistant`)
- `backend/induction-packs/` — 6 JSON packs: writing-a-case-note, writing-a-progress-report, writing-an-fca-report, calendar-booking-fundamentals, booking-rules-by-session-type, cancellation-policy-short-notice-cancellations-and-charging
- Frontend: `frontend/current/induction.js`, `induction-modules.js`, `induction.css`, `induction-assistant.js/.css`. Not a top-level shell tab — reached via Resource Hub → Learning and a Help-panel overlay card.

Guarded: `requireAuth` plus `requireRole('owner')` on all authoring/assign routes; `/api/learning/my*` and most of `tutorial-routes.js` are self-scoped to `req.user.id` (documented exception); `tutorial-routes.js`'s `/overview` uses an inline role check (`['owner','admin'].includes(req.user.role)`) rather than middleware — functionally guarded. No unguarded route found. No TODO/FIXME anywhere in this subsystem.

## Tests

- Unit (8 files): `assign-learning-guards.test.js`, `induction-assistant.test.js`, `induction-packs.test.js`, `induction-registry.test.js`, `learning-admin-routes.test.js`, `learning-content.test.js`, `learning-routes.test.js`, `walkthrough-content.test.js` — **306/306 pass**
- Integration (8 files): `induction-assistant.itest.js`, `learning-admin.itest.js`, `learning.itest.js`, `onboarding-induction.itest.js`, `tutorial-progress.itest.js`, `walkthrough-authoring.itest.js`, `walkthrough-catalogue.itest.js`, `walkthrough-evidence.itest.js` — **133/133 pass**

## Browser / E2E proof

`e2e/tests/tutorials.spec.js` exercises a full flow: login, open Resource Hub learning view, start → highlight → advance → pause (Escape) → resume after reload **and** after full logout/re-login (server-side persistence); a second test completes a module and asserts server state (`status: 'completed'`) plus the UI badge; restart resets it; also covers role-based module visibility and launching a walkthrough from a resource page. No matching manual entry in `docs/qa/BROWSER_QA_RESULTS.md`, but the E2E coverage alone satisfies the "proven" bar.

## Open tasks from the tracker

"Induction Playground" (todo), "Portal Inductions" (todo), "Splose Inductions" (todo) — no further detail text in the tracker.

## Commits in the window touching this feature

Very active: `34cf881`/`47ebb70` (two new induction packs — booking rules, cancellation policy, calendar booking fundamentals), `5b7f901` (auto-place packs at server start; Progress Report tour switch), `70d4c8b` (professional wording/content cleanup across the first three packs), `d503061` (sections unlock in order, whole-tile launch), `cb08ca8` (place packs without the Import button), `c19a488`/`4e7de4f`/`554fcea` (add Writing a Case Note / Progress Report / FCA Report packs), `df677e4` (tour steps open their own screen).

## Disagreement

None.
