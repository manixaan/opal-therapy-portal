/opal-feature

## Idea
Employee Personal Page (My Profile Tab)

## Why
(not yet written in the tracker)

## Who uses it
(not yet written in the tracker)

## What they see
(not yet written in the tracker)

## What should happen
(not yet written in the tracker)

## Outcome
(not yet written in the tracker)

## Decisions
(none recorded)

## Where it lives today
`backend/profile-routes.js` (personal details, work locations, leave, CPD, documents/credentials, notifications), `frontend/current/profile.js`, `PROFILE TAB` in `mockup_v3.html`.

## Start here
Open `backend/profile-routes.js` and find the leave-request and CPD submit/approve/reject handlers (`canApprove` gate). Add a new test file `backend/tests/integration/profile-leave-cpd.itest.js` that: submits a leave request as a therapist, approves it as owner, confirms the therapist sees the updated status; repeats the same round trip for a CPD submission, including a reject path. Copy the supertest-against-the-mounted-router pattern from `backend/tests/integration/resources.itest.js`.

Separately: re-run `backend/tests/integration/readonly-and-hardening.itest.js` on a non-root CI runner (not this sandbox) to confirm whether the D-6/D-7 storage-failure test genuinely passes there; if it still fails, that is a real defect in `profile-routes.js`'s document-upload error handling.

## Done means
`npx jest --config jest.integration.config.js tests/integration/profile-leave-cpd.itest.js --runInBand` passes, covering submit→approve and submit→reject for both leave and CPD. Evidence label should then reach `proven`.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
