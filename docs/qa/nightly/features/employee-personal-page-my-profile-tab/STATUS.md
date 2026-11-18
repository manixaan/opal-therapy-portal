# Employee Personal Page (My Profile Tab)

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed in the 2026-11-04..2026-11-18 change window: **no**
- Created (any located code): **yes**

## Located files
- backend/profile-routes.js (leave, cpd, documents, credentials)
- frontend tab: PROFILE TAB (mockup_v3.html)

## Guard check
OK functionally — requireAuth router-wide plus an inline canApprove(req.user) role check on the leave/cpd approve-reject routes. Style note: this is an inline check rather than the requirePermission() convention backend-api.md prefers; not a missing guard.

## Tests run
- unit: `credential-surface-guards.test.js, security.test.js, smart-route-backend.test.js, onboarding-security.test.js (indirect/partial coverage of profile-routes.js — credentials, work-schedule 404 scoping, leave route existence)` — **pass** (4 files / 94 tests)
- integration: `none found that exercises /api/profile/leave or /api/profile/cpd` — **no test exists** (—)

## Tab / browser proof
PROFILE TAB exists; no E2E or browser QA entry.

## Recency
Not touched in-window.

## Open tasks (from the tracker)
- Review Portal Structure — todo

## Reason for the label
The one task (Review Portal Structure) is todo, and the next_action — "add an integration test proving the leave/CPD approval round trip end to end" — exactly names the gap found: no such integration test exists.

## Disagreement with the tracker
None — the tracker's own words already match the evidence.
