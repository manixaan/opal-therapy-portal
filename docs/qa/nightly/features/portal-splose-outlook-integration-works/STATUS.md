# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window (commits since 2026-10-06 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-06); the audited commit (`aacf8e68`) is still unchanged. This is the seventh consecutive reconfirmation night on this exact code. Tonight is not Sunday UTC, so targeted batches were run (not the complete suites) — see each section below for exactly what ran tonight.
- Created (any located code at all): **yes**

## Located files
- backend/splose-sync-routes.js, splose-api.js, splose-link-routes.js, splose-credentials.js, splose-draft-sync.js, splose-poller.js
- backend/outlook-mirror.js, backend/outlook-delta-preserve.js, backend/outlook-oauth.js (OAuth helper), backend/travel-cascade.js (travel-time cascade)
- backend/routes.js — GET /api/outlook/categories (line 1463)
- Frontend: BOOK TAB (mockup_v3.html:4464), CALENDAR TAB (mockup_v3.html:4711/4712)

## Guard check
splose-sync-routes.js: requireAuth + denyReadOnly + requireDraftSync — guarded. Every other Splose/Outlook route checked has requireAuth plus a role or ownership check. **Re-read backend/routes.js:1459-1477 directly tonight: the known bug is still present, byte for byte.** `GET /api/outlook/categories` wraps its body in a blanket `catch` that returns HTTP 500 for every error, including the ordinary case of a user with no Outlook connection (which throws `Error('Outlook not connected')` from `getValidAccessToken`) — it should return 409 or an empty list instead. This is guard-adjacent, not a guard gap (the route is still correctly behind requireAuth), but it is a real, still-open defect, confirmed by reading the code again tonight, not inherited from the last report.

## Tests run tonight
- unit: `outlook-delta-preserve.test.js, outlook-mirror.test.js, splose-api-queue.test.js, splose-credentials.test.js, splose-draft-sync.test.js, splose-link-routes.test.js, splose-poller.test.js` — run in isolation tonight: 110/110 pass
- integration: `splose-connection.itest.js, splose-draft-sync.itest.js, outlook-claim.itest.js, outlook-delta-preserve.itest.js` — 59/59 pass tonight (run together with events-sync.itest.js and oauth-callback.itest.js; all green)

## Open tasks (from the tracker)
- Multi Calendar Rules — build, todo

## Compare with the tracker
None new — the tracker's own claude_update already names this open bug and task accurately. The travel-cascade/draft-sync/two-way-match workflow described in the tracker's notes is otherwise built, guarded and well tested, with real e2e (e2e/tests/portal.spec.js) and a recorded browser QA pass (BROWSER_QA_RESULTS.md flows D and F).
