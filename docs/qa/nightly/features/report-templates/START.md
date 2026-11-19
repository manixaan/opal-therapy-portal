/opal-critical

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
- backend/templates-routes.js + backend/templates/service-agreement-map.js (Client Agreement Form generation)
- backend/service-agreements/templates/*.docx, *.pdf (shipped templates)

## Start here
As a therapist, run all three flows by hand through to a downloaded file: an FCA draft (backend/fca-routes.js + frontend FCA wizard), a Progress Letter (backend/letter-routes.js), and a Client Agreement Form (backend/templates-routes.js + backend/templates/service-agreement-map.js). Note where a client-facing signing page is missing — none exists in frontend/current/ today.

## Done means
All three document flows are run by hand to a downloaded file with no errors, and either a signing surface is added or the tracker records that none is needed; label becomes `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
