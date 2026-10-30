# Inductions

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven** (mixed — 2 of 3 sub-parts are actually `proven`; see breakdown)
- Addressed since the last audit: **no** — the true change window (`15acf0c..338f5dc`, 5 commits) touches
  `backend/routes.js`, `backend/database.js`, `backend/mobile-routes.js`, `backend/ai/ai-audit.js`,
  `backend/case-note-routes.js`, their matching tests, and `frontend/current/{mockup_v3.html,travel.js,
  travel-alerts.js/.css,casenotes.js}` — travel/traffic, mobile diary sync, and case-note approval/edit.
  None of it touches `learning-routes.js`, `tutorial-routes.js`, `walkthrough-routes.js`,
  `walkthrough-catalogue.js`, `onboarding-induction.js`, `induction-assistant-routes.js`, or any
  `frontend/current/induction*.js` file. Confirmed with
  `git log 15acf0c..338f5dc --stat --name-only | grep -iE "induction|learning|tutorial|walkthrough"` (no output).
- Created (any located code): yes, for all three tracker tasks.

## Located

- **Induction Playground (AI co-author):** `backend/induction-assistant-routes.js` — owner-only chat tool, calls
  the AI gateway (`require('./ai/ai-gateway')`, no direct SDK import). Frontend:
  `frontend/current/induction-assistant.js` / `induction-assistant.css`.
- **Portal Inductions:** `backend/learning-routes.js` (Portal-walkthroughs import section, ~lines 650-683) +
  `backend/onboarding-induction.js` + `backend/tutorial-routes.js` + `backend/walkthrough-routes.js` +
  `backend/walkthrough-catalogue.js`. Frontend: `frontend/current/induction.js` (learner dashboard/player),
  `frontend/current/induction-modules.js` (seed/fallback registry; DB-backed catalogue is authoritative).
- **Splose Inductions:** same file, adjacent "Splose induction" section (`backend/learning-routes.js`
  ~lines 686-726): imports the external Splose curriculum's own walkthrough lessons plus a server-scored
  10-question, 80%-pass knowledge-check quiz. Route `/api/learning/workflows/import` (owner-only) triggers it.
  Each Splose lesson is a `task` item carrying a `walkthrough_key` (Splose has no hub tutorial pages of its own).

All twelve located files re-verified present on disk tonight (`backend/induction-assistant-routes.js`,
`frontend/current/induction-assistant.{js,css}`, `backend/learning-routes.js`,
`backend/onboarding-induction.js`, `backend/tutorial-routes.js`, `backend/walkthrough-routes.js`,
`backend/walkthrough-catalogue.js`, `frontend/current/induction.js`, `frontend/current/induction-modules.js`,
`e2e/tests/tutorials.spec.js`, `backend/tests/integration/learning-admin.itest.js`), and all five routers
confirmed mounted in `backend/server.js` (`tutorial-routes`, `walkthrough-routes`, `learning-routes`,
`induction-assistant-routes`).

## Guard check

Pass across all three, re-grepped tonight.
- `induction-assistant-routes.js` line 69: `router.use('/api/learning/assistant', requireAuth, requireRole('owner'))`.
- `learning-routes.js` line 56: `router.use('/api/learning', requireAuth)`; line 57 defines `ownerOnly =
  requireRole('owner')`, applied to every admin route (workflows CRUD, import, assign, staff); the employee
  `/api/learning/my/*` routes are self-scoped by design (filters on `req.user.id`, documented in the file).
- `tutorial-routes.js` line 47: `router.use('/api/tutorials', requireAuth)`; line 130: `/seed` is
  `requireRole('owner')`; the remaining per-user routes are self-scoped by design.
- `walkthrough-routes.js` line 36: `router.use('/api/walkthroughs', requireAuth)`; line 37 defines
  `ownerOnly = requireRole('owner')`, applied to authoring/publish/archive/report routes.
- `node --check` passes tonight on all six backend files (`induction-assistant-routes.js`,
  `learning-routes.js`, `tutorial-routes.js`, `walkthrough-routes.js`, `walkthrough-catalogue.js`,
  `onboarding-induction.js`).

## Tests and results

| Command | Result |
|---|---|
| `npx jest tests/induction-assistant.test.js tests/induction-registry.test.js tests/learning-admin-routes.test.js tests/learning-content.test.js tests/learning-routes.test.js tests/walkthrough-content.test.js` | PASS — 6 suites, 133 tests, 0 failed |
| `DB_NAME=therapy_scheduler_auditg6 DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/learning-admin.itest.js tests/integration/learning.itest.js tests/integration/induction-assistant.itest.js tests/integration/walkthrough-authoring.itest.js tests/integration/walkthrough-catalogue.itest.js tests/integration/walkthrough-evidence.itest.js tests/integration/tutorial-progress.itest.js --runInBand` | PASS — 7 suites, 128 tests, 0 failed |

Both counts match last night's run exactly (6/133 unit, 7/128 integration), consistent with zero code
change in this subsystem since 15acf0c.

`tests/integration/learning-admin.itest.js` re-confirmed to contain the test named
**"the Splose induction imports with launchable lessons and a formal close"** (line 500) — asserts a workflow
titled "Splose Induction" is created, its tasks all carry `walkthrough_key` matching `/^splose-/`, portal-only
content never leaks into it, and the assignment round-trips to an employee.

`e2e/tests/tutorials.spec.js` re-read tonight: `test.describe('induction dashboard', ...)` (Owner vs. learner
view, role-filtered) and `test.describe('walkthrough lifecycle', ...)` covering start → highlight → advance →
pause → resume across reload and re-login, module completion/restart, graceful degradation on a missing
anchor, and launching a walkthrough from a tutorial resource page. This is the delivery mechanism for
**both** Portal Inductions and Splose Inductions (same player, different content group). Checked
`docs/qa/BROWSER_QA_RESULTS.md` tonight for any Induction Playground mention — none found.

## Breakdown

- **Induction Playground: tab-unproven** — guarded, tested, AI-gateway boundary respected, zero browser/E2E evidence.
- **Portal Inductions: proven** — located, guarded, tested, and the delivery tab is covered end to end by `e2e/tests/tutorials.spec.js`.
- **Splose Inductions: proven** — located, guarded, has its own dedicated passing integration test naming the exact behaviour, and rides the same e2e-covered player as Portal Inductions.

## Commits in window touching located files

None. The window (`15acf0c..338f5dc`) is 08da79d, e1af24e, a56173c, dc5dbc4, 338f5dc — travel/traffic alerts,
mobile diary sync, case-note approval/edit, and a travel-test time fix. No commit touches any file listed
under "Located" above.

## Open tracker tasks

`[todo]` Induction Playground, `[todo]` Portal Inductions, `[todo]` Splose Inductions — all still marked open
in the tracker. Portal Inductions and Splose Inductions have no outstanding code work — only a tracker-stage
update to reflect the evidence. Induction Playground's only outstanding work is a browser/E2E check, not new
code.

## Disagreement / notes

Tracker's current `claude_update`: *"Mixed: Portal Inductions and Splose Inductions are both proven
(e2e-covered walkthrough player, plus a dedicated passing integration test for the Splose import). Only the
Induction Playground (AI co-author) remains tab-unproven."* `next_action`: *"Open the Induction Playground in
a browser as Owner and confirm it works; Portal/Splose Inductions need no further code."*

Tonight's independent re-verification **agrees** with both: the per-sub-part breakdown, the test counts, the
named Splose integration test, and the e2e coverage all re-check out exactly as claimed, and nothing in
tonight's 5-commit window touches this subsystem. No disagreement to flag tonight.
