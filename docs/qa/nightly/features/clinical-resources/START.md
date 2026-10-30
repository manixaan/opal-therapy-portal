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
`backend/resource-library-routes.js` (new SharePoint-style Library, `/api/rh2/library/*`),
`backend/resources-routes.js` (old flat list, `/api/resources/*`),
`backend/resource-hub-r2-routes.js` (catalogue/badges/bookmarks/CPD),
`backend/instrument-register-routes.js`, `backend/resource-ingestion-routes.js`.
Frontend: `frontend/current/resourcelibrary.js`/`.css`,
`frontend/current/resourcehub.js`/`.css`. Tab: `RESOURCES TAB (Resource Hub R1)`
(`mockup_v3.html:5104`).

## Start here
Log in as Owner/Admin, open the Resources tab, and walk the new Library view
end to end: browse folders, upload a file (including a file containing
emails/dates/phone numbers, to trigger the privacy-override "Upload anyway"
checklist), restore an item from the recycle bin, and view file version
history. Repeat the walk as a plain therapist to confirm the read-only
boundary. Copy the pattern in `e2e/tests/portal.spec.js`'s
`test.describe('therapist boundaries', ...)` block (flow G) to add a new
Playwright spec against `/api/rh2/library/*`, or record the walk as a dated
entry in `docs/qa/BROWSER_QA_RESULTS.md` — the existing 2026-08-01 entry only
covers the old flat list and predates this Library UI by months.

## Done means
A new E2E spec (or a dated `docs/qa/BROWSER_QA_RESULTS.md` entry) confirms the
Library view renders and the privacy-override checklist works end to end for
both an Owner/Admin and a therapist. Evidence label should move from
`tab-unproven` to `proven`.

Tracker: af1cdfa3-7519-401a-8549-0fd812ae62e7
