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
- WHODAS 2.0 engine: `backend/whodas-routes.js` + `backend/whodas/`, frontend `whodas.js`/`whodas.css`
- Assessment catalogue/tab: `backend/assessments-routes.js` + `backend/assessments/`, frontend `assessment.js`/`assessment.css`

## Start here
The tracker's only open task here ("Assessment Review") is a human job for Ann — sorting the Assessment tab's other listed assessments into keep/remove and sourcing originals — not a coding task; a Claude Code session should leave that alone. The coding-side gap is proof: open the WHODAS wizard in a browser as a therapist, run one assessment from a client record through to a completed document, and record it in `docs/qa/BROWSER_QA_RESULTS.md`. Copy the supertest setup in `tests/integration/whodas.itest.js` if you'd rather add an E2E spec under `e2e/tests/` instead.

## Done means
A `docs/qa/BROWSER_QA_RESULTS.md` row (or new E2E spec) showing the WHODAS wizard completes end to end in a browser. Evidence label should then move from `tab-unproven` to `proven`.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
