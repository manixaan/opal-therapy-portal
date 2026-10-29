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
Induction Playground: `backend/induction-assistant-routes.js` + `frontend/current/induction-assistant.js`. Portal Inductions and Splose Inductions: `backend/learning-routes.js` + `tutorial-routes.js` + `walkthrough-routes.js`, delivered through the My Learning tab (`frontend/current/induction.js`).

## Start here
Only the Induction Playground needs work. Log in as Owner, open the Induction Playground (AI co-author) under Learning/Induction admin, and walk it through building or editing an induction end to end. Add either a new Playwright spec alongside `e2e/tests/tutorials.spec.js` or a dated entry in `docs/qa/BROWSER_QA_RESULTS.md`. Portal Inductions and Splose Inductions need no further code or testing work — only a tracker update, since `tests/integration/learning-admin.itest.js`'s "the Splose induction imports with launchable lessons and a formal close" test and `e2e/tests/tutorials.spec.js`'s walkthrough-lifecycle coverage already prove both end to end.

## Done means
A browser or E2E check exercises the Induction Playground chat tool and confirms it produces a usable induction/walkthrough. Evidence label for that sub-part should move from `tab-unproven` to `proven`.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
