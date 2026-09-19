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
(none recorded in the tracker)

## Where it lives today
Two candidates, unchanged since the last several audits: `frontend/current/employees.js` (the People register, under More → People) and `frontend/current/profile.js` + `backend/profile-routes.js` (the pre-existing My Profile tab). See STATUS.md for why both are reported.

## Start here
First, clarify with the practice which surface this card is actually about — the title's parenthetical points at My Profile, but the most recently built surface is the People register. Once that's settled: if it's the People register, add a browser check or E2E spec proving the Employees tab renders and a profile opens; if it's My Profile, do the same for `#view-profile`. Either way there is no dedicated test file yet — start one named for whichever surface is confirmed.

## Done means
A clarified target in the tracker, plus either a passing E2E spec or a fresh `docs/qa/BROWSER_QA_RESULTS.md` entry for that tab. Evidence label should reach `proven`.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
