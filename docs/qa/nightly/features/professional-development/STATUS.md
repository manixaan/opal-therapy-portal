# Professional Development

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **built-untested**
- Addressed since the last audit (2026-11-25..2026-11-26): **no**
- Created (any located code): **yes**

## Located files
- My Profile tab's CPD section (frontend/current/mockup_v3.html — "Professional Development Documents" card) backed by backend/profile-routes.js's `/api/profile/cpd`, `/api/profile/documents` and `/api/profile/credentials` routes
- frontend/current/profile.js and frontend/current/induction-modules.js (a walkthrough step named "Professional Development (CPD)")

## Could not locate / notable gaps
No dedicated, standalone "Professional Development" tab or page exists — it lives inside My Profile's CPD section, not as its own card.

## Guard check
OK — backend/profile-routes.js is requireAuth router-wide + inline canApprove(req.user) on the approve/reject routes (lines ~124-125, 154-155).

## Tests run
- unit: the same 4 files that cover profile-routes.js generally — `credential-surface-guards.test.js, security.test.js, smart-route-backend.test.js, onboarding-security.test.js` — **pass** (4 files / 94 tests, re-run fresh tonight), but none of these test the CPD routes specifically; they are indirect/partial coverage (credentials, work-schedule scoping, leave route existence).
- integration: no test exercises `/api/profile/cpd` specifically — confirmed by a fresh grep tonight (no hits) — **no test exists** (—)

## Tab / browser proof
Resource Hub has E2E proof (portal.spec.js) but that is a different subsystem. **Found 2026-11-23**: `docs/qa/BROWSER_QA_RESULTS.md` row I ("Leave/CPD/documents", dated 2026-08-01) covers the same My Profile tab this card's CPD section lives in, but only confirms the sections render and disabled features honestly read "Coming soon"/"Preview only — not saved" — it does not exercise the CPD round trip itself, so it does not prove this feature specifically.

## Recency
Not touched since the last audit. Ten commits landed elsewhere in the repo tonight (2026-11-26, see the brief's "What changed since last audit") — none touched this subsystem's files.

## Open tasks (from the tracker)
(no tasks recorded on this card)

## Reason for the label
Confirmed again tonight as `built-untested` (reclassified from `tab-unproven` on 2026-11-20 once a fresh grep resolved the location: it is concretely the CPD section of the My Profile tab, backed by backend/profile-routes.js). No test — unit or integration — exercises the `/api/profile/cpd` round trip itself, which is exactly the `built-untested` definition (code located and guarded, but no test exercises it) rather than a tab-proof gap on tested code.

## Disagreement with the tracker
None beyond the location correction above — the tracker's own next_action ("decide whether this card merges into Resource Hub or My Profile") is now answered by the code: it already lives in My Profile.

## Note
**Worth a decision, not more test-chasing first:** this card's underlying code and test gap (no CPD/leave round-trip test) is the *same* gap already tracked under "Employee Personal Page (My Profile Tab)" feature 83bb9988-52ba-4f8c-85ba-7b65aca189b2. The team may want to merge these two tracker cards, or at minimum have one integration test satisfy both.
