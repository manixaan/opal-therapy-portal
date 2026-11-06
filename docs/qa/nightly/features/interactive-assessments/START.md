/opal-feature

## Idea
Interactive Assessments

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
`backend/whodas-routes.js` + `backend/whodas/` (templates, scoring), `backend/fca-routes.js`,
`backend/assessments-routes.js` + `backend/assessments/` (shared catalogue layer). Frontend
wizard lives inside `frontend/current/mockup_v3.html`. WHODAS is gated off by default via
`ENABLE_WHODAS_ASSESSMENT` in `backend/feature-flags.js`.

## Start here
656 unit tests already pass across 11 suites covering WHODAS scoring, templates, FCA wizard
behaviour and the catalogue — the backend is solid. The gap is proof that a real browser
session can complete the WHODAS wizard end to end. Add an `e2e/tests/whodas-wizard.spec.js`
(Playwright, follow the pattern of a neighbouring `e2e/tests/*.spec.js` file) that logs in as a
therapist, opens a client's assessment tab, starts a WHODAS 2.0 assessment, answers all 36
items, and reaches a completed/scored state. Run it with `ENABLE_WHODAS_ASSESSMENT=true`.

## Done means
The new e2e spec passes locally (`npm run test:e2e:local`, run under `/opal-release`/manually —
not part of this feature task's own validation) and the evidence label moves from
`tab-unproven` to `proven`.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
