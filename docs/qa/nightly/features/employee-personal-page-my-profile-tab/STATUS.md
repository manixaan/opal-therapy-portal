# Employee Personal Page (My Profile Tab)

- Tracker stage: `idea`
- Tracker environment: `none`
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-10-08): no
- Created (any located code at all): yes

## Located

- `backend/profile-routes.js` — every route guarded with `requireAuth`; the leave/CPD approve-reject routes add an inline `canApprove()` check (owner/admin only).
- Frontend: `PROFILE TAB` banner (`mockup_v3.html:4188`), `frontend/current/profile.js`.

## Tests

- Credentials: `tests/credential-extraction.test.js` + `tests/credential-surface-guards.test.js` — **62/62 unit pass**; `tests/integration/credential-scans.itest.js` — **22/22 pass.**
- Leave (`/api/profile/leave*`) and CPD (`/api/profile/cpd*`): **zero unit or integration tests** — no file in `tests/` or `tests/integration/` matches `leave` or `cpd`.
- Browser QA row I: setup card and profile sections render; disabled features read "Preview only — not saved", consistent with leave/CPD submission not being fully wired.

## Open tasks (from the tracker)

Tracker task "Review Portal Structure" is `todo` (a manual click-through review, still open).

## Commits since the last audit that touched it

None — no commits have landed on `develop` under `backend/` or `frontend/current/` since the last audit (2026-10-08). Code audited tonight is the same commit (`aacf8e6`) as the last several nights.

## Disagreement with the tracker

None — tracker stage `idea` matches the real gap.

