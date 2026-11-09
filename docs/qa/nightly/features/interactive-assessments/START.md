/opal-critical

**Idea:** Interactive Assessments
**Why:** (not yet written in the tracker)
**Who uses it:** (not yet written in the tracker)
**What they see:** (not yet written in the tracker)
**What should happen:** (not yet written in the tracker)
**Outcome:** (not yet written in the tracker)
(No recorded decisions.)

## Where it lives today

`backend/fca-routes.js`, `backend/whodas-routes.js`, `backend/assessments-routes.js`, `backend/fca/`, `backend/whodas/`, `backend/assessments/`; frontend overlay `frontend/current/assessment.js` + instrument pages `fca.js`/`whodas.js`. Guarded, 738 unit + 122 integration tests pass — all clinical/data logic is proven. Only the browser rendering is unproven.

## Start here

Add a Playwright case under `e2e/tests/` that opens a client's Assessment Review from the client workspace, loads `frontend/current/assessment.js`'s overlay, answers an instrument (FCA or WHODAS), and asserts the saved result. Use `backend/tests/assessment-surface-guards.test.js` to see which endpoint triggers the overlay. Add the result to `docs/qa/BROWSER_QA_RESULTS.md`.

## Done means

The new Playwright spec passes and a `docs/qa/BROWSER_QA_RESULTS.md` entry records it → evidence label `proven`.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
