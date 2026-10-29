# Employee Personal Page (My Profile Tab)

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed since the last audit: **no** — develop has not moved since last night's audit (2026-10-28, also commit `15acf0c`); tonight's true window is empty. `profile-routes.js` was touched by `74444eb` and `frontend/current/profile.js` by `a968e90` over the preceding fortnight (historical context, not tonight) — neither addresses the leave/CPD gap below.
- Created (any located code): yes.

## Located

`backend/profile-routes.js` (56KB) — full My Profile backend: leave (`/api/profile/leave*`), CPD (`/api/profile/cpd*`, same System B as the Professional Development card), documents (`/api/profile/documents*`), credentials (`/api/profile/credentials*`, scans/extraction), work-schedule, notification-prefs, setup-status, credential-reminder dismiss. Frontend: `frontend/current/profile.js`. Tab banner: `PROFILE TAB` (`mockup_v3.html:4307`).

## Guard check

`requireAuth` on every route; leave/CPD approve/reject/view-all gated by inline `canApprove`/`canViewAll` (owner-only) rather than `permissions.js` middleware — a convention deviation, not a missing guard (functions correctly). Document download/delete checks `doc.user_id !== req.user.id && !canViewAll(req.user)` inline — same note applies.

## Tests and results

Credentials and documents sections are covered indirectly through `tests/credential-surface-guards.test.js`, `tests/smart-route-backend.test.js`, and integration files `documents.itest.js`, `credential-scans.itest.js`, `stage2-pilot-readiness.itest.js`, `readonly-and-hardening.itest.js`, `audit.itest.js` (all `require`/exercise `profile-routes.js`, mostly for documents/credentials paths).

**Leave and CPD submit→approve→reject: no dedicated test anywhere.** Confirmed by grep across all unit and integration test files for `/api/profile/leave` and `/api/profile/cpd` as an actual HTTP call target — zero hits. The one `/api/profile/leave` string match found (`tests/onboarding-security.test.js`) is a path-allowlist unit assertion (`isPreEmployeePath`), never an endpoint call.

## Relevant commits (historical — predate last night's audit, not new tonight)

See above — neither commit addresses leave/CPD, and both are already several audit cycles old.

## Open tracker tasks

`[todo]` Review Portal Structure — still open, no evidence in code or commits that this was ever addressed.

## Disagreement / notes

Agree with the prior claude_update: credentials/documents/work-location sections have real (if indirect) test coverage; the leave + CPD submit→approve→reject round trip genuinely has none.
