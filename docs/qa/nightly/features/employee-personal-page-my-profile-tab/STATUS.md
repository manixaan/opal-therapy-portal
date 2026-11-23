# Employee Personal Page (My Profile Tab)

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **built-untested**
- Addressed since the last audit (2026-11-22..2026-11-23): **no**
- Created (any located code): **yes**

## Located files
- backend/profile-routes.js (leave, cpd, documents, credentials)
- frontend tab: PROFILE TAB (mockup_v3.html)

## Guard check
OK functionally — requireAuth router-wide plus an inline canApprove(req.user) role check on the leave/cpd approve-reject routes (lines ~124-125, 154-155), re-confirmed tonight. Style note: this is an inline check rather than the requirePermission() convention backend-api.md prefers; not a missing guard.

## Tests run
- unit: `credential-surface-guards.test.js, security.test.js, smart-route-backend.test.js, onboarding-security.test.js` — **pass** (4 files / 94 tests, re-run fresh tonight)
- integration: none found that exercises /api/profile/leave or /api/profile/cpd (re-confirmed by fresh grep tonight; no hits at all this time — not even the prior nights' incidental `scheduler-availability.itest.js` hit surfaced in this grep) — **no test exists** (—)

## Tab / browser proof
PROFILE TAB exists; no E2E spec. **New tonight**: `docs/qa/BROWSER_QA_RESULTS.md` row I ("Leave/CPD/documents", dated 2026-08-01, missed by prior audit nights) does exist and is nominally about this tab — but it only confirms the setup card and profile sections render and that *disabled* features honestly read "Coming soon"/"Preview only — not saved" rather than faking success. It does not exercise the leave/CPD approval round trip itself, and predates whatever current state `backend/profile-routes.js` is in — so it does not move this label toward `proven`, but it is worth citing as the closest thing to tab-level evidence that exists.

## Recency
Not touched since the last audit — tonight was the quietest window this audit has seen: **zero commits** landed in `backend/` or `frontend/current/` between 18:13 UTC 2026-11-22 (last audit) and tonight's run.

## Open tasks (from the tracker)
- Review Portal Structure — todo

## Reason for the label
Code is built, guarded, and used by real people, but no test — unit or integration — exercises the leave/CPD approval round trip itself (confirmed again tonight). That is a test-coverage gap on a specific workflow, `built-untested` rather than `needs-refinement`. Unchanged from last night, now confirmed nine nights running.

## Disagreement with the tracker
None — the tracker's own words already match the evidence.

## Note
**Same underlying gap as "Professional Development."** That card's CPD/documents code is this same backend/profile-routes.js — see its folder for a note recommending the team consider merging the two cards.
