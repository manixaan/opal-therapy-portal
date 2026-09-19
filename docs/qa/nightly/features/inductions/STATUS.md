# Inductions

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since last audit (2026-09-18T19:20Z UTC, commit `0726dde`): **no** — none of tonight's
  7 commits (all AI de-identification/Assist/theme work) touch any Inductions file
- Created (any located code): **yes** — unchanged from last night: two of the three tracker tasks
  are built and heavily tested, the third still does not exist

## Located files

Re-verified fresh tonight (commit `cec0a03`), all present and `node --check` clean:

- **"Portal Inductions"** → `backend/learning-routes.js`, `tutorial-routes.js`,
  `walkthrough-routes.js`, `walkthrough-catalogue.js`, `walkthrough-content.js`,
  `walkthrough-anchors.js`, `induction-assistant-routes.js`, `learning-content.js`,
  `onboarding-learning-bridge.js`. Frontend: `frontend/current/resourcehub.js` (`?v=r52`),
  `induction.js` (`?v=10`), `induction-modules.js` (`?v=3`), `induction-assistant.js`/`.css`
  (`?v=3`), `workshop.js`/`.css` (`?v=15`).
- **"Splose Inductions"** → still inside `learning-routes.js`, unchanged in shape.
- **"Induction Playground"** → re-checked via a repo-wide case-insensitive grep for
  `induction.{0,3}playground|playground` — still no code match anywhere (only unrelated hits: an
  FCA clinical example sentence, a map-suggestion string).
- `git log 0726dde..HEAD --oneline -- <all 16 files above>` — empty. Untouched tonight.

## Guard check

`learning-routes.js`, `tutorial-routes.js`, `walkthrough-routes.js`, `induction-assistant-routes.js`
all mount `router.use('/api/<x>', requireAuth)`, with owner-only management/authoring routes
additionally carrying `requireRole('owner')`. No unguarded route found. No TODO/FIXME in any of
the 9 backend files.

## Tests run

Re-run fresh tonight, no code changed here since last audit:

- Unit (9 files, one `jest` invocation): `assign-learning-guards`, `induction-assistant`,
  `induction-registry`, `learning-admin-routes`, `learning-content`, `learning-routes`,
  `walkthrough-content`, `assessment-surface-guards`, `templates-frontend-guards` — **PASS
  366/366**, 9/9 suites.
- Integration (8 files), `DB_NAME=therapy_scheduler_n4c DB_PASSWORD=audit npx jest --config
  jest.integration.config.js ... --runInBand`: `learning.itest.js`, `learning-admin.itest.js`,
  `walkthrough-authoring.itest.js`, `walkthrough-catalogue.itest.js`,
  `walkthrough-evidence.itest.js`, `tutorial-progress.itest.js`, `induction-assistant.itest.js`,
  `onboarding-induction.itest.js` — **PASS 130/130**, 8/8 suites, no cross-session contention this
  run (private database throughout).
- E2E: `e2e/tests/tutorials.spec.js` — re-checked tonight, still not run (out of scope). Line 59's
  assertion (`heading: 'All learning'`) is confirmed **still stale**:
  `grep -n "All learning" frontend/current/resourcehub.js` returns no match. This one assertion
  would fail if the spec were actually executed; not fixed (report-only).

No TODO/FIXME found in any located learning/induction/workshop file.

## Disagreement

Per this audit's own classification rubric, all 3 Inductions tracker tasks carry `status: todo`,
which triggers `needs-refinement` unless the evidence supports `broken` or `untouched`. Neither
applies — the code is extensively built, guarded correctly, and passes 366 unit + 130 integration
tests fresh tonight. The tracker stage (`idea`) still understates what exists regardless of label.
