/opal-feature

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
(none recorded in the tracker)

## Where it lives today
`backend/onboarding-defaults-routes.js`, `backend/onboarding-pack-db.js`, `backend/onboarding-payroll.js`, `backend/onboarding-induction.js`, integration tests `backend/tests/integration/onboarding-defaults.itest.js` and `backend/tests/integration/onboarding-induction.itest.js` (both now passing). Frontend: `frontend/current/onboarding-journey.js` (`?v=72`).

## Start here
Both regressions from the last two nightly audits are fixed as of commit `4c174b5` and confirmed by a fresh test run tonight — no code fix is needed here. What's missing is a browser or E2E proof of the fixed flow: walk through the Edit Onboarding → package defaults view and the Payroll Setup screen (all rows ready → status reaches "Ready for review") as an admin, using a scratch employee record. Record the result as a new `docs/qa/BROWSER_QA_RESULTS.md` entry or an `e2e/tests/*.spec.js` spec, modelled on the existing onboarding flow C entry.

## Done means
A fresh browser or E2E proof exists for the package-defaults view and the payroll-status screen. Evidence label should reach `proven`.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
