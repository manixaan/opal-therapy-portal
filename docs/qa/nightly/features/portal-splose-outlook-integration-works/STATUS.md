# Portal - Splose - Outlook | Integration Works

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **yes** · Created: **yes**

## Located files

- `backend/calendar-routes.js` — therapist/calendar/availability API
- `backend/splose-sync-routes.js`, `backend/sync-settings-routes.js`, `backend/splose-link-routes.js` — Splose sync, settings, practitioner linking
- `backend/travel-sync-routes.js` — travel legs mirrored to Outlook
- `backend/splose-api.js`, `backend/splose-caseload.js` — Splose client/queue layer (used by Assist too)
- `backend/outlook-mirror.js`, `backend/graph-identity.js`, `backend/graph-mail-transport.js` — Outlook/Graph integration
- `backend/outlook-oauth.js` — OAuth callback handling

All guarded: `requireAuth` plus `requireRole`/`requirePermission`/`denyReadOnly` on every route group. No unguarded route found. No TODO/FIXME in these files.

## Tests

- Unit (20 files): `sync.test.js`, `sync-preferences.test.js`, `sync-safety.test.js`, `sync-backfill.test.js`, `sync-status-route.test.js`, `splose-auto-sync-reset.test.js`, `splose-alert-dialog.test.js`, `splose-draft-sync.test.js`, `splose-match.test.js`, `splose-poller.test.js`, `splose-credentials.test.js`, `splose-link-routes.test.js`, `splose-api-queue.test.js`, `travel-sync-routes.test.js`, `travel-outlook-sync.test.js`, `outlook-mirror.test.js`, `outlook-delta-preserve.test.js`, `graph-identity.test.js`, `graph-mail-transport.test.js` — **291/291 pass**
- Integration (10 files): `sync-settings.itest.js`, `splose-connection.itest.js`, `splose-draft-sync.itest.js`, `splose-link-ignore.itest.js`, `events-sync.itest.js`, `outlook-claim.itest.js`, `outlook-delta-preserve.itest.js`, `travel-outlook-sync.itest.js`, `oauth-callback.itest.js`, `calendar-local-first.itest.js` — **104/104 pass**

## Browser / E2E proof

`docs/qa/BROWSER_QA_RESULTS.md` entries E (freshness pill, Outlook-only toggle), F (Splose 403 boundaries) and H (accounting/Xero gating, unrelated subsystem but same doc) all pass. `e2e/tests/portal.spec.js` exercises the Splose 403 boundaries directly.

## Open tasks from the tracker

- "Multi Calendar Rules" (todo) — a manual confirm-and-stress-test checklist for the booking/travel/sync workflow rules (not an automated-test gap; this is a human verification task the tracker itself describes as non-code).

## Commits in the window touching this feature

`643bace` (Splose lookup 502 fix via queue + retry), `0a365c4` (change-alert dialog stuck fix), `971cac1` (webhook token decrypt fix), `ab75330` (auto-sync nudge after reset fix), `11aa73f` (Calendar sync settings — per-direction sync, sync-from dates, Sync now preview).

## Disagreement

None — evidence matches "proven" and this matches the tracker's own existing `claude_update` text (likely from an earlier run not merged into this branch's history).
