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

## Task notes, verbatim (FCA / Progress Letter / Client Agreement Form)

(not yet written in the tracker — all three tasks have no explanation or notes recorded beyond
their titles)

## Where it lives today

`backend/fca-routes.js`, `backend/letter-routes.js`, `backend/templates-routes.js` +
`backend/service-agreements/templates/`. Embedded in the client profile via `#fca-root`
(`mockup_v3.html:28406`). 626 unit tests and both integration files (`fca-reports.itest.js`,
`progress-note-letters.itest.js`) pass tonight.

## Start here

All three document types generate correctly under test. Pick one (start with FCA, since it has
the most dedicated test files already) and run it by hand through to a downloaded file: open a
client's FCA, preview it, edit it, download as PDF and as a document, and confirm all three
look identical, per the tracker's own outcome. Record the result in
`docs/qa/BROWSER_QA_RESULTS.md`.

## Done means

A hand-check of at least one document type through to a downloaded file is recorded in
`docs/qa/BROWSER_QA_RESULTS.md`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
