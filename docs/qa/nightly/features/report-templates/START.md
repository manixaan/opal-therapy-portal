/opal-feature

# Report Templates

**Idea**

Report Templates

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

- FCA: `backend/fca-routes.js` (covered under Interactive Assessments).
- Progress Letter: `backend/letter-routes.js` — `requireAuth` on `/api/letters` (line 166). Note: `file` reports this source file as non-ASCII ("data"); `node --check` still passes cleanly — unusual encoding, not a defect.
- `backend/templates-routes.js` — `requireAuth` on `/api/templates` (line 113).
- Client Agreement Form: **no distinct route or file found.** `backend/service-agreements/` contains only a `templates/` subfolder, nothing is mounted under that name in `server.js`. `tests/templates-service-agreement-map.test.js` exercises this mapping from inside `templates-routes.js` instead, which matches the tracker's own suspicion that this card is just the existing Service Agreement template.

## Start here

Confirm with the team whether "Client Agreement Form" means the existing Service Agreement template (`backend/service-agreements/templates/`) — if so, close that task as a duplicate. Then add one Playwright check per template (pattern: `e2e/tests/portal.spec.js`) that generates an FCA report and a Progress Letter and asserts the download succeeds.

## Done means

A passing e2e spec covering at least the FCA and Progress Letter generation flows.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
