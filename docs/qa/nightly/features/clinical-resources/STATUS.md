# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in this change window: no
- Created (any located code): yes

## Located files
- backend/resources-routes.js, backend/resource-library-routes.js, backend/resource-hub-r2-routes.js and the rest of backend/resource-*.js ('governed clinical resource repository; backend-enforced RBAC' per server.js)
- frontend/current/resourcehub.js
- mockup_v3.html: RESOURCES TAB (Resource Hub R1) (line 5120)

## Guard check
requireAuth + role/permission checks throughout (confirmed via resource-hub-final.test.js and the 403 assertions in docs/qa/BROWSER_QA_RESULTS.md entry G).

## Tests and results
- unit: resource-hub-final.test.js (sampled; many more resource-*.test.js files exist) — 65 passed

## Open tracker tasks
- none

## Commits in the 14-day change window touching this feature
Not touched in the 14-day change window.

## Why this label
This idea-stage card with no tasks maps onto the entire existing Resource Hub. docs/qa/BROWSER_QA_RESULTS.md entry G proves a therapist sees 16 approved resources across 14 folders with folder-create correctly refused (403), and e2e/tests/portal.spec.js and tutorials.spec.js both exercise it further.

## Disagreement with the tracker
This tracker card ('idea' stage, no tasks) describes a feature that is already large and in production — likely worth closing or re-scoping to whatever gap in the Resource Hub actually prompted it.
