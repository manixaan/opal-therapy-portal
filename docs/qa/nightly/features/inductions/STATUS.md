# Inductions

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven** (mixed — 2 of 3 sub-parts are actually `proven`; see breakdown)
- Addressed since the last audit: **no** — develop has not moved since last night's audit (2026-10-28, also commit `15acf0c`); tonight's true window is empty. `learning-routes.js`'s induction-stage wiring was touched by the onboarding production-readiness commits over the preceding fortnight (historical context), not tonight.
- Created (any located code): yes, for all three tracker tasks.

## Located

- **Induction Playground (AI co-author):** `backend/induction-assistant-routes.js` — owner-only chat tool, correctly calls the AI gateway (`require('./ai/ai-gateway')`, no direct SDK import), registered in `ai-policy.js` as `induction_assistant`. Frontend: `frontend/current/induction-assistant.js`/`.css`.
- **Portal Inductions:** `backend/learning-routes.js` (Portal-walkthroughs import section, ~lines 650-683) + `onboarding-induction.js` + `tutorial-routes.js` + `walkthrough-routes.js` + `walkthrough-catalogue.js`. Frontend: `frontend/current/induction.js` (1199 lines), `induction-modules.js` (seed/fallback registry; DB-backed catalogue is authoritative).
- **Splose Inductions:** same file, adjacent "Splose induction" section (`learning-routes.js` ~lines 686-726): imports the external Splose curriculum's own walkthrough lessons plus a server-scored 10-question, 80%-pass knowledge-check quiz. Route `/api/learning/workflows/import` (owner-only) triggers it. Design is explicit in the code comment: Splose has no hub tutorial pages, so each lesson is a `task` item carrying a `walkthrough_key`.

## Guard check

Pass across all three. `induction-assistant-routes.js`: `requireAuth` + `requireRole('owner')`. `learning-routes.js`: `requireAuth` on `/api/learning`; every admin route (workflows CRUD, import, assign, staff) is owner-only; the employee `/api/learning/my/*` routes are self-scoped by design (documented, filters `user_id = req.user.id`). `tutorial-routes.js`: self-scoped per-user routes, `/seed` owner-only; one style note — `GET /api/tutorials/overview` enforces owner/admin visibility with an inline role check rather than `requirePermission` middleware (functionally correct, not a security defect, but a convention deviation worth a human eye). `walkthrough-routes.js`: every authoring/publish/archive/report route is owner-only. All five files pass `node --check`.

## Tests and results

| Command | Result |
|---|---|
| `induction-assistant`, `induction-registry`, `learning-admin-routes`, `learning-content`, `learning-routes`, `walkthrough-content` unit tests | PASS — 6 suites, 133 tests |
| `learning-admin`, `learning`, `induction-assistant`, `walkthrough-authoring`, `walkthrough-catalogue`, `walkthrough-evidence`, `tutorial-progress` integration tests | PASS — 7 suites, 128 tests |

`tests/integration/learning-admin.itest.js` includes a dedicated, explicitly-named test: **"the Splose induction imports with launchable lessons and a formal close"** (asserts a workflow titled "Splose Induction" is created, its tasks all carry `walkthrough_key` matching `/^splose-/`, portal-only content never leaks into it, and the assignment round-trips to an employee).

`e2e/tests/tutorials.spec.js` covers the learner dashboard (progress/modules/thumbnails, role-filtered), full walkthrough lifecycle (start→highlight→advance→pause→resume across reload and re-login), module completion/restart, and graceful degradation on a missing anchor — this is the delivery mechanism for **both** Portal Inductions and Splose Inductions (same player, different content group). No e2e or browser-QA mention of the Induction Playground anywhere.

## Breakdown

- **Induction Playground: tab-unproven** — guarded, tested, AI-gateway boundary respected, zero browser/E2E evidence.
- **Portal Inductions: proven** — located, guarded, tested, and the delivery tab is covered end to end by `e2e/tests/tutorials.spec.js`.
- **Splose Inductions: proven** — located, guarded, has its own dedicated passing integration test naming the exact behaviour, and rides the same e2e-covered player as Portal Inductions.

## Open tracker tasks

`[todo]` Induction Playground, `[todo]` Portal Inductions, `[todo]` Splose Inductions — all still marked open in the tracker. Portal Inductions and Splose Inductions have no outstanding code work — only a tracker-stage update to reflect the evidence. Induction Playground's only outstanding work is a browser/E2E check, not new code.

## Disagreement / notes

Prior claude_update: *"Needs refinement, unchanged: everyday walkthroughs are proven by e2e; the Induction Playground (AI co-author) is built and tested but unproven in a browser; Splose Inductions already has matching training content but the task's real intent is unclear."*
- **Agree** on walkthroughs being e2e-proven and the Induction Playground being tab-unproven.
- **Disagree** on "the task's real intent is unclear" for Splose Inductions. Reading `learning-routes.js` lines 686-726 plus the dedicated integration test makes the intent and mechanism completely explicit and already working. Recommend treating Splose Inductions as `proven`, not "unclear intent."
- The card-level `needs-refinement` label undersold two of the three sub-parts.
