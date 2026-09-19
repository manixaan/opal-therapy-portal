# Inductions

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since last audit (2026-09-18T02:05Z UTC baseline `b6a8ad4`): **yes** — 16 learning/workshop/induction commits landed tonight (`22fddf1` … `ee052e1`; full list via `git log b6a8ad4..HEAD --oneline`), the heaviest churn of the whole codebase tonight
- Created (any located code): **yes** — two of the three tasks are built and heavily reworked tonight; the third still does not exist

## Located files

- **"Portal Inductions"** → `backend/learning-routes.js`, `backend/tutorial-routes.js`, `backend/walkthrough-routes.js`, `backend/walkthrough-catalogue.js`, `backend/walkthrough-content.js`, `backend/walkthrough-anchors.js`, `backend/induction-assistant-routes.js` (new subsystem, chat-with-tools that builds inductions — `ba26286`), `backend/learning-content.js`, `backend/onboarding-learning-bridge.js`. Frontend: `frontend/current/resourcehub.js` (`?v=r52`, up from r46 last night), `frontend/current/induction.js` (`?v=10`), `induction-modules.js` (`?v=3`), `induction-assistant.js`/`.css` (`?v=3`, new tonight), `workshop.js`/`.css` (`?v=15`, new tonight — step-rail drag/reorder, rich text, live preview).
- **"Splose Inductions"** → still confirmed inside `learning-routes.js`, unchanged in shape tonight — a learning workflow filtered to `group: 'splose'` modules, each with a server-scored 10-question knowledge check at an 80% pass mark.
- **"Induction Playground"** → re-checked against every one of tonight's ~20 new commits and their diffs (`git log b6a8ad4..HEAD --oneline -- backend frontend/current`, plus a repo-wide case-insensitive grep for `induction.?playground`/`playground`). Still no match anywhere in application code — only unrelated hits (a `node_modules` TypeScript-playground link, a client-facing "playground nearby" line in FCA clinical example content, an unrelated JS-library README). No new commit introduces anything named or shaped like this.

## Guard check

`learning-routes.js`, `tutorial-routes.js`, `walkthrough-routes.js` and the new `induction-assistant-routes.js` all mount `router.use('/api/<x>', requireAuth)`, with owner-only management/authoring routes additionally carrying `requireRole('owner')` or an in-body role check consistent with the rest of the codebase. No unguarded route found tonight, including in the new induction-assistant surface.

The AI-touching part of tonight's work (`ab55bbc` "direct vendor API under a data residency waiver — induction assistant only") was already independently verified per this audit's brief (all 267 `tests/ai-*.test.js` pass, including the gateway-boundary guards) and is not re-litigated here — noted for recency only.

## Tests run

Unit (9 files, batched in one `jest` invocation): `assign-learning-guards.test.js`, `induction-assistant.test.js`, `induction-registry.test.js`, `learning-admin-routes.test.js` (tests `learning-routes.js`'s admin endpoints — no separate `learning-admin-routes.js` file exists, that's the test's own naming), `learning-content.test.js`, `learning-routes.test.js`, `walkthrough-content.test.js`, `assessment-surface-guards.test.js`, `templates-frontend-guards.test.js` — **366/366 passed**. Pin guards agree with the shipped `r52` and the new `induction-assistant.js?v=3`/`workshop.js?v=15` pins.

Integration (8 files): `learning.itest.js`, `learning-admin.itest.js`, `walkthrough-authoring.itest.js`, `walkthrough-catalogue.itest.js`, `walkthrough-evidence.itest.js`, `tutorial-progress.itest.js`, `induction-assistant.itest.js` (new tonight), `onboarding-induction.itest.js`.
  - First run against `DB_NAME=therapy_scheduler_audit` returned **78 failed / 52 passed** — traced live to another audit session's `jest` process (pid 2736, `fca-reports`/`templates`/`progress-note-letters` suites) running against the *same* database name concurrently; every failure was a `users_organisation_id_fkey` violation from cross-session table truncation, exactly the corruption `.claude/rules/tests.md`'s "Concurrent sessions" section warns about. Not a reproduced defect.
  - Re-run against an isolated `DB_NAME=therapy_scheduler_inductions_audit` — **130/130 passed**, all 8 suites green. This is the trustworthy result.
  - `resource-hub-r2.itest.js` also re-run in isolation for cross-reference with the PD feature below — **33/33 passed**, unrelated to Inductions but confirms the shared Resource Hub router is healthy tonight.
  - E2E: `e2e/tests/tutorials.spec.js` (210 lines) — not run (out of scope), but read for structural/markup sanity as instructed. Most of it still matches current markup (`#ind-card`, `#ind-ring`, `#ind-layer`, `.ind-dash`, `.ind-dash-item`, `.ind-quiz`, `.ind-restart-confirm` all still present in `induction.js`). **One assertion is now stale**: line 59, `await expect(page.getByRole('heading', { name: 'All learning' })).toBeVisible();` — the "All learning" heading no longer exists anywhere in `resourcehub.js`. The `56f3aaa` course-builder redesign (already part of last night's `b6a8ad4` baseline, so this predates tonight but was not caught before) replaced the Owner's "All learning" catalogue heading with three tabs (`Inductions` / `Assignments` / `Staff progress`) under the `Assign Learning` h1, which the spec's first test does still correctly check for (line 58 passes). This one line would fail if the spec were actually executed — the spec is not fully "green" the way last night's audit assumed from its mere existence.

No TODO/FIXME found in any located learning/induction/workshop file, including the ones touched or added tonight.

## Disagreement

Per this audit's own classification rubric, all 3 Inductions tracker tasks carry `status: todo`, which on its own is instructed to trigger `needs-refinement` unless the evidence supports `broken` or `untouched`. Neither applies here — the code is extensively built (11 backend files + 7 frontend files across two named tasks), guarded correctly, and passes 366 unit + 130 integration tests fresh tonight, including a brand-new AI-touching induction assistant. Last night's audit called this `proven`; applying tonight's explicit todo-task rule instead, and given the newly-found stale "All learning" E2E assertion, `needs-refinement` is the more accurate label — the code is real and working, but the tracker's own tasks are still open and the one browser-level check that stood in for "tab proof" no longer fully matches the shipped UI. The tracker stage (`idea`) still understates what exists regardless of label.
