/opal-critical (auth/external-integration risk, even though the fix itself
is small and scoped to one route)

**Idea:** Portal - Splose - Outlook | Integration Works

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

Tracker task notes (quoted verbatim, abridged — simplified per the
tracker's own last note "simplify this to high-level concepts"): "whenever
you pick a new client and create a session it automatically calculates the
travel from the home base of that allocated day to the session... every
single time you change something in the portal there should be an
indication saying that these changes are saved in the portal yet are not
synced into [Splose]... the system should work itself out... to make sure
that both Outlook, [Splose] and the portal are the exact same... we haven't
yet decided what the Outlook calendar may look like"

## Where it lives today

The confirmed bug: `backend/routes.js:1463-1476` (route handler) and
`backend/routes.js:150-153` (`getValidAccessToken`, the function that
throws). The wider integration: `backend/calendar-routes.js`,
`splose-sync-routes.js`, `splose-link-routes.js`, `travel-routes.js`,
`backend/outlook-oauth.js`.

## Start here

Open `backend/routes.js` around line 1463. Change the catch block to check
`err.message === 'Outlook not connected'` (or, better, check
`user.access_token` before calling `getValidAccessToken` at all) and return
`res.status(409).json({ error: 'Outlook not connected', data: [] })`
instead of 500 — follow the pattern already used in
`onboarding-journey-routes.js`'s `graphMail.unavailableReason(req.user)` →
409 check (`journey-routes.js:981-982`) as the house idiom for "no Graph
connection" responses. Add a unit test asserting the 409 path (mock
`db.getUser` to return no `access_token`).

## Done means

A new/extended unit test for `/api/outlook/categories` asserts a 409 "not
connected" response instead of 500 and passes — moving this specific defect
from `broken` to fixed. The "Multi Calendar Rules" task's stress-testing
items remain a manual verification job for a person, not a coding task.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
