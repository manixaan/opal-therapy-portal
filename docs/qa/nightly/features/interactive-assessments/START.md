/opal-feature

**Idea**
Interactive Assessments

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

No decisions recorded. Task-level notes (verbatim), "Assessment Review":

"we've created a series of assessments inside the assessment TAB of which
hudas 2.0 is the only one that has actually been currently configured
there are heaps and heaps and heaps of other assessments that are pending
or to be confirmed it is Anne's job to analyze and understand which ones
to remove and to find the originals for the ones that we need to include
and to try and provide those Originals intuition point for then Anthony or
Pauly to then added into the portal as an interactive workflow"

## Where it lives today

`backend/whodas-routes.js` + `backend/whodas/` (fully built, guarded, tested),
`backend/assessments-routes.js` + `backend/assessments/definitions.js`
(every other instrument deliberately returns a "source required"
placeholder, not a bug). Frontend: `frontend/current/whodas.js`,
`assessment.js`. 1050+201 tests pass — see STATUS.md.

## Start here

This tracker task is a human sourcing/review job, not a coding task — the
checklist (review the Assessment tab, mark keep/remove, find originals,
hand to a developer) happens outside this repository. The one thing a
Claude Code session can usefully do: add an E2E check in
`e2e/tests/tutorials.spec.js` or `portal.spec.js` that opens a client's
Assessments section and completes a WHODAS 2.0 instrument end to end,
since that's the one instrument actually built and it has zero browser
proof today.

## Done means

An E2E spec proving WHODAS 2.0 completes and scores correctly through the
UI moves this from `tab-unproven` to `proven`. Confirm `ENABLE_WHODAS_ASSESSMENT`
is actually `true` wherever this needs to be reachable first.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
