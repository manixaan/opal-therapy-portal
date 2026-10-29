/opal-feature

## Idea
Clinical resources

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
`backend/resource-library-routes.js` (new SharePoint-style Library), `backend/resources-routes.js` (old flat list), `backend/resource-hub-r2-routes.js`. Frontend: `frontend/current/resourcelibrary.js`, `frontend/current/resourcehub.js`. Tab: RESOURCES TAB (`mockup_v3.html:5104`).

## Start here
Log in as Owner/Admin, open the Resources tab, and walk the new Library view end to end: browse folders, upload a file (including triggering the privacy-override "Upload anyway" checklist on a file containing emails/dates/phone numbers), restore from the recycle bin, and view file versions. Repeat the walk as a plain therapist to confirm the read-only boundary. Follow the `e2e/tests/portal.spec.js` flow-G pattern (`test.describe('therapist boundaries', ...)`) to add a new Playwright spec, or record the walk in `docs/qa/BROWSER_QA_RESULTS.md`.

## Done means
A new E2E spec (or a dated `docs/qa/BROWSER_QA_RESULTS.md` entry) confirms the Library view renders and the privacy-override checklist works end to end. Evidence label should move from `tab-unproven` to `proven`.

Tracker: af1cdfa3-7519-401a-8549-0fd812ae62e7
