/opal-feature

## Idea

Interactive Assessments

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

## Task notes, verbatim (Assessment Review)

"This task is about reviewing, not building. Ann will go through every assessment already
listed in the Assessment tab. Only Hudas 2.0 is fully set up today; the rest are pending or
unconfirmed. Ann sorts them into keep or remove, tracks down the original source material for
the keepers, and hands those originals to Anthony or Pauly to turn into interactive workflows
later."

"we've created a series of assessments inside the assessment TAB of which hudas 2.0 is the
only one that has actually been currently configured there are heaps and heaps and heaps of
other assessments that are pending or to be confirmed it is Anne's job to analyze and
understand which ones to remove and to find the originals for the ones that we need to
include and to try and provide those Originals intuition point for then Anthony or Pauly to
then added into the portal as an interactive workflow"

## Where it lives today

`backend/whodas-routes.js`, `backend/whodas/`, `backend/assessments-routes.js`. Mounted inline
in the client profile (`mockup_v3.html:21409-21478`, `whodas.js?v=5`, `whodas.css?v=3`). All
484 unit tests and both integration files (`whodas.itest.js`, `assessments.itest.js`) pass
tonight.

## Start here

The API is solid; what's missing is proof a therapist can actually open WHODAS 2.0 for a real
client in a browser. Open the Assessment tab as a therapist with a client that has no prior
WHODAS record, start a new assessment, complete it, and record the result in
`docs/qa/BROWSER_QA_RESULTS.md`. Ann's separate "Assessment Review" triage (which assessments to
keep or remove) is a parallel human task and doesn't block this.

## Done means

A browser check of the WHODAS 2.0 flow is recorded in `docs/qa/BROWSER_QA_RESULTS.md`, moving
this card from `tab-unproven` to `proven`.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
