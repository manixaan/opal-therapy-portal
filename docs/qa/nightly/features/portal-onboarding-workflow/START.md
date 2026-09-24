/opal-critical

**Idea**
Portal Onboarding Workflow

**Why** / **Who uses it** / **What they see** / **What should happen** / **Outcome**
(not yet written in the tracker at the feature level — see task notes below)

Stage 2's own checklist item, quoted verbatim, is the remaining biggest gap
now that the dynamic contract is built: "Finalise the onboarding documents
and store them in SharePoint" — "documents in stage 2 need to be finalised
and uploaded both to the sharepoint and the portal (in portal under the
default categories inside the edit onbaording)."

## Where it lives today

The dynamic Contract of Employment is built:
`backend/onboarding-contract-docx.js` composes it from the same offer
terms the Letter of Offer uses, and `backend/onboarding-document-reader.js`
reads it back on return. Passing unit + integration tests. What's still
not built: **SharePoint storage** — no upload/storage dependency or code
exists anywhere; documents persist in Postgres today via
`onboarding-catalogue.js`/`onboarding-pack.js`/`onboarding-pack-routes.js`.
Stage 1's "Send button" is also still an Outlook draft, not a real send.

## Start here

This needs a team decision before code: is SharePoint storage still wanted
at all, given documents already persist reliably in Postgres today? If
yes, the smallest next step is picking a Microsoft Graph SharePoint
library/site to write to (the codebase already has a working Graph
integration pattern for Outlook — `backend/outlook-oauth.js` — to copy the
auth approach from), then a new `onboarding-sharepoint.js` that uploads a
finished pack item alongside its existing Postgres write, not instead of
it. Separately, confirm whether the Outlook-draft "Send" is still the
wanted design for Stage 1.

## Done means

For SharePoint: an integration test proving a finished onboarding document
lands in the chosen SharePoint location, alongside its existing portal
storage — plus the "still wanted?" decision recorded in the tracker first.
For Stage 1 Send: a decision recorded in the tracker on whether
Outlook-draft-then-manual-send is the final design.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
