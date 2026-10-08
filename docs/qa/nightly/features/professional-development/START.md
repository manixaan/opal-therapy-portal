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

(No decisions recorded in the tracker.)

## Where it lives today
- `backend/resource-hub-r2-routes.js` (`/api/rh2/pd*`, `/api/rh2/cpd*`), `backend/profile-routes.js`
  (`/api/profile/cpd*`)
- Frontend: PD sub-view in the Resources tab (`frontend/current/resourcehub.js`), personal CPD log in the
  Profile tab (`frontend/current/profile.js`)

## Start here
This card has no description and no tasks in the tracker, yet the code is fully built and tested. Confirm with
the team whether this card means the Resource Hub's PD events catalogue + CPD log (the only plausible match), then
either close the card out or write a proper idea/why/who for it. The one open gap is browser proof: add a
`docs/qa/BROWSER_QA_RESULTS.md` entry or an e2e scenario for `#resources/pd` and the Profile tab's CPD section,
following the Resource Hub's existing flow G pattern.

## Done means
A browser/e2e check exists for the PD events catalogue and/or the CPD log, and
`npx jest tests/pd-catalogue-guards.test.js` plus the matching integration test still pass. Evidence label moves
from tab-unproven to proven once that proof lands.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
