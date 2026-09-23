/opal-fast-change (for the stale test) then /opal-feature (for the rest)

**Idea**
Inductions

**Why** / **Who uses it** / **What they see** / **What should happen** / **Outcome**
(not yet written in the tracker)

Task notes for "Induction Playground" (verbatim, abridged): "induction
playground exists in the owners portal and it is meant to be a very
user-friendly way to create engaging interactive inductions... photos or
add directions or add little quiz steps so hold points... can also have an
AI integrator that will help when it comes to creating these inductions."

## Where it lives today

`frontend/current/workshop.js`/`.css` (the builder this audit believes
satisfies "Induction Playground" — see STATUS.md's Disagreement section
for why a prior audit night concluded otherwise), `induction-modules.js`
(19 built-in modules covering "Portal/Splose Inductions"),
`backend/walkthrough-routes.js`, `learning-routes.js`,
`induction-assistant-routes.js`. 639 unit + 128 integration tests pass.

## Start here

Two independent things: (1) a one-line fix to `e2e/tests/tutorials.spec.js:59`
— replace the stale `'All learning'` heading assertion with `'Assign
Learning'` (confirmed the actual `<h1>` text in `resourcehub.js:5738`);
(2) get a person to confirm whether `workshop.js` is what "Induction
Playground" meant, since this and a prior audit night disagree.

## Done means

The e2e spec fixed and actually passing when run, plus a person's
confirmation on the naming question, moves this to `proven`.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
