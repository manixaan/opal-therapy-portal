/opal-feature

**Idea:** Inductions

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

### Induction Playground task (verbatim)
AI co-author for building inductions, walled off from clinical data, as simple and visual as possible to use.
> "induction playground exists in the owners portal and it is meant to be a very user-friendly way to create engaging interactive inductions... a lot of the skeleton is already built... for the AI helper in this program there will be a requirement to access an API from that AI whether it's anthropic or open AI but that should be a key step to integrate that AI and alter to be very careful that it only interacts with this part of the program as the rest has clinical sensitive data"

## Where it lives today

- `backend/induction-assistant-routes.js`, `backend/learning-routes.js` (registry import/assign/player), `backend/onboarding-induction.js`
- `frontend/current/induction.js`, `induction-modules.js`, `induction-assistant.js`
- All three sub-tasks (Portal, Splose, Playground) pass 84 unit+integration tests between them — see STATUS.md, including a correction: Splose Inductions already has real code and tests, contrary to this card's last written update.

## Start here

Nothing to build — this is a browser-confirmation gap, not a code gap. As Owner: open the Resource Hub → My Learning, assign yourself the Portal Induction and the Splose Induction, and walk one lesson plus the knowledge check in each. Then open the Induction Playground (Learning admin → AI co-author chat panel) and confirm it builds a module end to end. Record what you saw in `docs/qa/BROWSER_QA_RESULTS.md`, following the existing "Onboarding/profile chain" row as the format to copy.

## Done means

A `docs/qa/BROWSER_QA_RESULTS.md` row (or an E2E spec) for the induction player and the Playground chat → evidence label becomes `proven`.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
