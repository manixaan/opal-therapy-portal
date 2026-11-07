# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in this change window: yes
- Created (any located code): yes

## Located files
- backend/sync-settings-routes.js (closest match to 'Multi Calendar Rules': per-direction Outlook/Splose sync rules, sync-from dates, Sync now with preview)
- backend/splose-sync-routes.js, backend/splose-link-routes.js, backend/routes-outlook-integration.js

## Not located
- No literal 'multi calendar rules' identifier in the code — the task name is inferred to map onto sync-settings-routes.js's per-direction sync rules; worth confirming with whoever wrote the card.

## Guard check
requireAuth + denyReadOnly on /api/sync-settings, requireRole('owner') on the practice-wide PUT. No unguarded route found.

## Tests and results
- unit: splose-auto-sync-reset.test.js, splose-draft-sync.test.js, sync-backfill.test.js, sync-preferences.test.js, sync-safety.test.js, sync-status-route.test.js, sync.test.js, travel-outlook-sync.test.js, travel-sync-routes.test.js (sampled) — 203 passed (shared run with Portal Onboarding Workflow's unit batch)
- integration: sync-settings.itest.js (shared run with Portal Onboarding Workflow) — 96 passed (shared total)

## Open tracker tasks
- Multi Calendar Rules (todo)

## Commits in the 14-day change window touching this feature
Heavily touched in the 14-day window: 971cac1 (webhook token decrypt fix), 11aa73f (Calendar sync settings feature), ab75330 (auto-sync reset fix), 0a365c4 (change-alert dialog fix).

## Why this label
Sync settings are guarded, well tested, and actively maintained this window. docs/qa/BROWSER_QA_RESULTS.md entries E and F confirm the Outlook/Splose freshness pill and permission boundaries render correctly in a real browser, and e2e/tests/portal.spec.js exercises the Splose 403 boundaries directly.
