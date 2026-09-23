/opal-feature

**Idea**
Report Templates

**Why**
(not yet written in the tracker)

**Who uses it**
(not yet written in the tracker)

**What they see**
(not yet written in the tracker)

**What should happen**
(not yet written in the tracker)

**Outcome**
(not yet written in the tracker)

No decisions recorded. Tasks (FCA, Progress Letter, Client Agreement Form)
have no notes or checklist recorded in the tracker — this feature's real
detail lives entirely in the codebase, not in tracker text.

## Where it lives today

`backend/fca-routes.js`, `backend/letter-routes.js`, `backend/templates-routes.js`,
the shared `backend/fca/` engine, and `backend/templates/` (Service
Agreement lives here as a template id, not its own route file). Frontend:
`frontend/current/fca.js`, `letter.js`, `templates.js`, entered through the
Resource Hub's Library → Templates collection. 1050 unit tests and 201
integration tests all pass — see STATUS.md.

## Start here

The backend is solid; the gap is proof any of the three document types
actually renders and downloads correctly for a real user. Open
`e2e/tests/portal.spec.js` and add a flow that logs in as therapist/owner,
opens Library → Templates, starts an FCA (or Progress Letter, or Service
Agreement) document, and confirms the preview renders and a download
succeeds — following the existing pattern used for Splose/Outlook checks
in the same file.

## Done means

An E2E spec or a documented `docs/qa/BROWSER_QA_RESULTS.md` entry proving
at least one of the three document types renders and downloads for a real
user moves this from `tab-unproven` to `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
