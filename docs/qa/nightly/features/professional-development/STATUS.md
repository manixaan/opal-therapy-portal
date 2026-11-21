# Professional Development

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **built-untested**
- Addressed since the last audit (2026-11-20..2026-11-21): **no**
- Created (any located code): **yes**

## Located files
- My Profile tab's CPD section (frontend/current/mockup_v3.html — "Professional Development Documents" card) backed by backend/profile-routes.js's `/api/profile/cpd`, `/api/profile/documents` and `/api/profile/credentials` routes
- frontend/current/profile.js and frontend/current/induction-modules.js (a walkthrough step named "Professional Development (CPD)")
- **Tonight's finding corrects last night's framing**: this card is not an open two-way choice between Resource Hub and My Profile — a fresh grep tonight found concrete, named "Professional Development" UI inside the My Profile tab's CPD section. That is its real home.

## Could not locate / notable gaps
No dedicated, standalone "Professional Development" tab or page exists — it lives inside My Profile's CPD section, not as its own card.

## Guard check
OK — backend/profile-routes.js is requireAuth router-wide + inline canApprove(req.user) on the approve/reject routes (lines ~124-125, 154-155).

## Tests run
- unit: the same 4 files that cover profile-routes.js generally — `credential-surface-guards.test.js, security.test.js, smart-route-backend.test.js, onboarding-security.test.js` — **pass** (4 files / 94 tests), but none of these test the CPD routes specifically; they are indirect/partial coverage (credentials, work-schedule scoping, leave route existence).
- integration: no test exercises `/api/profile/cpd` specifically — confirmed by a fresh grep tonight (the only incidental hit, `scheduler-availability.itest.js`, inserts a `leave_requests` row for an unrelated availability-blocking test, not a CPD/PD round trip) — **no test exists** (—)

## Tab / browser proof
Resource Hub has E2E proof (portal.spec.js) but that is a different subsystem; there is still no dedicated "Professional Development" tab/page proof under its real home (My Profile).

## Recency
Not touched since the last audit (2026-11-20) — none of the 77 commits that landed in `backend/` or `frontend/current/` between 18:52 UTC 2026-11-20 and tonight's audit touched `backend/profile-routes.js` or the CPD section (that window was calendar/booking/travel/Splose-sync and invoicing/billing/Xero work only).

## Open tasks (from the tracker)
(no tasks recorded on this card)

## Reason for the label
Confirmed again tonight as `built-untested` (reclassified from `tab-unproven` on 2026-11-20 once a fresh grep resolved the location: it is concretely the CPD section of the My Profile tab, backed by backend/profile-routes.js). No test — unit or integration — exercises the `/api/profile/cpd` round trip itself (only unrelated/incidental hits), which is exactly the `built-untested` definition (code located and guarded, but no test exercises it, or the only tests are unrelated) rather than a tab-proof gap on tested code.

## Disagreement with the tracker
None beyond the location correction above — the tracker's own next_action ("decide whether this card merges into Resource Hub or My Profile") is now answered by the code: it already lives in My Profile.

## Note
**Worth a decision, not more test-chasing first:** this card's underlying code and test gap (no CPD/leave round-trip test) is the *same* gap already tracked under "Employee Personal Page (My Profile Tab)" feature 83bb9988-52ba-4f8c-85ba-7b65aca189b2. The team may want to merge these two tracker cards, or at minimum have one integration test satisfy both.
