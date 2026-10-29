/opal-critical

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
`backend/fca-routes.js`, `backend/whodas-routes.js`, `backend/assessments-routes.js`, `backend/letter-routes.js`. Frontend: `frontend/current/fca.js`, `whodas.js`, `assessment.js`, `letter.js` (mounted as overlays, not a tab). This is clinical data — CRITICAL level.

## Start here
Open the assessment wizard in a browser as a therapist: start an FCA or WHODAS assessment from the NDIS case flow, complete it, and confirm it produces a document. Add either a Playwright spec or a dated `docs/qa/BROWSER_QA_RESULTS.md` entry. All backend logic already passes its tests — this is purely about proving the UI end to end.

## Done means
A browser or E2E check confirms the assessment wizard completes and produces a document. Evidence label should move from `tab-unproven` to `proven`.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
