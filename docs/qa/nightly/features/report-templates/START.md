/opal-feature

## Idea
Report Templates

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
- backend/fca-routes.js (requireClinicalRead/Write per route)
- backend/letter-routes.js (requireClinicalRead/Write per route — covers Progress Letter)
- backend/templates-routes.js (requireTemplateRead/Write per route — more precise than last night's "requireAuth" note, still fully guarded) + backend/templates/service-agreement-map.js (Client Agreement Form generation)
- backend/service-agreements/templates/*.docx, *.pdf (shipped templates)

## Start here
Run all three document flows by hand through to a downloaded file (FCA, Progress Letter, Client Agreement Form) and record the result in docs/qa/BROWSER_QA_RESULTS.md.

## Done means
All three flows have a recorded hand-check; label becomes `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
