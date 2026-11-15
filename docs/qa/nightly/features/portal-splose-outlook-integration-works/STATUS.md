# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea | Tracker environment: none
- Evidence label: **needs-refinement**
- Created: yes — extensive code exists
- Addressed this window: yes — heavily touched (flight tracking, booking weekends, calendar declutter,
  Outlook colours, travel block type, Splose-sync fixes)

## Located files
- Backend: outlook-oauth.js (library, no routes), routes-outlook-integration.js, splose-sync-routes.js,
  splose-link-routes.js, sync-settings-routes.js, block-review-routes.js, travel-sync-routes.js,
  travel-routes.js, calendar-routes.js, booking-rules.js, flight-routes.js (new this window)
- Frontend: Calendar tab in mockup_v3.html, frontend/current/flights.js/.css

## Guard check
All located route files guarded (requireAuth + permission/role middleware or router.use chain). No
unguarded endpoint found.

## Tests
- Unit: 18 suites / 290 tests — all PASS
- Integration: 13 suites / 118 tests — all PASS (DB_NAME=therapy_scheduler_audit)
- Tab coverage: docs/qa/BROWSER_QA_RESULTS.md sections C/D/E/F (login/onboarding chain, Outlook per-user
  state, calendar shell, Splose boundaries) all pass.

## Open tasks (from tracker)
- "Multi Calendar Rules" — todo. Confirmed genuinely unbuilt: no "multi calendar" string anywhere in
  backend/.

## Commits in window touching this
8edfa9b, 9444e23 (flight tracking), c1793d1 (weekends bookable), 5120f6d (calendar declutter),
3a494c7 (Outlook colours), 40669e7 (travel block type), 0a365c4 (splose-sync alert fix),
e222a77 (case-noting workspace touches nf2f/calendar).

## Disagreement
Tracker stage "idea" significantly understates reality: a large, heavily-tested integration already
exists and is exercised nightly. The only real gap is the "Multi Calendar Rules" task.
