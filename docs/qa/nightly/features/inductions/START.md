/opal-feature

**Idea**: Inductions

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

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
`backend/induction-assistant-routes.js`, `backend/walkthrough-routes.js`, `backend/tutorial-routes.js`, `backend/learning-routes.js`, `backend/walkthrough-content.js`; frontend `frontend/current/induction.js`, `induction-assistant.js`, `induction-modules.js`. 258 unit + 130 integration tests pass tonight; `e2e/tests/tutorials.spec.js` exercises the whole flow in a browser already — the gap is not test proof, it's the open tracker tasks below.

## Start here
This is not a naming mismatch — it's real and already built (intro/highlight/action/screenshot/callout/warning/quiz/complete steps, plus an AI-assisted builder through the gateway). The one genuine gap against the idea above is the missing literally-named **hold point** step — though `backend/walkthrough-content.js:49-61`'s `checkpoint`/`BLOCKING_TYPES` already blocks progress the same way. Confirm with the team whether they want a renamed/relabelled `checkpoint` or a distinct new type, then close out the "Induction Playground" task: pick the AI service and how it helps, following the existing pattern in `induction-assistant-routes.js` (owner-only, walled off per `.claude/rules/ai-gateway.md`).

## Done means
A test in `tests/walkthrough-content.test.js` covering whatever decision is made on the hold-point naming, and the open tracker tasks moved off `todo` — that's what turns `needs-refinement` into `proven` (the test/E2E proof is already there).

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
