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

### Task notes — "Review Portal Structure" (verbatim from tracker)
"I want you to review the portal structure for my profile TAB in the portal what the features are if they all the buttons and all the things are operational and use a friendly and I laid out in a very I pleasing and intuitive way basically test every single button make sure all the workflows occur this will include the following personal details work locations leave professional development credentials professional development documents notifications then there is this set your work locations for the next 24 hours we're not a reminder and then basically your name and email address so just those few little details need to be kind of outlined in terms of whether they are required do that function as per the intended design and they need to be tested with the owner portal if there are workflows that have a relationship for example approving leave approving PD etc"

(A second note clarifies this is a manual testing task, not documentation: "rather than listing or doing any manual documentation this checklist is to operate and verify the operation of buttons and basically the program so it's for the user to go and do their due diligence so no note taking is required it's just a matter of testing and ver[ifying]")

## Where it lives today
`backend/profile-routes.js`; `PROFILE TAB` in `mockup_v3.html:4325`; UI in `frontend/current/profile.js`. Integration-tested on documents/credentials/leave; no dedicated unit test file for the route handlers themselves.

## Start here
Two independent things, pick either first:
1. **The tracker's own ask** is a human clicking through the tab in a browser (owner + therapist accounts) — not a coding task. That's for a person, not this session.
2. **The coding gap this audit found**: add `backend/tests/profile-routes.test.js` covering the leave/CPD/credential guard boundaries (copy the pattern from a similar route-guard test such as `resource-governance.test.js`), and separately confirm with the team whether the "work locations for next 24 hours" (tracker) vs "next week" (actual UI text in `mockup_v3.html:4325`) mismatch is a wording bug or a tracker misunderstanding.

## Done means
`profile-routes.test.js` exists and passes, exercising at least the leave/cpd/documents/credentials guard boundaries. That moves this card from `needs-refinement` toward `proven` on the coding side; the manual-QA checklist is a separate, human-only "done".

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
