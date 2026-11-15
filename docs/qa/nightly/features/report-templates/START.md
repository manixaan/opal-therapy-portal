/opal-critical

## Idea
Report Templates

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
backend/letter-routes.js, backend/templates-routes.js, backend/fca-routes.js,
backend/service-agreements/templates/. Heavily built and tested this window (Support Letter +
Progress Report masters with live preview). CRITICAL-level because these are clinical letters/FCA
reports.

## Start here
This is primarily a hand-check, as the tracker's own next_action says: "Open a client record as a
therapist and run each of the three document flows by hand through to a downloaded file; record the
result." Do that for FCA, Progress Letter and Client Agreement Form, then record the result in
docs/qa/BROWSER_QA_RESULTS.md so future nightly audits pick it up as tab coverage. Only write new code
if the hand-check finds something broken.

## Done means
A docs/qa/BROWSER_QA_RESULTS.md entry (or an e2e spec) exists proving all three document flows produce
a correct downloaded file. Evidence label should move to `proven` once that entry lands.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
