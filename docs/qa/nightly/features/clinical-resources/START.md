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
`backend/resources-routes.js`, `backend/resource-hub-r2-routes.js`, `backend/resource-library-routes.js` and the supporting `resource-*.js` files; frontend `resourcehub.js`/`resourcehub.css`, Resources tab in `mockup_v3.html`.

## Start here
Log in as Owner/Admin, open the Resources tab's Library view, and walk the upload → privacy-override checklist → folder flow the rebuild (commits `0195cb3`, `06c6777`, `dd958d0`, `31d5008`, `896ace1`) just shipped. Then repeat as a therapist to confirm the view-only boundary holds. Record what you saw as a new, dated row in `docs/qa/BROWSER_QA_RESULTS.md` — the existing row G is from 2026-08-01 and predates this rebuild, so it does not cover it.

## Done means
A current `docs/qa/BROWSER_QA_RESULTS.md` row naming the Library view, upload flow and privacy-override checklist. Evidence label should then move from `tab-unproven` to `proven`.

Tracker: af1cdfa3-7519-401a-8549-0fd812ae62e7
