# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **built-untested**
- Addressed in this change window: no
- Created (any located code): yes

## Located files
- backend/profile-routes.js (Leave requests, CPD/professional development activities, professional development documents, Credentials)
- mockup_v3.html: PROFILE TAB (line 4323)

## Guard check
requireAuth on every route; leave approve/reject use an inline canApprove(user) check (owner/admin only) before acting. No unguarded route found.

## Tests and results
- unit: none found — no test exists
- integration: none found — no test exists

## Open tracker tasks
- Review Portal Structure (todo)

## Commits in the 14-day change window touching this feature
Not touched in the 14-day change window.

## Why this label
The code is located and properly guarded (canApprove() restricts leave approval to owner/admin), and docs/qa/BROWSER_QA_RESULTS.md entry I confirms the Leave/CPD/documents sections render correctly with no fake-success strings. But no unit or integration test file in backend/tests/ exercises profile-routes.js's leave, CPD or credential endpoints directly.
