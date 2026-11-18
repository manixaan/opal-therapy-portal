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
- backend/profile-routes.js — /api/profile/cpd, /api/profile/documents, /api/profile/credentials (shared file with Employee Personal Page; no dedicated file of its own)

## Start here
Decide first whether this card merges into Resource Hub or My Profile (its own next_action). If it stays separate, add a test exercising backend/profile-routes.js's /api/profile/cpd and /api/profile/documents endpoints the way credential-surface-guards.test.js tests the credentials endpoints next to them.

## Done means
Either the merge decision is recorded and this card is archived, or a new test proves the CPD/PD-document endpoints and the label becomes `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
