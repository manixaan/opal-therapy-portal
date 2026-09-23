/opal-feature

**Idea**
Portal - Splose - Outlook | Integration Works

**Why** / **Who uses it** / **What they see** / **What should happen** / **Outcome**
(not yet written in the tracker)

Task-level notes for "Multi Calendar Rules" are extensive — see
`docs/qa/nightly/features/portal-splose-outlook-integration-works/STATUS.md`
for the file locations; the tracker's own words are quoted in full there
in the original snapshot (kept short here per the 80-line limit).

## Where it lives today

The sync/calendar engine itself (`backend/routes.js`, `splose-sync-routes.js`,
`scheduler-routes.js`, `travel-routes.js`) is solidly built, guarded, and
passes 528+ unit / 91 integration tests. There are now **two** Splose
practitioner-linking UI surfaces, neither with browser/E2E proof:
1. Settings → Integrations → Splose (self-service, each user links their own identity — added
   2026-09-18), unproven since that date.
2. **New tonight (2026-09-22):** Settings → Users & Roles (`frontend/current/people.js`) — an owner
   picks which Splose practitioner *another person* maps to, via a dropdown
   (`backend/splose-link-routes.js`'s `/api/admin/people/:userId/splose-link`). Guarded correctly
   (`requireAuth` + `requireRole('owner')`), and has API-level test coverage
   (`admin-people.itest.js`, `splose-link-routes.test.js`), but nothing drives the actual UI.

## Start here

Extend `e2e/tests/portal.spec.js` (it already logs in as owner/therapist and drives Splose
fail-closed checks, so the login/role scaffolding is already there) with a new describe block that:
opens Settings → Users & Roles, asserts `people.js`'s row rendering for a seeded user, opens the side
panel, exercises the Splose practitioner dropdown (select a free practitioner → save → assert the
row/cell updates; select an already-claimed one → assert it's disabled/greyed), and separately covers
the self-service Settings → Integrations → Splose screen as both an owner and a therapist. One spec
covering both flows would close the whole gap, since `people.js` is now the shared surface both flows
render through for admin visibility.

## Done means

A browser QA entry or E2E spec covering the owner (Users & Roles admin assignment) AND therapist
(self-service linking) flows moves this to `proven`.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
