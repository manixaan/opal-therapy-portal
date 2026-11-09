/opal-critical

**Idea:** Employee Personal Page (My Profile Tab)
**Why:** (not yet written in the tracker)
**Who uses it:** (not yet written in the tracker)
**What they see:** (not yet written in the tracker)
**What should happen:** (not yet written in the tracker)
**Outcome:** (not yet written in the tracker)
(No recorded decisions.)

The tracker's one task, "Review Portal Structure", says in its own words: "This is a hands-on testing job, not a documentation job. You will walk through every part of the My Profile tab and click every button to confirm each one works. You will also test the parts that connect to the owner portal, like leave and professional development approval, to confirm both sides talk to each other. No note-taking or written report is needed. You simply tick each item once it is verified as working."

## Where it lives today

`backend/profile-routes.js` (Leave, CPD/professional development, documents, Credentials, work schedule, notifications) and `frontend/current/profile.js` / the Profile tab in `mockup_v3.html`. Guarded (inline `canApprove`, owner-only for approvals), but has zero automated test coverage.

## Start here

Add `backend/tests/profile-routes.test.js` (supertest against the mounted router, the pattern in `case-note-routes.test.js`). Cover: a therapist managing only their own leave/CPD/documents (403 on someone else's), and an owner approving/rejecting a leave or CPD request for a different user while admin is correctly refused (per the inline `canApprove` check). Assert the 403 path, not only the happy path.

## Done means

`backend/tests/profile-routes.test.js` exists and passes, covering the leave/CPD/documents/credentials guard boundaries → evidence label `proven` (still needs an E2E/browser proof of the tab itself beyond entry I's render-only check for full `proven`, otherwise `tab-unproven`).

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
