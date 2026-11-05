/opal-feature

**Idea**: Inductions

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

**Tracker's next_action**: "Confirm whether Induction Playground is a real planned feature or a
naming mismatch for what already exists."

**Task notes (verbatim, "Induction Playground")**: "induction playground exists in the owners
portal and it is meant to be a very user-friendly way to create engaging interactive inductions
that allow a user to be fully inducted in verse in the companies philosophy in the companies
operational procedures how to create those inductions should be of utmost Simplicity similar to
how an iOS or mobile kind of phone as software is very intuitive a lot of the skeleton is already
built but further refinement in terms of usability and engagement in terms of creating these
inductions and having someone be able to visually edit and make more engaging it should be quite
user-friendly and very very easy to use the interactive capability of each induction should allow
the use it to be able to make an induction as engaging as possible and photos or add directions or
add little quiz steps so hold points and so forth it all be fairly straightforward to create a
very complex induction with a few very few steps it can also have an AI integrator that will help
when it comes to creating these inductions so I want AI to be very much integrated in these part
of the portal"

## Where it lives today

`backend/learning-routes.js`, `backend/induction-assistant-routes.js`, `frontend/current/induction.js`.

## Start here

Answer the tracker's own question first: this is not a naming mismatch — it's real and already
built (intro/highlight/action/screenshot/callout/warning/quiz/complete steps, plus an
AI-assisted builder through the gateway). The one genuine gap against the idea above is the
missing **hold point** step type. Add it in `backend/learning-content.js` (new entry in whatever
enum/union defines step kinds) and `frontend/current/induction-modules.js` (the step editor UI),
following the pattern of the existing `quiz` step.

## Done means

A new unit test in `tests/learning-content.test.js` covering the hold-point step's validation, and
the step rendering correctly in `induction-modules.js` — reaching `proven` once a browser/E2E check
or `docs/qa/BROWSER_QA_RESULTS.md` entry confirms the tab itself.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
