/opal-feature

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

## Decisions
(none recorded)

## Where it lives today
- FCA: `backend/fca-routes.js` + `backend/fca/`, frontend `fca.js`/`fca.css`
- Progress Letter: `backend/letter-routes.js`, frontend `letter.js`/`letter.css`
- Client Agreement Form: `backend/templates-routes.js` + `backend/templates/catalogue.js` (the `service_agreement` document type), frontend `templates.js`/`templates.css`
- All three are launched from panels inside the NDIS Cases / Case Notes area, not a standalone tab.

## Start here
Open each wizard in a browser as a therapist (FCA from a client's NDIS case, Progress Letter from the same area, Client Agreement Form via the templates document picker), generate one real document end to end, and download it. Record what you saw as a new row in `docs/qa/BROWSER_QA_RESULTS.md` naming all three. If you'd rather prove it with code instead of by hand, add one Playwright spec under `e2e/tests/` — copy the structure of an existing document-wizard-style spec if one exists, otherwise copy `templates-routes.test.js`'s supertest pattern but drive it through the real browser.

## Done means
A `docs/qa/BROWSER_QA_RESULTS.md` row (or a new E2E spec) confirming each of FCA, Progress Letter and Client Agreement Form produces a real document in the browser. Evidence label should then move from `tab-unproven` to `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
