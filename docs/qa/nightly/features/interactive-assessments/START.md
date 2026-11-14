/opal-feature

**Idea:** Interactive Assessments

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

No decisions recorded yet.

**Task — Assessment Review:** This task is about reviewing, not building.
Ann will go through every assessment already listed in the Assessment tab.
Only Hudas 2.0 is fully set up today; the rest are pending or unconfirmed.
Ann sorts them into keep or remove, tracks down the original source
material for the keepers, and hands th...(truncated in the tracker).

## Where it lives today

`backend/whodas-routes.js`, `backend/assessments-routes.js`,
`frontend/current/whodas.js`, `frontend/current/assessment.js`. 481 unit +
81 integration tests pass. WHODAS 2.0 is the most complete; the rest of the
catalogue is where Ann's review task above is still deciding what to keep.

## Start here

This is primarily a product-decision task (which assessments to keep), not
a coding task — do not build new assessments before that review lands. The
engineering gap worth closing without waiting on the decision: there is no
browser/E2E proof that WHODAS 2.0 (the one assessment already confirmed)
renders and scores correctly. Open `frontend/current/whodas.js` and the
client-record view that hosts it, and follow
`tests/integration/whodas.itest.js` for the scoring contract to verify by
hand or in a new Playwright spec.

## Done means

A browser check or E2E spec proves WHODAS 2.0 renders and scores correctly
for a real client. Target label: `proven` for WHODAS 2.0 specifically; the
rest of the catalogue stays pending the human review.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
