# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **broken**
- Addressed this window (since 2026-10-18): Yes — heavy activity (travel traffic/desk-work rules, Splose auto-sync reset fix, Outlook webhook token decryption, Calendar sync settings, Splose reconcile Link/Send/Ignore).
- Created: Yes — this is the most actively developed subsystem in the window.

## Located files

- Routes: `backend/routes.js` (`GET /api/outlook/categories`, Splose proxy routes), `backend/routes-outlook-integration.js`, `backend/travel-routes.js`, `backend/travel-sync-routes.js`, `backend/splose-sync-routes.js`, `backend/splose-link-routes.js`
- Core: `backend/outlook-oauth.js`, `backend/splose-api.js`, `backend/splose-poller.js`, `backend/splose-credentials.js`, `backend/splose-draft-sync.js`, `backend/splose-match.js`, `backend/travel-cascade.js`, `backend/travel-feasibility.js`, `backend/travel-outlook-sync.js`
- Frontend: `frontend/current/splose-sync.js`, `frontend/current/travel.js`, `frontend/current/travel-alerts.js`, calendar view inside `mockup_v3.html`

## Tests run

| Test | Result |
|---|---|
| 17 unit suites (outlook-delta-preserve, outlook-mirror, splose-api-queue, splose-auto-sync-reset, splose-credentials, splose-draft-sync, splose-link-routes, splose-match, splose-poller, travel-cascade, travel-feasibility, travel-outlook-sync, travel-overlay-clamp, travel-physical-route, travel-sync-routes, travel-traffic, travel-work-location-gate) | ✅ 273/273 passed |
| `DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js` over calendar-local-first, event-travel-plan, outlook-claim, outlook-delta-preserve, splose-connection, splose-draft-sync, splose-link-ignore, travel-outlook-sync, travel-overrides `--runInBand` | ⚠️ 1 failed when run as a batch (`outlook-delta-preserve.itest.js` → "a change made in Outlook AFTER the portal edit wins..." threw `TypeError: Cannot read properties of undefined (reading 'last_modified_at')`); re-run alone → ✅ 11/11 passed. Likely cross-file state/order flakiness in this batch, not a defect in the feature itself — worth a look, not reported as `broken` on its own. |

## Guard check — and the finding

`GET /api/outlook/categories` (`backend/routes.js:1487`) sits behind `requireAuth` only (acceptable — it only reads the calling user's own Outlook token, no cross-user data). The defect is in its error handling: when the user has no Outlook connection, `getValidAccessToken(user)` throws, and the catch block returns
```
res.status(500).json({ error: 'Failed to fetch Outlook categories', details: err.message })
```
— a 500 with a leaked internal error message, not a clean "not connected" response. `grep`-ing `tests/` and `tests/integration/` for `outlook/categories` or `getValidAccessToken` finds **no test anywhere**. This exact gap was already named in the tracker's own `claude_update` field before this run; it is still unfixed.

## Open tracker tasks

- Multi Calendar Rules — `todo`

## Commits in window touching this subsystem

`08da79d`, `6a124db`, `41f45ed`/`ab75330`, `3ef3965`/`971cac1`, `11aa73f`, `d64389c`, `5d48f01`, `3ca80ad`, `40d88a6` (travel traffic/desk-work, Splose auto-sync reset, Outlook webhook decrypt, Calendar sync settings, Splose reconcile, travel→Outlook error handling).

## Disagreement

None on stage — the tracker already correctly flagged this exact defect. The gap is that nothing has fixed it despite a full week of active work on the surrounding subsystem.
