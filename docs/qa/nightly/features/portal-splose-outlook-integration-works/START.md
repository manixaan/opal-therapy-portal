/opal-feature

**Idea**
Portal - Splose - Outlook | Integration Works

**Why** / **Who uses it** / **What they see** / **What should happen** / **Outcome**
(not yet written in the tracker)

Task-level notes for "Multi Calendar Rules" are extensive — see
`docs/qa/nightly/features/portal-splose-outlook-integration-works/STATUS.md`
for the file locations; kept short here per the 80-line limit.

## Where it lives today

The sync/calendar engine (`backend/routes.js`, `splose-sync-routes.js`,
`scheduler-routes.js`, `travel-routes.js`) is solidly built, guarded, and
passes its unit/integration tests. There are two Splose
practitioner-linking UI surfaces, neither with browser/E2E proof:
1. Settings → Integrations → Splose (self-service, each user links their own identity) — unproven since 2026-09-18.
2. Settings → Users & Roles (`frontend/current/people.js`) — an owner picks which Splose practitioner *another person* maps to, via a dropdown (`backend/splose-link-routes.js`). Guarded correctly, API-tested, but nothing drives the UI.

## Start here

Extend `e2e/tests/portal.spec.js` (it already logs in as owner/therapist
and drives Splose fail-closed checks) with a new describe block that:
opens Settings → Users & Roles, exercises the Splose practitioner dropdown
for a seeded user (success + already-claimed-disabled cases), and
separately exercises the self-service Settings → Integrations → Splose
screen as both an owner and a therapist. One spec covering both closes the
whole gap.

## Done means

A browser QA entry or E2E spec covering both the owner (Users & Roles
admin assignment) and therapist (self-service linking) flows moves this to
`proven`.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
