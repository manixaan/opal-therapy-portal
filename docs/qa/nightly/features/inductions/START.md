/opal-feature for the e2e-spec addition below; /opal-critical for any change
to induction-assistant-routes.js or ai-policy.js (touches the AI gateway).

**Idea:** induction playground exists in the owners portal and it is meant
to be a very user-friendly way to create engaging interactive inductions
that allow a user to be fully inducted in verse in the companies philosophy
in the companies operational procedures how to create those inductions
should be of utmost Simplicity similar to how an iOS or mobile kind of phone
as software is very intuitive a lot of the skeleton is already built but
further refinement in terms of usability and engagement in terms of
creating these inductions and having someone be able to visually edit and
make more engaging it should be quite user-friendly and very very easy to
use the interactive capability of each induction should allow the use it to
be able to make an induction as engaging as possible and photos or add
directions or add little quiz steps so hold points and so forth it all be
fairly straightforward to create a very complex induction with a few very
few steps it can also have an AI integrator that will help when it comes to
creating these inductions and having someone be able to visually edit and
make more engaging it should be quite user-friendly and very very easy to
use

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded) — note: the tracker notes add "for the AI
helper in this program there will be a requirement to access an API from
that AI whether it's anthropic or open AI but that should be a key step to
integrate that AI and alter to be very careful that it only interacts with
this part of the program as the rest has clinical sensitive data" — this is
already honoured in code: `induction_assistant` is INTERNAL-classified in
`ai-policy.js` with no clinical-data path.

## Where it lives today

`backend/induction-assistant-routes.js`, `backend/learning-routes.js`,
`frontend/current/induction.js` / `induction-modules.js` / `induction-assistant.js`.

## Start here

The smallest next step is browser proof, not new code: write a Playwright
spec exercising the Induction Assistant chat (open Assign Learning as owner
→ send a message → assert a reply/activity renders), mirroring the
`login()` auth pattern already in `e2e/tests/tutorials.spec.js`. Flip
`INDUCTION_AI_ENABLED=true` in the local/staging env for that run only. If
new step *types* (photos/hold-points) are wanted later, extend
`SECTION_SCHEMA` in `induction-assistant-routes.js` and `lc.normaliseContent`
in `learning-content.js` together, following the existing `quiz` item type
as the pattern. Separately: tell whoever maintains the tracker that "Portal
Inductions" and "Splose Inductions" are already built and tested — their
"todo" status is stale.

## Done means

The new Playwright spec passes, proving the AI assistant chat renders and
responds in a browser — moving that slice from `tab-unproven` to `proven`.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
