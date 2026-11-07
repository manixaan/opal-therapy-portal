# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **built-untested**
- Addressed in this change window: no
- Created (any located code): yes

## Located files
- backend/profile-routes.js (same file as Employee Personal Page: 'CPD / Professional development activities' and 'Professional development documents' sections)

## Guard check
Same as Employee Personal Page: requireAuth + inline canApprove() for owner/admin actions.

## Tests and results
- unit: none found — no test exists
- integration: none found — no test exists

## Open tracker tasks
- none

## Commits in the 14-day change window touching this feature
Not touched in the 14-day change window.

## Why this label
This card has no tasks and appears to be the same underlying code as 'Employee Personal Page (My Profile Tab)' — the CPD section of profile-routes.js. docs/qa/BROWSER_QA_RESULTS.md entry I confirms it renders, but no automated test exercises the CPD endpoints.

## Disagreement with the tracker
This tracker card and 'Employee Personal Page (My Profile Tab)' both describe the same CPD code in profile-routes.js. Worth merging the two cards or giving each a distinct, non-overlapping scope.
