# Clinical resources

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **proven**
- Addressed since last audit (2026-09-18T19:20Z UTC, commit `0726dde`): **no**
- Created (any located code): **yes**

## Located files

- `backend/resource-hub-r2-routes.js`, `backend/resource-library-routes.js`,
  `backend/resources-routes.js`, `backend/resource-ingestion-routes.js`,
  `backend/instrument-register-routes.js` and their data-access counterparts.
- Frontend: `frontend/current/resourcehub.js`, mounted at the `RESOURCES TAB` banner.

This remains the closest and best-fit existing implementation for the tracker's "Clinical
resources" idea; no other code matches the title. `git log 0726dde..HEAD --oneline -- <all 6
files above>` — empty. Untouched tonight (the last touch to `resourcehub.js` predates last
night's baseline and only reached the unrelated `rh2-course`/induction-library namespace).

## Guard check

Every resource route still sits behind `requireAuth` plus a permission/role check
(`router.use('/api/rh2', requireAuth, ...)` with `canAuthor` gating writes;
`router.use('/api/rh2/library', requireAuth, ...)`; `router.use('/api/resources', requireAuth,
...)`; `instrument-register-routes.js` — `router.use('/api/rh2', requireAuth)`). No unguarded
route found.

## Tests run

Re-run fresh tonight on a session-private database (`DB_NAME=therapy_scheduler_n4c`):

- Unit (10 files) — **370/382 passed, 12 intentionally skipped** (not failures).
- Integration (6 files: `resource-file-upload.itest.js`, `resource-hub-r2.itest.js`,
  `resource-hub-v1.itest.js`, `resource-ingestion.itest.js`, `resource-library.itest.js`,
  `resources.itest.js`) — **133/133 passed**.
- Browser QA: `docs/qa/BROWSER_QA_RESULTS.md` flow G, still dated 2026-08-01 — now **49 days
  stale** (up from 48 last night, file itself untouched) — therapist sees 16 approved starter
  resources across 14 folders, no non-official external URLs, folder-create correctly 403s. Content
  unchanged and still valid; nothing in tonight's window touches folder/resource-governance code.

## Disagreement

Tracker stage is idea; the Resource Hub is a mature, RBAC-correct, thoroughly-tested subsystem
that already serves what "Clinical resources" describes.
