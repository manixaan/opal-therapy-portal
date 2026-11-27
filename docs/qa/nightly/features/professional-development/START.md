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

## Decisions

(none recorded)

## Where it lives today

Two places, and that's the first thing to resolve: `backend/resource-hub-r2-routes.js`
(`/api/rh2/cpd`, `/api/rh2/pd` — self-tracked log, fully tested) and `backend/profile-routes.js`
(owner-approved CPD on the My Profile tab — guarded but the approve/reject round trip has no
integration test). See "Employee Personal Page" — it shares this exact gap.

## Start here

First, confirm with Anthony/Ann which system this card is actually about (or merge it into
"Employee Personal Page", which is the card actively tracking the gap). If it's the
owner-approved CPD, open `backend/profile-routes.js` and add an integration test, following
the pattern in `tests/integration/resource-hub-r2.itest.js`, that: submits a CPD credential as
a therapist, approves it as the owner, and confirms the therapist sees the updated status.

## Done means

An integration test exercises `/api/profile/cpd/:id/approve` and `/reject` end to end and
passes, and the card's scope (merged or standalone) is settled.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
