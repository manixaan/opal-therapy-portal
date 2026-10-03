# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window (commits since 2026-10-02 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-02); the audited commit (`aacf8e6`) is still unchanged. This is the fourth consecutive reconfirmation night on this exact code.
- Created (any located code at all): **yes**

## Located files
- backend/calendar-routes.js, calendar-permissions.js (helper, no routes)
- backend/splose-sync-routes.js, splose-link-routes.js, splose-api.js, splose-caseload.js, splose-credentials.js, splose-draft-sync.js, splose-poller.js
- backend/outlook-oauth.js (OAuth helper, no routes), backend/routes-outlook-integration.js (defines its own local requireAuth instead of the shared one — inconsistent but not a gap), backend/routes.js (GET /api/outlook/categories lives here)
- Frontend: BOOK TAB (mockup_v3.html:4464), CALENDAR TAB (mockup_v3.html:4711/4712)

## Guard check
calendar-routes.js: requireAuth + requireRole(owner/admin) — guarded. splose-sync-routes.js: requireAuth + denyReadOnly + requireDraftSync — guarded. splose-link-routes.js: requireAuth + requireRole(owner) — guarded. routes-outlook-integration.js defines its own local requireAuth (checks req.session.userId) rather than importing the shared one from permissions.js — functionally equivalent, but a hygiene inconsistency worth fixing so there is one definition of "authenticated" in the codebase.

## Tests and results
Unit (all pass): outlook-mirror (part of 110), outlook-delta-preserve, splose-api-queue, splose-link-routes, splose-credentials, splose-draft-sync, splose-poller — re-run tonight, 7 suites / 110 tests, identical to the last three nights.
Integration (all pass): outlook-claim.itest.js, outlook-delta-preserve.itest.js, splose-connection.itest.js, splose-draft-sync.itest.js — re-run tonight, 39/39, identical to the last three nights.
Browser QA (docs/qa/BROWSER_QA_RESULTS.md, 2026-08-01): item D (Outlook state, 4/4) and item F (Splose boundaries, 4/4) directly exercise this surface in a real browser.

## Open tasks (from the tracker)
- Multi Calendar Rules — build, todo

## Compare with the tracker
None new — the tracker's own claude_update already names the open bug and task accurately.
