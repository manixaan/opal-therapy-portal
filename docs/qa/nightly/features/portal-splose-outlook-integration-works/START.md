/opal-critical

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
(`getValidAccessToken`), `backend/block-review-routes.js` (new).

## Start here

Two separate fixes, pick one at a time:

1. **Outlook categories 409** (matches tracker's own next_action, and the stale browser-QA
   finding): in `backend/routes.js` around line 1487-1499, catch the "Outlook not connected" error
   from `getValidAccessToken` specifically and return `res.status(409).json({ error: 'outlook_not_connected' })`
   instead of falling through to the generic 500 handler. Add a unit test alongside the existing
   `backend/tests/routes.test.js` pattern (or a new focused test file) asserting the 409.
2. **Block-review audit gap** (CRITICAL — billing risk): `backend/block-review-routes.js`'s confirm
   handler must write an `block_review.confirm` row to `audit_logs`, the way its `sweep` handler
   already does. Copy that sweep's audit call. `tests/integration/block-review.itest.js` already
   has the failing assertion (`audit trail carries ids and counts, never titles or names`) — make
   it pass.

## Done means

For (1): a new/updated unit test asserts 409 on a disconnected Outlook account, reaching `proven`
for that endpoint. For (2): `npx jest --config jest.integration.config.js tests/integration/block-review.itest.js --runInBand`
passes in full.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
