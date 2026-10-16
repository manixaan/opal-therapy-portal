/opal-feature

## Idea
Inductions

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
The everyday induction/learning system is solid, well-tested, and
E2E-proven (`e2e/tests/tutorials.spec.js`). The AI co-author tool
(`backend/induction-assistant-routes.js`) is built, tested, and safely
walled off behind the AI gateway, owner-only — it just hasn't been
confirmed in a browser.

## Start here
Mark "Portal Inductions" and "Splose Inductions" as done in the tracker —
the evidence here (and the tracker's own last Claude update) already
says they're built and tested. Then, as the one remaining gap, log in as
owner in a browser, open the induction builder, and use the AI co-author
button to draft or improve a step; add a Playwright spec or
`docs/qa/BROWSER_QA_RESULTS.md` entry confirming it works and that the
wall between it and clinical data holds.

## Done means
Tracker tasks reflect what's already built, and one browser/E2E check
proves the AI co-author chat works in the induction builder. Evidence
label should reach `proven`.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
