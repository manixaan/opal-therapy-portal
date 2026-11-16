/opal-critical

## Idea
Portal Onboarding Workflow

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
backend/onboarding-routes.js plus 28 other onboarding-*.js files; frontend/current/onboarding.js and
onboarding.html. This is extensively built and tested (653/654 unit tests, 232/232 integration tests
pass). The tracker's three "Stage" tasks have no scope written against them — "Stage 1", "Stage 2" and
"stage 3" are empty titles with no description in the tasks fetched tonight.

## Start here
This is primarily a tracker-hygiene decision for a person, not a coding task: the tracker's own
next_action says "Write real scope for Stage 1/2/3 in the tracker, or close/archive what's already
done." Before any code change, someone on the team needs to open the tracker and say what Stage 1/2/3
actually mean — the code evidence suggests most of what a reasonable Stage 1/2 would need already
exists (onboarding-journey-routes.js, onboarding-pack-routes.js, onboarding-payroll-routes.js all
tested). If real Stage 3 scope emerges, start by reading onboarding-journey.js to find the pattern to
extend.

## Done means
The tracker has real scope (or no Stage 3 card) and, once concrete work is identified, a passing test
under backend/tests/integration/onboarding-*.itest.js proves it. Evidence label should move to `proven`
once the three open tasks are resolved either way.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
