/opal-critical

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

## Decision
(not yet written in the tracker)

## Where it lives today
- My Profile tab's CPD section (frontend/current/mockup_v3.html — "Professional Development Documents" card) backed by backend/profile-routes.js's `/api/profile/cpd`, `/api/profile/documents` and `/api/profile/credentials` routes
- frontend/current/profile.js and frontend/current/induction-modules.js (a walkthrough step named "Professional Development (CPD)")
- **Tonight's finding corrects last night's framing**: this card is not an open two-way choice between Resource Hub and My Profile — a fresh grep tonight found concrete, named "Professional Development" UI inside the My Profile tab's CPD section. That is its real home.

## Start here
Decide (in the tracker) whether this card formally merges into "Employee Personal Page (My Profile Tab)" — they already share the same code (backend/profile-routes.js) and the same test gap. If it stays separate, add an integration test for the CPD approval round trip (see the Employee Personal Page prompt below) and point this card's next_action at that test.

## Done means
Either the tracker records a merge decision, or a new integration test proves the CPD round trip and the label moves to `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
