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
The flat Saved/All Resources list (`backend/resources-routes.js`, `frontend/current/resourcehub.js`)
is unchanged and was browser-proven before tonight. The folder-browsing
"Library" view was rebuilt tonight as a new module — `backend/resource-library-routes.js`
+ `backend/resource-recycle-bin.js` (any-depth folders, recycle bin, version
history, Owner+Admin management) and `frontend/current/resourcelibrary.js`
(tree navigation, list/tiles, drag-and-drop, command bar). It is fully
unit- and integration-tested but has never been opened in a real browser —
the old UI it replaced had browser proof, but that proof is for a screen
that no longer exists.

## Start here
Open the Resources tab as an Owner or Admin in a real browser, browse into
the Library, and walk the core paths: open a folder, upload a file, rename
and move an item, delete it to the recycle bin and restore it, view version
history. Then repeat the read-only paths as a therapist (browse, no mutate
buttons) and read-only role (browse, refused on any write attempt). Add a
`docs/qa/BROWSER_QA_RESULTS.md` row (or an `e2e/tests/*.spec.js` spec) once
confirmed.

## Done means
A browser QA row or E2E spec proves the new Library view for both an
Owner/Admin and a therapist/read_only user; evidence label returns to `proven`.

Tracker: af1cdfa3-7519-401a-8549-0fd812ae62e7
