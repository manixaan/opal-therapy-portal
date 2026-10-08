/opal-fast-change

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

(No decisions recorded in the tracker.)

## Where it lives today
- `backend/fca-routes.js`, `backend/letter-routes.js`, `backend/templates-routes.js` +
  `backend/templates/service-agreement-map.js`
- Frontend: hidden Resource Hub entry points in `mockup_v3.html`, rendered by `fca.js`/`letter.js`/`templates.js`

## Start here
Before building anything, confirm with the team whether "Client Agreement Form" means the existing Service
Agreement template (`backend/templates-routes.js`, `backend/templates/service-agreement-map.js`) or something new
— there is no code under the literal name "Client Agreement Form" anywhere in the repo. FCA and Progress Letter
are already built and tested; the only concrete next step for them is browser/e2e proof, not more backend work.

## Done means
Team confirms the Client Agreement Form mapping, and a browser check or e2e spec is added proving the FCA/Letter
builder pages render and generate a document. Existing suites
(`npx jest tests/fca-docx-engine.test.js tests/letter-docx-engine.test.js tests/templates-routes.test.js`) should
keep passing. Evidence label should move from tab-unproven to proven once that browser/e2e proof lands.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
