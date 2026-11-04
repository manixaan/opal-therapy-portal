/opal-feature

**Idea**: Interactive Assessments

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

**Tracker's next_action**: "Open the WHODAS wizard in a browser (or add an E2E check) and confirm
it completes end to end."

**Task notes (verbatim, "Assessment Review")**: "we've created a series of assessments inside the
assessment TAB of which hudas 2.0 is the only one that has actually been currently configured
there are heaps and heaps and heaps of other assessments that are pending or to be confirmed it is
Anne's job to analyze and understand which ones to remove and to find the originals for the ones
that we need to include and to try and provide those Originals intuition point for then Anthony or
Pauly to then added into the portal as an interactive workflow"

## Where it lives today

`backend/whodas-routes.js`, `backend/whodas/`, `frontend/current/whodas.js` (inside the client
profile view, `mockup_v3.html:19536`).

## Start here

First confirm `ENABLE_WHODAS_ASSESSMENT` is actually turned on wherever this should be visible —
it defaults off (`backend/feature-flags.js:87`). Then either walk the wizard manually in a browser
with the flag on, or add a Playwright spec under `e2e/tests/` (following `e2e/tests/portal.spec.js`'s
login pattern) that opens a client profile, starts a WHODAS assessment, answers through to
completion, and asserts the score renders.

## Done means

An E2E spec passes end to end, or a recorded browser walkthrough confirms it — either reaches
`proven`.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
