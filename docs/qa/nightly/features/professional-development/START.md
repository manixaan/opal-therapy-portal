/opal-fast-change

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
(none recorded)

## Where it lives today
Two real, built, tested subsystems could both answer to this title:
`backend/resource-hub-r2-routes.js` (`/api/rh2/pd`, `/api/rh2/cpd` — an
admin-curated PD events catalogue and org-wide CPD tracking), and
`backend/profile-routes.js` (`/api/profile/cpd`, `/documents`,
`/credentials` — an employee's own CPD log inside My Profile). Both are
guarded and both have passing tests.

## Start here
This isn't primarily a coding gap, it's a scoping gap. Before any code task is
written against this card, someone on the team needs to say in the
tracker's **What they see** / **What should happen** fields which of the
two subsystems above this card is actually about — or confirm it means
both, in which case it should probably be merged into (or linked from)
the "Employee Personal Page (My Profile Tab)" card, which already covers
the CPD/credentials half. Separately, under either reading, add a
Playwright or `docs/qa/BROWSER_QA_RESULTS.md` entry proving the relevant
page actually opens and renders — that's the standing `tab-unproven` gap.

## Done means
The tracker card has a filled-in idea/why/who/what-they-see, pointing at
one (or both, explicitly) of the two subsystems above, AND a browser/E2E
check proving that page renders. The scoping decision moves this once a
person decides; the browser check moves it the rest of the way to `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
