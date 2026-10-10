/opal-feature

# Interactive Assessments

**Idea**

Interactive Assessments

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

- `backend/fca-routes.js`, `backend/whodas-routes.js`, `backend/assessments-routes.js` — all guarded with `requireAuth` on their router.

## Start here

Add a Playwright spec (pattern: `e2e/tests/portal.spec.js`) that logs in as a therapist, opens a WHODAS 2.0 assessment for a client, completes one question, and asserts the score renders. That single flow is enough to prove the tab works end to end.

## Done means

A passing e2e spec for the WHODAS (or FCA) flow — label would move to `proven`.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
