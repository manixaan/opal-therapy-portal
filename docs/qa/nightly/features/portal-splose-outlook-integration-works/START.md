/opal-fast-change

# Portal - Splose - Outlook | Integration Works

**Idea**

Portal - Splose - Outlook | Integration Works

**Why**

(not yet written in the tracker)

**Who uses it**

(not yet written in the tracker)

**What they see**

(not yet written in the tracker)

**What should happen**

(not yet written in the tracker)

**Outcome**

(not yet written in the tracker)

**Decision**

(not yet written in the tracker)

## Where it lives today

- "Multi Calendar Rules" doesn't map to one distinct module — the closest match is `backend/calendar-routes.js` (master calendar / per-therapist access, each route individually guarded with `requireAuth` plus `requireRole`/`requireMasterCalendarAccess`), `backend/calendar-permissions.js` (role-based calendar visibility rules), the Outlook sync pipeline (`backend/outlook-oauth.js` + sync functions in `backend/routes.js`), and `backend/splose-sync-routes.js` (`requireAuth`+`denyReadOnly`+`requireDraftSync`).
- `backend/splose-link-routes.js` — `requireAuth`, plus `requireRole('owner')` on the admin/connection routes.
- Noted in passing: `backend/routes-outlook-integration.js` defines its own local `requireAuth` and is never `require()`'d anywhere in `server.js` or elsewhere — it's dead code, not a live guard gap (it never runs), but worth deleting.

## Start here

In `backend/routes.js`, change the `GET /api/outlook/categories` handler (line ~1463) to catch the specific "Outlook not connected" case from `getValidAccessToken()` and return `409` with an empty list instead of falling through to the generic `500`. Add a unit test asserting this (there currently is none — grep `outlook/categories` in `tests/` to confirm). While there, delete the unreachable `backend/routes-outlook-integration.js` (never required anywhere).

## Done means

A new test asserting `GET /api/outlook/categories` returns 409 (not 500) for a disconnected user, passing.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
