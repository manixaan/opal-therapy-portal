/opal-critical

**Idea:** Report Templates
**Why:** (not yet written in the tracker)
**Who uses it:** (not yet written in the tracker)
**What they see:** (not yet written in the tracker)
**What should happen:** (not yet written in the tracker)
**Outcome:** (not yet written in the tracker)
(No recorded decisions.)

## Where it lives today

`backend/templates-routes.js`, `backend/fca-routes.js`, `backend/letter-routes.js`, `backend/service-agreements/`, `backend/fca/`; frontend `frontend/current/templates.js` inside the Resource Hub Library. Guarded, 369 unit + 88 integration tests pass. Only the browser rendering of the Templates screen itself is unproven.

## Start here

Add a Playwright spec under `e2e/tests/` that logs in as a therapist, opens the Resource Hub → Templates surface (the `RESOURCES TAB` block in `mockup_v3.html`), picks a client, generates an FCA report or progress letter, and asserts the resulting document download. Copy the login/role setup from `e2e/tests/tutorials.spec.js`. Add the result to `docs/qa/BROWSER_QA_RESULTS.md`.

## Done means

The new Playwright spec passes and a `docs/qa/BROWSER_QA_RESULTS.md` entry records it → evidence label `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
