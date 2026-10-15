/opal-critical (clinical/document-export data with client-identifying
content)

**Idea:** Report Templates

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

The tracker holds this as three bare tasks with no notes: "FCA", "Progress
Letter", "Client Agreement Form" — the matching of "Client Agreement Form"
to the existing Service Agreement template is our inference, not a
tracker statement; confirm it with Anthony before assuming it's the same
thing.

## Where it lives today

FCA: `backend/fca-routes.js` + `backend/fca/`. Progress Letter:
`backend/letter-routes.js` (logic shared with `backend/fca/letter-blocks.js`).
Client Agreement Form (candidate match): `backend/templates-routes.js` +
`backend/templates/service-agreement-map.js`.

## Start here

No engineering gap was found for any of the three document types — the next
step is proof, not code. Add Playwright coverage in `e2e/tests/` (new file,
e.g. `document-templates.spec.js`) exercising: open the FCA wizard →
generate a preview; open the progress-letter flow; open Templates → Service
Agreement export — copy the login/role setup already in
`e2e/tests/portal.spec.js`. If any gap surfaces during that exercise, the
neighbouring pattern to copy is whichever of the three sibling unit-test
suites already covers the equivalent behaviour (`fca-wizard-behaviour.test.js`
is the richest).

## Done means

The new Playwright spec passes for all three document types — moving this
feature from `tab-unproven` to `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
