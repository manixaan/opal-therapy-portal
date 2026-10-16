Feature: Professional Development
Tracker stage: idea
Tracker environment: none
Evidence label: needs-refinement
Addressed in change window (2026-10-02 to 2026-10-16): no
Created (any located code): yes

## Located files
The tracker card doesn't say which PD system it means — there are two:
1. My Profile CPD: `backend/profile-routes.js` `GET/POST /api/profile/cpd`,
   `PATCH /api/profile/cpd/:id/approve|reject` — `requireAuth` + inline
   `canApprove()` check on the approval routes.
2. Resource Hub CPD tracker: `backend/resource-hub-r2-routes.js`
   `/api/rh2/cpd` — self-scoped by user_id, documented in the file's header
   as "every role" by design (PROMPT.md's self-scoped exception applies).
A third, related thing also exists: a "PD catalogue" of CPD events/courses
inside the Resource Hub, guarded by `tests/pd-catalogue-guards.test.js`.

## Guard check
Pass on both systems (see above — My Profile CPD guarded + inline approver
check; Resource Hub CPD self-scoped by design).

## Tests run
- Unit: `tests/pd-catalogue-guards.test.js` → 1 suite / 46 tests, PASS
- Integration (`DB_NAME=therapy_scheduler_audit`): `resource-hub-r2.itest.js`
  → 1 suite / 33 tests, PASS (covers `/api/rh2/cpd` CRUD, cross-user 404s,
  yearly summary)
- **Zero test coverage found anywhere** (grepped all of `tests/` and
  `tests/integration/`) for My Profile's `/api/profile/cpd` or
  `/api/profile/leave` routes.

## Browser / E2E evidence
None found for either CPD system, or for the My Profile tab's leave/CPD
approval flow specifically.

## Open tasks from tracker
None recorded against this feature.

## Commits in window touching this feature
None.

## Disagreement with tracker
None. Tracker stage `idea` doesn't overclaim.
