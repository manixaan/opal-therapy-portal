/opal-critical

## Idea

Inductions

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

## Task notes, verbatim (Induction Playground)

"A basic induction builder already exists in the owner's portal. We will build on that rather
than starting fresh. The focus is making it simple and visual to create, adding engaging step
types like photos, directions, quizzes and hold points, and weaving in AI help. The AI help
relies on an outside AI service, so we connect it carefully and keep it walled off from the
rest of the portal's sensitive data."

"induction playground exists in the owners portal and it is meant to be a very user-friendly
way to create engaging interactive inductions that allow a user to be fully inducted in verse
in the companies philosophy in the companies operational procedures how to create those
inductions should be of utmost Simplicity similar to how an iOS or mobile kind of phone as
software is very intuitive a lot of the skeleton is already built but further refinement in
terms of usability and engagement in terms of creating these inductions and having someone be
able to visually edit and make more engaging it should be quite user-friendly and very very
easy to use the interactive capability of each induction should allow the use it to be able to
make an induction as engaging as possible and photos or add directions or add little quiz
steps so hold points and so forth it all be fairly straightforward to create a very complex
induction with a few very few steps it can also have an AI integrator that will help when it
comes to creating these inductions so I want AI to be very much integrated in these part of
the portal
---
for the AI helper in this program there will be a requirement to access an API from that AI
whether it's anthropic or open AI but that should be a key step to integrate that AI and alter
to be very careful that it only interacts with this part of the program as the rest has
clinical sensitive data"

## Task notes, verbatim (Portal Inductions / Splose Inductions)

(not yet written in the tracker — both tasks have no explanation or notes recorded)

## Where it lives today

`backend/learning-routes.js`, `backend/induction-assistant-routes.js`,
`backend/onboarding-induction.js`, `backend/onboarding-learning-bridge.js`,
`frontend/current/induction.js/.css`, `induction-assistant.js/.css`, `induction-modules.js`.
Learner consumption is already proven (`e2e/tests/tutorials.spec.js`); the builder and AI
helper are the open part of this task.

## Start here

Open `backend/induction-assistant-routes.js` and the AI policy entry `induction_assistant` in
`backend/ai/ai-policy.js` — the AI wall-off already exists and is registered correctly. The
real gap is the step types: confirm whether `frontend/current/induction-modules.js` already
supports photo/direction/quiz/hold-point steps (the tracker's checklist implies not), and if
not, add the first one (start with photo, per the tracker's own task text) end to end: builder
UI → save → learner playback → a new test in `tests/integration/learning.itest.js`'s pattern.

## Done means

One new step type (photo) is addable in the builder, saves, and plays back for a learner, with
a passing integration test proving it, and the AI helper can draft or improve that step without
touching clinical data.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
