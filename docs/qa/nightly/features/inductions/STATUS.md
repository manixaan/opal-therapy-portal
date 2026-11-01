# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (since 2026-10-18): no — no commit since then touches the induction files below
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
| `npx jest tests/induction-registry.test.js tests/induction-assistant.test.js` | ✅ 49 passed |
| `DB_NAME=therapy_scheduler_audit2 ... tests/integration/learning-admin.itest.js tests/integration/onboarding-induction.itest.js tests/integration/induction-assistant.itest.js --runInBand` | ✅ 35 passed, incl. "the Splose induction imports with launchable lessons and a formal close" |

No E2E spec and no entry in `docs/qa/BROWSER_QA_RESULTS.md` for induction/learning anywhere — the player (Portal walkthroughs, Splose walkthroughs + scored knowledge check) and the Induction Playground chat panel are proven at the API/unit level only.

## Open tracker tasks

- Induction Playground — `todo`
- Portal Inductions — `todo`
- Splose Inductions — `todo`

## Commits in window

None touching these files since 2026-10-18.

## Disagreement — correcting the tracker's own prior note

The tracker's `claude_update` currently says *"Splose Inductions has no code at all yet."* That is no longer accurate (and may never have been, independent of this window): `backend/learning-routes.js` lines 686-748 build a complete "Splose Induction" with walkthrough lessons and a server-scored 10-question knowledge check (80% pass mark), and `tests/integration/learning-admin.itest.js:500` ("the Splose induction imports with launchable lessons and a formal close") plus `tests/induction-registry.test.js:186` ("the Splose induction group") pass against it right now. Splose Inductions should be treated the same as Portal Inductions and the Playground: built and tested, never confirmed in a browser — not "not started."
