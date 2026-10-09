/opal-feature

# Employee Personal Page (My Profile Tab)

**Idea**

Employee Personal Page (My Profile Tab)

**Why**

(not yet written in the tracker)

**Who uses it**

(not yet written in the tracker)

**What they see**

(not yet written in the tracker)

**What should happen**

(not yet written in the tracker)

**Outcome**

(not yet written in the tracker)

**Decision**

(not yet written in the tracker)

## Where it lives today

- `backend/profile-routes.js` — every route guarded with `requireAuth`; the leave/CPD approve-reject routes add an inline `canApprove()` check (owner/admin only).
- Frontend: `PROFILE TAB` banner (`mockup_v3.html:4188`), `frontend/current/profile.js`.

## Start here

Open `backend/tests/credential-extraction.test.js` as the pattern and write an equivalent round-trip test for `backend/profile-routes.js`'s leave endpoints (`POST /api/profile/leave`, then `PATCH /api/profile/leave/:id/approve` as an owner, then `PATCH .../reject`). Do the same for `/api/profile/cpd*`. That closes the biggest gap here.

## Done means

A passing leave-request and CPD-approval round-trip test in a new `tests/profile-routes.test.js` (or `tests/integration/profile.itest.js`) — label would move toward `proven` once the manual review task also closes.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
