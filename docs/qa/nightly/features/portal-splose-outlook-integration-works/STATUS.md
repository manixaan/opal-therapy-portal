# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea · Tracker environment: none
- Evidence label: **broken**
- Addressed since the last audit (develop unchanged since 2026-10-28, also commit `15acf0c`): no — the one defect found was not touched by any commit in the window; the related file `outlook-oauth.js` touched only by `971cac1` (webhook token decryption, a different concern).
- Created (any located code): yes, for the integration surface in general; no for the tracker's own named task.

## Located

- `GET /api/outlook/categories` lives in `backend/routes.js:1487` (mounted via `app.use('/', require('./routes'))` and `app.use('/api', routes)` in `server.js`).
- Wider integration surface: `backend/outlook-oauth.js`, `backend/calendar-routes.js`, `backend/sync-settings-routes.js`, `backend/splose-sync-routes.js`, `backend/splose-link-routes.js`, `backend/splose-api.js`, `backend/sync-backfill.js`, `backend/sync-preferences.js`, `backend/sync-safety.js`.
- The tracker's only named task, **"Multi Calendar Rules"**, has no matching code anywhere (`multi.calendar`, `multi-calendar`, `calendar.rules` all searched, case-insensitive, across `backend/` and `frontend/current/` — no real hit). `backend/routes-outlook-integration.js` and `backend/check-outlook-categories.js` exist on disk but are never `require`d — dead files, not the live path.

## Guard check

`GET /api/outlook/categories` sits behind `requireAuth` only, scoped to the caller's own Outlook tokens — self-scoped by design, not a guard defect. The rest of the integration surface (`sync-settings-routes.js`, `splose-sync-routes.js`) is guarded with `requireAuth` + role/permission middleware. No unguarded endpoint found.

## Tests and results

| Command | Result |
|---|---|
| `npx jest tests/sync.test.js tests/splose-match.test.js tests/sync-safety.test.js tests/sync-backfill.test.js tests/sync-preferences.test.js tests/sync-status-route.test.js tests/splose-auto-sync-reset.test.js` | PASS — 7 suites, 101 tests |
| `DB_NAME=therapy_scheduler_audit_g1 npx jest --config jest.integration.config.js tests/integration/sync-settings.itest.js --runInBand` | PASS — 12 tests |
| test for `GET /api/outlook/categories` | **none exists** |
| `node --check` on routes.js, calendar-routes.js, sync-settings-routes.js, splose-sync-routes.js | OK |

## The defect

`GET /api/outlook/categories` (`routes.js:1487`) calls `getValidAccessToken(user)` with no pre-check. `getValidAccessToken` (`routes.js:151`) throws a plain `Error('Outlook not connected')` when the user has no Outlook token, and the route's catch block turns *any* thrown error into a generic `500 {error: 'Failed to fetch Outlook categories'}`. A user who has never connected Outlook gets a 500, not a clean "not connected" response.

The fix pattern already exists next door: `GET /api/calendar/reconcile` (`routes.js:1058`) pre-checks `if (!user?.access_token) return res.status(409)...` before calling the same helper.

## Open tracker tasks

- `[todo]` Multi Calendar Rules — no code located; nothing has been built for this.

## Commits in window touching located files

None fix this defect. `971cac1 fix(outlook): the webhook receiver decrypts stored tokens` touched a different concern (webhook token decryption) in the same general area.

## Disagreement / notes

None — this run independently reproduced the bug by code inspection and agrees with the prior night's "broken, no test" finding. Tracker stage `idea` already undersells the amount of working integration code around this defect (sync settings, Splose reconciliation are solid); see the audit-wide note in the morning brief about stage hygiene.
