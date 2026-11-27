/opal-feature

## Idea

Portal - Splose - Outlook | Integration Works

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

## Task notes, verbatim (Multi Calendar Rules)

"This task confirms the booking workflow we have designed is actually in operation and
working. We use what already exists: the Portal schedule, its link to Splose, and the Outlook
calendar feed. We check bookings, travel time, the save-versus-sync marker, and the two-way
match, then stress test with real-world examples."

"at the current point of our design we have people booking their sessions on our portal
portal then posts those sessions onto explosives essentially is the Certified Body to hold all
the NDIS compliance regulations and rules it is through explosively attach case notes the
portal is essentially a way in which you can shift around and move and and figure out your
schedule from a weekly point of view whenever you pick a new client and create a session it
automatically calculates the tremble from the home base of that allocated day to the session
and then if you don't assign the next session it just assumes you're going back home say for
example you have a session straightaway afterwards you can click on the return travel and
click onto a next client and it should Auto calculate the next time travel to the next session
this tool is still in the testing phase and needs to be rigorously tested for usability and
for ensuring that the workflow correctly posts things in other words every single time you
change something in the portal there should be an indication saying that these changes are
saved in the portal yet are not synced into explosives so that you can do multiple changes and
then with one click right them all the design is not to allow a use it to make the
appointments on splits but in the case that it does happen so someone does at the other way
around the system should work itself out and rethink to make sure that both in Outlook sorry
I'll look close and the portal are the exact same Outlook is essentially is kind of the third
calendar in all of this where it will just sink to the portal and grab that portal information
you may you know add your personal information or meetings but we haven't yet decided what the
Outlook calendar may look like in terms of things so that's the current workflow rules I want
you to kind of document them as checkpoints to confirm the workflow that is built and stress
test we've different types of examples to see and which case where the calendars will fail
where the calendar might have a bug
---
I just want rather than just the right down confirmed workflow rules in planning English I
don't want the user to just write down necessary crap I want you to state what the workflow
should be so that point needs to be more directive rather than exercise for someone to write
down okay because we're telling them what to do rather than them telling us
---
I do not want the state workflow ruled as single plane English reference that's not a to-do
list it's more just we need to confirm that whatever we are designing is in operation and
working
---
simplify this to high-level concepts"

## Where it lives today

`backend/calendar-routes.js`, `backend/travel-routes.js`, `backend/travel-sync-routes.js`,
`backend/travel-outlook-sync.js`, `backend/travel-feasibility.js`, `backend/travel-cascade.js`,
`backend/splose-sync-routes.js`, `backend/splose-link-routes.js`, `backend/splose-poller.js`,
`backend/splose-api.js`, `backend/splose-match.js`, `backend/splose-credentials.js`,
`backend/outlook-oauth.js`, `backend/outlook-embed.js`. Calendar tab at
`mockup_v3.html:5231`. All guarded, 41 unit files (598 tests) and 10 integration files
(79 tests) pass tonight.

## Start here

The individual mechanics (saved-vs-synced, two-way match, travel time) already have passing
unit/integration tests (`splose-draft-sync.test.js`, `splose-match.test.js`,
`travel-feasibility.test.js`). What's missing is one place that proves them together, the way
the checklist describes. Copy the pattern in `tests/integration/splose-draft-sync.itest.js`
and add a single integration test that: creates a booking, edits it (asserts a "saved not
synced" state), syncs it, and confirms the Portal and Splose records match — this is the
smallest piece of the checklist a Claude Code session can actually prove. Then a human still
needs to open the live Calendar tab and stress-test real-world scheduling scenarios by hand —
that part has no automated substitute.

## Done means

A new integration test exercises the saved-not-synced → sync → two-way-match sequence end to
end and passes, and a person has walked the remaining "Confirm travel time", "Decide what
Outlook should show" and stress-test items on the live Calendar tab.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
