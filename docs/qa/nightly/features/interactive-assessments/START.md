/opal-critical (clinical assessment data and a WHO-copyrighted instrument
with a dedicated licensing/integrity gate — default to critical even though
a pure E2E-spec addition with no app-code change could run under /opal-feature)

**Idea:** Interactive Assessments

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

Tracker task notes (quoted verbatim): "we've created a series of
assessments inside the assessment TAB of which hudas [WHODAS] 2.0 is the
only one that has actually been currently configured there are heaps and
heaps and heaps of other assessments that are pending or to be confirmed it
is Anne's job to analyze and understand which ones to remove and to find
the originals for the ones that we need to include and to try and provide
those Originals intuition point for then Anthony or Pauly to then added
into the portal as an interactive workflow"

## Where it lives today

`backend/whodas-routes.js`, `backend/whodas/`, `backend/assessments-routes.js`,
`backend/assessments/`, rendered via `/whodas.js` + `/assessment.js` into
`#assessment-root`.

## Start here

The smallest next step is a browser/E2E proof, not new code. Add one
Playwright spec (new file, or extend `e2e/tests/portal.spec.js`) that logs
in as a therapist, opens the client/assessment entry point, starts a WHODAS
assessment, and asserts `#assessment-root` renders — mirror the existing
login/role-gating pattern in `portal.spec.js`. Check `backend/feature-flags.js`
and `backend/server.js`'s template-integrity check at boot for how
`ENABLE_WHODAS_ASSESSMENT` is toggled, in case it needs enabling for the
test environment. The content-review task (which other instruments to keep)
is a content/licensing decision for a person, not a coding ticket.

## Done means

The new Playwright spec passes, proving the WHODAS assessment page opens
and renders in a browser — moving this feature from `tab-unproven` to
`proven`.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
