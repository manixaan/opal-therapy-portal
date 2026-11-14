/opal-feature

**Idea:** Report Templates

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

No decisions recorded yet.

**Tasks:** FCA, Progress Letter, Client Agreement Form — no task-level
explanation recorded in the tracker for any of the three.

## Where it lives today

`backend/fca-routes.js`, `backend/letter-routes.js`,
`backend/templates-routes.js`, `backend/templates/catalogue.js` (maps all
three document kinds to their masters), `frontend/current/fca.js` /
`letter.js` / `templates.js`. 626 unit + 123 integration tests pass.

## Start here

The engine is built and tested; nobody has proven it in a browser. Sign in
as a therapist, open a client's record, and run all three flows by hand:
complete an FCA, complete a Progress Letter, complete a Service Agreement —
each through to a downloaded `.docx`/`.pdf`. Follow the pattern in
`tests/integration/templates.itest.js` for what each flow's API calls look
like, then write one Playwright spec per flow (or one that covers all
three) under `e2e/tests/`, following `e2e/tests/tutorials.spec.js` as the
house style.

## Done means

A new E2E spec (or a recorded `docs/qa/BROWSER_QA_RESULTS.md` entry) proves
each of the three document types renders and exports correctly in a real
browser. Target label: `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
