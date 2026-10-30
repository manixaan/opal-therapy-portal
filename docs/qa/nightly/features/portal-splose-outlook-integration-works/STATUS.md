# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea · Tracker environment: none
- Evidence label: **broken**
- Addressed since the last audit (window `15acf0c..338f5dc`, 5 commits: `08da79d`, `e1af24e`, `a56173c`, `dc5dbc4`, `338f5dc`): no. `08da79d` (the travel feature) is the only commit in the window touching `backend/routes.js`, and its diff is confined to the `PATCH /api/events/:dbId/travel` handler (adds `noDriveBefore`/`noDriveAfter` flag handling around line 2580-2598) — it does not touch `GET /api/outlook/categories` (line 1487) or `getValidAccessToken` (line 151) in any way. The other four commits in the window touch mobile-routes/database.js, case-note-routes.js, and casenotes.js/mockup_v3.html frontend — none are the Outlook integration surface.
- Created (any located code): yes, for the integration surface in general; no for the tracker's own named task ("Multi Calendar Rules").

## Located

- `GET /api/outlook/categories` lives in `backend/routes.js:1487` (same line as last audit — the only change to `routes.js` tonight landed ~1,100 lines further down, at the travel-leg PATCH handler, so this route's line number did not shift). Mounted via `app.use('/', require('./routes'))` and `app.use('/api', routes)` in `server.js`.
- `getValidAccessToken(user)` helper: `backend/routes.js:151-154` — throws `Error('Outlook not connected')` when `!user.access_token`, unchanged tonight.
- Comparable route with the fix pattern already applied: `GET /api/calendar/reconcile`, `backend/routes.js:1052` (`requireAuth`, `requireRole('owner','admin')`), pre-checks `if (!user?.access_token) return res.status(409)...` at line 1059 before calling `getValidAccessToken`.
- Wider integration surface (unchanged tonight): `backend/outlook-oauth.js`, `backend/calendar-routes.js`, `backend/sync-settings-routes.js`, `backend/splose-sync-routes.js`, `backend/splose-link-routes.js`, `backend/splose-api.js`, `backend/sync-backfill.js`, `backend/sync-preferences.js`, `backend/sync-safety.js`.
- The tracker's only named task, **"Multi Calendar Rules"**, still has no matching code anywhere. Re-searched case-insensitively tonight: `multi.calendar`, `multi-calendar`, `calendar.rules`, `calendar rules` across `backend/` and `frontend/current/`. The only hit, `frontend/current/scheduler.js:162` ("...matching the existing calendar rules"), is an unrelated code comment about event visibility filtering, not this task. `backend/routes-outlook-integration.js` and `backend/check-outlook-categories.js` still exist on disk and are still never `require`d anywhere (checked `server.js` and all `backend/*.js` for a reference) — dead files, not the live path.

## Guard check

`GET /api/outlook/categories` sits behind `requireAuth` only, scoped to the caller's own Outlook tokens (`db.getUser(req.session.userId)`) — self-scoped by design, not a guard defect. The rest of the integration surface (`sync-settings-routes.js`, `splose-sync-routes.js`) is guarded with `requireAuth` + role/permission middleware. No unguarded endpoint found tonight.

## Tests and results

| Command | Result |
|---|---|
| `npx jest tests/sync.test.js tests/splose-match.test.js tests/sync-safety.test.js tests/sync-backfill.test.js tests/sync-preferences.test.js tests/sync-status-route.test.js tests/splose-auto-sync-reset.test.js` | PASS — 7 suites, 101 tests |
| `DB_NAME=therapy_scheduler_auditg9 DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/sync-settings.itest.js --runInBand` | PASS — 1 suite, 12 tests |
| test for `GET /api/outlook/categories` specifically | **none exists** — grepped `tests/` and `tests/integration/` for `outlook.*categor` (case-insensitive); the 7 hits (`frontend-stage3-guards.test.js`, `booking-rules.test.js`, `outlook-delta-preserve.test.js`/`.itest.js`, `sync-settings.itest.js`, `travel-outlook-sync.itest.js`, `smart-booking-route.test.js`) reference calendar *event* categories, not the `masterCategories` route at line 1487 |
| `node --check backend/routes.js` | OK |

## The defect (re-verified tonight by tracing the live handler)

`GET /api/outlook/categories` (`routes.js:1487-1501`) calls `getValidAccessToken(user)` at line 1490 with no pre-check on `user.access_token`. `getValidAccessToken` (`routes.js:151-154`) throws a plain `Error('Outlook not connected')` when the user has no Outlook token. The route's `catch` block (line 1497-1500) turns *any* thrown error, including that one, into a generic `500 {error: 'Failed to fetch Outlook categories', details: err.message}`. A user who has never connected Outlook still gets a 500, not a clean "not connected" response. Confirmed unchanged since last audit: diffing tonight's `routes.js` change (`08da79d`) shows it only inserts 6 lines at 2580-2598, nowhere near this route or helper.

The fix pattern already exists next door: `GET /api/calendar/reconcile` (`routes.js:1052-1059`) pre-checks `if (!user?.access_token) return res.status(409)...` before calling the same helper.

## Open tracker tasks

- `[todo]` Multi Calendar Rules — no code located; nothing has been built for this. The task's own notes (long free-text) describe it as a *verification/stress-test* task against an already-built booking → Splose → Outlook workflow, not a new feature to code from scratch — but there is still no checklist item, test, or doc confirming any of the six checklist points tonight.

## Commits in window touching located files

- `08da79d` (travel feature) touched `backend/routes.js` but only the `PATCH /api/events/:dbId/travel` handler (~line 2580) — confirmed by diff, does not touch the Outlook categories route or its helper.
- `e1af24e`, `a56173c`, `dc5dbc4`, `338f5dc` — touch mobile-routes/database.js, case-note-routes.js, casenotes.js/mockup_v3.html, and travel-traffic.test.js respectively; none touch the Outlook/Splose integration surface.
- No commit in the window fixes, or regresses, this defect.

## Disagreement / notes

None — this run independently re-verified the bug by tracing the handler and helper line-by-line, re-ran the matching tests, and re-confirmed "Multi Calendar Rules" has no code. Agrees with the prior night's (`15acf0c`, 2026-10-29) "broken, no test" finding; the defect, its location, and the fix pattern are unchanged. Tracker stage `idea` still undersells the amount of working integration code around this defect (sync settings, Splose reconciliation are solid and covered by passing tests).
