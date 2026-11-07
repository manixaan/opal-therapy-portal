/opal-critical

# Employee Personal Page (My Profile Tab)

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
(not yet written in the tracker)

## Where it lives today
- backend/profile-routes.js (Leave requests, CPD/professional development activities, professional development documents, Credentials)
- mockup_v3.html: PROFILE TAB (line 4323)

## Start here
Add backend/tests/profile-routes.test.js (supertest against the mounted router, the house pattern — see case-note-routes.test.js for the idiom). Cover: a therapist submitting and viewing only their own leave requests, and an owner/admin approving/rejecting someone else's — assert the 403 path for a therapist who tries to approve, not only the happy path.

## Done means
backend/tests/profile-routes.test.js passes and asserts both the 200 and 403 paths on leave approve/reject, moving the label to proven.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
