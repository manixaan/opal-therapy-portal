/opal-feature

**Idea**
Employee Personal Page (My Profile Tab)

**Why** / **Outcome**
(not yet written in the tracker)

**Who uses it** / **What they see** / **What should happen**
(not yet written in the tracker)

No decisions recorded. Task notes ("Review Portal Structure", verbatim,
abridged): "test every single button make sure all the workflows occur...
personal details work locations leave professional development
credentials professional development documents notifications... set your
work locations for the next 24 hours... tested with the owner portal if
there are workflows that have a relationship for example approving leave
approving PD etc" — followed by: "no note taking is required it's just a
matter of testing and ver[ification]".

## Where it lives today

`backend/profile-routes.js` (leave/CPD/documents/credentials/work-schedule/
notifications), `frontend/current/profile.js` and the `PROFILE TAB` markup
in `mockup_v3.html`. The People register is `frontend/current/employees.js`
+ `onboarding-routes.js`/`onboarding-employee-routes.js`. See STATUS.md for
test results (all pass except one known sandbox-only false failure).

## Start here

This tracker task is a manual click-through, not code — someone needs to
walk My Profile end to end on a real account and confirm each section
against the tracker's list. One thing to correct before that walkthrough:
the tracker expects a 24-hour reminder for setting work locations; the
actual code (`runLocationAlarmCheck` in `backend/server.js`) only fires on
Fridays for the coming week — either update the tracker's expectation or
raise whether the original 24-hour design is still wanted.

## Done means

The tracker's own checklist, worked through by a person, with results
recorded back in the tracker (not in this repo). If the team wants
automated proof instead, an E2E spec walking My Profile's leave/CPD
sections would be the natural next step.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
