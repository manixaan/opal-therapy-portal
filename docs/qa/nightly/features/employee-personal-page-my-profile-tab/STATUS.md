# Employee Personal Page (My Profile Tab)

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **built-untested**
- Addressed since the last audit (2026-11-17..2026-11-18): **no**
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
Not touched since the last audit (2026-11-17); zero commits anywhere since 2026-11-14.

## Open tasks (from the tracker)
- Review Portal Structure — todo

## Reason for the label
Code is built, guarded, and used by real people, but no test — unit or integration — exercises the leave/CPD approval round trip itself (confirmed by grepping for updateLeaveStatus / leave_request / profile/leave / profile/cpd across every test file; only incidental mentions turned up). That is a test-coverage gap on a specific workflow, which this audit's established convention calls `built-untested` rather than `needs-refinement` (the latter is reserved for a genuinely unbuilt piece of functionality).

## Disagreement with the tracker
None — the tracker's own words already match the evidence.
