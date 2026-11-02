# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (since 2026-11-01): no — no commit since then touches the induction files below
- Created (any located code): yes, for all three sub-tasks

## Located files

- Backend: `backend/induction-assistant-routes.js` (AI co-author chat, "Induction Playground"), `backend/onboarding-induction.js` (rules consumed by onboarding packs), `backend/learning-routes.js` (induction registry import/assign/player — this is where "Portal Inductions" and "Splose Inductions" actually live, lines ~649-748)
- Frontend: `frontend/current/induction.js`, `induction-modules.js`, `induction-assistant.js` (+ matching `.css`)

## Guard check

- `/api/learning/assistant/*` — `router.use('/api/learning/assistant', requireAuth, requireRole('owner'))`. No defect.
- `/api/learning/*` (workflows, import, assign) — `router.use('/api/learning', requireAuth)` plus per-route `ownerOnly` on every admin action (import, publish, assign, cancel, staff list). No defect.

## Tests run

| Test | Result |
|---|---|
| `npx jest tests/induction-registry.test.js tests/induction-assistant.test.js` | ✅ 49 passed (re-run 2026-11-02) |
| `DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/learning-admin.itest.js tests/integration/onboarding-induction.itest.js tests/integration/induction-assistant.itest.js --runInBand` | ✅ 35 passed (re-run 2026-11-02), incl. "the Splose induction imports with launchable lessons and a formal close" |

No E2E spec and no entry in `docs/qa/BROWSER_QA_RESULTS.md` for induction/learning anywhere — the player (Portal walkthroughs, Splose walkthroughs + scored knowledge check) and the Induction Playground chat panel are proven at the API/unit level only.

## Open tracker tasks

- Induction Playground — `todo`
- Portal Inductions — `todo`
- Splose Inductions — `todo`

## Commits in window

None touching these files since 2026-11-01.

## Disagreement — last night's correction held

Last night's audit corrected the tracker's own `claude_update`, which previously said *"Splose Inductions has no code at all yet."* That write-back landed (tonight's fetched snapshot now reads "Correcting an earlier note: Splose Inductions already has real code and tests"). No further disagreement tonight — all three surfaces remain built and tested, never confirmed in a browser.
