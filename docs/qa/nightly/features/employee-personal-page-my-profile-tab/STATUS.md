# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window: **no** — zero commits since 2026-10-07 touching `backend/` or `frontend/current/`.
  Eighth consecutive reconfirmation night.
- Created (any located code at all): **yes**

## Located files
- `backend/profile-routes.js` — leave requests (`/api/profile/leave*`), CPD (`/api/profile/cpd*`), credentials
  and PD documents, work-schedule and notification-prefs
- Frontend: `<!-- PROFILE TAB -->` (mockup_v3.html:4188, `id="view-profile"`), `frontend/current/profile.js`

## Guard check
Every route uses `requireAuth`; approve/reject/verify endpoints additionally check `canApprove(req.user)` inline
(owner-only — admin explicitly excluded per a documented 2026-08-06 RBAC decision in the file, re-read directly
tonight), not a composed `requirePermission`/`requireRole` middleware. This is the same house pattern as
`resource-hub-r2-routes.js`'s `canAuthor` check (see Professional Development) and has been reviewed on every
prior audit night without a gap: PATCH on another user's credential returns 404 not 403 (anti-enumeration),
cross-user document access is audit-logged, and the role check is correctly enforced even though it lives inside
the handler rather than in the route's middleware array. No gaps found.

## Tests run tonight
- unit: `credential-surface-guards.test.js` (run as part of the 12-file Resource Hub batch, see
  Clinical resources / Professional Development) — no dedicated test exercises the leave or CPD request/approve
  endpoints at all, confirmed again tonight by grepping for `profile/leave` and `profile/cpd` across every unit
  test file
- integration: no dedicated integration test for leave/CPD either — `audit.itest.js, credential-scans.itest.js,
  documents.itest.js, onboarding-returns.itest.js, readonly-and-hardening.itest.js, stage2-pilot-readiness.itest.js`
  reference `profile-routes`/`/api/profile/` only for credentials/documents paths, confirmed by grepping those
  files for "leave" or "cpd" (no matches)

## Open tasks (from the tracker)
- Review Portal Structure — build, todo

## Compare with the tracker
None. This matches the tracker's own `claude_update` exactly: leave requests and CPD activities have zero
automated test coverage, and the manual click-through QA task ("Review Portal Structure") is still open.
Credentials specifically are the one well-tested sub-area (see Resource Hub batch, 12 skipped tests noted there).
