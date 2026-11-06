/opal-fast-change

**Idea**: Portal - Splose - Outlook | Integration Works

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

**Tracker's next_action**: "Fix the Outlook-categories route to return a clean 409 when Outlook
isn't connected, and add a test for that case."

## Where it lives today

`backend/routes.js` (`GET /api/outlook/categories`, line ~1487), `backend/outlook-oauth.js`
(`getValidAccessToken`), `backend/block-review-routes.js`.

## Start here

Only one fix remains open — the other half of this card (the block-review audit-write race) was
fixed in commit `e3c0b90` on 3 Nov and reconfirmed clean tonight (4 isolated runs of
`tests/integration/block-review.itest.js`, 13/13 every time); no further action needed there.

**Outlook categories 409** (matches the tracker's own next_action; flagged for a fifth night): in
`backend/routes.js` around line 1487-1498, catch the "Outlook not connected" error from
`getValidAccessToken` specifically and return `res.status(409).json({ error: 'outlook_not_connected' })`
instead of falling through to the generic 500 handler. Add a unit test alongside the existing
`backend/tests/routes.test.js` pattern (or a new focused test file) asserting the 409 — there is
currently zero test coverage for this route at all.

## Done means

A new/updated unit test asserts 409 on a disconnected Outlook account; the endpoint reaches
`proven`.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
