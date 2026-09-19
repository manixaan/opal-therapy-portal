/opal-feature

## Idea
Professional Development

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
(none recorded in the tracker)

## Where it lives today
Two disconnected implementations: `backend/resource-hub-r2-routes.js` (`/api/rh2/pd*` catalogue +
`/api/rh2/cpd*` personal tracker, rendered by `frontend/current/resourcehub.js`'s `pd` page) and
`backend/profile-routes.js` (`/api/profile/cpd*` log + owner approve/reject, rendered by
`frontend/current/profile.js`'s My Profile section). Tested by
`backend/tests/integration/resource-hub-r2.itest.js` (PD events + CPD tracker blocks) for the first;
only incidentally by unrelated suites for the second.

## Start here
First decide the product question before writing more code: should "Professional Development" be
one feature or two? Right now a therapist can log CPD hours in Resource Hub (self-only, no
approval, registration-year summary) that an owner never sees, and separately log CPD activities in
My Profile that an owner does approve/reject — same practice, same regulator requirement, two
un-synced ledgers. Once decided:
- If they should merge: pick one table (`pd_events`/`rh2/cpd` looks like the newer, more complete
  data model — mode, cost, registration URL, registration-year summary), migrate
  `profile-routes.js`'s approve/reject workflow onto it, and delete the other.
- If they're deliberately separate (e.g. Resource Hub = browsing what's on offer + a personal log,
  My Profile = the formal approved record), document that distinction somewhere a developer will
  find it, and rename one of the two UI labels so they aren't both "Professional development."

## Done means
A single integration test (or an extension of `resource-hub-r2.itest.js`) that exercises whichever
shape is chosen end to end, plus a browser/E2E check of the actual tab. Evidence label should reach
`proven` once both the API contract and a real browser pass cover the chosen design; `built-untested`
is not the right next milestone here since both API layers are already tested — the gap is a browser
check and a product decision, not missing tests.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
