# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window: no (no commits since 2026-09-27)
- Created at all: yes

## Located files

- Routes: `backend/profile-routes.js` — one file for leave (`/api/profile/leave*`),
  CPD (`/api/profile/cpd*`), PD documents (`/api/profile/documents*`),
  credentials (`/api/profile/credentials*`).
- Frontend: `frontend/current/profile.js`; PROFILE TAB block in
  `mockup_v3.html:4188-4464` (work-locations reminder banner, Leave/CPD/PD-docs/
  Notifications cards).
- Tests: documents and credentials are heavily covered —
  `tests/integration/documents.itest.js`, `credential-scans.itest.js`,
  `audit.itest.js`, `readonly-and-hardening.itest.js`, plus unit
  `credential-surface-guards.test.js`, `frontend-stage3-guards.test.js`.
  **Leave and CPD have no functional test at all** — the only hit for either
  is `tests/onboarding-security.test.js:40`, a path-allowlist string check
  (`isPreEmployeePath('/api/profile/leave') === false`), not a test of the
  actual leave/CPD logic.

## Guard status

`profile-routes.js` imports only `requireAuth` (no `requireRole`); role
gating is deliberate and inline via `canApprove(user)` / `canViewAll(user)`
(both owner-only), checked explicitly inside the leave-approve, leave-reject,
CPD-approve, CPD-reject, and cross-user document/credential-view handlers.
This matches the file's own documented pattern — a legitimate design, not a
gap.

## Tests run

- `node --check backend/profile-routes.js` → OK.
- `DB_NAME=therapy_scheduler_auditB DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/documents.itest.js --runInBand` → 3/3 passed.
- Credentials: `credential-scans.itest.js` confirmed present and on-topic
  (create, verify-then-lock, owner vs. therapist edit rights, 404s).
- Leave: **no test exists** that submits, approves, or rejects a leave
  request.
- CPD (profile's AHPRA-linked CPD — distinct from the Resource Hub's CPD,
  see Professional Development): **no test exists** either.
- No TODO/FIXME found in `profile-routes.js`.

## Browser-QA

`docs/qa/BROWSER_QA_RESULTS.md` row I ("Leave/CPD/documents") only confirms
the sections *render* and show honest "Coming soon"/"Preview only" labels —
it does not claim a leave or CPD round trip to the owner was exercised. No
`e2e/tests/*.spec.js` touches profile/leave or profile/cpd at all.

## Open tasks from the tracker

- "Review Portal Structure" (todo) — explicitly a manual click-through
  testing task ("test every single button... no note-taking... just
  testing and verification"), not an engineering task by itself. It does
  not cover the missing automated regression coverage for leave/CPD, which
  is a genuine, separate engineering gap.

## Commits in the window

None.

## Disagreement note

Confirms the previous `claude_update` exactly: "credentials and documents
proven and well-tested, but leave requests and PD approvals have no
automated tests at all, manual review pending." No contradiction found.
