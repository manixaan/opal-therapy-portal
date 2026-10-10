# Portal - Splose - Outlook | Integration Works

- Tracker stage: `idea`
- Tracker environment: `none`
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-10-09): no
- Created (any located code at all): yes

## Located

- "Multi Calendar Rules" doesn't map to one distinct module — the closest match is `backend/calendar-routes.js` (master calendar / per-therapist access, each route individually guarded with `requireAuth` plus `requireRole`/`requireMasterCalendarAccess`), `backend/calendar-permissions.js` (role-based calendar visibility rules), the Outlook sync pipeline (`backend/outlook-oauth.js` + sync functions in `backend/routes.js`), and `backend/splose-sync-routes.js` (`requireAuth`+`denyReadOnly`+`requireDraftSync`).
- `backend/splose-link-routes.js` — `requireAuth`, plus `requireRole('owner')` on the admin/connection routes.
- Noted in passing: `backend/routes-outlook-integration.js` defines its own local `requireAuth` and is never `require()`'d anywhere in `server.js` or elsewhere — it's dead code, not a live guard gap (it never runs), but worth deleting.

## Tests

- Unit (7 files): **110/110 pass.**
- Integration (5 files): **50/50 pass.**
- e2e: `e2e/tests/portal.spec.js` — Splose 403 boundaries, write-blocked, Outlook not-connected state. Browser QA rows D (Outlook state, 4/4) and F (Splose boundaries, 4/4) pass.
- **Confirmed real, reproducible, currently unfixed bug** (not caught by any test — grepped `outlook/categories` across `tests/` and `tests/integration/`, zero matches): `GET /api/outlook/categories` in `backend/routes.js:1463` calls `getValidAccessToken()`, which throws a plain `Error('Outlook not connected')` for a disconnected user (`routes.js:151-153`); the route's catch block (`routes.js:1473-1476`) turns *any* error into a flat `500` instead of distinguishing "not connected." Independently documented in `docs/qa/BROWSER_QA_RESULTS.md` (2026-08-01, Medium severity) and reproduced again tonight by reading the code path directly.

## Open tasks (from the tracker)

Tracker task "Multi Calendar Rules" is `todo`.

## Commits since the last audit that touched it

None — no commits have landed on `develop` under `backend/` or `frontend/current/` since the last audit (2026-10-09). Code audited tonight is the same commit (`aacf8e6`) as the last several nights.

## Disagreement with the tracker

None.

