# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (2026-11-13 to 2026-11-14): no
- Created at all: yes, but the card is ambiguous about which of two real
  subsystems it means

## Located files

Two candidate subsystems, both real and both built:

1. **Admin PD-events catalogue + org CPD tracking** —
   `backend/resource-hub-r2-routes.js` (`/api/rh2/pd`, `/api/rh2/pd/catalogue`,
   `/api/rh2/cpd` and their `:id` variants), UI in
   `frontend/current/resourcehub.js`. Unit test:
   `tests/pd-catalogue-guards.test.js` (46 tests). Integration:
   `tests/integration/resource-hub-r2.itest.js`.
2. **Employee's own CPD/documents** (also the subject of the "Employee
   Personal Page" feature) — `backend/profile-routes.js`
   (`GET/POST /api/profile/cpd`, approve/reject, plus the
   professional-development side of `/api/profile/documents`), UI in
   `frontend/current/profile.js`. No test exercises `/api/profile/cpd` at
   all (confirmed — zero matches for the literal string across every test
   file).

## Guard check

`resource-hub-r2-routes.js`: `router.use('/api/rh2', requireAuth, ...)`
plus inline `canAuthor`/role checks on writes. `profile-routes.js`:
`requireAuth` + inline `canApprove(user)` (`role === 'owner'`) on
approve/reject. No missing guard on either reading.

## Tests run

- Subsystem 1 (rh2 PD/CPD catalogue): `tests/pd-catalogue-guards.test.js`
  — 46/46 passed. `tests/integration/resource-hub-r2.itest.js` — passed
  as part of the Clinical resources run tonight (168/168).
- Subsystem 2 (`/api/profile/cpd`): zero tests found, either direction.

## Recency

Not touched in the change window (since the 2026-11-13 audit).

## Classify

`tab-unproven`. Under the first reading (the admin PD catalogue), code is
built, guarded and unit-tested — but no browser/E2E proof exists either
way. Under the second reading (`/api/profile/cpd`), there is zero test
coverage at all. Either way, nothing proves the relevant page renders
correctly for a user.

## Open tasks (from tracker)

None recorded — the card has no tasks.

## Commits in the window touching this

None.

## Disagreement

The ambiguity itself is worth raising with the team: this card could mean
either the admin-side PD-events catalogue (built, unit-tested, no browser
proof) or the employee's own CPD section of My Profile (built, zero test
coverage). Recommend clarifying in the tracker, or splitting/merging the
card with "Employee Personal Page" if it means the CPD section
specifically.
