# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **broken**
- Addressed this window (since 2026-11-01): No — the 7 commits in this window are all "Opal Assist" (a new AI chat feature, see the brief's "What changed" section) plus one generic address-autocomplete positioning fix; none touch this subsystem's files.
- Created: Yes — built in an earlier window, re-verified unchanged tonight.

## Located files

- Routes: `backend/routes.js` (`GET /api/outlook/categories`, Splose proxy routes), `backend/routes-outlook-integration.js`, `backend/travel-routes.js`, `backend/travel-sync-routes.js`, `backend/splose-sync-routes.js`, `backend/splose-link-routes.js`
- Core: `backend/outlook-oauth.js`, `backend/splose-api.js`, `backend/splose-poller.js`, `backend/splose-credentials.js`, `backend/splose-draft-sync.js`, `backend/splose-match.js`, `backend/travel-cascade.js`, `backend/travel-feasibility.js`, `backend/travel-outlook-sync.js`
- Frontend: `frontend/current/splose-sync.js`, `frontend/current/travel.js`, `frontend/current/travel-alerts.js`, calendar view inside `mockup_v3.html`

## Tests run

| Test | Result |
|---|---|
| 17 unit suites (outlook-delta-preserve, outlook-mirror, splose-api-queue, splose-auto-sync-reset, splose-credentials, splose-draft-sync, splose-link-routes, splose-match, splose-poller, travel-cascade, travel-feasibility, travel-outlook-sync, travel-overlay-clamp, travel-physical-route, travel-sync-routes, travel-traffic, travel-work-location-gate) | ✅ 273/273 passed (re-run 2026-11-02, unchanged) |
| `DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js` over calendar-local-first, event-travel-plan, outlook-claim, outlook-delta-preserve, splose-connection, splose-draft-sync, splose-link-ignore, travel-outlook-sync, travel-overrides `--runInBand` | ✅ 9/9 suites, 75/75 tests passed tonight — last night's single-test batch flakiness (`outlook-delta-preserve.itest.js`) did not reproduce; confirms it was cross-run flakiness, not a defect. |

## Guard check — and the finding

`GET /api/outlook/categories` (`backend/routes.js:1487`) sits behind `requireAuth` only (acceptable — it only reads the calling user's own Outlook token, no cross-user data). The defect is in its error handling: when the user has no Outlook connection, `getValidAccessToken(user)` throws, and the catch block returns
```
res.status(500).json({ error: 'Failed to fetch Outlook categories', details: err.message })
```
— a 500 with a leaked internal error message, not a clean "not connected" response. `grep`-ing `tests/` and `tests/integration/` for `outlook/categories` or `getValidAccessToken` finds **no test anywhere**. This exact gap was already named in the tracker's own `claude_update` field before this run; it is still unfixed.

## Open tracker tasks

- Multi Calendar Rules — `todo`

## Commits in window touching this subsystem (since 2026-11-01)

None directly. `75eae1e` "fix(maps): open address suggestions right under the input" touches the shared `attachPlacesAutocomplete()` helper in `mockup_v3.html` used by location fields app-wide, including the booking panel's location block — a positioning fix only, no behaviour change to travel/Splose/Outlook logic.

## Disagreement

None on stage — the tracker already correctly flagged this exact defect. The gap is that nothing has fixed it despite two full weeks of activity on the surrounding subsystem (the defect itself is unchanged tonight; today's window had no commits here at all).
