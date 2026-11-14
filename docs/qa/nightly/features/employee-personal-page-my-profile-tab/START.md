/opal-critical

**Idea:** Employee Personal Page (My Profile Tab)

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

No decisions recorded yet.

**Task — Review Portal Structure:** This is a hands-on testing job, not a
documentation job. You will walk through every part of the My Profile tab
and click every button to confirm each one works. You will also test the
parts that connect to the owner portal, like leave and professional
development approval, to confirm both sides tal...(truncated in the
tracker).

## Where it lives today

`backend/profile-routes.js`, `frontend/current/profile.js`, the "My
Profile" tab in `mockup_v3.html`. Guarded correctly and renders in a real
browser. Document upload/download has integration coverage (one subtest
fails on this sandbox for a known, root-vs-chmod reason — see STATUS.md);
leave and CPD approval have none.

## Start here

CRITICAL level — employee-sensitive data plus owner-side approvals.
Concrete starting point: write an integration test for
`/api/profile/leave` and `/api/profile/cpd`
   approve/reject, following the pattern already used for
   `/api/profile/documents` in `readonly-and-hardening.itest.js` —
   therapist submits, owner approves, therapist sees `approved`; owner
   rejects, therapist sees `rejected` with the reason.

## Done means

A new test proves the leave/CPD approval round-trip end to end. Target
label: `proven`.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
