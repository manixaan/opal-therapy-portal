/opal-critical (sensitive employee data + a new external integration)

**Idea:** Portal Onboarding Workflow

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

Tracker task notes (quoted verbatim, Stage 2): "Add finish the templated
documents and upload to sharepoint as well as portal default packages under
the edit onboarding tab" / "documents in stage 2 need to be finalised and
uploaded both to the sharepoint and the portal (in portal under the default
categories inside the edit onboarding). Check the workflow from stage 1 to 2
if the buttons all work. Should be able to preview, edit (when applicable),
download, replace, remove etc so make sure all buttons in the UI work. Also
simplify UI where necessary"

## Where it lives today

Stage 1/2/3: `backend/onboarding-journey-routes.js`,
`onboarding-defaults-routes.js`, `onboarding-pack-routes.js`,
`onboarding-contract-docx.js`, `frontend/current/onboarding-journey.js`.
SharePoint storage: nothing — no existing pattern in this repo to copy.

## Start here

SharePoint storage is a net-new integration. Decide the auth model first
(an app registration + Microsoft Graph `/sites/{id}/drive`, vs. a service
account) — this is a decision for Anthony, not a coding step. Once decided,
add `backend/onboarding-sharepoint.js` alongside the existing
`onboarding-pack-db.js` storage pattern, wire a new route into
`onboarding-pack-routes.js`, and add an integration test modeled on
`tests/integration/onboarding-pack.itest.js`.

## Done means

A new integration test proves a finished onboarding document round-trips to
SharePoint and back — moving the Stage 2 SharePoint piece from `untouched`
to `proven`. (Everything else in this feature is already proven; update the
tracker's Stage 1/2/3 checklists to reflect that once this is read.)

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
