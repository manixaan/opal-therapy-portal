/opal-feature

**Idea**: Report Templates

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

**Tracker's next_action**: "Add an E2E spec covering the FCA, Progress Letter and Client Agreement
wizards end to end."

**Task notes**: none recorded for FCA, Progress Letter, or Client Agreement Form individually.

## Where it lives today

`backend/fca-routes.js`, `backend/letter-routes.js`, `backend/templates-routes.js`,
`frontend/current/fca.js`, `letter.js`, `templates.js`.

## Start here

Add a new `e2e/tests/report-wizards.spec.js` using the login pattern from
`e2e/tests/portal.spec.js`. For each wizard: open it, fill the minimum required fields, generate,
and assert a download/preview appears. Start with FCA (the most heavily tested backend of the
three) to establish the pattern, then extend to Progress Letter and Client Agreement.

## Done means

`npm run test:e2e:local` (RELEASE-level, run by a human or `/opal-release`, not from a feature
task) exercises all three wizards end to end and passes.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
