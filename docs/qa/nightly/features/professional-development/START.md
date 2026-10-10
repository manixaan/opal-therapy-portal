/opal-feature

# Professional Development

**Idea**

Professional Development

**Why**

(not yet written in the tracker)

**Who uses it**

(not yet written in the tracker)

**What they see**

(not yet written in the tracker)

**What should happen**

(not yet written in the tracker)

**Outcome**

(not yet written in the tracker)

**Decision**

(not yet written in the tracker)

## Where it lives today

- No description or tasks on this card. Best match: the PD events catalogue — `backend/migrations/029_pd_catalogue.sql` + `backend/resource-hub-r2-routes.js` (same guard as Clinical Resources: `requireAuth` + admin-denied 403).

## Start here

Confirm with the team that this card means the Resource Hub's PD events catalogue (`resource-hub-r2-routes.js`). If so, extend `e2e/tests/portal.spec.js`'s Resource Hub flow (around line 116) to also open the PD category and assert at least one event renders.

## Done means

An e2e assertion that the PD events catalogue renders in the Resource Hub — label would move to `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
