# Employee Personal Page (My Profile Tab)

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **built-untested**
- Addressed since the last audit (2026-11-19..2026-11-20): **no**
- Created (any located code): **yes**

## Located files
- backend/profile-routes.js (leave, cpd, documents, credentials)
- frontend tab: PROFILE TAB (mockup_v3.html)

## Guard check
OK functionally — requireAuth router-wide plus an inline canApprove(req.user) role check on the leave/cpd approve-reject routes (lines ~124-125, 154-155), re-confirmed tonight. Style note: this is an inline check rather than the requirePermission() convention backend-api.md prefers; not a missing guard.

## Tests run
- unit: `credential-surface-guards.test.js, security.test.js, smart-route-backend.test.js, onboarding-security.test.js` — **pass** (4 files / 94 tests)
- integration: none found that exercises /api/profile/leave or /api/profile/cpd (re-confirmed by fresh grep tonight; the only incidental hit, scheduler-availability.itest.js, inserts a leave_requests row for an unrelated test) — **no test exists** (—)

## Tab / browser proof
PROFILE TAB exists; no E2E or browser QA entry.

## Recency
Not touched since the last audit (2026-11-19) — zero commits landed in `backend/` or `frontend/current/` anywhere in the repository between 18:39 UTC 2026-11-19 and tonight's audit.

## Open tasks (from the tracker)
- Review Portal Structure — todo

## Reason for the label
Code is built, guarded, and used by real people, but no test — unit or integration — exercises the leave/CPD approval round trip itself (confirmed again tonight). That is a test-coverage gap on a specific workflow, `built-untested` rather than `needs-refinement`. Unchanged from last night.

## Disagreement with the tracker
None — the tracker's own words already match the evidence.

## Note
**Same underlying gap as "Professional Development."** That card's CPD/documents code is this same backend/profile-routes.js — see its folder for a note recommending the team consider merging the two cards.
