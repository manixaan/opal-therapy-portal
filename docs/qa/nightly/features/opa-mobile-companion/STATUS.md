# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in this change window: no
- Created (any located code): yes

## Located files
- backend/mobile-routes.js (Case Noting + Calendar View, 'thin aggregated surface for the Opa Mobile Companion app')

## Not located
- No frontend page in frontend/current/ — the mobile companion is a separate client app that only talks to this backend; its UI is not part of this repository.

## Guard check
requireAuth only, documented self-scoped by design: header comment states every query is scoped to the caller's own therapist_profile_id/user_id and 'anything not owned by the caller answers 404'. Matches the snapshot-routes.js exception in the backend-api rule.

## Tests and results
- unit: mobile-routes.test.js — 50 passed
- integration: none found — no test exists

## Open tracker tasks
- Case Noting (todo)
- Calendar View (todo)

## Commits in the 14-day change window touching this feature
Not touched in the 14-day change window directly, though e1af24e ('the phone diary matches the portal calendar') landed one day before the window started.

## Why this label
Case Noting and Calendar View are both implemented behind a correctly self-scoped guard, and 50 unit tests pass. The mobile app's own UI lives outside this repository, so there is no portal tab to prove with E2E/browser QA here — this evidence is for the backend API surface only.
