/opal-critical

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

## Task notes, verbatim (Review Portal Structure)

"I want you to review the portal structure for my profile TAB in the portal what the features
are if they all the buttons and all the things are operational and use a friendly and I laid
out in a very I pleasing and intuitive way basically test every single button make sure all
the workflows occur this will include the following personal details work locations leave
professional development credentials professional development documents notifications then
there is this set your work locations for the next 24 hours we're not a reminder and then
basically your name and email address so just those few little details need to be kind of
outlined in terms of whether they are required do that function as per the intended design and
they need to be tested with the owner portal if there are workflows that have a relationship
for example approving leave approving PD etc
---
rather than listing or doing any manual documentation this checklist is to operate and verify
the operation of buttons and basically the program so it's for the user to go and do their due
diligence so no note taking is required it's just a matter of testing and ver"

## Where it lives today

`backend/profile-routes.js`, Profile tab at `mockup_v3.html:4660`, `frontend/current/profile.js`.
Correctly owner-gated for approvals. 399 guard-only unit tests and 5 of 6 integration files
pass clean (the 6th has one failing test that is a root/chmod environment artifact, not a code
defect).

## Start here

Open `backend/profile-routes.js` and find the leave approve/reject and CPD approve/reject
routes. Add an integration test, following the pattern in
`tests/integration/stage2-pilot-readiness.itest.js`, that: submits a leave request as a
therapist, approves it as the owner, and confirms the therapist's view shows the updated
status — then do the same for a CPD credential/document submission. This is the exact round
trip the tracker's own checklist asks a human to verify by hand; proving it with a test first
makes that walkthrough much faster and catches regressions going forward.

## Done means

New integration tests exercise `/api/profile/leave/:id/approve`, `/reject`,
`/api/profile/cpd/:id/approve` and `/reject` end to end and pass.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
